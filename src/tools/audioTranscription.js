const SUPPORTED_AUDIO_FORMATS = new Set(["mp3", "wav", "pcm", "ogg"]);

export async function relayAudioTranscription({
  baseUrl = "",
  authToken = "",
  audio,
  format = "wav",
  language = "zh",
  fetchImpl = globalThis.fetch
} = {}) {
  if (!baseUrl || !authToken) {
    return {
      status: 401,
      data: { ok: false, code: "authorization_required", error: "请先登录并绑定授权码后使用语音转文字。" }
    };
  }
  const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio || []);
  if (!buffer.length) {
    return {
      status: 400,
      data: { ok: false, code: "voice_audio_required", error: "没有收到录音内容，请重新录制。" }
    };
  }
  const normalizedFormat = String(format || "").trim().toLowerCase();
  if (!SUPPORTED_AUDIO_FORMATS.has(normalizedFormat)) {
    return {
      status: 400,
      data: { ok: false, code: "voice_audio_format_unsupported", error: "当前录音格式无法识别，请重新录制。" }
    };
  }

  let response;
  try {
    response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/api/audio/transcribe`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/octet-stream",
        authorization: `Bearer ${authToken}`,
        "x-audio-format": normalizedFormat,
        "x-audio-language": String(language || "zh").slice(0, 16)
      },
      body: buffer
    });
  } catch {
    return {
      status: 502,
      data: { ok: false, code: "voice_transcription_service_unavailable", error: "语音识别服务暂时无法连接，请稍后重试。" }
    };
  }

  const data = await safeJson(response);
  if (!response.ok) return { status: response.status, data: normalizeError(data, response.status) };
  const text = String(data.text || data.transcript || "").trim();
  if (!text) {
    return {
      status: 422,
      data: { ok: false, code: "voice_no_speech", error: "没有识别到清晰语音，请靠近麦克风重新录制。" }
    };
  }
  return {
    status: 200,
    data: {
      ok: true,
      text,
      model: data.model || "",
      language: data.language || language,
      usage: data.usage || null
    }
  };
}

function normalizeError(data = {}, status = 500) {
  const code = String(data.code || "voice_transcription_failed");
  const fallback = status === 401 || status === 403
    ? "登录状态已失效，请重新登录后使用语音转文字。"
    : status === 402 || status === 429
      ? "语音识别额度已用完，请升级后继续使用。"
      : status === 413
        ? "录音太长，请缩短后重新录制。"
        : "语音识别失败，请重新录制。";
  return { ok: false, code, error: String(data.error || data.message || fallback) };
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 240) };
  }
}
