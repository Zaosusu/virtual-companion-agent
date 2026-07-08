import { detectSafety } from "./safetyAgent.js";

const DEFAULT_REALTIME_MODEL = "stepaudio-2.5-realtime";
const DEFAULT_REALTIME_URL = "wss://api.stepfun.com/step_plan/v1/realtime";

export function buildRealtimeSessionPlan({
  agent = {},
  character = {},
  modelConfig = {},
  memory = {},
  recentMessages = [],
  retrievedMemories = [],
  transcript = ""
} = {}) {
  const safety = detectSafety(transcript || recentMessages.at(-1)?.content || "");
  const allowVoice = safety.level !== "crisis";
  return {
    agent: "realtime_voice_agent",
    model: modelConfig.realtimeModel || DEFAULT_REALTIME_MODEL,
    url: modelConfig.realtimeUrl || DEFAULT_REALTIME_URL,
    apiKey: modelConfig.realtimeApiKey || "",
    session: {
      modalities: ["text", "audio"],
      instructions: buildRealtimeInstructions({
        agent,
        character,
        memory,
        recentMessages,
        retrievedMemories,
        transcript,
        safety
      }),
      voice: resolveRealtimeVoice({ agent, modelConfig }),
      input_audio_format: "pcm16",
      output_audio_format: "pcm16"
    },
    policy: {
      allowVoice,
      allowInterruptions: true,
      allowTools: false,
      safetyLevel: safety.level,
      reason: allowVoice ? "" : "crisis_safety"
    }
  };
}

export function buildRealtimeTurnPatch({
  agent = {},
  character = {},
  modelConfig = {},
  memory = {},
  recentMessages = [],
  retrievedMemories = [],
  transcript = ""
} = {}) {
  const safety = detectSafety(transcript);
  return {
    agent: "realtime_voice_agent",
    session: {
      modalities: ["text", "audio"],
      instructions: buildRealtimeInstructions({
        agent,
        character,
        memory,
        recentMessages,
        retrievedMemories,
        transcript,
        safety
      })
    },
    policy: {
      allowVoice: safety.level !== "crisis",
      safetyLevel: safety.level,
      reason: safety.level === "crisis" ? "crisis_safety" : ""
    }
  };
}

function resolveRealtimeVoice({ agent = {}, modelConfig = {} } = {}) {
  if (agent.clonedVoiceId) return agent.clonedVoiceId;
  if (modelConfig.audioVoice) return modelConfig.audioVoice;
  const voiceGender = String(agent.voiceGender || "").toLowerCase();
  if (voiceGender.includes("male") || voiceGender.includes("boy")) return "cixingnansheng";
  return "yuanqishaonv";
}

function buildRealtimeInstructions({
  agent = {},
  character = {},
  memory = {},
  recentMessages = [],
  retrievedMemories = [],
  transcript = "",
  safety = { level: "normal" }
}) {
  const name = agent.name || character.name || "角色";
  const userSystemPrompt = String(agent.systemPrompt || character.runtime_config?.systemPrompt || "").trim();
  const persona = String(agent.persona || character.persona || "").trim();
  const voiceStyle = String(agent.voiceStyle || character.voice?.style || "").trim();
  const relationship = String(agent.relationship || character.relationship?.stance || "").trim();
  const boundaries = normalizeLines(agent.boundaries || character.boundaries);
  const safetyRules = normalizeLines(agent.safetyRules || character.safety_rules);

  return [
    userSystemPrompt
      ? `最高优先级角色系统提示：\n${userSystemPrompt}`
      : `你正在以「${name}」的第一人称与用户进行实时语音对话。`,
    persona ? `角色人设：${persona}` : "",
    relationship ? `关系定位：${relationship}` : "",
    voiceStyle ? `说话风格：${voiceStyle}` : "说话风格：自然口语、短句、贴近真实语音，不要播音腔。",
    boundaries.length ? `边界规则：${boundaries.join("；")}` : "",
    safetyRules.length ? `安全规则：${safetyRules.join("；")}` : "",
    "实时语音规则：回答要短、自然、可被打断；不要解释你是模型、系统或接口；不要把括号里的动作当成说明书朗读。",
    "身份规则：第一人称“我”永远是当前角色，第二人称“你”永远是当前正在聊天的用户。",
    formatMemory(memory),
    formatRetrievedMemories(retrievedMemories),
    formatRecentMessages(recentMessages),
    transcript ? `用户刚才的语音转写：${trim(transcript, 500)}` : "",
    safety.level === "bounded" ? "当前话题可能涉及高风险领域，只做信息整理和情绪支持，不给医疗、法律或金融决定性建议。" : "",
    safety.level === "crisis" ? "用户可能存在自伤风险。停止角色扮演式暧昧或娱乐回应，优先引导联系现实可信赖的人或当地紧急服务。" : ""
  ].filter(Boolean).join("\n\n").slice(0, 6000);
}

function formatMemory(memory = {}) {
  const parts = [
    listMemory("用户事实", memory.facts),
    listMemory("用户偏好", memory.preferences),
    listMemory("情绪模式", memory.emotional_patterns),
    listMemory("角色资料风格", memory.persona_style),
    listMemory("角色资料口头禅", memory.persona_catchphrases),
    listMemory("近期摘要", memory.recent_summaries?.map((item) => ({ text: item.assistant || item.text || "" })))
  ].filter(Boolean);
  return parts.length ? `可用长期记忆：\n${parts.join("\n")}` : "";
}

function formatRetrievedMemories(items = []) {
  const lines = items
    .slice(0, 8)
    .map((item, index) => `${index + 1}. ${trim(item.content || item.text || "", 220)}`)
    .filter(Boolean);
  return lines.length ? `本轮召回记忆：\n${lines.join("\n")}` : "";
}

function formatRecentMessages(messages = []) {
  const lines = messages
    .slice(-10)
    .map((item) => `${item.role === "assistant" ? "角色" : item.role === "user" ? "用户" : "系统"}：${trim(item.content, 180)}`)
    .filter(Boolean);
  return lines.length ? `最近对话：\n${lines.join("\n")}` : "";
}

function listMemory(label, items = []) {
  const lines = (items || [])
    .slice(0, 5)
    .map((item) => trim(item.text || item.content || item.assistant || "", 160))
    .filter(Boolean);
  return lines.length ? `${label}：${lines.join("；")}` : "";
}

function normalizeLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function trim(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
