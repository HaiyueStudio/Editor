/** Shadertoy: 256 keys, rows held / pressed this frame / toggle, bottom-left origin. */
export class KeyboardState {
  private held = new Uint8Array(256);
  private pressed = new Uint8Array(256);
  private toggled = new Uint8Array(256);
  down(key: number) {
    if (!Number.isInteger(key) || key < 0 || key > 255 || this.held[key]) return false;
    this.held[key] = 1; this.pressed[key] = 1; this.toggled[key] = this.toggled[key]! ^ 1; return true;
  }
  up(key: number) { if (!this.held[key]) return false; this.held[key] = 0; return true; }
  release() { this.held.fill(0); this.pressed.fill(0); }
  reset() { this.release(); this.toggled.fill(0); }
  endFrame() { const pending = this.pressed.some(Boolean); this.pressed.fill(0); return pending; }
  pixels() {
    const data = new Uint8Array(256 * 3 * 4);
    // GPU uploads start at the top; channel() and translated texelFetch use bottom-left.
    [this.toggled, this.pressed, this.held].forEach((row, y) => row.forEach((v, x) => {
      const offset = (y * 256 + x) * 4;
      data.fill(v * 255, offset, offset + 3); data[offset + 3] = 255;
    }));
    return data;
  }
}
export function keyboardCode(event: Pick<KeyboardEvent, 'code' | 'keyCode'>): number {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.charCodeAt(5);
  const special: Record<string, number> = { Backspace: 8, Tab: 9, Enter: 13, ShiftLeft: 16, ShiftRight: 16,
    ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18, Escape: 27, Space: 32,
    PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };
  return special[event.code] ?? event.keyCode;
}
