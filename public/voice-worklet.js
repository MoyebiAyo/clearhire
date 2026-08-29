/**
 * ClearHire voice mic capture — AudioWorklet processor.
 *
 * Receives Float32 mic frames (device sample rate), converts to Int16 LE,
 * downsamples to the target rate, and posts fixed-size PCM chunks to the
 * main thread as ArrayBuffers (wired to the Deepgram agent socket).
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

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    // Mix down to mono.
    const ch = input[0];
    for (let i = 0; i < ch.length; i++) {
      this.fill += this.ratio;
      const n = Math.floor(this.fill);
      this.fill -= n;
      for (let k = 0; k < n; k++) {
        let sample = this.muted ? 0 : ch[i];
        // clamp + convert
        sample = Math.max(-1, Math.min(1, sample));
        this.buffer[this.pos++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        if (this.pos >= this.buffer.length) {
          // post a copy — the buffer is reused
          this.port.postMessage(this.buffer.slice(0, this.pos).buffer, [this.buffer.slice(0, this.pos).buffer]);
          this.pos = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("voice-capture", VoiceCapture);
