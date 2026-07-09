import { buildAgentModelRequest } from "../modelPolicy.js";

export async function reviewAgentOutput({
  channel,
  text = "",
  userText = "",
  history = [],
  agent = {},
  character = {},
  llm = {}
}) {
  const original = String(text || "").trim();
  const fallback = localReview({ channel, text: original, userText, agent });
  if (!original) return fallback;
  if (!llm?.apiKey || !llm?.baseUrl || !llm?.model) return fallback;

  try {
    const reviewed = await callReviewModel({ channel, text: original, userText, history, agent, character, llm });
    if (!reviewed?.text) return fallback;
    const hardCheck = localReview({ channel, text: reviewed.text, userText, agent });
    if (hardCheck.action === "rewrite") return { ...hardCheck, previousReviewer: "llm" };
    return reviewed;
  } catch {
    return fallback;
  }
}

async function callReviewModel({ channel, text, userText, history, agent, character, llm }) {
  const endpoint = llm.mode === "cloud_license" || llm.mode === "free_quota"
    ? `${llm.baseUrl.replace(/\/$/, "")}/api/chat`
    : `${llm.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const messages = [
    {
      role: "system",
      content: [
        "你是 review_agent，负责在最终输出前审阅各输出通道的内容。",
        `当前通道：${channel}。`,
        "你需要判断草稿是否符合用户本轮请求、角色人设、聊天语境和通道能力。",
        "如果通道是 voice，内容必须能直接作为语音气泡播放；不得出现“我不能发语音、只能打字、打电话、约语音通话”等与已经发语音冲突的话。",
        "如果通道是 voice，括号里的动作、神态、内心和场景描写不是台词，不能进入最终语音文本；只保留角色真正说出口的话。例：（他轻轻笑了一下）我在，别怕。=> 我在，别怕。",
        "如果通道是 voice 且草稿只有括号动作没有台词，需要根据上下文补一句自然台词，不要返回空文本。",
        "如果草稿不合格，必须保留有效上下文并改写；不要写审阅解释，不要说你在改稿。",
        "输出严格 JSON：{\"action\":\"keep|rewrite\",\"text\":\"最终输出内容\",\"reason\":\"简短原因\"}。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        channel,
        userText,
        draftText: text,
        agent: {
          name: agent.name || character.name || "",
          persona: agent.persona || character.persona || "",
          voiceStyle: agent.voiceStyle || character.voice?.style || "",
          relationship: agent.relationship || ""
        },
        recentHistory: history.slice(-10).map((item) => ({ role: item.role, content: item.content }))
      }, null, 2)
    }
  ];
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify(buildAgentModelRequest({ model: llm.model, messages, task: "review_gate" }))
  });
  if (!response.ok) throw new Error(`review agent failed ${response.status}`);
  const data = await response.json();
  const parsed = parseJsonObject(extractReviewText(data));
  const reviewedText = String(parsed.text || "").trim();
  if (!reviewedText) throw new Error("review agent returned empty text");
  return {
    agent: "review_agent",
    action: parsed.action === "keep" ? "keep" : "rewrite",
    text: reviewedText,
    reason: String(parsed.reason || "").slice(0, 160),
    reviewer: "llm"
  };
}

function localReview({ channel, text, userText, agent }) {
  if (channel !== "voice") {
    return {
      agent: "review_agent",
      action: "keep",
      text,
      reason: "当前通道无需本地改写",
      reviewer: "local"
    };
  }
  const spokenText = spokenTextForVoice(text);
  const hasNarration = comparableText(spokenText) !== comparableText(text);
  const hasConflict = hasVoiceCapabilityConflict(text);
  if (!hasConflict && !hasNarration && spokenText) {
    return {
      agent: "review_agent",
      action: "keep",
      text: spokenText,
      reason: "适合语音输出",
      reviewer: "local"
    };
  }
  if (!hasConflict && spokenText) {
    return {
      agent: "review_agent",
      action: "rewrite",
      text: spokenText,
      reason: "语音通道已移除括号动作，只保留可朗读台词。",
      reviewer: "local"
    };
  }
  return {
    agent: "review_agent",
    action: "rewrite",
    text: repairVoiceText(text, userText, agent),
    reason: "语音通道内容包含能力冲突，已按上下文改写。",
    reviewer: "local"
  };
}

function hasVoiceCapabilityConflict(text) {
  return [
    /发不了.{0,8}(语音|声音)/,
    /发不出.{0,8}(语音|声音)/,
    /没法.{0,12}(直接)?(发|用|说).{0,12}(语音|声音)/,
    /不能.{0,12}(直接)?(发|用|说).{0,12}(语音|声音)/,
    /无法.{0,12}(直接)?(发|用|说).{0,12}(语音|声音)/,
    /不支持.{0,8}(语音|声音)/,
    /这边是文字交流/,
    /只能打字/,
    /打字比较方便/,
    /开个语音通话/,
    /打个电话/,
    /约个时间打/
  ].some((pattern) => pattern.test(String(text || "")));
}

function repairVoiceText(text, userText, agent = {}) {
  const cleaned = spokenTextForVoice(text)
    .split(/(?<=[。！？!?])\s*|\n+/)
    .map((line) => line.trim().replace(/^要不这样，?/, ""))
    .filter(Boolean)
    .filter((line) => !hasVoiceCapabilityConflict(line))
    .join("\n\n")
    .replace(/你是不是想听我说？?/g, "")
    .trim();
  if (cleaned.length >= 12) return cleaned;

  const name = agent?.name || "我";
  const request = String(userText || "")
    .replace(/发语音给我|给我发语音|发一段语音|发个语音|语音|声音/g, "")
    .replace(/[，。！？!?]+/g, " ")
    .trim();
  return request
    ? `${name}用语音跟你说：${request}`
    : `${name}用语音跟你说。我在，你想听技术细节、项目故事，还是最近的想法？`;
}

export function spokenTextForVoice(text) {
  const source = String(text || "").trim();
  if (!source) return "";
  let result = source;
  for (let index = 0; index < 4; index += 1) {
    const next = result
      .replace(/（[^（）]{0,240}）/g, "")
      .replace(/\([^()]{0,240}\)/g, "")
      .replace(/【[^【】]{0,240}】/g, "")
      .replace(/\[[^\[\]]{0,240}\]/g, "")
      .replace(/^[\s>*_~-]*[*_][^*_]{0,240}[*_][\s>*_~-]*$/gm, "");
    if (next === result) break;
    result = next;
  }
  return result
    .replace(/[“”"‘’「」]/g, "")
    .replace(/^[\s:：,，。.!！?？;；、"“”'‘’]+|[\s:：,，;；、"“”'‘’]+$/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function comparableText(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function extractReviewText(data) {
  if (typeof data?.text === "string") return data.text.trim();
  if (typeof data?.output_text === "string") return data.output_text.trim();
  const outputText = data?.output
    ?.flatMap((item) => item.content || [])
    ?.map((part) => part.text || "")
    ?.join("")
    ?.trim();
  if (outputText) return outputText;
  return data?.choices?.[0]?.message?.content?.trim() || "";
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
