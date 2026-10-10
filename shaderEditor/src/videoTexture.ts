import { LIMITS } from './model.js';

export class VideoSource {
  readonly video = document.createElement('video');
  private url: string;
  private dead = false;
  private failedPlayback = false;
  private starting = false;
  private constructor(blob: Blob) {
    this.url = URL.createObjectURL(blob);
    this.video.muted = true; this.video.loop = true; this.video.playsInline = true;
    this.video.preload = 'auto'; this.video.src = this.url;
  }
  static async load(blob: Blob) {
    const source = new VideoSource(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('视频解码超时，请使用浏览器支持的 MP4 或 WebM。')), 15000);
        const loaded = () => finish();
        const error = () => finish(new Error('无法解码视频，请使用浏览器支持的 MP4 或 WebM 编码。'));
        const finish = (failure?: Error) => {
          clearTimeout(timer); source.video.removeEventListener('loadeddata', loaded); source.video.removeEventListener('error', error);
          failure ? reject(failure) : resolve();
        };
        source.video.addEventListener('loadeddata', loaded); source.video.addEventListener('error', error); source.video.load();
      });
      if (!source.video.videoWidth || !source.video.videoHeight || Math.max(source.video.videoWidth, source.video.videoHeight) > LIMITS.dimension)
        throw new Error('视频尺寸最多 4096。');
      return source;
    } catch (error) { source.dispose(); throw error; }
  }
  play(value: boolean) {
    if (this.dead) return;
    if (!value) { this.video.pause(); return; }
    if (this.video.paused && !this.starting && !this.failedPlayback) {
      this.starting = true;
      void this.video.play().catch(() => { this.failedPlayback = true; }).finally(() => { this.starting = false; });
    }
  }
  reset() { this.failedPlayback = false; this.video.currentTime = 0; }
  step(seconds: number) {
    this.video.pause();
    const end = this.video.duration;
    this.video.currentTime = Number.isFinite(end) && end > 0 ? (this.video.currentTime + seconds) % end : this.video.currentTime + seconds;
  }
  dispose() {
    if (this.dead) return; this.dead = true;
    this.video.pause(); this.video.removeAttribute('src'); this.video.load(); URL.revokeObjectURL(this.url);
  }
}
