const STEP_AUDIO_TTS_MODEL = "stepaudio-2.5-tts";

export async function synthesizeSpeech({ text, audioConfig, overrides = {} }) {
  const config = mergeAudioConfig(audioConfig, overrides);
  if (!config.apiKey || !config.baseUrl || !config.model || !config.voice) {
    throw new Error("语音服务还没有配置完整。");
  }

  const responseFormat = config.responseFormat || config.format || "mp3";
  const body = cleanBody({
    model: config.model,
    input: trimSpeechText(text),
    voice: config.voice,
    response_format: responseFormat,
    instruction: config.instruction ? String(config.instruction).slice(0, 200) : undefined,
    speed: toOptionalNumber(config.speed),
    volume: toOptionalNumber(config.volume),
    sample_rate: toOptionalNumber(config.sampleRate),
    text_normalization: config.textNormalization,
    markdown_filter: config.markdownFilter,
    return_url: config.returnUrl,
    timestamp: config.timestamp,
    ...safeObject(config.extraBody)
  });

  const response = await postRaw({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    path: "/audio/speech",
    body,
    action: "语音合成"
  });

  const contentType = response.headers.get("content-type") || `audio/${responseFormat}`;
  if (contentType.includes("application/json")) {
    const data = await response.json();
    const payload = data.data?.[0] || data.data || data;
    return normalizeAudioPayload(payload, responseFormat, data);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    audioBase64: bytes.toString("base64"),
    audioUrl: "",
    mimeType: normalizeMimeType(contentType, responseFormat),
    format: responseFormat,
    raw: null
  };
}

export async function previewVoice({ audioConfig, body = {} }) {
  const config = mergeAudioConfig(audioConfig, body);
  if (!config.apiKey || !config.baseUrl) throw new Error("语音服务还没有配置完整。");
  const requestBody = cleanBody({
    model: STEP_AUDIO_TTS_MODEL,
    file_id: body.file_id || body.fileId,
    text: body.text,
    sample_text: body.sample_text || body.sampleText,
    response_format: body.response_format || config.format || "mp3",
    instruction: body.instruction || config.instruction,
    speed: toOptionalNumber(body.speed ?? config.speed),
    volume: toOptionalNumber(body.volume ?? config.volume),
    sample_rate: toOptionalNumber(body.sample_rate ?? body.sampleRate ?? config.sampleRate),
    ...safeObject(body.extraBody)
  });

  const data = await postJson({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    path: "/audio/voices/preview",
    body: requestBody,
    action: "音色试听"
  });
  return {
    ...normalizeAudioPayload(data, requestBody.response_format || "mp3", data),
    sampleText: data.sample_text || requestBody.sample_text || "",
    requestId: data.request_id || ""
  };
}

export async function cloneVoice({ audioConfig, body = {} }) {
  const config = mergeAudioConfig(audioConfig, body);
  if (!config.apiKey || !config.baseUrl) throw new Error("语音服务还没有配置完整。");

  const fileId = body.file_id || body.fileId || await uploadVoiceSample({ audioConfig: config, body });
  const sampleText = normalizeSampleText(body.text || body.sampleText || body.sample_text);
  const requestBody = cleanBody({
    model: STEP_AUDIO_TTS_MODEL,
    file_id: fileId,
    text: sampleText,
    ...safeObject(body.extraBody)
  });

  const data = await postJson({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    path: "/audio/voices",
    body: requestBody,
    action: "声音克隆"
  });
  return {
    voiceId: data.id || data.voice_id || data.voice || data.voiceId || "",
    object: data.object || "",
    duplicated: Boolean(data.duplicated),
    raw: data
  };
}

