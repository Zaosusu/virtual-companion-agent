const SILENCE_PATTERN = /保持沉默|继续沉默|只能沉默|沉默不语|沉默了|沉默着|一言不发|默不作声|没有开口|不再开口|闭嘴|噤声|别说话|不要说话|不许说话|不能说话|不要开口|不许开口|不能开口|不要出声|不许出声|不能出声/i;
const BARE_SILENCE_PATTERN = /^(?:请)?(?:沉默|闭嘴|噤声)[。.!！~～]*$/i;
const USER_SILENCE_PATTERN = /^(?:我|用户|旁白中的我).{0,8}(?:沉默|不想说话|没有说话|一言不发)/i;
const SPEECH_RELEASE_PATTERN = /(?:可以|允许|准许|让|示意).{0,8}(?:说话|开口|出声|回答)|(?:终于|随后|这才|然后|片刻后|沉默.{0,6}后).{0,8}(?:开口|说|问|喊|回答|回应)|打破沉默|恢复说话/i;
const PERSISTENT_SILENCE_PATTERN = /一直|保持|继续|接下来|在此期间|直到|除非|不许|不能|不要|别说话|闭嘴|噤声/i;

export function buildSceneConstraints({ userText = "", dialogueState = {} } = {}) {
  const prior = normalizeSceneConstraints(dialogueState?.sceneConstraints || dialogueState?.constraints);
  const local = inferLocalSpeechConstraint(userText);
  if (local.release) return { speech: normalSpeech(local.reason, "local_release") };
  if (local.mode === "silent") return { speech: local };
  if (prior.speech.mode === "silent" && prior.speech.scope === "until_released") return prior;
  return { speech: normalSpeech() };
}

export function normalizeSceneConstraints(value = null) {
  const input = value && typeof value === "object" ? value : {};
  const speech = input.speech && typeof input.speech === "object" ? input.speech : input;
  return { speech: normalizeSpeechConstraint(speech) };
}

export function formatSceneConstraintInstruction(constraints = {}) {
  const speech = normalizeSceneConstraints(constraints).speech;
  if (speech.mode !== "silent") return "";
  return [
    "[SCENE_CONSTRAINTS]",
    "本轮角色受沉默约束：不能说话、出声、回答、提问或产生可朗读台词。",
    "整个回复只能由一个或多个全角括号（ ）组成；括号内可写动作、神态、观察或内心活动，括号外不得出现文字。",
    "不要用引号、冒号、拟声词或内心引号绕过沉默约束，也不要解释为什么没有台词。",
    `约束范围：${speech.scope === "until_released" ? "持续到剧情明确允许开口" : "仅当前一轮"}。`,
    "[/SCENE_CONSTRAINTS]"
  ].join("\n");
}

export function enforceSceneConstraints(answer = "", constraints = {}) {
  const speech = normalizeSceneConstraints(constraints).speech;
  const text = String(answer || "").trim();
  if (speech.mode !== "silent") return text;
  const actions = extractNarrationBlocks(text);
  if (actions.length) return actions.map((item) => `（${item}）`).join("\n");
  return "（没有开口，只以沉默回应眼前发生的一切。）";
}

export function canProduceSpeech(constraints = {}) {
  return normalizeSceneConstraints(constraints).speech.mode !== "silent";
}

export function spokenTextOutsideNarration(value = "") {
  return String(value || "")
    .replace(/（[^（）\n\r]{0,1200}）/g, "")
    .replace(/\([^()\n\r]{0,1200}\)/g, "")
    .replace(/[\s，。！？!?、：:；;…—-]/g, "")
    .trim();
}

function inferLocalSpeechConstraint(userText = "") {
  const text = String(userText || "").normalize("NFKC").trim();
  if (!text) return normalSpeech();
  if (SPEECH_RELEASE_PATTERN.test(text)) {
    return { ...normalSpeech("剧情中已经重新允许开口"), release: true };
  }
  if (USER_SILENCE_PATTERN.test(text) && !/(?:你|他|她|角色).{0,8}(?:也|必须|要).{0,6}(?:沉默|别说话|不要开口)/.test(text)) {
    return normalSpeech("用户描述自己的沉默");
  }
  if (!SILENCE_PATTERN.test(text) && !BARE_SILENCE_PATTERN.test(text)) return normalSpeech();
  return {
    mode: "silent",
    scope: PERSISTENT_SILENCE_PATTERN.test(text) ? "until_released" : "turn",
    reason: "用户或剧情要求角色保持沉默",
    source: "local_explicit",
    release: false
  };
}

function normalizeSpeechConstraint(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const mode = ["normal", "silent", "whisper"].includes(input.mode) ? input.mode : "normal";
  return {
    mode,
    scope: ["turn", "until_released"].includes(input.scope) ? input.scope : "turn",
    reason: String(input.reason || "").slice(0, 160),
    source: String(input.source || "").slice(0, 40)
  };
}

function normalSpeech(reason = "", source = "") {
  return { mode: "normal", scope: "turn", reason, source, release: false };
}

function extractNarrationBlocks(value = "") {
  const text = String(value || "");
  const blocks = [
    ...[...text.matchAll(/（([^（）\n\r]{1,1200})）/g)].map((match) => match[1]),
    ...[...text.matchAll(/\(([^()\n\r]{1,1200})\)/g)].map((match) => match[1])
  ];
  return [...new Set(blocks.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 3);
}
