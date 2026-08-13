class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.outputChunkSize = 640;
    this.inputSamples = [];
    this.outputSamples = [];
    this.cursor = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) {
      return true;
    }

    for (const sample of channel) {
      this.inputSamples.push(sample);
    }

    const ratio = sampleRate / this.targetSampleRate;
    while (this.cursor < this.inputSamples.length) {
      const sample = Math.max(-1, Math.min(1, this.inputSamples[Math.floor(this.cursor)]));
      this.outputSamples.push(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
      this.cursor += ratio;
    }

    const consumed = Math.floor(this.cursor);
    if (consumed > 0) {
      this.inputSamples.splice(0, consumed);
      this.cursor -= consumed;
    }

    while (this.outputSamples.length >= this.outputChunkSize) {
      const values = this.outputSamples.splice(0, this.outputChunkSize);
      const pcm = new Int16Array(values);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
