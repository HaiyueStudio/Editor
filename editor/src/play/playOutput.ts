export class PlayOutput {
  private _lastTimestampSecond = -1;
  private _lastTimestampText = '';

  constructor(private readonly _container: HTMLElement | null) {}

  clear(): void {
    this._container?.replaceChildren();
  }

  append(level: string, message: string, meta: {
    source?: string | undefined;
    entity?: string | number | undefined;
    script?: string | number | undefined;
    time?: number | undefined;
  } = {}): void {
    if (!this._container) return;
    const line = document.createElement('div');
    line.className = `play-output-line ${level}`;
    const time = meta.time ? new Date(meta.time).toLocaleTimeString() : this._getTimestampText();
    const context = [
      meta.source,
      meta.entity !== undefined ? `entity=${meta.entity}` : '',
      meta.script !== undefined ? `script=${meta.script}` : '',
    ].filter(Boolean).join(' ');
    line.textContent = `[${time}] ${level}${context ? ` ${context}` : ''}: ${message}`;
    this._container.append(line);
    while (this._container.childElementCount > 200) {
      this._container.firstElementChild?.remove();
    }
    this._container.scrollTop = this._container.scrollHeight;
  }

  private _getTimestampText(): string {
    const now = Date.now();
    const second = Math.floor(now / 1000);
    if (second !== this._lastTimestampSecond) {
      this._lastTimestampSecond = second;
      this._lastTimestampText = new Date(now).toLocaleTimeString();
    }
    return this._lastTimestampText;
  }
}
