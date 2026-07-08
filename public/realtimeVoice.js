export function createRealtimeVoiceController({
  onStatus = () => {},
  onTranscript = () => {},
  onAssistantText = () => {},
  onResponseDone = () => {},
  onError = () => {}
} = {}) {
  return new RealtimeVoiceController({ onStatus, onTranscript, onAssistantText, onResponseDone, onError });
}

class RealtimeVoiceController {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.socket = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.source = null;
    this.worklet = null;
    this.playCursor = 0;
    this.started = false;
    this.assistantText = "";
    this.readyResolver = null;
    this.lastAudioAt = 0;
    this.lastSpeechAt = 0;
    this.lastCommitAt = 0;
    this.commitTimer = null;
    this.pendingAudio = false;
    this.awaitingCommit = false;
    this.responseInProgress = false;
    this.stats = this.createStats();
  }

  get active() {
    return this.started;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.stats = this.createStats();
    this.assistantText = "";
    this.callbacks.onStatus("connecting");
    try {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
      this.stats.audioContext = true;
      await this.audioContext.audioWorklet.addModule(audioWorkletUrl());
      this.stats.worklet = true;
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      this.stats.microphone = true;
      this.socket = await this.openSocket();
      await this.waitUntilReady();
      await this.audioContext.resume();
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.worklet = new AudioWorkletNode(this.audioContext, "realtime-pcm-capture");
      this.worklet.port.onmessage = (event) => {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        const packet = normalizeAudioPacket(event.data);
        this.stats.audioChunks += 1;
        this.stats.lastRms = Number(packet.rms.toFixed(4));
        this.lastAudioAt = Date.now();
        if (packet.rms >= 0.012) {
          this.pendingAudio = true;
          this.lastSpeechAt = this.lastAudioAt;
          this.stats.speechChunks += 1;
        } else {
          this.stats.silenceChunks += 1;
        }
        this.socket.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: bytesToBase64(packet.bytes)
        }));
      };
      this.source.connect(this.worklet);
      this.commitTimer = setInterval(() => this.maybeCommitAudio(), 250);
      this.callbacks.onStatus("listening");
    } catch (error) {
      this.callbacks.onError(friendlyRealtimeError(error));
      await this.stop();
    }
  }

  async stop() {
    if (!this.started && !this.socket && !this.mediaStream) return;
    this.started = false;
    this.callbacks.onStatus("closing");
    try {
      this.socket?.close();
    } catch {}
    this.socket = null;
    try {
      this.worklet?.disconnect();
      this.source?.disconnect();
    } catch {}
    this.worklet = null;
    this.source = null;
    if (this.commitTimer) clearInterval(this.commitTimer);
    this.commitTimer = null;
    this.pendingAudio = false;
    this.awaitingCommit = false;
    this.responseInProgress = false;
    for (const track of this.mediaStream?.getTracks?.() || []) track.stop();
    this.mediaStream = null;
    if (this.audioContext?.state !== "closed") {
      try {
        await this.audioContext?.close();
      } catch {}
    }
    this.audioContext = null;
    this.playCursor = 0;
    this.callbacks.onStatus("idle");
  }

  maybeCommitAudio() {
    if (!this.pendingAudio || this.awaitingCommit || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - this.lastSpeechAt < 650 || now - this.lastCommitAt < 1200) return;
    this.pendingAudio = false;
    this.awaitingCommit = true;
    this.lastCommitAt = now;
    this.stats.commits += 1;
    this.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
  }

  interrupt() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "interrupt" }));
    }
    this.playCursor = this.audioContext?.currentTime || 0;
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws/realtime`);
      const timer = setTimeout(() => reject(new Error("实时语音连接超时")), 12000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        this.stats.socketOpen = true;
        this.bindSocket(socket);
        resolve(socket);
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("实时语音连接失败"));
      }, { once: true });
    });
  }

  waitUntilReady() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("实时语音服务准备超时")), 12000);
      this.readyResolver = () => {
        clearTimeout(timer);
        this.readyResolver = null;
        resolve();
      };
    });
  }

  bindSocket(socket) {
    socket.addEventListener("message", (event) => {
      const data = parseJson(event.data);
      if (!data) return;
      this.trackServerEvent(data);
      if (data.type === "ready") {
        this.stats.ready = true;
        this.readyResolver?.();
        this.callbacks.onStatus("listening");
        return;
      }
      if (data.type === "transcript") {
        this.stats.userTranscripts += 1;
        this.callbacks.onTranscript(data.text || "");
        return;
      }
      if (data.type === "transcript_delta") {
        this.stats.textDeltas += 1;
        this.assistantText += data.text || "";
        this.callbacks.onAssistantText(this.assistantText);
        return;
      }
      if (data.type === "audio_delta" && data.delta) {
        this.stats.audioDeltas += 1;
        this.playPcm16(data.delta);
        this.callbacks.onStatus("speaking");
        return;
      }
      if (data.type === "input_audio_buffer.committed") {
        this.awaitingCommit = false;
        this.stats.committedEvents += 1;
        if (!this.responseInProgress) this.requestResponse();
        return;
      }
      if (data.type === "input_audio_buffer.speech_started") {
        this.stats.vadStarted += 1;
        return;
      }
      if (data.type === "input_audio_buffer.speech_stopped") {
        this.stats.vadStopped += 1;
        return;
      }
      if (data.type === "response_done") {
        this.callbacks.onResponseDone?.(data);
        this.assistantText = "";
        this.responseInProgress = false;
        this.callbacks.onStatus("listening");
        return;
      }
      if (data.type === "error") {
        this.stats.errors += 1;
        this.callbacks.onError(data.message || "实时语音出错");
      }
      if (data.type === "closed") {
        this.stop();
      }
    });
    socket.addEventListener("close", () => this.stop());
  }

  requestResponse() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.responseInProgress) return;
    this.responseInProgress = true;
    this.stats.responseCreates += 1;
    this.socket.send(JSON.stringify({ type: "response.create" }));
  }

  trackServerEvent(data = {}) {
    const type = String(data.type || "unknown");
    this.stats.serverEvents[type] = (this.stats.serverEvents[type] || 0) + 1;
    this.stats.lastServerEvents.push(type);
    if (this.stats.lastServerEvents.length > 10) this.stats.lastServerEvents.shift();
  }

  playPcm16(base64) {
    if (!this.audioContext) return;
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buffer = this.audioContext.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      channel[index] = Math.max(-1, Math.min(1, samples[index] / 32768));
    }
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    const now = this.audioContext.currentTime;
    const startAt = Math.max(now + 0.02, this.playCursor || now);
    source.start(startAt);
    this.playCursor = startAt + buffer.duration;
    this.stats.playedBuffers += 1;
    this.stats.lastPlayedMs = Math.round(buffer.duration * 1000);
  }

  getDebugSnapshot() {
    return {
      active: this.active,
      socketState: this.socket ? socketStateName(this.socket.readyState) : "none",
      audioContextState: this.audioContext?.state || "none",
      ...this.stats
    };
  }

  async runDiagnostics() {
    const result = {
      microphone: "未检测",
      localWebSocket: "未检测",
      ready: "未检测",
      active: this.active,
      stats: this.getDebugSnapshot()
    };
    let stream = null;
    let socket = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      result.microphone = "通过";
    } catch (error) {
      result.microphone = `失败：${friendlyRealtimeError(error)}`;
    } finally {
      for (const track of stream?.getTracks?.() || []) track.stop();
    }

    try {
      socket = await openDiagnosticSocket();
      result.localWebSocket = "通过";
      result.ready = await waitForDiagnosticReady(socket);
    } catch (error) {
      result.localWebSocket = `失败：${error.message || error}`;
    } finally {
      try {
        socket?.close();
      } catch {}
    }

    result.stats = this.getDebugSnapshot();
    return result;
  }

  createStats() {
    return {
      audioContext: false,
      worklet: false,
      microphone: false,
      socketOpen: false,
      ready: false,
      audioChunks: 0,
      speechChunks: 0,
      silenceChunks: 0,
      lastRms: 0,
      commits: 0,
      committedEvents: 0,
      responseCreates: 0,
      vadStarted: 0,
      vadStopped: 0,
      userTranscripts: 0,
      textDeltas: 0,
      audioDeltas: 0,
      responseDone: 0,
      errors: 0,
      serverEvents: {},
      lastServerEvents: [],
      playedBuffers: 0,
      lastPlayedMs: 0
    };
  }
}

function openDiagnosticSocket() {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws/realtime`);
    const timer = setTimeout(() => reject(new Error("连接超时")), 8000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("连接失败"));
    }, { once: true });
  });
}

