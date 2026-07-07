export async function runContextAgent({
  agent = {},
  character = {},
  memory = {},
  retrievedMemories = [],
  retrievalPlan = null,
  message = "",
  history = [],
  llm = {},
  traceId = ""
}) {
  const fallback = localContextPlan({ agent, character, memory, retrievedMemories, retrievalPlan, message, history });
  if (!llm?.apiKey || !llm?.baseUrl || !llm?.model) return fallback;
  if (!needsRemoteContextAgent({ retrievedMemories, memory, message })) return fallback;

  try {
    const plan = await callContextModel({ agent, character, memory, retrievedMemories, retrievalPlan, message, history, llm, traceId });
    return normalizePlan(plan, fallback);
  } catch (error) {
    logTrace(traceId, "context_agent.fallback", { message: error.message });
    return fallback;
  }
}

function needsRemoteContextAgent({ retrievedMemories = [], memory = {}, message = "" }) {
  const text = [
    message,
    ...retrievedMemories.map((item) => item.content),
    ...(memory.persona_corpus || []).slice(0, 3).map((item) => item.text)
  ].join("\n");
  const hasLargeCorpus = text.length > 2600;
  const hasIdentityRisk = /这是谁的资料|我的资料|你的资料|本人|分身|复刻|亲人|去世|开发者|导入者|Agent Build|Hackathon|黑客松|项目获奖|代码|Demo/i.test(text);
  return hasLargeCorpus || hasIdentityRisk;
}

async function callContextModel({ agent, character, memory, retrievedMemories, retrievalPlan, message, history, llm, traceId }) {
  const endpoint = llm.mode === "cloud_license" || llm.mode === "free_quota"
    ? `${llm.baseUrl.replace(/\/$/, "")}/api/chat`
    : `${llm.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    roleName: agent.name || character.name || "",
    persona: agent.persona || character.persona || "",
    userText: message,
    recentHistory: retrievalPlan?.strictEvidence ? compactMessages(history.filter((item) => item.role !== "assistant").slice(-4)) : compactMessages(history.slice(-5)),
    retrievalPlan: retrievalPlan ? {
      intent: retrievalPlan.intent,
      quality: retrievalPlan.quality,
      strictEvidence: retrievalPlan.strictEvidence,
      evidenceCount: retrievalPlan.evidenceCount
    } : null,
    retrievedMemories: retrievedMemories.slice(0, 8).map((item) => ({
      kind: item.kind,
      content: compactText(item.content, 260),
      score: item.score,
      ftsScore: item.ftsScore
    })),
    memorySnapshot: {
      user: {
        profile: memory.profile || {},
        facts: compactMemoryItems(memory.facts, 5),
        preferences: compactMemoryItems(memory.preferences, 5),
        emotional_patterns: compactMemoryItems(memory.emotional_patterns, 5),
        recent_summaries: retrievalPlan?.strictEvidence ? [] : compactMemoryItems(memory.recent_summaries, 5)
      },
      persona: {
        style: retrievalPlan?.strictEvidence ? [] : compactMemoryItems(memory.persona_style, 4),
        values: retrievalPlan?.strictEvidence ? [] : compactMemoryItems(memory.persona_values, 4),
        catchphrases: retrievalPlan?.strictEvidence ? [] : compactMemoryItems(memory.persona_catchphrases, 6),
        corpus: retrievalPlan?.strictEvidence ? [] : compactMemoryItems(memory.persona_corpus, 4, 260)
      }
    }
  };
  const messages = [
    {
      role: "system",
      content: [
        "你是 context_agent。只做身份归属分类，不聊天。",
        "把资料分为：characterFacts=当前角色事实；userMemory=当前聊天用户事实；styleHints=只学语气；blockedFacts=第三方/导入者/开发者资料，禁止当事实。",
        "如果角色人设明确说资料库就是角色本人经历，可以把资料归为 characterFacts；否则可疑开发/奖项/项目资料优先 blockedFacts 或 styleHints。",
        "如果 payload.retrievalPlan.strictEvidence=true，只能把 payload.retrievedMemories 归入 characterFacts，不要从 recentHistory 或 memorySnapshot 补事实。",
        "必须输出紧凑 JSON，不要解释，不要推理，不要 Markdown。",
        "{\"characterFacts\":[],\"userMemory\":[],\"styleHints\":[],\"blockedFacts\":[],\"warnings\":[],\"identityRule\":\"\"}"
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
      max_tokens: 900
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

function compactMessages(messages = []) {
  return messages.map((item) => ({
    role: item.role,
    content: compactText(item.content, 220)
  }));
}

function compactMemoryItems(items = [], limit = 5, maxChars = 220) {
  return (Array.isArray(items) ? items : [])
    .slice(0, limit)
    .map((item) => ({
      text: compactText(item.text || item.assistant || item.content || item, maxChars)
    }))
    .filter((item) => item.text);
}

function compactText(value, maxChars = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function localContextPlan({ agent, character, memory, retrievedMemories, retrievalPlan, history }) {
  if (retrievalPlan?.strictEvidence) {
    return {
      agent: "context_agent",
      reviewer: "local_strict_evidence",
      characterFacts: compactList((retrievedMemories || []).map((item) => item.content), 10),
      userMemory: [],
      styleHints: [],
      blockedFacts: [],
      warnings: retrievalPlan.evidenceCount
        ? ["严格证据模式：只允许使用 memory_agent/CRAG 召回证据。"]
        : ["严格证据模式：没有可用证据，禁止补全具体事实。"],
      identityRule: "第一人称是当前角色；本轮具体事实只能来自 characterFacts。"
    };
  }
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
