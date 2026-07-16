import { RELEASE_OFFICIAL_BASE_URL } from "./releaseEnv.js";

function officialRealtimeUrl(baseUrl = "") {
  const clean = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!clean) return "";
  return `${clean.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:")}/ws/realtime`;
}

export function getEffectiveModelConfig(store, env = process.env) {
  const saved = store.getModelConfig();
  const envApiKey = env.STEP_API_KEY || env.STEPFUN_API_KEY || env.COMPANION_API_KEY || "";
  const envBaseUrl = env.STEPFUN_BASE_URL || env.COMPANION_BASE_URL || "https://api.stepfun.com/step_plan/v1";
  const envModel = env.STEPFUN_MODEL || env.COMPANION_MODEL || "step-3.7-flash";
  const envOfficialBaseUrl = env.COMPANION_OFFICIAL_BASE_URL || RELEASE_OFFICIAL_BASE_URL || "";
  const envOfficialModel = env.COMPANION_OFFICIAL_MODEL || envModel;
  const selfHostedEnabled = env.COMPANION_SELF_HOSTED === "1";

  const apiKey = selfHostedEnabled ? (saved.apiKey || envApiKey) : "";
  const baseUrl = saved.baseUrl || envBaseUrl;
  const model = saved.model || envModel;
  const officialBaseUrl = saved.officialBaseUrl || envOfficialBaseUrl;
  const officialLicenseKey = saved.officialLicenseKey || "";
  const officialUserToken = saved.officialUserToken || "";
  const officialModel = saved.officialModel || envOfficialModel;
  const officialEnabled = Boolean(officialUserToken && officialBaseUrl && officialModel);
  const publicFreeAccessEnabled = env.COMPANION_PUBLIC_FREE_ACCESS === "1";
  const enabled = !officialEnabled && Boolean(apiKey) && selfHostedEnabled;
  const officialGatewayAvailable = officialEnabled || (publicFreeAccessEnabled && !enabled && Boolean(officialBaseUrl && officialModel));
  const imageApiKey = selfHostedEnabled ? (saved.imageApiKey || apiKey) : "";
  const imageBaseUrl = saved.imageBaseUrl || env.STEPFUN_IMAGE_BASE_URL || env.COMPANION_IMAGE_BASE_URL || "https://api.stepfun.com/step_plan/v1";
  const imageModel = saved.imageModel || env.STEPFUN_IMAGE_MODEL || env.COMPANION_IMAGE_MODEL || "step-image-edit-2";
  const imageModelEnabled = officialGatewayAvailable
    ? Boolean(officialBaseUrl && imageModel)
    : Boolean(imageBaseUrl && imageModel && imageApiKey);
  const audioApiKey = selfHostedEnabled ? (saved.audioApiKey || saved.imageApiKey || apiKey) : "";
  const audioBaseUrl = saved.audioBaseUrl || env.STEPFUN_AUDIO_BASE_URL || env.COMPANION_AUDIO_BASE_URL || "https://api.stepfun.com/step_plan/v1";
  const audioModel = saved.audioModel || env.STEPFUN_AUDIO_MODEL || env.COMPANION_AUDIO_MODEL || "stepaudio-2.5-tts";
  const audioVoice = saved.audioVoice || "yuanqishaonv";
  const audioInstruction = saved.audioInstruction || "语气自然亲近，像聊天中轻声回复，情绪贴合上下文。";
  const audioFormat = saved.audioFormat || "mp3";
  const audioSpeed = saved.audioSpeed || "";
  const audioVolume = saved.audioVolume || "";
  const audioSampleRate = saved.audioSampleRate || "";
  const audioTextNormalization = saved.audioTextNormalization || "";
  const audioMarkdownFilter = Boolean(saved.audioMarkdownFilter);
  const audioReturnUrl = Boolean(saved.audioReturnUrl);
  const audioTimestamp = Boolean(saved.audioTimestamp);
  const audioExtraBody = parseJsonObject(saved.audioExtraBody);
  const audioConfigured = officialGatewayAvailable
    ? Boolean(officialBaseUrl && audioModel)
    : Boolean(audioBaseUrl && audioModel && audioApiKey);
  const audioEnabled = Boolean(audioConfigured && audioVoice);
  const realtimeUrl = officialEnabled
    ? officialRealtimeUrl(officialBaseUrl)
    : env.STEPFUN_REALTIME_URL || env.COMPANION_REALTIME_URL || "wss://api.stepfun.com/step_plan/v1/realtime";
  const realtimeModel = env.STEPFUN_REALTIME_MODEL || env.COMPANION_REALTIME_MODEL || "stepaudio-2.5-realtime";
  const realtimeApiKey = officialEnabled
    ? officialUserToken
    : selfHostedEnabled
    ? (env.STEPFUN_REALTIME_API_KEY || env.STEP_API_KEY || env.STEPFUN_API_KEY || saved.audioApiKey || apiKey)
    : "";
  const realtimeEnabled = Boolean((officialEnabled || selfHostedEnabled) && realtimeUrl && realtimeModel && realtimeApiKey);

  return {
    enabled,
    apiKey: enabled ? apiKey : "",
    baseUrl,
    model,
    officialEnabled,
    officialBaseUrl,
    officialLicenseKey,
    officialUserToken,
    officialAccessToken: officialUserToken || officialLicenseKey,
    officialModel,
    imageOutputEnabled: Boolean(saved.imageOutputEnabled) || imageModelEnabled,
    imageModelEnabled,
    imageOutputAvailable: Boolean(saved.imageOutputEnabled && (enabled || officialGatewayAvailable)) || imageModelEnabled,
    imageBaseUrl,
    imageApiKey: imageModelEnabled ? imageApiKey : "",
    imageModel,
    publicBaseUrl: baseUrl,
    publicModel: model,
    publicImageBaseUrl: imageBaseUrl,
    publicImageModel: imageModel,
    audioEnabled,
    audioBaseUrl,
    audioApiKey: audioConfigured ? audioApiKey : "",
    audioModel,
    audioVoice,
    audioInstruction,
    audioFormat,
    audioSpeed,
    audioVolume,
    audioSampleRate,
    audioTextNormalization,
    audioMarkdownFilter,
    audioReturnUrl,
    audioTimestamp,
    audioExtraBody,
    realtimeEnabled,
    realtimeUrl,
    realtimeModel,
    realtimeApiKey: realtimeEnabled ? realtimeApiKey : "",
    mode: officialEnabled ? "cloud_license" : enabled ? "self_hosted" : "free_quota",
    source: officialEnabled ? "official" : enabled ? (saved.enabled ? "database" : "environment-self-hosted") : "local"
  };
}

