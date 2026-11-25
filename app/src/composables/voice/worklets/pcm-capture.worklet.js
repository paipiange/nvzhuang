// AudioWorklet runs at the device rate; retain fractional position across render quanta.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.phase = 0
    this.previous = 0
    this.frame = new ArrayBuffer(640)
    this.view = new DataView(this.frame)
    this.count = 0
    this.squared = 0
    this.peak = 0
  }

  process(inputs) {
    const samples = inputs[0]?.[0]
    if (!samples)
      return true
    const step = sampleRate / 16000
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      while (this.phase <= 0) {
        const value = Math.max(-1, Math.min(1, this.previous + (sample - this.previous) * (1 + this.phase)))
        this.view.setInt16(this.count * 2, value < 0 ? value * 32768 : value * 32767, true)
        this.squared += value * value
        this.peak = Math.max(this.peak, Math.abs(value))
        this.count++
        this.phase += step
        if (this.count === 320) {
          this.port.postMessage({ pcm: this.frame, rms: Math.sqrt(this.squared / 320), peak: this.peak }, [this.frame])
          this.frame = new ArrayBuffer(640)
          this.view = new DataView(this.frame)
          this.count = 0
          this.squared = 0
          this.peak = 0
        }
      }
      this.phase--
      this.previous = sample
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor)
