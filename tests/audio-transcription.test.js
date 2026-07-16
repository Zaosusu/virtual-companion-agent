import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeMonoPcm16Wav,
  friendlyVoiceTranscriptionError,
  prepareVoiceForTranscription,
  requestVoiceTranscription,
  resampleLinear
} from "../public/voiceTranscription.js";
import { relayAudioTranscription } from "../src/tools/audioTranscription.js";

test("voice transcription creates a valid mono 16k PCM WAV", () => {
  const wav = encodeMonoPcm16Wav(new Float32Array([-1, 0, 1]), 16_000);
  const view = new DataView(wav);
  const ascii = (offset, length) => String.fromCharCode(...new Uint8Array(wav, offset, length));
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 6);
});

test("voice transcription resamples decoded browser audio to 16k", async () => {
  const source = new Float32Array(48_000).fill(0.25);
  const resampled = resampleLinear(source, 48_000, 16_000);
  assert.equal(resampled.length, 16_000);
  assert.equal(resampled[100], 0.25);

  class FakeAudioContext {
    decodeAudioData(_buffer, done) {
      const decoded = {
        numberOfChannels: 1,
        length: source.length,
        sampleRate: 48_000,
        getChannelData: () => source
      };
      done(decoded);
      return Promise.resolve(decoded);
    }
    close() {
      return Promise.resolve();
    }
  }
  const prepared = await prepareVoiceForTranscription(
    new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" }),
    { AudioContextClass: FakeAudioContext }
  );
  assert.equal(prepared.converted, true);
  assert.equal(prepared.format, "wav");
  assert.equal(prepared.blob.type, "audio/wav");
  assert.equal(prepared.blob.size, 44 + 16_000 * 2);
});

test("browser transcription request sends binary audio and returns editable text", async () => {
  let request = null;
  const result = await requestVoiceTranscription(new Blob(["audio"], { type: "audio/wav" }), {
    format: "wav",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ ok: true, text: "  今天天气不错。  ", model: "asr" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(request.url, "/api/audio/transcribe");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["content-type"], "application/octet-stream");
  assert.equal(request.options.headers["x-audio-format"], "wav");
  assert.equal(result.text, "今天天气不错。");
});

test("desktop relay preserves the official transcription protocol", async () => {
  let request = null;
  const result = await relayAudioTranscription({
    baseUrl: "https://role-api.example.com/",
    authToken: "desktop-token",
    audio: Buffer.from("wav-data"),
    format: "wav",
    language: "zh",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ transcript: "识别成功", model: "stepaudio-2.5-asr" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.text, "识别成功");
  assert.equal(request.url, "https://role-api.example.com/api/audio/transcribe");
  assert.equal(request.options.headers.authorization, "Bearer desktop-token");
  assert.equal(request.options.headers["content-type"], "application/octet-stream");
  assert.deepEqual(request.options.body, Buffer.from("wav-data"));
});

test("voice transcription reports auth, quota, size, and empty speech clearly", async () => {
  const unauthorized = await relayAudioTranscription({ audio: Buffer.from("x") });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.data.code, "authorization_required");

  const quota = await relayAudioTranscription({
    baseUrl: "https://role-api.example.com",
    authToken: "token",
    audio: Buffer.from("x"),
    fetchImpl: async () => new Response(JSON.stringify({ code: "quota_exceeded" }), { status: 429 })
  });
  assert.equal(quota.status, 429);
  assert.match(quota.data.error, /额度/);
  assert.match(friendlyVoiceTranscriptionError({ status: 429, code: "quota_exceeded" }), /额度/);

  const empty = await relayAudioTranscription({
    baseUrl: "https://role-api.example.com",
    authToken: "token",
    audio: Buffer.from("x"),
    fetchImpl: async () => new Response(JSON.stringify({ text: "" }), { status: 200 })
  });
  assert.equal(empty.status, 422);
  assert.equal(empty.data.code, "voice_no_speech");
});
