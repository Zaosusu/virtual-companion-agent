import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { loadLocalEnv } from "./src/env.js";
import { extractMemoryCandidates, buildTurnSummary, compressConversation } from "./src/agent.js";
import { CompanionStore } from "./src/db.js";
import { buildVoiceAgentDecision, orchestrateCompanionTurn } from "./src/orchestrator/index.js";
import { runCragRetrieval } from "./src/orchestrator/memoryAgent.js";
import { attachStepFunRealtimeBridge } from "./src/realtime/stepfunRealtimeBridge.js";
import { generateImage } from "./src/tools/imageGeneration.js";
import { cloneVoice, synthesizeSpeech, previewVoice } from "./src/tools/speechSynthesis.js";
import {
  agentFromImport,
  agentToPack,
  characterFromAgent,
  getEffectiveModelConfig,
  toPublicModelConfig
} from "./src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envInfo = loadLocalEnv({ dir: __dirname });
const PORT = Number(process.env.PORT || 5177);
const HOST = process.env.COMPANION_HOST || "127.0.0.1";
const DATA_DIR = process.env.COMPANION_DATA_DIR
  ? path.resolve(process.env.COMPANION_DATA_DIR)
  : path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "companion.sqlite");
const store = new CompanionStore(DB_PATH);
const COMPRESSION_MESSAGE_WINDOW = Number(process.env.COMPANION_COMPRESSION_WINDOW || 100);
const FREE_DAILY_CHAT_LIMIT = Number(process.env.COMPANION_FREE_DAILY_CHAT_LIMIT || 10);
const PUBLIC_FREE_ACCESS_ENABLED = process.env.COMPANION_PUBLIC_FREE_ACCESS === "1";
const SELF_HOSTED_ENABLED = process.env.COMPANION_SELF_HOSTED === "1";
const DEBUG_TRACE_ENABLED = process.env.COMPANION_DEBUG_TRACE !== "0";
const chatQueues = new Map();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"]
]);

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function getRuntimeConfig() {
  const agent = store.getActiveAgent();
  const character = characterFromAgent(agent);
  const modelConfig = getEffectiveModelConfig(store, process.env);
  return { agent, character, modelConfig };
}

function createTraceId(prefix = "chat") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function traceLog(traceId, stage, payload = {}) {
  if (!DEBUG_TRACE_ENABLED) return;
  const prefix = traceId ? `[trace:${traceId}]` : "[trace]";
  console.log(prefix, stage, payload);
}

