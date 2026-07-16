import { buildAgentModelRequest } from "../modelPolicy.js";

const ALLOWED_FIELDS = [
  "name", "avatar", "tagline", "persona", "appearance", "relationship", "userPersona",
  "voiceStyle", "systemPrompt", "openingMessage", "openingSuggestions", "visualContext",
  "prompts", "boundaries", "safetyRules", "gender", "voiceGender", "voiceTone"
];

export async function optimizeAgentDraft({ draft = {}, memories = [], targetField = "", llm = {}, fetchImpl = fetch }) {
  if (!llm?.apiKey || !llm?.baseUrl || !llm?.model) throw new Error("请先登录并确认文字模型服务可用。");
  const field = ALLOWED_FIELDS.includes(targetField) ? targetField : "";
  const compactDraft = compactDraftFields(draft);
  const compactMemories = (Array.isArray(memories) ? memories : []).slice(0, 16).map((item) => ({
    kind: String(item.kind || "").slice(0, 40),
    content: String(item.content || item.text || "").slice(0, 900)
  })).filter((item) => item.content);
  const messages = buildMessages(compactDraft, compactMemories, field);
  let text = await requestOptimization({ llm, messages, fetchImpl, maxTokens: field ? 900 : 2600 });
  let parsed = normalizeResult(parseJsonObject(text), field);
  if (!parsed) {
    text = await requestOptimization({
      llm,
      fetchImpl,
      maxTokens: field ? 900 : 2600,
      messages: [
        { role: "system", content: "把下面内容修复成严格 JSON。只返回 JSON，不要 Markdown。" },
        { role: "user", content: `允许字段：${field || ALLOWED_FIELDS.join(", ")}\n原始输出：\n${String(text).slice(0, 6000)}` }
      ]
    });
    parsed = normalizeResult(parseJsonObject(text), field);
  }
  if (!parsed) throw new Error("AI 返回格式不稳定，请稍后重试。");
  return { agent: normalizeOptimizedAgent(parsed), targetField: field };
}

async function requestOptimization({ llm, messages, fetchImpl, maxTokens }) {
  const official = llm.mode === "cloud_license" || llm.mode === "free_quota";
  const endpoint = official
    ? `${llm.baseUrl.replace(/\/$/, "")}/api/chat`
    : `${llm.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify(buildAgentModelRequest({ model: llm.model, messages, task: "review_gate", maxTokens }))
  });
  const data = await safeJson(response);
  if (!response.ok) throw new Error(data.error || `AI 优化服务请求失败 ${response.status}`);
  const text = extractText(data);
  if (!text) throw new Error("AI 优化服务没有返回内容。");
  return text;
}

function buildMessages(draft, memories, targetField) {
  const fields = targetField || ALLOWED_FIELDS.join(", ");
  return [
    {
      role: "system",
      content: [
        "你是 2link 的角色设定优化 Agent。只返回一个 JSON 对象，不要 Markdown 或解释。",
        "所有用户可见内容使用自然简体中文。保留用户原意、姓名、称呼、关系气氛和边界，不要改成另一个角色。",
        "长期记忆只用于有证据的身份、经历、外貌和表达习惯；不得把用户事实转移到角色身上，不得补写证据中不存在的具体事实。",
        `只允许返回字段：${fields}。`,
        targetField ? `只优化 ${targetField}，不要返回其他字段。` : "完整优化时尽量补齐所有允许字段，数组项保持短而具体。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "当前角色草稿：",
        JSON.stringify(draft, null, 2),
        memories.length ? "当前角色长期记忆证据：" : "没有召回长期记忆，只能依据当前草稿。",
        memories.length ? JSON.stringify(memories, null, 2) : ""
      ].filter(Boolean).join("\n\n")
    }
  ];
}

function compactDraftFields(draft = {}) {
  const result = {};
  for (const field of ALLOWED_FIELDS) {
    const value = draft[field];
    result[field] = Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8)
      : String(value || "").trim().slice(0, field === "persona" || field === "systemPrompt" ? 1800 : 900);
  }
  result.userPersonaEnabled = Boolean(draft.userPersonaEnabled);
  return result;
}

function normalizeOptimizedAgent(agent = {}) {
  const result = {};
  for (const field of ALLOWED_FIELDS) {
    if (!(field in agent)) continue;
    const value = agent[field];
    if (["openingSuggestions", "prompts", "boundaries", "safetyRules"].includes(field)) {
      result[field] = (Array.isArray(value) ? value : String(value || "").split(/\r?\n/))
        .map((item) => String(item || "").trim()).filter(Boolean)
        .slice(0, field === "openingSuggestions" ? 3 : 8);
    } else {
      result[field] = String(value || "").trim().slice(0, field === "avatar" ? 2 : 1800);
    }
  }
  return result;
}

function normalizeResult(parsed, targetField) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed.agent && typeof parsed.agent === "object" ? parsed.agent : parsed;
  if (targetField) return targetField in value ? { [targetField]: value[targetField] } : null;
  return Object.keys(value).some((field) => ALLOWED_FIELDS.includes(field)) ? value : null;
}

function parseJsonObject(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : part?.text || "").join("\n").trim();
  return String(data?.output_text || data?.text || "").trim();
}

async function safeJson(response) {
  try { return await response.json(); } catch { return { error: await response.text().catch(() => "") }; }
}
