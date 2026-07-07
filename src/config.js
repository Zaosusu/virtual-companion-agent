import { RELEASE_OFFICIAL_BASE_URL } from "./releaseEnv.js";

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
    mode: officialEnabled ? "cloud_license" : enabled ? "self_hosted" : "free_quota",
    source: officialEnabled ? "official" : enabled ? (saved.enabled ? "database" : "environment-self-hosted") : "local"
  };
}

export function toPublicModelConfig(config) {
  return {
    enabled: Boolean(config.enabled),
    capabilities: {
      image: Boolean(config.imageOutputAvailable),
      voice: Boolean(config.audioEnabled)
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
      systemPrompt: agent.systemPrompt,
      prompts: agent.prompts || [],
      avatar: agent.avatar,
      tagline: agent.tagline,
      imageStyle: agent.imageStyle || "realistic",
      appearance: agent.appearance || "",
      visualContext: agent.visualContext || "",
      voiceGender: agent.voiceGender || "female",
      voiceTone: agent.voiceTone || "warm",
      clonedVoiceId: agent.clonedVoiceId || "",
      voiceSampleName: agent.voiceSampleName || "",
      referenceImage: agent.referenceImage || null
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
    appearance: agent.appearance || "",
    voiceStyle: agent.voiceStyle || "",
    relationship: agent.relationship || "",
    openingMessage: agent.openingMessage || "",
    systemPrompt: agent.systemPrompt || "",
    imageStyle: agent.imageStyle === "anime" ? "anime" : "realistic",
    visualContext: agent.visualContext || "",
    voiceGender: normalizeVoiceGender(agent.voiceGender),
    voiceTone: ["warm", "bright", "calm", "energetic", "soft"].includes(agent.voiceTone) ? agent.voiceTone : "warm",
    clonedVoiceId: agent.clonedVoiceId || "",
    voiceSampleName: agent.voiceSampleName || "",
    referenceImage: agent.referenceImage || null,
    boundaries: Array.isArray(agent.boundaries) ? agent.boundaries : [],
    safetyRules: Array.isArray(agent.safetyRules) ? agent.safetyRules : [],
    prompts: Array.isArray(agent.prompts) ? agent.prompts : [],
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
