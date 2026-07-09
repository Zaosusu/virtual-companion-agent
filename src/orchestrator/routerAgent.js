import { detectModalityIntent } from "./modalityIntent.js";

const voiceKeywords = [
  "语音", "声音", "念给我", "读出来", "哄我",
  "发语音", "发一段语音", "语音消息", "语音回我",
  "说给我听", "用语音", "陪我睡", "晚安",
  "不想看字", "voice", "audio"
];

export function routeAgentTurn({ userText, reply = {}, modelConfig = {} }) {
  const text = String(userText || "").toLowerCase();
  const intent = detectModalityIntent(text);
  const wantsTextOnly = intent.textOnly;
  const wantsNoVoice = includesAny(text, noVoiceKeywords);
  const wantsImage = !wantsTextOnly && intent.image.explicit;
  const imageHelpful = !wantsTextOnly && intent.image.implicit && reply.workflow !== "safety_crisis";
  const wantsVoice = !wantsTextOnly && !wantsNoVoice && includesAny(text, voiceKeywords) && reply.workflow !== "safety_crisis";

  const capabilities = normalizeCapabilities(modelConfig);
  const imageFromTextAgent = reply.source === "tool:image.generate";
  const imageEnabled = Boolean((imageFromTextAgent || wantsImage || imageHelpful) && capabilities.image);
  const voiceEnabled = Boolean(wantsVoice && capabilities.voice);

  const outputs = ["text"];
  if (imageEnabled) outputs.push("image");
  if (voiceEnabled) outputs.push("voice");

  return {
    agent: "router_agent",
    outputs,
    textAgent: { enabled: true },
    imageAgent: {
      enabled: imageEnabled,
      explicit: Boolean(wantsImage || imageFromTextAgent),
      source: imageFromTextAgent ? "text_agent_tool" : wantsImage ? "explicit_request" : imageHelpful ? "implicit_context" : "none"
    },
    voiceAgent: {
      enabled: voiceEnabled,
      explicit: Boolean(wantsVoice)
    }
  };
}

function normalizeCapabilities(modelConfig = {}) {
  return {
    image: Boolean(modelConfig.capabilities?.image || modelConfig.imageOutputAvailable),
    voice: Boolean(modelConfig.capabilities?.voice || modelConfig.audioEnabled)
  };
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

const noVoiceKeywords = [
  "不要语音"
];