export async function uploadVoiceSample({ audioConfig, body = {} }) {
  const config = mergeAudioConfig(audioConfig, body);
  if (!config.apiKey || !config.baseUrl) throw new Error("语音服务还没有配置完整。");

  const audioBase64 = stripDataUrl(body.audioBase64 || body.audio_base64 || body.audio?.data || "");
  if (!audioBase64) throw new Error("请先上传一段声音样本。");

  const mime = normalizeUploadMime(body.mime || body.mimeType || "");
  const fileName = normalizeUploadFileName(body.fileName || body.name || "", mime);
  const bytes = Buffer.from(audioBase64, "base64");
  if (!bytes.length) throw new Error("声音样本读取失败，请重新上传。");

  const form = new FormData();
  form.append("purpose", "storage");
  form.append("file", new Blob([bytes], { type: mime }), fileName);

  const endpoint = resolveFilesEndpoint(config.baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`
    },
    body: form
  });
  if (!response.ok) {
    const errorText = await response.text();
    logProviderFailure({
      action: "声音样本上传",
      endpoint,
      status: response.status,
      body: errorText
    });
    throw new Error(`声音样本上传失败 ${response.status}: ${compactProviderError(errorText)}`);
  }

  const data = await response.json();
  const fileId = data.id || data.file_id || data.fileId || "";
  if (!fileId) throw new Error("声音样本上传成功，但服务端没有返回文件 ID。");
  return fileId;
}

export function mergeAudioConfig(base = {}, overrides = {}) {
  return {
    ...base,
    baseUrl: overrides.baseUrl || overrides.audioBaseUrl || base.baseUrl,
    apiKey: overrides.apiKey || overrides.audioApiKey || base.apiKey,
    model: overrides.model || overrides.audioModel || base.model,
    voice: overrides.voice || overrides.audioVoice || base.voice,
    instruction: overrides.instruction ?? overrides.audioInstruction ?? base.instruction,
    format: overrides.format || overrides.responseFormat || overrides.audioFormat || base.format,
    responseFormat: overrides.responseFormat || overrides.format || overrides.audioFormat || base.responseFormat,
    speed: overrides.speed ?? base.speed,
    volume: overrides.volume ?? base.volume,
    sampleRate: overrides.sampleRate ?? overrides.sample_rate ?? base.sampleRate,
    textNormalization: overrides.textNormalization ?? overrides.text_normalization ?? base.textNormalization,
    markdownFilter: overrides.markdownFilter ?? overrides.markdown_filter ?? base.markdownFilter,
    returnUrl: overrides.returnUrl ?? overrides.return_url ?? base.returnUrl,
    timestamp: overrides.timestamp ?? base.timestamp,
    extraBody: overrides.extraBody ?? base.extraBody
  };
}

async function postRaw({ baseUrl, apiKey, path, body, action = "语音服务" }) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(cleanBody(body))
  });
  if (!response.ok) {
    const errorText = await response.text();
    logProviderFailure({
      action,
      endpoint,
      status: response.status,
      body: errorText
    });
    throw new Error(`${action}请求失败 ${response.status}: ${compactProviderError(errorText)}`);
  }
  return response;
}

async function postJson({ baseUrl, apiKey, path, body, action }) {
  const response = await postRaw({ baseUrl, apiKey, path, body, action });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      audioBase64: bytes.toString("base64"),
      mimeType: normalizeMimeType(contentType, body.response_format || "mp3")
    };
  }
  return response.json();
}

function normalizeAudioPayload(payload = {}, format = "mp3", raw = payload) {
  const audioBase64 = payload.b64_json || payload.audio || payload.audio_base64 || payload.sample_audio || payload.audioBase64 || "";
  const audioUrl = payload.url || payload.audio_url || payload.audioUrl || "";
  return {
    audioBase64: stripDataUrl(audioBase64),
    audioUrl,
    subtitles: payload.subtitles || [],
    mimeType: payload.mime_type || payload.mimeType || guessMimeFromPayload(audioBase64, format),
    format,
    raw
  };
}

function cleanBody(body) {
  return Object.fromEntries(
    Object.entries(body || {}).filter(([, value]) => value !== undefined && value !== "" && value !== null)
  );
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function trimSpeechText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function normalizeSampleText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function stripDataUrl(value) {
  return String(value || "").replace(/^data:[^;]+;base64,/, "");
}

function guessMimeFromPayload(base64Value, format) {
  const value = String(base64Value || "");
  if (value.startsWith("data:")) return value.slice(5, value.indexOf(";"));
  return normalizeMimeType("", format);
}

function normalizeMimeType(contentType, format) {
  if (contentType?.startsWith("audio/")) return contentType.split(";")[0];
  if (format === "mp3") return "audio/mpeg";
  if (format === "wav") return "audio/wav";
  if (format === "opus") return "audio/opus";
  return `audio/${format || "mpeg"}`;
}

function resolveFilesEndpoint(baseUrl) {
  const url = new URL(baseUrl);
  if (url.pathname.endsWith("/step_plan/v1")) {
    url.pathname = "/v1/files";
  } else if (url.pathname.endsWith("/v1")) {
    url.pathname = `${url.pathname}/files`;
  } else {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/files`;
  }
  url.search = "";
  return url.toString();
}

function normalizeUploadMime(mime) {
  if (mime === "audio/mp3" || mime === "audio/mpeg") return "audio/mpeg";
  if (mime === "audio/wav" || mime === "audio/x-wav" || mime === "audio/wave") return "audio/wav";
  throw new Error("声音克隆只支持 mp3 或 wav 样本。");
}

function normalizeUploadFileName(fileName, mime) {
  const cleanName = String(fileName || "").replace(/[\\/:*?"<>|]+/g, "_").trim();
  const ext = mime === "audio/mpeg" ? "mp3" : "wav";
  if (!cleanName) return `voice-sample.${ext}`;
  if (/\.(mp3|wav)$/i.test(cleanName)) return cleanName;
  return `${cleanName}.${ext}`;
}

function compactProviderError(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "服务端没有返回错误详情";
  try {
    const parsed = JSON.parse(value);
    return parsed.error?.message || parsed.message || JSON.stringify(parsed).slice(0, 200);
  } catch {
    return value.slice(0, 200);
  }
}

function logProviderFailure({ action, endpoint, status, body }) {
  const url = maskUrl(endpoint);
  console.error(`[audio] ${action} failed`, {
    endpoint: url,
    status,
    error: compactProviderError(body)
  });
}

function maskUrl(endpoint) {
  try {
    const url = new URL(endpoint);
    url.search = "";
    return url.toString();
  } catch {
    return String(endpoint || "");
  }
}
