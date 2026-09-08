import type { AdvancedAuthoringIntent, AdvancedAuthoringView, AuthoringGizmoAxis, AuthoringPreview } from './types.js';
import { AuthoringTransformGesture, authoringProjectedAxes, type AuthoringGestureOptions } from './transform.js';
const mounted = new WeakSet<HTMLElement>();

/** Pointer interaction is extracted from the product viewport; mutation stays with the host. */
export class AdvancedTransformGizmo {
  readonly root: HTMLElement;
  private view: AdvancedAuthoringView;
  private options: AuthoringGestureOptions = { mode: 'translate', space: 'world', axis: 'x', pivot: 'active', snap: 0 };
  private drag: Readonly<{ pointerId: number; x: number; y: number; handle: HTMLElement; gesture: AuthoringTransformGesture }> | null = null;
  private readonly lifetime = new AbortController();
  private closed = false;
  private busy = false;
  private readonly previousPosition: string;
  private readonly ownsPosition: boolean;
  constructor(private readonly host: HTMLElement, initial: AdvancedAuthoringView, private readonly preview: (value: AuthoringPreview | null) => void, private readonly dispatch: (intent: AdvancedAuthoringIntent) => void, private readonly diagnostic: (message: string) => void) {
    if (mounted.has(host)) throw Error('advanced-authoring.viewport-already-mounted');
    this.view = initial; const document = host.ownerDocument;
    this.previousPosition = host.style.position;
    this.ownsPosition = document.defaultView!.getComputedStyle(host).position === 'static';
    if (this.ownsPosition) host.style.position = 'relative';
    mounted.add(host);
    this.root = document.createElement('div'); this.root.className = 'advanced-transform-gizmo'; this.root.setAttribute('aria-label', 'Transform gizmo');
    this.root.innerHTML = '<svg aria-hidden="true"></svg><button type="button" data-axis="x" aria-label="Transform X axis">X</button><button type="button" data-axis="y" aria-label="Transform Y axis">Y</button><button type="button" data-axis="z" aria-label="Transform Z axis">Z</button><button type="button" data-axis="all" aria-label="Transform XY / uniform scale">●</button>';
    host.append(this.root);
    try {
      for (const button of this.root.querySelectorAll<HTMLElement>('[data-axis]')) {
        button.addEventListener('pointerdown', event => this.begin(event, button), { signal: this.lifetime.signal });
        button.addEventListener('lostpointercapture', () => { if (this.drag?.handle === button) this.cancel(); }, { signal: this.lifetime.signal });
        button.addEventListener('keydown', event => {
          if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) || this.busy) return;
          event.preventDefault(); event.stopPropagation();
          try {
            const gesture = new AuthoringTransformGesture(this.view, { ...this.options, axis: button.dataset.axis as AuthoringGizmoAxis });
            const amount = event.shiftKey ? 10 : 1;
            const sample = gesture.update(event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0);
            this.preview(sample); const intent = gesture.finish(this.view); this.preview(null); if (intent) this.dispatch(intent);
          } catch { this.cancel(); this.diagnostic('Transform is unavailable for this selection or coordinate space.'); }
        }, { signal: this.lifetime.signal });
      }
      const surface = document.defaultView!;
      surface.addEventListener('pointermove', event => this.move(event), { signal: this.lifetime.signal });
      surface.addEventListener('pointerup', event => this.finish(event), { signal: this.lifetime.signal });
      surface.addEventListener('pointercancel', event => { if (event.pointerId === this.drag?.pointerId) this.cancel(); }, { signal: this.lifetime.signal });
      surface.addEventListener('blur', () => this.cancel(), { signal: this.lifetime.signal });
      host.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.drag) { event.preventDefault(); event.stopPropagation(); this.cancel(); }
      }, { signal: this.lifetime.signal });
      this.render();
    } catch (error) { this.dispose(); throw error; }
  }
  configure(options: Omit<AuthoringGestureOptions, 'axis'>): void { this.cancel(); this.options = { ...options, axis: 'x' }; this.render(); }
  update(view: AdvancedAuthoringView, busy = false): void {
    if (this.closed) return;
    if (this.drag && (!this.drag.gesture.current(view) || !view.gizmo.enabled || !view.gizmo.projection || busy)) this.cancel();
    this.view = view; this.busy = busy; this.render();
  }
  cancel(): void {
    const drag = this.drag; this.drag = null;
    if (drag) { drag.gesture.cancel(); try { if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId); } catch { /* Detached host. */ } }
    this.restorePreview();
  }
  private restorePreview(): void { try { this.preview(null); } catch { /* Cleanup must release owned listeners even when the viewport host fails. */ } }
  dispose(): void { if (this.closed) return; this.closed = true; try { this.cancel(); } finally { this.lifetime.abort(); this.root.remove(); mounted.delete(this.host); if (this.ownsPosition && this.host.style.position === 'relative') this.host.style.position = this.previousPosition; } }
  private begin(event: PointerEvent, handle: HTMLElement): void {
    if (this.closed || this.busy || this.drag || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    try {
      const gesture = new AuthoringTransformGesture(this.view, { ...this.options, axis: handle.dataset.axis as AuthoringGizmoAxis });
      this.drag = { gesture, pointerId: event.pointerId, x: event.clientX, y: event.clientY, handle }; handle.setPointerCapture(event.pointerId);
    } catch { this.cancel(); this.diagnostic('Transform is unavailable for this selection or coordinate space.'); }
  }
  private move(event: PointerEvent): void {
    const drag = this.drag; if (!drag || drag.pointerId !== event.pointerId) return; event.preventDefault();
    try { if (!drag.gesture.current(this.view)) throw Error('stale'); this.preview(drag.gesture.update(event.clientX-drag.x, event.clientY-drag.y)); }
    catch { this.cancel(); this.diagnostic('Transform preview cancelled. Refresh the selection before retrying.'); }
  }
  private finish(event: PointerEvent): void {
    const drag = this.drag; if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    try {
      // Include the final pointer position even if no last pointermove was delivered.
      drag.gesture.update(event.clientX-drag.x, event.clientY-drag.y);
      const intent = drag.gesture.finish(this.view); this.preview(null); if (intent) this.dispatch(intent);
    } catch { this.restorePreview(); this.diagnostic('Transform was cancelled because its source changed.'); }
    finally { if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId); }
  }
  private render(): void {
    const projection = this.view.gizmo.projection;
    const axes = authoringProjectedAxes(this.view,this.options.space);
    this.root.hidden = !projection || !axes || !this.view.gizmo.enabled || !this.view.selection.active;
    this.root.dataset.mode = this.options.mode;
    if (!projection || !axes) return;
    const [x,y] = projection.origin, svg = this.root.querySelector('svg')!; svg.replaceChildren();
    const colors = { x: '#ff8e8e', y: '#84e5a4', z: '#98c4ff' };
    for (const axis of ['x','y','z'] as const) {
      const [dx,dy] = axes[axis], button = this.root.querySelector<HTMLButtonElement>(`[data-axis="${axis}"]`)!;
      button.style.left = `${x+dx}px`; button.style.top = `${y+dy}px`; button.disabled = this.busy || Math.hypot(dx,dy) < 1;
      const line = this.host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line');
      for (const [key,value] of Object.entries({ x1: x, y1: y, x2: x+dx, y2: y+dy, stroke: colors[axis], 'stroke-width': 3 })) line.setAttribute(key, String(value)); svg.append(line);
      if (this.options.mode === 'rotate') {
        const others = (['x','y','z'] as const).filter(value => value !== axis), a = axes[others[0]!]!, b = axes[others[1]!]!;
        const points = Array.from({ length: 49 }, (_,index) => { const t = index*Math.PI/24; return `${x+a[0]*Math.cos(t)*.65+b[0]*Math.sin(t)*.65},${y+a[1]*Math.cos(t)*.65+b[1]*Math.sin(t)*.65}`; });
        const ring = this.host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'polyline'); ring.setAttribute('points', points.join(' ')); ring.setAttribute('stroke', colors[axis]); ring.setAttribute('stroke-width', '2'); ring.setAttribute('fill', 'none'); svg.append(ring);
      }
    }
    const all = this.root.querySelector<HTMLButtonElement>('[data-axis="all"]')!; all.style.left = `${x}px`; all.style.top = `${y}px`; all.disabled = this.busy;
  }
}
