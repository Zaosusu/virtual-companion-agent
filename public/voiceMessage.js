export async function audioBlobToMessagePayload(blob, { durationMs = 0, name = "voice-message" } = {}) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("没有收到录音内容。");
  const mime = String(blob.type || "audio/webm").split(";")[0].toLowerCase();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return {
    data: btoa(binary),
    mime,
    format: audioFormatFromMime(mime),
    durationMs: Math.max(0, Number(durationMs || 0)),
    name: `${name}.${audioExtensionFromMime(mime)}`
  };
}

export function audioFormatFromMime(mime = "") {
  if (/mpeg|mp3/i.test(mime)) return "mp3";
  if (/wav|wave/i.test(mime)) return "wav";
  if (/mp4|m4a/i.test(mime)) return "mp4";
  if (/ogg/i.test(mime)) return "ogg";
  return "webm";
}

function audioExtensionFromMime(mime) {
  const format = audioFormatFromMime(mime);
  return format === "mp3" ? "mp3" : format;
}