export function toPublicModelConfig(config) {
  return {
    enabled: Boolean(config.enabled),
    capabilities: {
      image: Boolean(config.imageOutputAvailable),
      voice: Boolean(config.audioEnabled),
      realtimeVoice: Boolean(config.realtimeEnabled)
    },
    license: {
      enabled: Boolean(config.officialLicenseKey),
      saved: Boolean(config.officialLicenseKey),
      mask: config.officialLicenseKey ? maskKey(config.officialLicenseKey) : "",
      bound: false,
      pendingBind: Boolean(config.officialLicenseKey && !config.officialUserToken)
    },
    user: {
      loggedIn: Boolean(config.officialUserToken),
      tokenSaved: Boolean(config.officialUserToken)
    },
    mode: config.officialEnabled ? "licensed" : config.enabled ? "online" : "trial"
  };
}

export function characterFromAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    version: "0.2.0",
    persona: agent.persona,
    gender: normalizeAgentGender(agent.gender, agent.voiceGender),
    relationship: {
      default: agent.category,
      stance: agent.relationship
    },
    voice: {
      style: agent.voiceStyle,
      catchphrases: []
    },
    workflows: ["daily_checkin", "comfort", "plan", "reflection", "creative", "safety_crisis"],
    boundaries: agent.boundaries || [],
    safety_rules: agent.safetyRules || [],
    runtime_config: {
      openingMessage: agent.openingMessage,
      openingSuggestions: normalizeTextArray(agent.openingSuggestions, 3, 180),
      systemPrompt: agent.systemPrompt,
      prompts: agent.prompts || [],
      quickActionsEnabled: Boolean(agent.quickActionsEnabled),
      avatar: agent.avatar,
      avatarImage: agent.avatarImage || null,
      tagline: agent.tagline,
      gender: normalizeAgentGender(agent.gender, agent.voiceGender),
      imageStyle: agent.imageStyle || "realistic",
      appearance: agent.appearance || "",
      visualContext: agent.visualContext || "",
      userPersonaEnabled: Boolean(agent.userPersonaEnabled),
      userPersona: agent.userPersonaEnabled ? String(agent.userPersona || "").trim() : "",
      voiceGender: agent.voiceGender || "female",
      voiceTone: agent.voiceTone || "warm",
      autoRead: Boolean(agent.autoRead),
      voiceSpeed: normalizeVoiceSpeed(agent.voiceSpeed),
      voiceVolume: normalizeVoiceVolume(agent.voiceVolume),
      voiceExpressiveness: normalizeRatio(agent.voiceExpressiveness, 0.6),
      voiceWarmth: normalizeRatio(agent.voiceWarmth, 0.7),
      voiceClarity: normalizeRatio(agent.voiceClarity, 0.65),
      responseStyle: normalizeResponseStyle(agent.responseStyle),
      creativityLevel: normalizeRatio(agent.creativityLevel, 0.6),
      replyLength: normalizeRatio(agent.replyLength, 0.35),
      clonedVoiceId: agent.clonedVoiceId || "",
      voiceSampleName: agent.voiceSampleName || "",
      referenceImage: agent.referenceImage || null,
      chatBackground: agent.chatBackground || null,
      chatBackgroundOpacity: agent.chatBackgroundOpacity ?? 0.18,
      chatBackgroundBlur: agent.chatBackgroundBlur ?? 0,
      chatBackgroundOverlay: agent.chatBackgroundOverlay === true,
      chatBrandVisible: agent.chatBrandVisible !== false
    }
  };
}