function waitForDiagnosticReady(socket) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("未收到 ready"), 8000);
    socket.addEventListener("message", (event) => {
      const data = parseJson(event.data);
      if (data?.type === "ready") {
        clearTimeout(timer);
        resolve(`通过：${data.model || ""}`);
      } else if (data?.type === "error") {
        clearTimeout(timer);
        resolve(`失败：${data.message || "实时服务错误"}`);
      }
    });
  });
}

function socketStateName(value) {
  return ["connecting", "open", "closing", "closed"][value] || String(value);
}

function normalizeAudioPacket(value) {
  if (value?.bytes) return { bytes: value.bytes, rms: Number(value.rms || 0) };
  return { bytes: value, rms: 0 };
}

function audioWorkletUrl() {
  const code = `
    class RealtimePcmCapture extends AudioWorkletProcessor {
      constructor() {
        super();
        this.buffer = [];
        this.target = 2400;
      }
      process(inputs) {
        const input = inputs[0]?.[0];
        if (!input) return true;
        for (let i = 0; i < input.length; i += 1) {
          this.buffer.push(Math.max(-1, Math.min(1, input[i])));
        }
        while (this.buffer.length >= this.target) {
          const chunk = this.buffer.splice(0, this.target);
          const bytes = new Uint8Array(chunk.length * 2);
          let sum = 0;
          for (let i = 0; i < chunk.length; i += 1) {
            const value = Math.max(-1, Math.min(1, chunk[i]));
            sum += value * value;
            const sample = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
            bytes[i * 2] = sample & 255;
            bytes[i * 2 + 1] = (sample >> 8) & 255;
          }
          this.port.postMessage({ bytes, rms: Math.sqrt(sum / chunk.length) });
        }
        return true;
      }
    }
    registerProcessor("realtime-pcm-capture", RealtimePcmCapture);
  `;
  return URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
}

function bytesToBase64(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < source.length; index += chunkSize) {
    binary += String.fromCharCode(...source.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function friendlyRealtimeError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("Permission denied") || message.includes("NotAllowedError")) {
    return "麦克风权限被拒绝，请允许浏览器使用麦克风。";
  }
  return message || "实时语音启动失败。";
}
