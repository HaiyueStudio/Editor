import { SOUND_BLOCK, type StereoSound } from './sound.js';

export type SoundProducer = (start: number, count: number, current: () => boolean) => Promise<StereoSound>;

/** Schedule a small rolling window on the audio clock. Played blocks are released;
 * pausing/resetting invalidates pending GPU results before they can be scheduled. */
export class SoundPlayer {
  private context: AudioContext | undefined;
  private gain: GainNode | undefined;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private data: StereoSound | undefined;
  private produce: SoundProducer | undefined;
  private startAt = 0;
  private startOffset = 0;
  private tailAt = 0;
  private nextSample = 0;
  private generation = 0;
  private pumping: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private active = false;
  private request = 0;
  private volume = 0.25;
  armed = false;
  onError: ((message: string) => void) | undefined;
  get playing() { return this.active && this.context?.state === 'running'; }
  get position(): number | undefined {
    return this.active && this.context ? this.startOffset + Math.max(0, Math.min(this.context.currentTime, this.tailAt) - this.startAt) : undefined;
  }
  get bufferedUntil() { return this.data ? this.nextSample / this.data.sampleRate : 0; }
  load(data: StereoSound | undefined, produce?: SoundProducer) { this.pause(); this.data = data; this.produce = produce; this.nextSample = 0; }
  setVolume(value: number) {
    this.volume = value;
    if (this.context && this.gain) this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.015);
  }
  async unlock() {
    // Unlock during the add-Sound gesture, before asynchronous GPU synthesis.
    // load/play will start audio only once samples and an armed context exist.
    if ((!this.context || this.context.state !== 'running') && !navigator.userActivation.isActive) throw new Error('请先点击编辑器的“开启声音”，允许浏览器播放音频。');
    const request = ++this.request;
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain(); this.gain.gain.value = this.volume; this.gain.connect(this.context.destination);
    }
    await this.context.resume();
    if (request === this.request) this.armed = true;
  }
  mute() { ++this.request; this.armed = false; this.pause(); }
  pause() {
    this.active = false; ++this.generation;
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; }
    for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect(); }
    this.sources.clear();
  }
  play(offset: number) {
    if (!this.armed || !this.data || !this.context || !this.gain || this.active) return;
    this.nextSample = Math.max(0, Math.floor(offset * this.data.sampleRate));
    this.startOffset = this.nextSample / this.data.sampleRate;
    this.startAt = this.tailAt = this.context.currentTime + 0.05;
    this.active = true; const generation = ++this.generation;
    this.timer = setInterval(() => { void this.pump(generation); }, 100);
    void this.pump(generation);
  }
  private async pump(generation: number) {
    if (!this.active || generation !== this.generation || this.pumping === generation) return;
    const context = this.context!, gain = this.gain!, seed = this.data!, produce = this.produce;
    const current = () => this.active && generation === this.generation;
    this.pumping = generation;
    try {
      while (current() && this.tailAt - context.currentTime < 4.5 && this.sources.size < 4) {
        const start = this.nextSample;
        let chunk: StereoSound;
        if (start < seed.left.length) {
          const end = Math.min(seed.left.length, start + SOUND_BLOCK);
          chunk = { left: seed.left.subarray(start, end), right: seed.right.subarray(start, end), sampleRate: seed.sampleRate };
        } else {
          if (!produce) break;
          chunk = await produce(start, SOUND_BLOCK, current);
          if (!current()) return;
        }
        if (!chunk.left.length || chunk.left.length !== chunk.right.length || chunk.sampleRate !== seed.sampleRate) throw new Error('音频分块格式不一致。');
        // If synthesis could not keep up, resume from the next exact sample:
        // pause the timeline during the gap instead of skipping part of the song.
        if (this.tailAt < context.currentTime) {
          this.startOffset = start / seed.sampleRate;
          this.startAt = this.tailAt = context.currentTime + 0.05;
        }
        const buffer = context.createBuffer(2, chunk.left.length, chunk.sampleRate);
        buffer.getChannelData(0).set(chunk.left); buffer.getChannelData(1).set(chunk.right);
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(gain);
        this.sources.add(source);
        source.onended = () => {
          source.disconnect(); this.sources.delete(source);
          if (!produce && !this.sources.size && this.nextSample >= seed.left.length && current()) this.pause();
        };
        source.start(this.tailAt);
        this.tailAt += chunk.left.length / chunk.sampleRate;
        this.nextSample += chunk.left.length;
      }
    } catch (error) {
      if (current()) { this.mute(); this.onError?.('音频合成中断：' + (error instanceof Error ? error.message : String(error))); }
    } finally { if (this.pumping === generation) this.pumping = undefined; }
  }
  async dispose() { this.mute(); this.data = undefined; this.produce = undefined; await this.context?.close(); }
}