function enqueueByKey(key, task) {
  const previous = chatQueues.get(key) || Promise.resolve();
  const queued = previous.catch(() => {}).then(task);
  const tracked = queued.finally(() => {
    if (chatQueues.get(key) === tracked) chatQueues.delete(key);
  });
  chatQueues.set(key, tracked);
  return tracked;
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    const { modelConfig } = getRuntimeConfig();
    return sendJson(res, 200, {
      ok: true,
      mode: modelConfig.mode,
      capabilities: {
        chat: Boolean(modelConfig.enabled || modelConfig.officialEnabled || (PUBLIC_FREE_ACCESS_ENABLED && modelConfig.officialBaseUrl)),
        image: Boolean(modelConfig.imageOutputAvailable),
        voice: Boolean(modelConfig.audioEnabled),
        realtimeVoice: Boolean(modelConfig.realtimeEnabled)
      }
    });
  }

  if (req.method === "GET" && pathname === "/api/realtime/diagnostics") {
    const { modelConfig } = getRuntimeConfig();
    const startedAt = Date.now();
    const result = {
      enabled: Boolean(modelConfig.realtimeEnabled),
      mode: modelConfig.mode,
      target: safeRealtimeTarget(modelConfig.realtimeUrl),
      model: modelConfig.realtimeModel || "",
      hasToken: Boolean(modelConfig.realtimeApiKey),
      websocket: "未检测",
      ready: "未检测",
      elapsedMs: 0
    };
    try {
      const probe = await probeRealtimeBackend(modelConfig);
      Object.assign(result, probe);
    } catch (error) {
      result.websocket = "失败";
      result.ready = error.message || "实时后端检测失败";
    }
    result.elapsedMs = Date.now() - startedAt;
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    const { agent, character, modelConfig } = getRuntimeConfig();
    const authUser = await resolveOfficialUser(modelConfig);
    sendJson(res, 200, {
      active_agent_id: agent.id,
      agents: store.getAgents(),
      agent,
      character,
      model_config: toPublicModelConfigWithUser(modelConfig, authUser),
      auth_user: authUser,
      memory: store.getMemorySnapshot({ agentId: agent.id }),
      recent_messages: store.getRecentMessages(agent.id, 30),
      db_path: DB_PATH,
      llm_enabled: modelConfig.enabled
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/agents") {
    const activeAgentId = store.getActiveAgentId();
    sendJson(res, 200, {
      active_agent_id: activeAgentId,
      agents: store.getAgents(),
      active_agent: store.getAgent(activeAgentId)
    });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/agents/")) {
    const id = decodeURIComponent(pathname.split("/").at(-1));
    const agent = store.getAgent(id);
    if (!agent) return sendJson(res, 404, { error: "agent not found" });
    sendJson(res, 200, { agent, pack: agentToPack(agent) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/agents") {
    const body = await readBody(req);
    const agent = store.upsertAgent({ ...body.agent, isBuiltin: false });
    store.setActiveAgent(agent.id);
    sendJson(res, 200, { ok: true, agent, agents: store.getAgents(), active_agent_id: agent.id });
    return;
  }

  if (req.method === "POST" && pathname === "/api/agents/import") {
    const body = await readBody(req);
    const agent = store.upsertAgent(agentFromImport(body.pack || body));
    store.setActiveAgent(agent.id);
    sendJson(res, 200, { ok: true, agent, agents: store.getAgents(), active_agent_id: agent.id });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/agents/") && pathname.endsWith("/activate")) {
    const id = decodeURIComponent(pathname.split("/").at(-2));
    store.setActiveAgent(id);
    const agent = store.getAgent(id);
    sendJson(res, 200, {
      ok: true,
      active_agent_id: id,
      agent,
      character: characterFromAgent(agent),
      recent_messages: store.getRecentMessages(id, 30)
    });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/agents/") && pathname.endsWith("/clone")) {
    const id = decodeURIComponent(pathname.split("/").at(-2));
    const agent = store.createAgentFromTemplate(id);
    store.setActiveAgent(agent.id);
    sendJson(res, 200, { ok: true, agent, agents: store.getAgents(), active_agent_id: agent.id });
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/agents/")) {
    const id = decodeURIComponent(pathname.split("/").at(-1));
    store.deleteAgent(id);
    sendJson(res, 200, { ok: true, active_agent_id: store.getActiveAgentId(), agents: store.getAgents() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/config") {
    const { agent, modelConfig } = getRuntimeConfig();
    sendJson(res, 200, {
      agent,
      model_config: toPublicModelConfig(modelConfig)
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/config") {
    const body = await readBody(req);
    if (body.model_config) {
      const modelConfigBody = body.model_config;
      store.saveModelConfig({
        enabled: SELF_HOSTED_ENABLED ? modelConfigBody.enabled : false,
        baseUrl: SELF_HOSTED_ENABLED ? modelConfigBody.baseUrl : undefined,
        apiKey: SELF_HOSTED_ENABLED ? modelConfigBody.apiKey : undefined,
        model: SELF_HOSTED_ENABLED ? modelConfigBody.model : undefined,
        imageOutputEnabled: modelConfigBody.imageOutputEnabled,
        imageBaseUrl: SELF_HOSTED_ENABLED ? modelConfigBody.imageBaseUrl : undefined,
        imageApiKey: SELF_HOSTED_ENABLED ? modelConfigBody.imageApiKey : undefined,
        imageModel: modelConfigBody.imageModel,
        officialBaseUrl: modelConfigBody.officialBaseUrl,
        officialLicenseKey: modelConfigBody.officialLicenseKey,
        officialUserToken: modelConfigBody.officialUserToken,
        officialModel: modelConfigBody.officialModel,
        clearApiKey: !SELF_HOSTED_ENABLED || Boolean(modelConfigBody.clearApiKey),
        clearImageApiKey: !SELF_HOSTED_ENABLED || Boolean(modelConfigBody.clearImageApiKey),
        clearAudioApiKey: !SELF_HOSTED_ENABLED || Boolean(modelConfigBody.clearAudioApiKey),
        clearOfficialLicenseKey: Boolean(modelConfigBody.clearOfficialLicenseKey),
        clearOfficialUserToken: Boolean(modelConfigBody.clearOfficialUserToken)
      });
    }
    if (body.agent) {
      const current = store.getActiveAgent();
      const agent = store.upsertAgent({ ...current, ...body.agent, id: body.agent.id || current.id });
      store.setActiveAgent(agent.id);
    }
    const { agent, character, modelConfig } = getRuntimeConfig();
    sendJson(res, 200, {
      ok: true,
      agent,
      character,
      model_config: toPublicModelConfig(modelConfig),
      agents: store.getAgents()
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/send-code") {
    const body = await readBody(req);
    const { modelConfig } = getRuntimeConfig();
    try {
      const data = await callOfficialAuth({ modelConfig, path: pathname, body });
      return sendJson(res, 200, { ok: true, ...data });
    } catch (error) {
      return sendJson(res, 500, { error: error.message || "send code failed" });
    }
  }

  if (req.method === "POST" && (pathname === "/api/auth/register" || pathname === "/api/auth/login" || pathname === "/api/auth/reset-password")) {
    const body = await readBody(req);
    const { modelConfig } = getRuntimeConfig();
    try {
      const data = await callOfficialAuth({
        modelConfig,
        path: pathname,
        body
      });
      const authToken = data.token || data.accessToken || data.access_token || data.userToken || data.user_token || "";
      if (!authToken) {
        return sendJson(res, 502, {
          error: "账号服务没有返回登录凭证，请稍后重试。",
          code: "missing_auth_token"
        });
      }
      store.saveModelConfig({
        officialBaseUrl: modelConfig.officialBaseUrl,
        officialModel: modelConfig.officialModel,
        officialUserToken: authToken
      });
      const nextConfig = getRuntimeConfig().modelConfig;
      return sendJson(res, 200, {
        ok: true,
        user: data.user,
        model_config: toPublicModelConfigWithUser(nextConfig, data.user)
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message || "auth failed" });
    }
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    const { modelConfig } = getRuntimeConfig();
    if (!modelConfig.officialUserToken) return sendJson(res, 200, { user: null, model_config: toPublicModelConfig(modelConfig) });
    try {
      const data = await callOfficialMe({ modelConfig });
      return sendJson(res, 200, { user: data.user, model_config: toPublicModelConfigWithUser(modelConfig, data.user) });
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        store.saveModelConfig({ clearOfficialUserToken: true });
        const nextConfig = getRuntimeConfig().modelConfig;
        return sendJson(res, 200, { user: null, model_config: toPublicModelConfig(nextConfig) });
      }
      return sendJson(res, 200, {
        user: null,
        authPending: true,
        model_config: toPublicModelConfig(modelConfig)
      });
    }
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    store.saveModelConfig({ clearOfficialUserToken: true });
    const { modelConfig } = getRuntimeConfig();
    return sendJson(res, 200, { ok: true, user: null, model_config: toPublicModelConfig(modelConfig) });
  }

  if (req.method === "POST" && pathname === "/api/auth/bind-license") {
    const body = await readBody(req);
    const { modelConfig } = getRuntimeConfig();
    if (!modelConfig.officialUserToken) {
      return sendJson(res, 401, { error: "请先注册或登录账号，再绑定授权码。" });
    }
    const licenseKey = body.licenseKey || body.officialLicenseKey || modelConfig.officialLicenseKey || "";
    try {
      const data = await callOfficialBindLicense({
        modelConfig,
        licenseKey
      });
      store.saveModelConfig({
        clearOfficialLicenseKey: true,
        officialBaseUrl: modelConfig.officialBaseUrl,
        officialModel: modelConfig.officialModel
      });
      const nextConfig = getRuntimeConfig().modelConfig;
      return sendJson(res, 200, {
        ok: true,
        user: data.user,
        license: data.license,
        model_config: toPublicModelConfigWithUser(nextConfig, data.user)
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message || "bind license failed" });
    }
  }

  if (req.method === "GET" && pathname === "/api/memories/search") {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const query = url.searchParams.get("q") || "";
    const { agent } = getRuntimeConfig();
    sendJson(res, 200, { query, results: query ? store.retrieveMemories(query, { limit: 12, agentId: agent.id }) : [] });
    return;
  }

  if (req.method === "GET" && pathname === "/api/messages") {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const beforeId = Number(url.searchParams.get("before_id") || 0);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 80);
    if (!Number.isFinite(beforeId) || beforeId <= 0) {
      return sendJson(res, 400, { error: "before_id is required" });
    }
    const { agent } = getRuntimeConfig();
    const messages = store.getMessagesBefore({ sessionId: agent.id, beforeId, limit });
    sendJson(res, 200, {
      ok: true,
      messages,
      has_more: messages.length === limit
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/persona-corpus/import") {
    const body = await readBody(req);
    const text = String(body.text || body.input || "").trim();
    if (text.length < 20) return sendJson(res, 400, { error: "请先放入足够的人物语料。" });
    const { agent } = getRuntimeConfig();
    const imported = importPersonaCorpus({
      agentId: agent.id,
      text,
      sourceName: body.sourceName || "人物资料",
      relation: body.relation || "unknown"
    });
    sendJson(res, 200, {
      ok: true,
      imported,
      memory: store.getMemorySnapshot({ perKind: 12, agentId: agent.id })
    });
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/messages/")) {
    const id = Number(decodeURIComponent(pathname.split("/").at(-1)));
    if (!Number.isFinite(id)) return sendJson(res, 400, { error: "message id is required" });
    const { agent } = getRuntimeConfig();
    const deleted = store.deleteMessage({ sessionId: agent.id, id });
    sendJson(res, 200, {
      ok: true,
      deleted,
      recent_messages: store.getRecentMessages(agent.id, 30)
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/messages/clear") {
    const { agent } = getRuntimeConfig();
    const deleted = store.clearMessages(agent.id);
    sendJson(res, 200, {
      ok: true,
      deleted,
      recent_messages: []
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/appearance/analyze") {
    const body = await readBody(req);
    const image = body.image || {};
    if (!image.data) return sendJson(res, 400, { error: "请先上传一张图片。" });
    const { modelConfig } = getRuntimeConfig();
    try {
      const appearance = await analyzeAppearanceFromImage({
        image,
        currentAppearance: body.currentAppearance || "",
        llm: resolveVisionChatModel(modelConfig)
      });
      sendJson(res, 200, { ok: true, appearance });
    } catch (error) {
      sendJson(res, 500, { error: publicAppearanceError(error) });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/debug/state") {
    if (process.env.COMPANION_DEBUG_API !== "1") {
      return sendJson(res, 404, { error: "not found" });
    }
    const { agent, modelConfig } = getRuntimeConfig();
    sendJson(res, 200, {
      db_path: DB_PATH,
      compression_window: COMPRESSION_MESSAGE_WINDOW,
      active_agent: agent,
      model: toPublicModelConfig(modelConfig),
      uncompressed_message_count: store.getUncompressedMessageCount(agent.id),
      recent_messages: store.getRecentMessages(agent.id, 30),
      memory: store.getMemorySnapshot({ perKind: 20, agentId: agent.id })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat") {
    const traceId = createTraceId();
    const chatStartedAt = Date.now();
    const body = await readBody(req);
    const message = String(body.message || "").trim();
    if (!message) return sendJson(res, 400, { error: "message is required" });

    const { agent, character, modelConfig } = getRuntimeConfig();
    return enqueueByKey(`chat:${agent.id}`, async () => {
    traceLog(traceId, "chat.start", { messageChars: message.length, agentId: agent.id });
    const sessionId = agent.id;
    const quota = prepareChatAccess(modelConfig);
    if (!quota.allowed && quota.code === "official_license_required") {
      return sendAuthorizationRequired(res);
    }
    if (!quota.allowed) {
      return sendJson(res, 429, {
        error: quota.message,
        code: "free_quota_exceeded",
        quota
      });
    }
    const userMessageId = store.addMessage({ sessionId, role: "user", content: message, status: "active" });
    const ragStartedAt = Date.now();
    const history = store.getRecentMessages(sessionId, 14).map((item) => ({
      role: item.role,
      content: item.content
    }));
    const { retrievedMemories, retrievalPlan } = runCragRetrieval({
      store,
      agentId: agent.id,
      message,
      history,
      limit: 8
    });
    const memory = store.getMemorySnapshot({ agentId: agent.id });
    traceLog(traceId, "chat.context_ready", {
      elapsedMs: Date.now() - ragStartedAt,
      agentId: agent.id,
      historyCount: history.length,
      retrievedCount: retrievedMemories.length,
      retrievalQuality: retrievalPlan.quality,
      strictEvidence: retrievalPlan.strictEvidence,
      personaCorpusItems: memory.persona_corpus?.length || 0
    });
    traceLog(traceId, "memory_agent.crag", {
      agentId: agent.id,
      originalQuery: retrievalPlan.originalQuery,
      rewrittenQuery: retrievalPlan.rewrittenQuery,
      intent: retrievalPlan.intent,
      quality: retrievalPlan.quality,
      evidenceCount: retrievalPlan.evidenceCount,
      rejectedCount: retrievalPlan.rejectedCount,
      rounds: retrievalPlan.rounds,
      evidence: retrievedMemories.slice(0, 5).map((item) => ({
        kind: item.kind,
        score: item.evidenceScore,
        rank: item.evidenceRank,
        query: item.retrievalQuery,
        preview: String(item.content || "").replace(/\s+/g, " ").slice(0, 180)
      }))
    });

    let turn;
    try {
      turn = await orchestrateCompanionTurn({
        agent,
        character,
        memory,
        retrievedMemories,
        retrievalPlan,
        message,
        history,
        llm: {
          ...resolveChatModel(modelConfig),
          imageOutputEnabled: modelConfig.imageOutputEnabled,
          imageOutputAvailable: modelConfig.imageOutputAvailable,
          image: {
            baseUrl: modelConfig.imageBaseUrl,
            apiKey: modelConfig.imageApiKey,
            model: modelConfig.imageModel
          }
        },
        modelConfig,
        traceId
      });
    } catch (error) {
      traceLog(traceId, "chat.error", {
        elapsedMs: Date.now() - chatStartedAt,
        code: error.code || "",
        status: error.status || "",
        message: error.message
      });
      if (isQuotaOrBillingError(error)) {
        return sendJson(res, error.code === "quota_exceeded" ? 402 : 401, {
          error: error.publicMessage || publicQuotaMessage(error),
          code: error.code || "quota_exceeded",
          upgrade: buildUpgradePrompt(),
          quota
        });
      }
      if (error.code) {
        return sendJson(res, Number(error.status || 500), {
          error: error.publicMessage || error.message || "服务暂时不可用，请稍后再试。",
          code: error.code
        });
      }
      throw error;
    }

    traceLog(traceId, "chat.success", {
      elapsedMs: Date.now() - chatStartedAt,
      replySource: turn.reply?.source || "",
      outputs: (turn.orchestration?.outputs || []).map((item) => item.type)
    });
    sendJson(res, 200, finalizeChatTurn({
      agent,
      sessionId,
      message,
      userMessageId,
      reply: turn.reply,
      orchestration: turn.orchestration,
      retrievedMemories,
      retrievalPlan,
      quota
    }));
    });
  }

  if (req.method === "POST" && pathname === "/api/chat/regenerate") {
    const traceId = createTraceId("regen");
    const chatStartedAt = Date.now();
    const body = await readBody(req);
    const oldAssistantId = Number(body.message_id || body.messageId || 0);
    const requestId = String(body.requestId || traceId);
    if (!Number.isFinite(oldAssistantId) || oldAssistantId <= 0) {
      return sendJson(res, 400, { error: "message_id is required" });
    }

    const { agent, character, modelConfig } = getRuntimeConfig();
    return enqueueByKey(`chat:${agent.id}`, async () => {
      const sessionId = agent.id;
      const requestedAssistant = store.getMessage(oldAssistantId);
      const lastAssistant = store.getLastActiveAssistantMessage(sessionId);
      const oldAssistant = requestedAssistant?.sessionId === sessionId
        && requestedAssistant.role === "assistant"
        && requestedAssistant.status === "active"
        ? requestedAssistant
        : lastAssistant;
      if (!oldAssistant) {
        return sendJson(res, 404, { error: "没有可替换的最后一条 AI 回复。" });
      }
      if (!lastAssistant || Number(lastAssistant.id) !== Number(oldAssistant.id)) {
        return sendJson(res, 409, { error: "只能替换最后一条 AI 回复。" });
      }
      const userMessage = oldAssistant.parentId ? store.getMessage(oldAssistant.parentId) : null;
      if (!userMessage || userMessage.sessionId !== sessionId || userMessage.role !== "user" || userMessage.status !== "active") {
        return sendJson(res, 409, { error: "找不到这条回复对应的用户消息。" });
      }

      traceLog(traceId, "chat.regenerate.start", { requestId, agentId: agent.id, oldAssistantId });
      const quota = prepareChatAccess(modelConfig);
      if (!quota.allowed && quota.code === "official_license_required") {
        return sendAuthorizationRequired(res);
      }
      if (!quota.allowed) {
        return sendJson(res, 429, {
          error: quota.message,
          code: "free_quota_exceeded",
          quota
        });
      }

      const message = userMessage.content;
      const history = store.getActiveMessagesBefore({
        sessionId,
        beforeId: oldAssistant.id,
        limit: 20
      })
        .filter((item) => item.id !== oldAssistant.id)
        .map((item) => ({ role: item.role, content: item.content }));
      const { retrievedMemories, retrievalPlan } = runCragRetrieval({
        store,
        agentId: agent.id,
        message,
        history,
        limit: 8
      });
      const memory = store.getMemorySnapshot({ agentId: agent.id });

      let turn;
      try {
        turn = await orchestrateCompanionTurn({
          agent,
          character,
          memory,
          retrievedMemories,
          retrievalPlan,
          message,
          history,
          llm: {
            ...resolveChatModel(modelConfig),
            imageOutputEnabled: modelConfig.imageOutputEnabled,
            imageOutputAvailable: modelConfig.imageOutputAvailable,
            image: {
              baseUrl: modelConfig.imageBaseUrl,
              apiKey: modelConfig.imageApiKey,
              model: modelConfig.imageModel
            }
          },
          modelConfig,
          traceId
        });
      } catch (error) {
        traceLog(traceId, "chat.regenerate.error", {
          elapsedMs: Date.now() - chatStartedAt,
          code: error.code || "",
          status: error.status || "",
          message: error.message
        });
        if (isQuotaOrBillingError(error)) {
          return sendJson(res, error.code === "quota_exceeded" ? 402 : 401, {
            error: error.publicMessage || publicQuotaMessage(error),
            code: error.code || "quota_exceeded",
            upgrade: buildUpgradePrompt(),
            quota
          });
        }
        if (error.code) {
          return sendJson(res, Number(error.status || 500), {
            error: error.publicMessage || error.message || "服务暂时不可用，请稍后再试。",
            code: error.code
          });
        }
        throw error;
      }

      traceLog(traceId, "chat.regenerate.success", {
        elapsedMs: Date.now() - chatStartedAt,
        replySource: turn.reply?.source || ""
      });
      sendJson(res, 200, finalizeRegeneratedChatTurn({
        agent,
        sessionId,
        userMessage,
        oldAssistant,
        requestId,
        reply: turn.reply,
        orchestration: turn.orchestration,
        retrievedMemories,
        retrievalPlan,
        quota
      }));
    });
  }

  if (req.method === "POST" && pathname === "/api/tts") {
    const body = await readBody(req);
    const text = String(body.text || body.input || "").trim();
    if (!text) return sendJson(res, 400, { error: "text is required" });
    const { agent, modelConfig } = getRuntimeConfig();
    if (!usesOfficialGateway(modelConfig) && !SELF_HOSTED_ENABLED) {
      return sendAuthorizationRequired(res);
    }
    try {
      const voiceDecision = buildVoiceAgentDecision({
        text,
        context: body.context,
        agent
      });
      const audioConfig = applyTtsOverrides(audioConfigFromModel(modelConfig, agent, voiceDecision), body, agent);
      const audio = usesOfficialGateway(modelConfig)
        ? await callOfficialTtsGatewayWithFallback({
          modelConfig,
          text,
          audioConfig
        })
        : await synthesizeSpeech({
          text,
          audioConfig
        });
      const shouldPersistMessage = body.persistMessage !== false;
      let messageId = null;
      let message = null;
      if (shouldPersistMessage) {
        store.deleteRecentAssistantTextMessage({ sessionId: agent.id, content: text });
        messageId = store.addMessage({
          sessionId: agent.id,
          role: "assistant",
          content: text,
          workflow: "voice",
          source: "tool:voice.speech",
          metadata: {
            type: "voice",
            audio: {
              audioBase64: audio.audioBase64,
              audioUrl: audio.audioUrl,
              mimeType: audio.mimeType,
              format: audio.format
            },
            transcript: text,
            voiceAgent: voiceDecision
          }
        });
        message = store.getMessage(messageId);
      }
      sendJson(res, 200, {
        ok: true,
        messageId,
        message,
        audioBase64: audio.audioBase64,
        audioUrl: audio.audioUrl,
        mimeType: audio.mimeType,
        format: audio.format,
        voiceAgent: voiceDecision
      });
    } catch (error) {
      if (isQuotaOrBillingError(error)) {
        return sendJson(res, error.code === "quota_exceeded" ? 402 : 401, {
          error: error.publicMessage || publicQuotaMessage(error),
          code: error.code || "quota_exceeded",
          upgrade: buildUpgradePrompt()
        });
      }
      console.error("[audio] tts failed", {
        message: error.message,
        cause: error.cause?.message || String(error.cause || "")
      });
      sendJson(res, 500, { error: error.message || "tts failed" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/image") {
    const body = await readBody(req);
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return sendJson(res, 400, { error: "prompt is required" });
    const { agent, character, modelConfig } = getRuntimeConfig();
    if (!usesOfficialGateway(modelConfig) && !SELF_HOSTED_ENABLED) {
      return sendAuthorizationRequired(res);
    }
    try {
      const referenceImage = body.useReferenceImage === false ? null : character.runtime_config?.referenceImage;
      const localImageConfig = {
        baseUrl: SELF_HOSTED_ENABLED ? (body.baseUrl || modelConfig.imageBaseUrl || modelConfig.baseUrl) : "",
        apiKey: SELF_HOSTED_ENABLED ? (body.apiKey || modelConfig.imageApiKey || modelConfig.apiKey) : "",
        model: SELF_HOSTED_ENABLED ? (body.model || modelConfig.imageModel || modelConfig.model) : modelConfig.imageModel,
        size: body.size,
        styleReferenceWeight: body.styleReferenceWeight
      };
      const image = usesOfficialGateway(modelConfig)
        ? await callOfficialImageGatewayWithFallback({
          modelConfig,
          body,
          prompt,
          referenceImage,
          localImageConfig
        })
        : await generateImage({
          prompt,
          imageConfig: localImageConfig,
          referenceImage
        });
      const content = String(body.content || "给你发来一张图片。").trim();
      const messageId = store.addMessage({
        sessionId: agent.id,
        role: "assistant",
        content,
        workflow: "image_request",
        source: "tool:image.generate",
        metadata: {
          type: "image",
          imageUrl: image.url || "",
          b64Json: image.b64Json || "",
          prompt,
          seed: image.seed,
          finishReason: image.finishReason || "",
          referenceMode: image.referenceMode || "none",
          imageEndpoint: image.endpoint || ""
        }
      });
      sendJson(res, 200, { ok: true, image, message: store.getMessage(messageId), message_id: messageId });
    } catch (error) {
      if (isQuotaOrBillingError(error)) {
        return sendJson(res, error.code === "quota_exceeded" ? 402 : 401, {
          error: error.publicMessage || publicQuotaMessage(error),
          code: error.code || "quota_exceeded",
          upgrade: buildUpgradePrompt()
        });
      }
      console.error("[image] generation failed", {
        message: error.message,
        cause: error.cause?.message || String(error.cause || "")
      });
      sendJson(res, 500, { error: error.message || "image generation failed" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/audio/voices/preview") {
    if (process.env.COMPANION_DEBUG_API !== "1") {
      return sendJson(res, 404, { error: "not found" });
    }
    const body = await readBody(req);
    const { modelConfig } = getRuntimeConfig();
    try {
      const audio = usesOfficialGateway(modelConfig)
        ? await callOfficialVoicePreviewGateway({ modelConfig, body })
        : await previewVoice({
          audioConfig: audioConfigFromModel(modelConfig),
          body: {
            ...body,
            extraBody: parseJsonObject(body.extraBody)
          }
        });
      sendJson(res, 200, { ok: true, ...audio });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "voice preview failed" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/audio/voices/clone") {
    if (process.env.COMPANION_DEBUG_API !== "1") {
      return sendJson(res, 404, { error: "not found" });
    }
    const body = await readBody(req);
    const { agent, modelConfig } = getRuntimeConfig();
    try {
      const voice = usesOfficialGateway(modelConfig)
        ? await callOfficialVoiceCloneGateway({ modelConfig, body })
        : await cloneVoice({
          audioConfig: audioConfigFromModel(modelConfig, agent),
          body: {
            ...body,
            file_id: body.file_id || body.fileId || "",
            audioBase64: body.audioBase64 || body.audio?.data || "",
            text: body.sampleText || body.text,
            extraBody: parseJsonObject(body.extraBody)
          }
        });
      if (voice.voiceId) {
        store.upsertAgent({
          ...agent,
          clonedVoiceId: voice.voiceId,
          voiceSampleName: body.fileName || body.name || "已克隆音色"
        });
      }
      sendJson(res, 200, { ok: true, ...voice });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "voice clone failed" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/voice/clone") {
    const body = await readBody(req);
    const { agent, modelConfig } = getRuntimeConfig();
    try {
      const voice = usesOfficialGateway(modelConfig)
        ? await callOfficialVoiceCloneGateway({ modelConfig, body })
        : await cloneVoice({
          audioConfig: audioConfigFromModel(modelConfig, agent),
          body: {
            audioBase64: body.audioBase64 || "",
            text: body.sampleText || body.text || "",
            fileName: body.fileName || "",
            mime: body.mime || "",
            extraBody: {}
          }
        });
      if (voice.voiceId) {
        store.upsertAgent({
          ...agent,
          clonedVoiceId: voice.voiceId,
          voiceSampleName: body.fileName || "已克隆声音"
        });
      }
      sendJson(res, 200, { ok: true, voiceId: voice.voiceId || "", voiceSampleName: body.fileName || "" });
    } catch (error) {
      sendJson(res, 500, { error: publicVoiceCloneError(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/memory/reset") {
    sendJson(res, 200, { ok: true, memory: store.resetUserData() });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

function maybeCompressConversation(sessionId, agentId = sessionId) {
  const count = store.getUncompressedMessageCount(sessionId);
  if (count < COMPRESSION_MESSAGE_WINDOW) return { triggered: false, uncompressed_count: count };
  return store.runInTransaction(() => {
    const messages = store.getOldestUncompressedMessages(sessionId, COMPRESSION_MESSAGE_WINDOW);
    if (messages.length < COMPRESSION_MESSAGE_WINDOW) return { triggered: false, uncompressed_count: messages.length };
    const id = store.upsertMemory({
      kind: "summary",
      content: compressConversation(messages),
      importance: 0.82,
      confidence: 0.72,
      sourceMessageId: messages.at(-1)?.id,
      metadata: {
        compression: true,
        agentId,
        sessionId,
        fromMessageId: messages[0].id,
        toMessageId: messages.at(-1).id,
        messageCount: messages.length
      }
    });
    store.markMessagesCompressed(messages.map((item) => item.id));
    return {
      triggered: true,
      summary_memory_id: id,
      compressed_messages: messages.length,
      from_message_id: messages[0].id,
      to_message_id: messages.at(-1).id,
      remaining_uncompressed_count: store.getUncompressedMessageCount(sessionId)
    };
  });
}

function finalizeChatTurn({ agent, sessionId, message, userMessageId, reply, orchestration, retrievedMemories, retrievalPlan, quota }) {
  const outputs = orchestration?.outputs || [];
  const hasVoiceOutput = outputs.some((output) => output.type === "voice");
  const hasTextOutput = outputs.some((output) => output.type === "text");
  const shouldPersistAssistantText = reply.source !== "tool:image.generate" && hasTextOutput && !hasVoiceOutput;
  const assistantMessageId = shouldPersistAssistantText
    ? store.addMessage({
      sessionId,
      role: "assistant",
      content: reply.text,
      status: "active",
      parentId: userMessageId,
      variantGroupId: `variant:${userMessageId}`,
      variantIndex: 0,
      mood: reply.mood,
      workflow: reply.workflow,
      safetyLevel: reply.safety?.level,
      source: reply.source
    })
    : null;

  const saved = [];
  for (const candidate of extractMemoryCandidates(message)) {
    if (candidate.profileName) store.setProfile("name", candidate.profileName);
    const id = store.upsertMemory({
      kind: candidate.kind,
      content: candidate.text,
      importance: candidate.importance,
      sourceMessageId: userMessageId,
      metadata: { bucket: candidate.bucket, extractedBy: "regex-v0", agentId: agent.id }
    });
    if (id) saved.push({ ...candidate, id });
  }

  if (reply.safety?.level === "crisis") {
    const id = store.upsertMemory({
      kind: "safety_note",
      content: "用户曾出现可能涉及自伤/轻生的表达，后续陪伴需要优先关注现实安全与求助路径。",
      importance: 0.95,
      confidence: 0.65,
      sourceMessageId: userMessageId,
      metadata: { safetyLevel: "crisis", agentId: agent.id }
    });
    saved.push({ id, kind: "safety_note", text: "危机安全提示" });
  }

  const voiceOutput = outputs.find((output) => output.type === "voice");
  const memoryReply = hasVoiceOutput
    ? { ...reply, text: voiceOutput?.text || reply.text, workflow: "voice" }
    : reply;
  store.upsertMemory({
    kind: "summary",
    content: buildTurnSummary({ message, reply: memoryReply }),
    importance: 0.35,
    confidence: 0.65,
    sourceMessageId: assistantMessageId || userMessageId,
    metadata: { workflow: memoryReply.workflow, mood: reply.mood, agentId: agent.id }
  });

  const compression = maybeCompressConversation(sessionId, agent.id);
  return {
    reply,
    orchestration,
    outputs,
    router: orchestration?.router || null,
    agent,
    memory: store.getMemorySnapshot({ agentId: agent.id }),
    retrieved_memories: retrievedMemories,
    retrieval_plan: retrievalPlan,
    compression,
    quota: commitChatAccess(quota),
    saved,
    assistant_message_id: assistantMessageId
  };
}

function finalizeRegeneratedChatTurn({ agent, sessionId, userMessage, oldAssistant, requestId, reply, orchestration, retrievedMemories, retrievalPlan, quota }) {
  const outputs = orchestration?.outputs || [];
  const hasVoiceOutput = outputs.some((output) => output.type === "voice");
  const hasTextOutput = outputs.some((output) => output.type === "text");
  const shouldPersistAssistantText = reply.source !== "tool:image.generate" && hasTextOutput && !hasVoiceOutput;
  if (!shouldPersistAssistantText) {
    return {
      request_id: requestId,
      reply,
      orchestration,
      outputs,
      router: orchestration?.router || null,
      agent,
      memory: store.getMemorySnapshot({ agentId: agent.id }),
      retrieved_memories: retrievedMemories,
      retrieval_plan: retrievalPlan,
      quota: commitChatAccess(quota),
      regenerated: false,
      old_assistant_message_id: oldAssistant.id,
      assistant_message_id: null,
      recent_messages: store.getRecentMessages(sessionId, 30)
    };
  }

  const nextVariantIndex = Number(oldAssistant.variantIndex || 0) + 1;
  const newAssistant = store.replaceAssistantMessage({
    oldMessageId: oldAssistant.id,
    newMessage: {
      sessionId,
      role: "assistant",
      content: reply.text,
      status: "active",
      parentId: userMessage.id,
      variantGroupId: oldAssistant.variantGroupId || `variant:${userMessage.id}`,
      variantIndex: nextVariantIndex,
      mood: reply.mood,
      workflow: reply.workflow,
      safetyLevel: reply.safety?.level,
      source: reply.source,
      metadata: {
        regeneratedFrom: oldAssistant.id,
        requestId
      }
    }
  });

  return {
    request_id: requestId,
    reply,
    orchestration,
    outputs,
    router: orchestration?.router || null,
    agent,
    memory: store.getMemorySnapshot({ agentId: agent.id }),
    retrieved_memories: retrievedMemories,
    retrieval_plan: retrievalPlan,
    quota: commitChatAccess(quota),
    regenerated: true,
    old_assistant_message_id: oldAssistant.id,
    assistant_message_id: newAssistant.id,
    assistant_message: newAssistant,
    recent_messages: store.getRecentMessages(sessionId, 30)
  };
}

function importPersonaCorpus({ agentId, text, sourceName, relation }) {
  const clean = normalizeCorpusText(text);
  const chunks = splitCorpusChunks(clean, 700);
  const imported = {
    chunks: 0,
    styles: 0,
    values: 0,
    catchphrases: 0,
    facts: 0
  };

  for (const [index, chunk] of chunks.entries()) {
    const id = store.upsertMemory({
      kind: "persona_corpus",
      content: `人物语料片段 ${index + 1}/${chunks.length}（${sourceName}）：${chunk}`,
      importance: 0.58,
      confidence: 0.72,
      metadata: { agentId, sourceName, relation, corpus: true, index }
    });
    if (id) imported.chunks += 1;
  }

  for (const item of inferPersonaStyle(clean)) {
    const id = store.upsertMemory({
      kind: "persona_style",
      content: item,
      importance: 0.82,
      confidence: 0.68,
      metadata: { agentId, sourceName, relation, extractedBy: "persona-corpus-v1" }
    });
    if (id) imported.styles += 1;
  }

  for (const item of inferPersonaValues(clean)) {
    const id = store.upsertMemory({
      kind: "persona_value",
      content: item,
      importance: 0.78,
      confidence: 0.62,
      metadata: { agentId, sourceName, relation, extractedBy: "persona-corpus-v1" }
    });
    if (id) imported.values += 1;
  }

  for (const item of inferCatchphrases(clean)) {
    const id = store.upsertMemory({
      kind: "persona_catchphrase",
      content: item,
      importance: 0.74,
      confidence: 0.64,
      metadata: { agentId, sourceName, relation, extractedBy: "persona-corpus-v1" }
    });
    if (id) imported.catchphrases += 1;
  }

  for (const item of inferPersonaFacts(clean)) {
    const id = store.upsertMemory({
      kind: "fact",
      content: item,
      importance: 0.7,
      confidence: 0.55,
      metadata: { agentId, sourceName, relation, extractedBy: "persona-corpus-v1", personaCorpus: true }
    });
    if (id) imported.facts += 1;
  }

  return imported;
}

function normalizeCorpusText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 200000);
}

function splitCorpusChunks(text, maxLength) {
  const parts = text
    .split(/\n{2,}|(?<=[。！？!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";
  for (const part of parts) {
    if ((current + part).length > maxLength && current) {
      chunks.push(current.trim());
      current = "";
    }
    current += `${part}\n`;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.slice(0, 180);
}

function inferPersonaStyle(text) {
  const styles = [];
  const exclaimCount = (text.match(/[!！]/g) || []).length;
  const questionCount = (text.match(/[?？]/g) || []).length;
  const emojiCount = (text.match(/[\u{1f300}-\u{1faff}]/gu) || []).length;
  const sentenceParts = text.split(/[。！？!?\n]+/).map((item) => item.trim()).filter(Boolean);
  const avgLength = sentenceParts.length
    ? sentenceParts.reduce((sum, item) => sum + item.length, 0) / sentenceParts.length
    : 0;
  if (avgLength && avgLength <= 18) styles.push("说话习惯：句子偏短，节奏轻快，适合用短句回应。");
  if (avgLength >= 36) styles.push("说话习惯：表达较完整，喜欢把原因和感受讲清楚。");
  if (exclaimCount >= 4) styles.push("语气特征：情绪外放，常用感叹语气。");
  if (questionCount >= 4) styles.push("互动习惯：经常用问句确认对方状态或延续话题。");
  if (emojiCount >= 2) styles.push("表达习惯：会使用表情符号增强亲近感。");
  if (/哈哈|嘿嘿|笑死|救命|真的|就是说|其实|然后|你知道吗/.test(text)) {
    styles.push("口语特征：表达偏自然口语，会使用语气垫词和轻松转场。");
  }
  return [...new Set(styles)].slice(0, 6);
}

function inferPersonaValues(text) {
  const values = [];
  const patterns = [
    [/家人|爸爸|妈妈|亲人|家里/g, "重视家人和亲密关系。"],
    [/朋友|姐妹|队友|同伴/g, "重视朋友、同伴和互相支持。"],
    [/努力|练习|训练|坚持|舞台|工作/g, "看重努力、练习和把事情做好。"],
    [/开心|快乐|自由|舒服|放松/g, "在意快乐、自由和舒服的生活状态。"],
    [/谢谢|感谢|感恩/g, "习惯表达感谢，重视被支持和回应。"],
    [/别担心|没关系|慢慢来|不要怕/g, "倾向于安慰别人，给人稳定感。"]
  ];
  for (const [pattern, value] of patterns) {
    if ((text.match(pattern) || []).length >= 2) values.push(`价值观/在意的事：${value}`);
  }
  return [...new Set(values)].slice(0, 8);
}

function inferCatchphrases(text) {
  const candidates = [];
  const quoted = text.match(/[“"]([^”"]{2,24})[”"]/g) || [];
  for (const item of quoted) candidates.push(item.replace(/[“”"]/g, ""));
  const common = ["哈哈", "嘿嘿", "救命", "真的", "其实", "就是说", "没关系", "慢慢来", "不要怕", "你知道吗"];
  for (const phrase of common) {
    const count = (text.match(new RegExp(escapeRegExp(phrase), "g")) || []).length;
    if (count >= 2) candidates.push(phrase);
  }
  return [...new Set(candidates)]
    .filter((item) => item.length >= 2 && item.length <= 24)
    .slice(0, 12)
    .map((item) => `常用表达/口头禅：${item}`);
}

function inferPersonaFacts(text) {
  const facts = [];
  const patterns = [
    /(?:我叫|我是|我的名字是)([^，。！？!?\n]{1,24})/g,
    /(?:我喜欢|我爱|我很喜欢)([^。！？!?\n]{1,40})/g,
    /(?:我不喜欢|我讨厌|我害怕)([^。！？!?\n]{1,40})/g,
    /(?:我经常|我总是|我习惯)([^。！？!?\n]{1,40})/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      facts.push(`人物资料线索：${match[0]}`);
    }
  }
  return [...new Set(facts)].slice(0, 16);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveChatModel(modelConfig) {
  if (modelConfig.mode === "cloud_license") {
    return {
      apiKey: modelConfig.officialAccessToken || modelConfig.officialLicenseKey || modelConfig.officialUserToken,
      baseUrl: modelConfig.officialBaseUrl,
      model: modelConfig.officialModel,
      mode: "cloud_license"
    };
  }
  if (modelConfig.mode === "self_hosted") {
    return {
      apiKey: modelConfig.apiKey,
      baseUrl: modelConfig.baseUrl,
      model: modelConfig.model,
      mode: "self_hosted"
    };
  }
  if (PUBLIC_FREE_ACCESS_ENABLED && modelConfig.officialBaseUrl && modelConfig.officialModel) {
    return {
      apiKey: process.env.COMPANION_FREE_ACCESS_TOKEN || "free",
      baseUrl: modelConfig.officialBaseUrl,
      model: modelConfig.officialModel,
      mode: "free_quota"
    };
  }
  return {
    apiKey: "",
    baseUrl: "",
    model: "",
    mode: "free_quota"
  };
}

function toPublicModelConfigWithUser(modelConfig, user) {
  const publicConfig = toPublicModelConfig(modelConfig);
  return {
    ...publicConfig,
    license: {
      ...publicConfig.license,
      bound: Boolean(user?.boundLicense),
      enabled: Boolean(user?.boundLicense),
      pendingBind: Boolean(publicConfig.license?.saved && !user?.boundLicense)
    }
  };
}

function usesOfficialGateway(modelConfig) {
  return modelConfig.mode === "cloud_license" || (PUBLIC_FREE_ACCESS_ENABLED && modelConfig.mode === "free_quota");
}

function officialGatewayAuth(modelConfig) {
  if (modelConfig.mode === "cloud_license") return modelConfig.officialAccessToken || modelConfig.officialLicenseKey || modelConfig.officialUserToken;
  return process.env.COMPANION_FREE_ACCESS_TOKEN || "free";
}

function sendAuthorizationRequired(res) {
  return sendJson(res, 401, {
    error: "请先登录并绑定授权码后继续使用。",
    code: "official_license_required"
  });
}

async function callOfficialAuth({ modelConfig, path, body }) {
  const endpoint = `${modelConfig.officialBaseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `账号服务请求失败 ${response.status}`);
  return data;
}

async function callOfficialMe({ modelConfig }) {
  const endpoint = `${modelConfig.officialBaseUrl.replace(/\/$/, "")}/api/auth/me`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { authorization: `Bearer ${modelConfig.officialUserToken}` }
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || `账号状态请求失败 ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function callOfficialBindLicense({ modelConfig, licenseKey }) {
  const endpoint = `${modelConfig.officialBaseUrl.replace(/\/$/, "")}/api/auth/bind-license`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${modelConfig.officialUserToken}`
    },
    body: JSON.stringify({ licenseKey })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `绑定授权码失败 ${response.status}`);
  return data;
}

async function resolveOfficialUser(modelConfig) {
  if (!modelConfig.officialUserToken) return null;
  try {
    const data = await callOfficialMe({ modelConfig });
    return data.user || null;
  } catch {
    return null;
  }
}

async function callOfficialImageGatewayWithFallback({ modelConfig, body = {}, prompt, referenceImage, localImageConfig }) {
  try {
    return await callOfficialImageGateway({ modelConfig, body, prompt, referenceImage });
  } catch (error) {
    throw error;
  }
}

async function callOfficialImageGateway({ modelConfig, body = {}, prompt, referenceImage }) {
  const endpoint = `${modelConfig.officialBaseUrl.replace(/\/$/, "")}/api/image`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${officialGatewayAuth(modelConfig)}`
      },
      body: JSON.stringify({
        model: body.model || modelConfig.imageModel || "step-image-edit-2",
        prompt,
        size: body.size || "1024x1024",
        response_format: body.response_format || "b64_json",
        cfg_scale: body.cfg_scale ?? 1,
        steps: body.steps ?? 8,
        seed: body.seed,
        text_mode: body.text_mode ?? (referenceImage?.data ? false : true),
        referenceImage: referenceImage?.data ? {
          data: referenceImage.data,
          mime: referenceImage.mime || "image/png",
          name: referenceImage.name || "reference.png"
        } : undefined
      })
    });
  } catch (error) {
    throw new Error(`授权图片服务连接失败：${formatFetchError(error)}`);
  }
  const data = await response.json();
  if (!response.ok) {
    throwGatewayError({ status: response.status, data, prefix: "授权图片接口请求失败" });
  }
  const first = data.data?.[0] || {};
  return {
    url: first.url || "",
    b64Json: first.b64_json || "",
    seed: first.seed,
    finishReason: first.finish_reason || "",
    revisedPrompt: first.revised_prompt || "",
    referenceMode: referenceImage?.data ? "stepfun:image_edit" : "none",
    requestPrompt: prompt,
    endpoint: data.gateway?.endpoint || "license:/api/image",
    raw: data
  };
}

async function callOfficialTtsGatewayWithFallback({ modelConfig, text, audioConfig }) {
  try {
    return await callOfficialTtsGateway({ modelConfig, text, audioConfig });
  } catch (error) {
    throw error;
  }
}

async function callOfficialTtsGateway({ modelConfig, text, audioConfig }) {
  const endpoint = `${modelConfig.officialBaseUrl.replace(/\/$/, "")}/api/tts`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${officialGatewayAuth(modelConfig)}`
      },
      body: JSON.stringify({
        model: audioConfig.model || "stepaudio-2.5-tts",
        text,
        input: text,
        voice: audioConfig.voice,
        response_format: audioConfig.responseFormat || audioConfig.format || "mp3",
        instruction: audioConfig.instruction,
        speed: audioConfig.speed,
        volume: audioConfig.volume,
        sample_rate: audioConfig.sampleRate,
        text_normalization: audioConfig.textNormalization,
        markdown_filter: audioConfig.markdownFilter,
        return_url: audioConfig.returnUrl,
        timestamp: audioConfig.timestamp,
        ...safeObject(audioConfig.extraBody)
      })
    });
  } catch (error) {
    throw new Error(`授权语音服务连接失败：${formatFetchError(error)}`);
  }
  const data = await response.json();
  if (!response.ok) {
    throwGatewayError({ status: response.status, data, prefix: "授权语音接口请求失败" });
  }
  return {
    audioBase64: data.audioBase64 || "",
    audioUrl: data.audioUrl || "",
    mimeType: data.mimeType || "audio/mpeg",
    format: data.format || audioConfig.format || "mp3",
    raw: data.raw || data
  };
}

async function callOfficialVoicePreviewGateway({ modelConfig, body = {} }) {
  const endpoint = `${modelConfig.officialBaseUrl.replace(/\/$/, "")}/api/audio/voices/preview`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${officialGatewayAuth(modelConfig)}`
    },
    body: JSON.stringify({
      ...body,
      extraBody: undefined
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`授权音色试听接口请求失败 ${response.status}: ${compactErrorText(JSON.stringify(data))}`);
  }
  return data;
}

async function callOfficialVoiceCloneGateway({ modelConfig, body = {} }) {
  const endpoint = `${modelConfig.officialBaseUrl.replace(/\/$/, "")}/api/voice/clone`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${officialGatewayAuth(modelConfig)}`
    },
    body: JSON.stringify({
      file_id: body.file_id || body.fileId || "",
      audioBase64: body.audioBase64 || body.audio?.data || "",
      text: body.sampleText || body.text || body.sample_text || "",
      sampleText: body.sampleText || body.text || body.sample_text || "",
      fileName: body.fileName || body.name || "",
      mime: body.mime || body.mimeType || ""
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`授权声音克隆接口请求失败 ${response.status}: ${compactErrorText(JSON.stringify(data))}`);
  }
  return {
    voiceId: data.voiceId || data.voice_id || data.id || "",
    voiceSampleName: body.fileName || body.name || "",
    raw: data.raw || data
  };
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveVisionChatModel(modelConfig) {
  if (usesOfficialGateway(modelConfig)) return resolveChatModel(modelConfig);
  return resolveChatModel(modelConfig);
}

async function analyzeAppearanceFromImage({ image, currentAppearance = "", llm }) {
  if (!llm?.apiKey || !llm?.baseUrl || !llm?.model) {
    throw new Error("当前还不能识别图片，请先启用在线服务。");
  }
  const dataUrl = toImageDataUrl(image);
  const messages = [
    {
      role: "system",
      content: "你是角色外貌描述助手。只输出适合图像生成提示词使用的中文外貌描述，不要评价颜值，不要猜测身份。"
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "请从这张图提取虚拟角色外貌特征，聚焦：发型发色、脸型五官、妆容、穿搭、体态、整体气质。",
            "写成一段 80 到 160 字的中文描述，可以直接放进生图提示词。",
            currentAppearance ? `已有描述可参考并合并：${currentAppearance}` : ""
          ].filter(Boolean).join("\n")
        },
        {
          type: "image_url",
          image_url: { url: dataUrl }
        }
      ]
    }
  ];
  const response = await fetch(`${llm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${llm.apiKey}`
    },
    body: JSON.stringify({
      model: llm.model,
      messages,
      temperature: 0.2,
      max_tokens: 1200,
      reasoning_effort: "low"
    })
  });
  if (!response.ok) {
    const text = await response.text();
    console.error("[vision] appearance analyze failed", {
      endpoint: `${llm.baseUrl.replace(/\/$/, "")}/chat/completions`,
      model: llm.model,
      mode: llm.mode,
      status: response.status,
      error: compactErrorText(text)
    });
    throw new Error(text.slice(0, 300));
  }
  const data = await response.json();
  const content = extractChatContent(data);
  const clean = String(content).replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("没有识别到可用的外貌描述。");
  return clean.slice(0, 500);
}

function extractChatContent(data) {
  const message = data?.choices?.[0]?.message || {};
  if (typeof message.content === "string" && message.content.trim()) return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => typeof part === "string" ? part : part?.text || "")
      .join("\n")
      .trim();
  }
  return data?.output_text || data?.text || "";
}

function toImageDataUrl(image) {
  const data = String(image.data || "");
  if (data.startsWith("data:image/")) return data;
  const mime = String(image.mime || "image/png");
  return `data:${mime};base64,${data}`;
}

function publicAppearanceError(error) {
  const message = String(error?.message || "");
  if (message.includes("不能识别图片")) return message;
  if (message.includes("401") || message.includes("403") || message.includes("Unauthorized")) {
    return "图片识别失败：服务端授权不可用，请检查后台 API Key。";
  }
  if (message.includes("model") || message.includes("step-3.7-flash")) {
    return "图片识别失败：请确认后台识别模型使用支持多模态的 step-3.7-flash。";
  }
  if (message.includes("image") || message.includes("vision") || message.includes("modal")) {
    return "当前在线服务暂不支持图片识别，请先手写外貌特征。";
  }
  return "识别失败，请换一张更清晰的正面或半身图重试。";
}

function compactErrorText(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "empty response";
  try {
    const parsed = JSON.parse(value);
    return parsed.error?.message || parsed.message || JSON.stringify(parsed).slice(0, 240);
  } catch {
    return value.slice(0, 240);
  }
}

function isNetworkFetchError(error) {
  const message = String(error?.message || "");
  return message.includes("fetch failed")
    || message.includes("连接失败")
    || ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(error?.cause?.code);
}

function formatFetchError(error) {
  const code = error?.cause?.code ? `（${error.cause.code}）` : "";
  const cause = error?.cause?.message || "";
  return `${error?.message || "fetch failed"}${code}${cause ? `：${cause}` : ""}`;
}

function prepareChatAccess(modelConfig) {
  if (modelConfig.mode !== "free_quota") {
    return {
      allowed: true,
      mode: modelConfig.mode,
      limit: null,
      remaining: null
    };
  }

  if (!PUBLIC_FREE_ACCESS_ENABLED) {
    return {
      allowed: false,
      code: "official_license_required",
      mode: "free_quota",
      limit: 0,
      remaining: 0,
      message: "请先注册或登录免费账号。新用户可获得 10 次免费额度。"
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const key = `free_chat_usage:${today}`;
  const used = Number(store.getMeta(key, "0") || 0);
  const remaining = Math.max(FREE_DAILY_CHAT_LIMIT - used, 0);
  if (used >= FREE_DAILY_CHAT_LIMIT) {
    return {
      allowed: false,
      mode: "free_quota",
      date: today,
      used,
      limit: FREE_DAILY_CHAT_LIMIT,
      remaining: 0,
      message: `免费体验今天已经用完（${FREE_DAILY_CHAT_LIMIT} 次）。请填写授权码继续使用。`
    };
  }
  return {
    allowed: true,
    mode: "free_quota",
    date: today,
    key,
    used,
    limit: FREE_DAILY_CHAT_LIMIT,
    remaining
  };
}

function commitChatAccess(quota) {
  if (quota.mode !== "free_quota" || !quota.key) return quota;
  const used = quota.used + 1;
  store.setMeta(quota.key, String(used));
  return {
    ...quota,
    used,
    remaining: Math.max(quota.limit - used, 0)
  };
}

function isQuotaOrBillingError(error) {
  return error?.code === "quota_exceeded"
    || error?.code === "authorization_required"
    || [401, 402, 403, 429].includes(Number(error?.status));
}

function publicQuotaMessage(error) {
  if (error?.code === "authorization_required") return "请先登录并绑定授权码后继续使用。";
  return "免费额度已用完，请升级会员后继续使用。";
}

function buildUpgradePrompt() {
  return {
    title: "免费额度已用完",
    message: "开通会员或绑定授权码后，可以继续聊天、生成图片和语音。",
    primaryAction: "开通会员",
    secondaryAction: "绑定授权码"
  };
}

function throwGatewayError({ status, data, prefix = "授权接口请求失败" }) {
  const text = JSON.stringify(data || {});
  const error = new Error(`${prefix} ${status}: ${compactErrorText(text)}`);
  error.status = status;
  error.code = detectGatewayErrorCode(status, text);
  error.publicMessage = publicQuotaMessage(error);
  throw error;
}

function detectGatewayErrorCode(status, text = "") {
  const value = String(text || "");
  if (status === 402 || status === 429 || /quota|limit|额度|用完|余额|会员|upgrade|payment|subscribe/i.test(value)) {
    return "quota_exceeded";
  }
  if (status === 401 || status === 403 || /unauthorized|forbidden|授权|登录/i.test(value)) {
    return "authorization_required";
  }
  return "gateway_error";
}

function probeRealtimeBackend(modelConfig = {}) {
  return new Promise((resolve, reject) => {
    if (!modelConfig.realtimeEnabled) return reject(new Error("实时语音未启用"));
    if (!modelConfig.realtimeUrl || !modelConfig.realtimeModel || !modelConfig.realtimeApiKey) {
      return reject(new Error("实时语音配置不完整"));
    }
    const url = new URL(modelConfig.realtimeUrl);
    url.searchParams.set("model", modelConfig.realtimeModel);
    const startedAt = Date.now();
    const eventTypes = [];
    let responseRequested = false;
    let audioDeltas = 0;
    let textDeltas = 0;
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${modelConfig.realtimeApiKey}` }
    });
    const done = (payload) => {
      clearTimeout(timer);
      closeRealtimeProbe(socket);
      resolve({ ...payload, elapsedMs: Date.now() - startedAt });
    };
    const timer = setTimeout(() => done({
      websocket: socket.readyState === WebSocket.OPEN ? "通过" : "超时",
      ready: eventTypes.length ? "已连接但未完成音频检测" : "未收到 ready",
      audioOutput: audioDeltas > 0 ? `通过：${audioDeltas} 个音频片段` : "未收到音频",
      textOutput: textDeltas > 0 ? `收到：${textDeltas} 个文字片段` : "未收到文字",
      events: eventTypes.slice(-12)
    }), 12000);
    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions: "这是实时语音连通性检测。收到 response.create 后，只用中文说一句：通话检测成功。",
          voice: modelConfig.audioVoice || "yuanqishaonv",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16"
        }
      }));
    });
    socket.on("message", (raw) => {
      const event = parseRealtimeJson(raw);
      if (event?.type) {
        eventTypes.push(event.type);
        if (eventTypes.length > 30) eventTypes.shift();
      }
      if (event?.type === "ready") {
        maybeRequestRealtimeProbeResponse();
      } else if (event?.type === "session.updated" || event?.type === "session.created") {
        maybeRequestRealtimeProbeResponse();
      } else if (event?.type === "response.audio.delta" && event.delta) {
        audioDeltas += 1;
        done({
          websocket: "通过",
          ready: "通过",
          audioOutput: `通过：${audioDeltas} 个音频片段`,
          textOutput: textDeltas > 0 ? `收到：${textDeltas} 个文字片段` : "未收到文字",
          events: eventTypes.slice(-12)
        });
      } else if (/response\.(text|audio_transcript)\.delta/.test(event?.type || "")) {
        textDeltas += 1;
      } else if (event?.type === "error") {
        done({
          websocket: "通过",
          ready: "失败",
          audioOutput: `失败：${event.message || event.error?.message || "实时服务错误"}`,
          textOutput: "失败",
          events: eventTypes.slice(-12)
        });
      }
    });
    socket.on("error", (error) => reject(error));

    function maybeRequestRealtimeProbeResponse() {
      if (responseRequested || socket.readyState !== WebSocket.OPEN) return;
      responseRequested = true;
      socket.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text", "audio"],
          instructions: "请用中文说：通话检测成功。"
        }
      }));
    }
  });
}

function parseRealtimeJson(raw) {
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || ""));
  } catch {
    return null;
  }
}

function closeRealtimeProbe(socket) {
  try {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  } catch {}
}

function safeRealtimeTarget(url = "") {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "";
  }
}

function audioConfigFromModel(modelConfig, agent = {}, voiceDecision = null) {
  const preferredVoice = agent.clonedVoiceId || voicePresetForAgent(agent) || modelConfig.audioVoice;
  return {
    baseUrl: modelConfig.audioBaseUrl,
    apiKey: modelConfig.audioApiKey,
    model: modelConfig.audioModel || "stepaudio-2.5-tts",
    voice: preferredVoice,
    instruction: buildVoiceInstruction(modelConfig.audioInstruction, agent, voiceDecision),
    format: modelConfig.audioFormat,
    speed: modelConfig.audioSpeed,
    volume: modelConfig.audioVolume,
    sampleRate: modelConfig.audioSampleRate,
    textNormalization: modelConfig.audioTextNormalization,
    markdownFilter: modelConfig.audioMarkdownFilter,
    returnUrl: modelConfig.audioReturnUrl,
    timestamp: modelConfig.audioTimestamp,
    extraBody: modelConfig.audioExtraBody
  };
}

function applyTtsOverrides(audioConfig, body = {}, agent = {}) {
  const voiceTuning = {
    expressiveness: resolveRatio(body.voiceExpressiveness ?? agent.voiceExpressiveness, 0.6),
    warmth: resolveRatio(body.voiceWarmth ?? agent.voiceWarmth, 0.7),
    clarity: resolveRatio(body.voiceClarity ?? agent.voiceClarity, 0.65)
  };
  return {
    ...audioConfig,
    speed: resolveVoiceSpeed(body.voiceSpeed ?? body.speed ?? agent.voiceSpeed ?? audioConfig.speed),
    volume: resolveVoiceVolume(body.voiceVolume ?? body.volume ?? agent.voiceVolume ?? audioConfig.volume),
    instruction: appendVoiceTuningInstruction(audioConfig.instruction, voiceTuning)
  };
}

function resolveVoiceSpeed(value) {
  if (value === "slow") return 0.85;
  if (value === "normal") return 1;
  if (value === "fast") return 1.15;
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(2, Math.max(0.5, number)) : undefined;
}

function resolveVoiceVolume(value) {
  if (value === undefined || value === null || value === "") return 1;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(2, Math.max(0.1, number)) : 1;
}

function resolveRatio(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

function appendVoiceTuningInstruction(baseInstruction, tuning = {}) {
  const lines = [
    voiceTuningLine("情绪表现", tuning.expressiveness, [
      "克制自然，不要夸张",
      "有一点情绪起伏",
      "情绪更明显，贴近文字里的状态"
    ]),
    voiceTuningLine("亲近感", tuning.warmth, [
      "保持礼貌清爽",
      "自然亲近，像熟人聊天",
      "更柔和贴近，有陪伴感"
    ]),
    voiceTuningLine("清晰度", tuning.clarity, [
      "更松弛口语，允许轻微停顿",
      "清楚自然，停顿适中",
      "吐字更清楚，重点更明确"
    ])
  ].filter(Boolean);
  return [baseInstruction, lines.length ? `声音细调：${lines.join("；")}。` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 200);
}

function voiceTuningLine(label, value, levels = []) {
  const ratio = resolveRatio(value, 0.5);
  const text = ratio < 0.34 ? levels[0] : ratio > 0.67 ? levels[2] : levels[1];
  return `${label}${Math.round(ratio * 100)}%，${text}`;
}

function voicePresetForAgent(agent = {}) {
  if (agent.voiceGender === "girl") return "yuanqishaonv";
  if (agent.voiceGender === "mature_female") return "zhixingjiejie";
  if (agent.voiceGender === "boy") return "qingniandaxuesheng";
  if (agent.voiceGender === "deep_male") return "shenchennanyin";
  if (agent.voiceGender === "neutral_calm") return "zhixingjiejie";
  if (agent.voiceGender === "male") {
    if (agent.voiceTone === "calm") return "shenchennanyin";
    if (agent.voiceTone === "soft") return "wenrounansheng";
    return "cixingnansheng";
  }
  if (agent.voiceGender === "neutral") return agent.voiceTone === "energetic" ? "qingniandaxuesheng" : "zhixingjiejie";
  if (agent.voiceTone === "bright" || agent.voiceTone === "energetic") return "yuanqishaonv";
  if (agent.voiceTone === "soft") return "wenrounvsheng";
  if (agent.voiceTone === "calm") return "zhixingjiejie";
  return "linjiajiejie";
}

function buildVoiceInstruction(baseInstruction, agent = {}, voiceDecision = null) {
  const voiceTypeMap = {
    girl: "少女感声线",
    female: "温柔女声",
    mature_female: "成熟女声",
    boy: "少年感声线",
    male: "青年男声",
    deep_male: "低沉男声",
    neutral: "中性清亮声线",
    neutral_calm: "中性沉稳声线"
  };
  const voiceType = voiceTypeMap[agent.voiceGender] || voiceTypeMap.female;
  const toneMap = {
    warm: "温暖亲近",
    bright: "明亮自然",
    calm: "沉稳克制",
    energetic: "元气活泼",
    soft: "轻柔慢速"
  };
  const tone = toneMap[agent.voiceTone] || toneMap.warm;
  return [
    baseInstruction,
    `声音偏好：${voiceType}，${tone}。`,
    voiceDecision?.instruction ? `当前情绪演绎：${voiceDecision.instruction}` : ""
  ].filter(Boolean).join("\n").slice(0, 500);
}

function publicVoiceCloneError(error) {
  const message = String(error?.message || "");
  if (message.includes("请求体太大") || message.includes("413")) {
    return "声音克隆失败：声音文件太大，请换一段 6 到 9 秒、前后少留空白的 mp3/wav 人声。";
  }
  if (message.includes("file_format") || message.includes("unsupported") || message.includes("invalid or unsupported")) {
    return "声音克隆失败：服务端没有识别到有效的 mp3/wav 音频内容，请重新导出或重录一段清晰人声。";
  }
  if (message.includes("只支持 mp3 或 wav")) return message;
  if (message.includes("请先上传")) return message;
  if (message.includes("语音服务还没有配置完整")) return message;
  if (message.includes("401") || message.includes("403")) {
    return "声音克隆失败：授权不可用或没有语音复刻权限。";
  }
  if (message.includes("404")) {
    return "声音克隆失败：语音复刻接口不可用，请检查服务端语音地址是否配置为 Step Plan。";
  }
  if (message.includes("model") || message.includes("stepaudio")) {
    return "声音克隆失败：服务端应使用 stepaudio-2.5-tts 进行音色复刻。";
  }
  if (message.includes("processed audio duration is out of valid range") || message.includes("duration")) {
    return "声音克隆失败：服务端识别到的有效人声时长不在 5 到 10 秒内。请录一段 6 到 9 秒、前后少留空白的清晰人声。";
  }
  if (message.includes("400") && message.includes("file_id")) {
    return "声音样本没有被服务端识别，请重新上传 5 到 10 秒的 mp3 或 wav 清晰人声。";
  }
  if (message.includes("上传失败")) return message;
  if (message.includes("声音克隆请求失败")) return message.slice(0, 180);
  return "声音克隆失败，请换一段 5 到 10 秒的清晰 mp3/wav 人声后重试。";
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/public/index.html" : pathname;
  const resolved = path.normalize(path.join(__dirname, safePath));
  if (!resolved.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const body = await readFile(resolved);
    const ext = path.extname(resolved);
    res.writeHead(200, { "content-type": mimeTypes.get(ext) || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

export const serverReady = new Promise((resolve) => {
  globalThis.__COMPANION_SERVER_READY__ = resolve;
});

export function getServerUrl() {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : PORT;
  return `http://${HOST}:${actualPort}`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url.pathname);
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "server error" });
  }
});

attachStepFunRealtimeBridge({
  server,
  getRuntimeConfig,
  store,
  resolveAuth(modelConfig) {
    if (!modelConfig.realtimeEnabled) {
      return {
        allowed: false,
        message: "实时语音未启用。请配置 COMPANION_SELF_HOSTED=1 和 STEPFUN_REALTIME_API_KEY。"
      };
    }
    return { allowed: true };
  }
});

function shutdown() {
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  const url = getServerUrl();
  console.log(`Virtual companion agent running at ${url}`);
  console.log(`Environment file: ${envInfo.loaded ? envInfo.path : "not found"}`);
  console.log(`SQLite database: ${DB_PATH}`);
  console.log(`Compression window: ${COMPRESSION_MESSAGE_WINDOW} messages`);
  globalThis.__COMPANION_SERVER_READY__?.({
    url,
    dbPath: DB_PATH,
    environmentFile: envInfo.loaded ? envInfo.path : ""
  });
});
