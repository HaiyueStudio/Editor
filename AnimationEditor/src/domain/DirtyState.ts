export class DirtyState {
  private _savedFingerprint: string;
  private _currentFingerprint: string;

  constructor(initialFingerprint: string) {
    this._savedFingerprint = initialFingerprint;
    this._currentFingerprint = initialFingerprint;
  }

  get isDirty(): boolean { return this._currentFingerprint !== this._savedFingerprint; }
  get savedFingerprint(): string { return this._savedFingerprint; }
  get currentFingerprint(): string { return this._currentFingerprint; }

  update(currentFingerprint: string): boolean {
    const before = this.isDirty;
    this._currentFingerprint = currentFingerprint;
    return before !== this.isDirty;
  }

  markSaved(): boolean {
    const before = this.isDirty;
    this._savedFingerprint = this._currentFingerprint;
    return before !== this.isDirty;
  }

  reset(fingerprint: string): boolean {
    const changed = this.isDirty || this._currentFingerprint !== fingerprint;
    this._savedFingerprint = fingerprint;
    this._currentFingerprint = fingerprint;
    return changed;
  }

  restore(savedFingerprint: string, currentFingerprint: string): boolean {
    const before = this.isDirty;
    this._savedFingerprint = savedFingerprint;
    this._currentFingerprint = currentFingerprint;
    return before !== this.isDirty;
  }
}
