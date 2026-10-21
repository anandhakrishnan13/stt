/**
 * AudioWorklet: mixes the mic stream down to 16 kHz mono Int16 PCM and posts
 * ~100 ms frames. Stereo input is averaged; sample-rate conversion is a simple
 * box filter (the recognizer only needs 8 kHz of bandwidth).
 */
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Int16Array(1600);
    this.filled = 0;
  }

  flush() {
    const copy = this.frame.slice(0, this.filled);
    this.port.postMessage(copy.buffer, [copy.buffer]);
    this.filled = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;

    const left = channels[0];
    const right = channels.length > 1 ? channels[1] : null;

    for (let i = 0; i < left.length; i += 1) {
      const mixed = right ? (left[i] + right[i]) * 0.5 : left[i];
      this.sum += mixed;
      this.count += 1;
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        const value = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        const clamped = Math.max(-1, Math.min(1, value));
        this.frame[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        if (this.filled === this.frame.length) this.flush();
      }
    }
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
