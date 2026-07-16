const TARGET_SAMPLE_RATE = 16_000;
const DIRECT_FORMATS = new Map([
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/wave", "wav"],
  ["audio/ogg", "ogg"]
]);

export async function prepareVoiceForTranscription(blob, options = {}) {
  if (!(blob instanceof Blob) || !blob.size) {
    throw voiceError("没有收到录音内容，请重新录制。", "voice_audio_required");
  }
  const mime = String(blob.type || "").split(";")[0].toLowerCase();
  const directFormat = DIRECT_FORMATS.get(mime);
  if (directFormat) return { blob, format: directFormat, converted: false };

  const AudioContextClass = options.AudioContextClass || globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) {
    throw voiceError("当前浏览器无法转换录音格式，请使用新版 Chrome 或 Edge。", "voice_audio_conversion_unsupported");
  }
  const context = new AudioContextClass();
  try {
    const decoded = await decodeAudioData(context, await blob.arrayBuffer());
    const mono = downmixAudioBuffer(decoded);
    const samples = resampleLinear(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
    return {
      blob: new Blob([encodeMonoPcm16Wav(samples, TARGET_SAMPLE_RATE)], { type: "audio/wav" }),
      format: "wav",
      converted: true
    };
  } catch (error) {
    if (error?.code) throw error;
    throw voiceError("当前录音格式无法识别，请换用新版 Chrome 或 Edge 重新录制。", "voice_audio_decode_failed");
  } finally {
    await context.close?.().catch?.(() => {});
  }
}

export async function requestVoiceTranscription(blob, {
  format = "wav",
  language = "zh",
  fetchImpl = globalThis.fetch,
  timeoutMs = 60_000
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl("/api/audio/transcribe", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-audio-format": format,
        "x-audio-language": language
      },
      signal: controller.signal,
      body: blob
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw voiceError("语音识别超时，请缩短录音后重试。", "voice_transcription_timeout", 504);
    }
    throw voiceError("语音识别服务暂时无法连接，请稍后重试。", "voice_transcription_network_error", 502);
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw voiceError(
      String(data.error || data.message || defaultErrorForStatus(response.status)),
      String(data.code || "voice_transcription_failed"),
      response.status
    );
  }
  const text = String(data.text || data.transcript || "").trim();
  if (!text) throw voiceError("没有识别到清晰语音，请靠近麦克风重新录制。", "voice_no_speech", 422);
  return { ...data, text };
}

export function friendlyVoiceTranscriptionError(error = {}) {
  const code = String(error.code || "");
  const status = Number(error.status || 0);
  if (status === 401 || status === 403 || /authorization|login|登录|授权/i.test(code)) {
    return "请先登录并绑定授权码后使用语音转文字。";
  }
  if (status === 402 || status === 429 || /quota|额度|余额/i.test(code)) {
    return "语音识别额度已用完，请升级后继续使用。";
  }
  if (status === 413 || code === "voice_audio_too_large") return "录音太长，请缩短后重新录制。";
  if (code === "voice_no_speech") return "没有识别到清晰语音，请靠近麦克风重新录制。";
  if (/timeout/.test(code)) return "语音识别超时，请缩短录音后重试。";
  return String(error.message || "语音识别失败，请重新录制。");
}

export function resampleLinear(input, fromRate, toRate = TARGET_SAMPLE_RATE) {
  if (!input?.length) return new Float32Array();
  if (!Number.isFinite(fromRate) || fromRate <= 0 || fromRate === toRate) return new Float32Array(input);
  const length = Math.max(1, Math.round(input.length * toRate / fromRate));
  const output = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const mix = position - left;
    output[index] = input[left] * (1 - mix) + input[right] * mix;
  }
  return output;
}

export function encodeMonoPcm16Wav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const pcm = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let index = 0; index < pcm.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function downmixAudioBuffer(audioBuffer) {
  const channels = Math.max(1, Number(audioBuffer.numberOfChannels || 1));
  const output = new Float32Array(audioBuffer.length || 0);
  for (let channel = 0; channel < channels; channel += 1) {
    const samples = audioBuffer.getChannelData(channel);
    for (let index = 0; index < output.length; index += 1) output[index] += samples[index] / channels;
  }
  return output;
}

function decodeAudioData(context, arrayBuffer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const pending = context.decodeAudioData(arrayBuffer, done, fail);
      pending?.then?.(done, fail);
    } catch (error) {
      fail(error);
    }
  });
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function defaultErrorForStatus(status) {
  if (status === 401 || status === 403) return "请先登录并绑定授权码后使用语音转文字。";
  if (status === 402 || status === 429) return "语音识别额度已用完。";
  if (status === 413) return "录音太长。";
  return "语音识别失败，请重新录制。";
}

function voiceError(message, code, status = 0) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
