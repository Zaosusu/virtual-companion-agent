import assert from "node:assert/strict";
import test from "node:test";
import { audioBlobToMessagePayload, audioFormatFromMime } from "../public/voiceMessage.js";

test("recorded user audio becomes a persistable voice-message payload", async () => {
  const blob = new Blob([new Uint8Array([0, 1, 2, 253, 254, 255])], { type: "audio/webm;codecs=opus" });
  const payload = await audioBlobToMessagePayload(blob, { durationMs: 2450 });
  assert.equal(payload.mime, "audio/webm");
  assert.equal(payload.format, "webm");
  assert.equal(payload.durationMs, 2450);
  assert.deepEqual(Buffer.from(payload.data, "base64"), Buffer.from([0, 1, 2, 253, 254, 255]));
  assert.match(payload.name, /\.webm$/);
});

test("voice-message format follows the recorded MIME type", () => {
  assert.equal(audioFormatFromMime("audio/mpeg"), "mp3");
  assert.equal(audioFormatFromMime("audio/wav"), "wav");
  assert.equal(audioFormatFromMime("audio/mp4"), "mp4");
  assert.equal(audioFormatFromMime("audio/ogg"), "ogg");
  assert.equal(audioFormatFromMime("audio/webm"), "webm");
});
