import { WebSocketServer, WebSocket } from "ws";
import { buildRealtimeSessionPlan, buildRealtimeTurnPatch } from "../orchestrator/realtimeVoiceAgent.js";
import { runCragRetrieval } from "../orchestrator/memoryAgent.js";

export function attachStepFunRealtimeBridge({
  server,
  path = "/ws/realtime",
  getRuntimeConfig,
  store,
  resolveAuth = () => ({ allowed: true })
}) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== path) return;
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req);
    });
  });

  wss.on("connection", (client) => {
    createRealtimeSession({ client, getRuntimeConfig, store, resolveAuth }).catch((error) => {
      sendClient(client, "error", { message: publicRealtimeError(error) });
      closeQuietly(client);
    });
  });

  return wss;
}

async function createRealtimeSession({ client, getRuntimeConfig, store, resolveAuth }) {
  const { agent, character, modelConfig } = getRuntimeConfig();
  const auth = resolveAuth(modelConfig);
  if (!auth.allowed) throw new Error(auth.message || "实时语音未授权。");

  const sessionId = agent.id;
  const recentMessages = store.getRecentMessages(sessionId, 12).map((item) => ({
    role: item.role,
    content: item.content
  }));
  const memory = store.getMemorySnapshot({ agentId: agent.id });
  let sessionPlan = buildRealtimeSessionPlan({
    agent,
    character,
    modelConfig,
    memory,
    recentMessages
  });
  if (!sessionPlan.apiKey || !sessionPlan.url || !sessionPlan.model) {
    throw new Error("实时语音服务还没有配置完整。");
  }
  if (!sessionPlan.policy.allowVoice) {
    throw new Error("当前安全状态不适合开启实时语音。");
  }

  const providerUrl = new URL(sessionPlan.url);
  providerUrl.searchParams.set("model", sessionPlan.model);
  const upstream = new WebSocket(providerUrl, {
    headers: {
      authorization: `Bearer ${sessionPlan.apiKey}`
    }
  });

  let closed = false;
  let latestTranscript = "";
  let currentAssistantText = "";
  let currentAssistantMessageId = null;
  let currentUserMessageId = null;
  let upstreamSessionCreated = false;
  let responseInProgress = false;

  const closeBoth = () => {
    if (closed) return;
    closed = true;
    closeQuietly(upstream);
    closeQuietly(client);
  };

  upstream.on("open", () => {
    sendClient(client, "ready", {
      model: sessionPlan.model,
      agent: "realtime_voice_agent",
      sampleRate: 24000
    });
  });

  upstream.on("message", (raw) => {
    const event = parseJson(raw);
    if (!event) return;
    if (event.type === "response.created") {
      responseInProgress = true;
    }

    if (event.type === "error") {
      sendClient(client, "error", { message: event.error?.message || event.message || "实时语音服务返回错误。" });
      return;
    }
    if (event.type === "session.created") {
      upstreamSessionCreated = true;
      sendUpstream(upstream, {
        type: "session.update",
        session: sessionPlan.session
      });
    }
    if (event.type === "session.updated") {
      sendClient(client, "session.updated", { session: event.session });
    }
    if (
      event.type === "input_audio_buffer.committed"
      || event.type === "input_audio_buffer.speech_started"
      || event.type === "input_audio_buffer.speech_stopped"
      || event.type === "input_audio_buffer.cleared"
    ) {
      sendClient(client, event.type, {
        event_id: event.event_id,
        previous_item_id: event.previous_item_id,
        item_id: event.item_id,
        audio_start_ms: event.audio_start_ms,
        audio_end_ms: event.audio_end_ms
      });
    }

    const transcript = extractUserTranscript(event);
    if (transcript) {
      latestTranscript = transcript;
      currentUserMessageId = persistUserTranscript({ store, sessionId, transcript });
      const turnContext = buildTurnContext({ store, agent, transcript });
      sessionPlan = {
        ...sessionPlan,
        ...buildRealtimeTurnPatch({
          agent,
          character,
          modelConfig,
          memory: turnContext.memory,
          recentMessages: turnContext.recentMessages,
          retrievedMemories: turnContext.retrievedMemories,
          transcript
        })
      };
      if (sessionPlan.policy?.allowVoice === false) {
        sendUpstream(upstream, { type: "response.cancel" });
      } else {
        sendUpstream(upstream, {
          type: "session.update",
          session: sessionPlan.session
        });
      }
      sendClient(client, "transcript", { role: "user", text: transcript });
    }

    const assistantText = extractAssistantText(event);
    if (assistantText) {
      currentAssistantText = [currentAssistantText, assistantText].filter(Boolean).join("");
      sendClient(client, "transcript_delta", { role: "assistant", text: assistantText });
    }

    if (event.type === "response.audio.delta" && event.delta) {
      sendClient(client, "audio_delta", { delta: event.delta });
    }

    if (isResponseDone(event)) {
      responseInProgress = false;
      if (currentAssistantText.trim()) {
        currentAssistantMessageId = persistAssistantTurn({
          store,
          agent,
          sessionId,
          text: currentAssistantText.trim(),
          parentId: currentUserMessageId
        });
      }
      sendClient(client, "response_done", {
        text: currentAssistantText.trim(),
        messageId: currentAssistantMessageId,
        userText: latestTranscript
      });
      currentAssistantText = "";
      currentAssistantMessageId = null;
      currentUserMessageId = null;
    }

    sendClient(client, "provider_event", {
      providerType: event.type
    });
  });

  upstream.on("close", () => {
    sendClient(client, "closed", {});
    closeBoth();
  });
  upstream.on("error", (error) => {
    sendClient(client, "error", { message: publicRealtimeError(error) });
    closeBoth();
  });

  client.on("message", (raw) => {
    const event = parseJson(raw);
    if (!event) return;
    if (event.type === "input_audio_buffer.append" && event.audio) {
      if (upstreamSessionCreated) sendUpstream(upstream, event);
      return;
    }
    if (event.type === "input_audio_buffer.commit") {
      if (upstreamSessionCreated) sendUpstream(upstream, event);
      return;
    }
    if (event.type === "response.create") {
      if (!upstreamSessionCreated) return;
      if (responseInProgress) {
        return;
      }
      responseInProgress = true;
      sendUpstream(upstream, event);
      return;
    }
    if (event.type === "response.cancel") {
      responseInProgress = false;
      if (upstreamSessionCreated) sendUpstream(upstream, event);
      return;
    }
    if (event.type === "interrupt") {
      responseInProgress = false;
      sendUpstream(upstream, { type: "response.cancel" });
      sendClient(client, "interrupted", {});
    }
  });

  client.on("close", closeBoth);
  client.on("error", closeBoth);
}

