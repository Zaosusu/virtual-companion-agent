const explicitImageKeywords = [
  "自拍", "拍一张", "发张照片", "发个照片", "发个图", "给我看",
  "看看你", "画一张", "生成一张", "生成图", "出图",
  "image", "photo", "picture"
];

const implicitImageKeywords = [
  "穿", "背景", "场景", "灯光", "姿势", "表情",
  "今天长什么样", "现在在哪里", "想看看"
];

const voiceKeywords = [
  "语音", "声音", "念给我", "读出来", "哄我",
  "发语音", "发一段语音", "语音消息", "语音回我",
  "说给我听", "用语音", "陪我睡", "晚安",
  "不想看字", "voice", "audio"
];

const textOnlyKeywords = [
  "只要文字", "别发图", "不要语音", "文字说", "text only"
];

export function routeAgentTurn({ userText, reply = {}, modelConfig = {} }) {
  const text = String(userText || "").toLowerCase();
  const wantsTextOnly = includesAny(text, textOnlyKeywords);
  const wantsImage = !wantsTextOnly && includesAny(text, explicitImageKeywords);
  const imageHelpful = !wantsTextOnly
    && !wantsImage
    && includesAny(text, implicitImageKeywords)
    && reply.workflow !== "safety_crisis";
  const wantsVoice = !wantsTextOnly && includesAny(text, voiceKeywords) && reply.workflow !== "safety_crisis";

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
