export interface DesignerViewportView {
  readonly zoom: number;
  readonly center: readonly [number, number];
  readonly showGrid: boolean;
}

export interface DesignerViewportInteractionOptions {
  readonly host: HTMLElement;
  readonly surface: HTMLElement;
  readonly compositionSize: readonly [number, number];
  readonly initialView: DesignerViewportView;
  readonly onChange: (view: DesignerViewportView) => void;
  readonly label?: string;
}

/** Shared zoom/pan/snapping-guide interaction with an explicit listener owner. */
export class DesignerViewportInteraction {
  readonly host: HTMLElement;
  readonly surface: HTMLElement;
  #compositionSize: [number, number];
  #view: DesignerViewportView;
  #spacePressed = false;
  #pointerId: number | null = null;
  #lastPointer: [number, number] = [0, 0];
  #destroyed = false;
  #listeners: Array<readonly [EventTarget, string, EventListener, AddEventListenerOptions | boolean | undefined]> = [];
  #guides: HTMLElement;
  #onChange: DesignerViewportInteractionOptions['onChange'];

  constructor(options: DesignerViewportInteractionOptions) {
    this.host = options.host;
    this.surface = options.surface;
    this.#compositionSize = [...options.compositionSize];
    this.#view = normalizeView(options.initialView);
    this.#onChange = options.onChange;
    this.host.tabIndex = this.host.tabIndex < 0 ? 0 : this.host.tabIndex;
    this.host.setAttribute('role', 'application');
    this.host.setAttribute('aria-label', options.label ?? '动画画布：滚轮缩放，按住空格或鼠标中键平移');
    this.#guides = document.createElement('div');
    this.#guides.className = 'viewport-guides';
    this.#guides.setAttribute('aria-hidden', 'true');
    this.#guides.append(document.createElement('i'), document.createElement('i'));
    this.host.append(this.#guides);
    this.#listen(this.host, 'wheel', this.#onWheel as EventListener, { passive: false });
    this.#listen(this.host, 'pointerdown', this.#onPointerDown as EventListener);
    this.#listen(window, 'pointermove', this.#onPointerMove as EventListener);
    this.#listen(window, 'pointerup', this.#onPointerUp as EventListener);
    this.#listen(window, 'pointercancel', this.#onPointerCancel as EventListener);
    this.#listen(window, 'keydown', this.#onKeyDown as EventListener);
    this.#listen(window, 'keyup', this.#onKeyUp as EventListener);
    this.#apply();
  }

  get view(): DesignerViewportView { return this.#view; }
  get listenerCount(): number { return this.#listeners.length; }

  setProjectView(compositionSize: readonly [number, number], view: DesignerViewportView): void {
    this.#assertActive();
    this.#compositionSize = [...compositionSize];
    this.#view = normalizeView(view);
    this.#apply();
  }

  zoomBy(factor: number): void {
    this.#commit({ ...this.#view, zoom: clamp(this.#view.zoom * factor, 0.1, 8) });
  }

  reset(): void {
    this.#commit({
      ...this.#view,
      zoom: 1,
      center: [this.#compositionSize[0] / 2, this.#compositionSize[1] / 2],
    });
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const [target, type, listener, options] of this.#listeners.splice(0)) {
      target.removeEventListener(type, listener, options);
    }
    this.#guides.remove();
    this.surface.style.removeProperty('transform');
    this.host.classList.remove('is-panning', 'pan-ready');
  }

  #onWheel = (event: WheelEvent): void => {
    if (this.#destroyed) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.zoomBy(factor);
  };

  #onPointerDown = (event: PointerEvent): void => {
    if (this.#destroyed || !(event.button === 1 || this.#spacePressed && event.button === 0)) return;
    event.preventDefault();
    this.#pointerId = event.pointerId;
    this.#lastPointer = [event.clientX, event.clientY];
    this.host.classList.add('is-panning');
    this.#showGuides(true);
    try { this.host.setPointerCapture(event.pointerId); } catch { /* window listeners remain the fallback */ }
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (this.#pointerId !== event.pointerId || this.#destroyed) return;
    const dx = (event.clientX - this.#lastPointer[0]) / this.#view.zoom;
    const dy = (event.clientY - this.#lastPointer[1]) / this.#view.zoom;
    this.#lastPointer = [event.clientX, event.clientY];
    const raw: [number, number] = [this.#view.center[0] - dx, this.#view.center[1] - dy];
    const snapped: [number, number] = event.shiftKey
      ? [Math.round(raw[0] / 10) * 10, Math.round(raw[1] / 10) * 10]
      : raw;
    this.#commit({ ...this.#view, center: snapped });
  };

  #onPointerUp = (event: PointerEvent): void => this.#endPointer(event.pointerId);
  #onPointerCancel = (event: PointerEvent): void => this.#endPointer(event.pointerId);

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space' && !isEditable(event.target)) {
      this.#spacePressed = true;
      this.host.classList.add('pan-ready');
      if (document.activeElement === this.host) event.preventDefault();
      return;
    }
    if (document.activeElement !== this.host || !(event.metaKey || event.ctrlKey)) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoomBy(1.2); }
    else if (event.key === '-') { event.preventDefault(); this.zoomBy(1 / 1.2); }
    else if (event.key === '0') { event.preventDefault(); this.reset(); }
  };

  #onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return;
    this.#spacePressed = false;
    this.host.classList.remove('pan-ready');
  };

  #endPointer(pointerId: number): void {
    if (this.#pointerId !== pointerId) return;
    this.#pointerId = null;
    this.host.classList.remove('is-panning');
    this.#showGuides(false);
  }

  #showGuides(visible: boolean): void {
    this.#guides.classList.toggle('visible', visible);
  }

  #commit(view: DesignerViewportView): void {
    this.#assertActive();
    this.#view = normalizeView(view);
    this.#apply();
    this.#onChange(this.#view);
  }

  #apply(): void {
    const x = this.#compositionSize[0] / 2 - this.#view.center[0];
    const y = this.#compositionSize[1] / 2 - this.#view.center[1];
    this.surface.style.transform = `translate(${x}px, ${y}px) scale(${this.#view.zoom})`;
    this.surface.style.transformOrigin = 'center';
    this.host.style.setProperty('--viewport-zoom', this.#view.zoom.toFixed(3));
  }

  #listen(target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions | boolean): void {
    target.addEventListener(type, listener, options);
    this.#listeners.push([target, type, listener, options]);
  }

  #assertActive(): void {
    if (this.#destroyed) throw new Error('Designer viewport interaction is destroyed.');
  }
}

function normalizeView(view: DesignerViewportView): DesignerViewportView {
  return Object.freeze({
    zoom: clamp(view.zoom, 0.1, 8),
    center: Object.freeze([
      Number.isFinite(view.center[0]) ? view.center[0] : 0,
      Number.isFinite(view.center[1]) ? view.center[1] : 0,
    ] as const),
    showGrid: view.showGrid !== false,
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement || target instanceof HTMLElement && target.isContentEditable;
}