function buildTurnContext({ store, agent, transcript }) {
  const recentMessages = store.getRecentMessages(agent.id, 12).map((item) => ({
    role: item.role,
    content: item.content
  }));
  const { retrievedMemories } = runCragRetrieval({
    store,
    agentId: agent.id,
    message: transcript,
    history: recentMessages,
    limit: 8
  });
  return {
    recentMessages,
    retrievedMemories,
    memory: store.getMemorySnapshot({ agentId: agent.id })
  };
}

function persistUserTranscript({ store, sessionId, transcript }) {
  const text = String(transcript || "").trim();
  if (!text) return null;
  return store.addMessage({
    sessionId,
    role: "user",
    content: text,
    status: "active",
    source: "realtime:stepfun",
    metadata: { type: "realtime_transcript" }
  });
}

function persistAssistantTurn({ store, agent, sessionId, text, parentId }) {
  const messageId = store.addMessage({
    sessionId,
    role: "assistant",
    content: text,
    status: "active",
    parentId,
    variantGroupId: parentId ? `variant:${parentId}` : "",
    variantIndex: 0,
    workflow: "realtime_voice",
    source: "realtime:stepfun",
    metadata: { type: "realtime_voice" }
  });
  store.upsertMemory({
    kind: "summary",
    content: `实时语音轮次：用户通过语音与${agent.name || "角色"}对话，角色回应：${text.slice(0, 120)}`,
    importance: 0.28,
    confidence: 0.62,
    sourceMessageId: messageId,
    metadata: { workflow: "realtime_voice", agentId: agent.id }
  });
  return messageId;
}

function sendUpstream(socket, event) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(event));
}

function sendClient(socket, type, payload = {}) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, ...payload }));
}

function parseJson(raw) {
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || ""));
  } catch {
    return null;
  }
}

function extractUserTranscript(event) {
  return event.transcript && (
    event.type === "conversation.item.input_audio_transcription.completed"
    || event.type === "input_audio_transcription.completed"
  ) ? String(event.transcript || "").trim() : "";
}

function extractAssistantText(event) {
  if (typeof event.delta === "string" && /response\.(text|audio_transcript)\.delta/.test(event.type || "")) return event.delta;
  return "";
}

function isResponseDone(event) {
  return event.type === "response.done";
}

function closeQuietly(socket) {
  try {
    if (socket.readyState === 1 || socket.readyState === 0) socket.close();
  } catch {}
}

function publicRealtimeError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("401") || message.includes("403") || /auth|authorization|unauthorized|forbidden/i.test(message)) {
    return "实时语音授权失败，请检查 StepFun Realtime API Key。";
  }
  if (message.includes("配置完整")) return message;
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(message)) {
    return "实时语音连接失败，请检查网络或 StepFun 服务地址。";
  }
  return message || "实时语音连接失败。";
}