export function agentToPack(agent) {
  return {
    format: "companion-agent-pack",
    version: "0.1.0",
    exportedAt: new Date().toISOString(),
    agent: {
      ...agent,
      isBuiltin: false
    }
  };
}

export function agentFromImport(value) {
  const agent = value?.agent || value;
  if (!agent?.name || !agent?.persona) {
    throw new Error("角色包缺少 name 或 persona");
  }
  return {
    id: agent.id,
    name: agent.name,
    avatar: agent.avatar || agent.name.slice(0, 1),
    category: agent.category || "custom",
    tagline: agent.tagline || "",
    persona: agent.persona,
    gender: normalizeAgentGender(agent.gender, agent.voiceGender),
    appearance: agent.appearance || "",
    voiceStyle: agent.voiceStyle || "",
    relationship: agent.relationship || "",
    userPersonaEnabled: Boolean(agent.userPersonaEnabled),
    userPersona: String(agent.userPersona || "").trim(),
    openingMessage: agent.openingMessage || "",
    openingSuggestions: normalizeTextArray(agent.openingSuggestions, 3, 180),
    systemPrompt: agent.systemPrompt || "",
    imageStyle: agent.imageStyle === "anime" ? "anime" : "realistic",
    visualContext: agent.visualContext || "",
    voiceGender: normalizeVoiceGender(agent.voiceGender),
    voiceTone: ["warm", "bright", "calm", "energetic", "soft"].includes(agent.voiceTone) ? agent.voiceTone : "warm",
    autoRead: Boolean(agent.autoRead),
    voiceSpeed: normalizeVoiceSpeed(agent.voiceSpeed),
    voiceVolume: normalizeVoiceVolume(agent.voiceVolume),
    voiceExpressiveness: normalizeRatio(agent.voiceExpressiveness, 0.6),
    voiceWarmth: normalizeRatio(agent.voiceWarmth, 0.7),
    voiceClarity: normalizeRatio(agent.voiceClarity, 0.65),
    responseStyle: normalizeResponseStyle(agent.responseStyle),
    creativityLevel: normalizeRatio(agent.creativityLevel, 0.6),
    replyLength: normalizeRatio(agent.replyLength, 0.35),
    clonedVoiceId: agent.clonedVoiceId || "",
    voiceSampleName: agent.voiceSampleName || "",
    referenceImage: agent.referenceImage || null,
    chatBackground: agent.chatBackground || null,
    chatBackgroundOpacity: normalizeChatBackgroundOpacity(agent.chatBackgroundOpacity),
    chatBackgroundBlur: normalizeChatBackgroundBlur(agent.chatBackgroundBlur),
    chatBackgroundOverlay: agent.chatBackgroundOverlay === true,
    chatBrandVisible: agent.chatBrandVisible !== false,
    boundaries: Array.isArray(agent.boundaries) ? agent.boundaries : [],
    safetyRules: Array.isArray(agent.safetyRules) ? agent.safetyRules : [],
    prompts: Array.isArray(agent.prompts) ? agent.prompts : [],
    quickActionsEnabled: Boolean(agent.quickActionsEnabled),
    dialogueState: parseJsonObject(agent.dialogueState),
    isBuiltin: false
  };
}

function maskKey(apiKey) {
  if (apiKey.length <= 8) return "********";
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

function normalizeVoiceGender(value) {
  return [
    "girl",
    "female",
    "mature_female",
    "boy",
    "male",
    "deep_male",
    "neutral",
    "neutral_calm"
  ].includes(value) ? value : "female";
}

function normalizeVoiceSpeed(value) {
  if (value === "slow") return 0.85;
  if (value === "normal") return 1;
  if (value === "fast") return 1.15;
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Number(Math.min(2, Math.max(0.5, number)).toFixed(2));
}

function normalizeVoiceVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Number(Math.min(2, Math.max(0.1, number)).toFixed(2));
}

function normalizeRatio(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Number(Math.min(1, Math.max(0, number)).toFixed(2));
}

function normalizeResponseStyle(value) {
  const style = String(value || "").trim();
  return [
    "balanced",
    "vivid",
    "dream",
    "lover",
    "reserved",
    "story",
    "immersive",
    "history"
  ].includes(style) ? style : "balanced";
}

function normalizeTextArray(value, limit = 3, itemLimit = 180) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim().slice(0, itemLimit))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeAgentGender(value, voiceGender = "") {
  const gender = String(value || "").trim();
  if (["female", "male", "nonbinary", "unspecified"].includes(gender)) return gender;
  if (["boy", "male", "deep_male"].includes(voiceGender)) return "male";
  if (["girl", "female", "mature_female"].includes(voiceGender)) return "female";
  return "unspecified";
}

function normalizeChatBackgroundOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.18;
  return Math.min(1, Math.max(0, number));
}

function normalizeChatBackgroundBlur(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(24, Math.max(0, Math.round(number)));
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
