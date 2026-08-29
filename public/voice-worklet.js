/**
 * ClearHire voice mic capture — AudioWorklet processor.
 *
 * Receives Float32 mic frames (device sample rate), decimates to the
 * target rate (16kHz), converts to Int16 LE, and posts fixed-size PCM
 * chunks to the main thread as ArrayBuffers (wired to the Deepgram agent
 * socket). Nearest-sample decimation: one output per `ratio` inputs, so
 * output length tracks real time — stretching here makes Deepgram's STT
 * hear slowed garbage and transcribe nothing.
 *
 * Config via port.postMessage({ type: "init", targetSampleRate }).
 */
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.ratio = sampleRate / this.targetSampleRate;
    this.fill = 0;
    this.buffer = new Int16Array(1600); // ~100ms at 16kHz
    this.pos = 0;
    this.muted = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "init") {
        this.targetSampleRate = e.data.targetSampleRate || 16000;
        this.ratio = sampleRate / this.targetSampleRate;
      } else if (e.data && e.data.type === "mute") {
        this.muted = Boolean(e.data.value);
      }
    };
  }

  pushSample(f32) {
    const sample = Math.max(-1, Math.min(1, f32));
    this.buffer[this.pos++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    if (this.pos >= this.buffer.length) {
      const out = this.buffer.slice(0, this.pos);
      this.pos = 0;
      this.port.postMessage(out.buffer, [out.buffer]);
    }
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch || ch.length === 0) return true;
    for (let i = 0; i < ch.length; i++) {
      this.fill += 1;
      if (this.fill >= this.ratio) {
        this.fill -= this.ratio;
        this.pushSample(this.muted ? 0 : ch[i]);
      }
    }
    return true;
  }
}

registerProcessor("voice-capture", VoiceCapture);
