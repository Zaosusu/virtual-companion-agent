export async function runContextAgent({
  agent = {},
  character = {},
  memory = {},
  retrievedMemories = [],
  message = "",
  history = [],
  llm = {},
  traceId = ""
}) {
  const fallback = localContextPlan({ agent, character, memory, retrievedMemories, message, history });
  if (!llm?.apiKey || !llm?.baseUrl || !llm?.model) return fallback;

  try {
    const plan = await callContextModel({ agent, character, memory, retrievedMemories, message, history, llm, traceId });
    return normalizePlan(plan, fallback);
  } catch (error) {
    logTrace(traceId, "context_agent.fallback", { message: error.message });
    return fallback;
  }
}

async function callContextModel({ agent, character, memory, retrievedMemories, message, history, llm, traceId }) {
  const endpoint = llm.mode === "cloud_license" || llm.mode === "free_quota"
    ? `${llm.baseUrl.replace(/\/$/, "")}/api/chat`
    : `${llm.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    roleName: agent.name || character.name || "",
    persona: agent.persona || character.persona || "",
    userText: message,
    recentHistory: history.slice(-8),
    retrievedMemories: retrievedMemories.slice(0, 10).map((item) => ({
      kind: item.kind,
      content: item.content,
      score: item.score,
      ftsScore: item.ftsScore
    })),
    memorySnapshot: {
      user: {
        profile: memory.profile || {},
        facts: memory.facts || [],
        preferences: memory.preferences || [],
        emotional_patterns: memory.emotional_patterns || [],
        recent_summaries: memory.recent_summaries || []
      },
      persona: {
        style: memory.persona_style || [],
        values: memory.persona_values || [],
        catchphrases: memory.persona_catchphrases || [],
        corpus: (memory.persona_corpus || []).slice(0, 8)
      }
    }
  };
  const messages = [
    {
      role: "system",
      content: [
        "你是 context_agent，负责在 text_agent 回复前整理上下文身份归属。",
        "目标是防止串台：不要让角色资料、开发者资料、导入者资料、当前用户资料互相污染。",
        "必须判断每条资料属于哪一类：character_facts 当前角色事实；user_memory 当前聊天用户事实；style_only 只可学习语气风格；third_party_noise 第三方/开发者/导入者资料，不可当作角色或用户事实。",
        "如果资料提到黑客松、Agent Build、开发工具、项目获奖、代码、开发者，而当前角色人设没有明确写自己就是这个人，优先归为 third_party_noise 或 style_only。",
        "输出严格 JSON，不要 Markdown。格式：{\"characterFacts\":[],\"userMemory\":[],\"styleHints\":[],\"blockedFacts\":[],\"warnings\":[],\"identityRule\":\"一句话身份边界\"}"
      ].join("\n")
    },
    { role: "user", content: JSON.stringify(payload, null, 2) }
  ];
  logTrace(traceId, "context_agent.request", {
    endpoint,
    retrievedCount: retrievedMemories.length,
    historyCount: history.length
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${llm.apiKey}`,
      ...(traceId ? { "x-request-id": `${traceId}_context` } : {})
    },
    signal: modelTimeoutSignal(),
    body: JSON.stringify({
      model: llm.model,
      messages,
      temperature: 0.1,
      max_tokens: 700
    })
  });
  if (!response.ok) throw new Error(`context agent failed ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  const raw = extractText(data);
  const parsed = parseJsonObject(raw);
  logTrace(traceId, "context_agent.response", {
    characterFacts: parsed.characterFacts?.length || 0,
    userMemory: parsed.userMemory?.length || 0,
    styleHints: parsed.styleHints?.length || 0,
    blockedFacts: parsed.blockedFacts?.length || 0
  });
  return parsed;
}

function localContextPlan({ agent, character, memory, retrievedMemories, history }) {
  const roleText = `${agent.name || character.name || ""}\n${agent.persona || character.persona || ""}`;
  const roleAllowsDeveloperFacts = /开发|AI|黑客松|创业|程序|代码|Agent|OPC|金鸡湖|南京/i.test(roleText);
  const blockedFacts = [];
  const characterFacts = [];
  const styleHints = [];
  const userMemory = [];
  for (const item of retrievedMemories || []) {
    const content = String(item.content || "");
    const suspicious = /Agent Build|Hackathon|黑客松|金鸡湖|OPC|开发者|代码|Demo|中小商家|一等奖/i.test(content);
    if (item.kind?.startsWith("persona_")) {
      if (suspicious && !roleAllowsDeveloperFacts) {
        blockedFacts.push(content);
      } else if (item.kind === "persona_corpus") {
        styleHints.push(content);
      } else {
        characterFacts.push(content);
      }
      continue;
    }
    userMemory.push(content);
  }
  return {
    agent: "context_agent",
    reviewer: "local",
    characterFacts: compactList([
      ...(memory.persona_style || []).map((item) => item.text),
      ...(memory.persona_values || []).map((item) => item.text),
      ...(memory.persona_catchphrases || []).map((item) => item.text),
      ...characterFacts
    ], 10),
    userMemory: compactList([
      ...(memory.facts || []).map((item) => item.text),
      ...(memory.preferences || []).map((item) => item.text),
      ...(memory.emotional_patterns || []).map((item) => item.text),
      ...(memory.recent_summaries || []).map((item) => item.assistant || item.text),
      ...userMemory
    ], 10),
    styleHints: compactList([
      ...(memory.persona_corpus || []).map((item) => item.text),
      ...styleHints
    ], 8),
    blockedFacts: compactList(blockedFacts, 8),
    warnings: blockedFacts.length ? ["检测到可能属于开发者/导入者的项目经历，已阻止它成为角色或用户事实。"] : [],
    identityRule: "第一人称是当前角色，第二人称是当前聊天用户；资料必须先判归属再使用。"
  };
}

function normalizePlan(plan, fallback) {
  return {
    agent: "context_agent",
    reviewer: plan?.reviewer || "llm",
    characterFacts: compactList(plan?.characterFacts, 10),
    userMemory: compactList(plan?.userMemory, 10),
    styleHints: compactList(plan?.styleHints, 8),
    blockedFacts: compactList(plan?.blockedFacts, 8),
    warnings: compactList(plan?.warnings, 6),
    identityRule: String(plan?.identityRule || fallback.identityRule || "").slice(0, 240)
  };
}

function compactList(items = [], limit = 8) {
  return [...new Set((Array.isArray(items) ? items : [])
    .map((item) => typeof item === "string" ? item : item?.text || item?.content || "")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 420)))]
    .slice(0, limit);
}

function extractText(data) {
  if (typeof data?.text === "string") return data.text.trim();
  if (typeof data?.output_text === "string") return data.output_text.trim();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").join("\n").trim();
  return "";
}

function parseJsonObject(value) {
  const raw = String(value || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  try {
    return JSON.parse(candidate);
  } catch {
    return {};
  }
}

function modelTimeoutSignal() {
  const ms = Number(process.env.COMPANION_AGENT_TIMEOUT_MS || process.env.COMPANION_LLM_TIMEOUT_MS || 180000);
  if (!Number.isFinite(ms) || ms <= 0 || !AbortSignal?.timeout) return undefined;
  return AbortSignal.timeout(ms);
}

function logTrace(traceId, stage, payload = {}) {
  if (process.env.COMPANION_DEBUG_TRACE === "0") return;
  const prefix = traceId ? `[trace:${traceId}]` : "[trace]";
  console.log(prefix, stage, payload);
}
