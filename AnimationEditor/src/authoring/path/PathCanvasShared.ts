import type { PathPoint, PathViewportTransform } from '../../domain/PathAuthoringTypes';

export function sizePathCanvas(canvas: HTMLCanvasElement): number {
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * scale));
  const height = Math.max(1, Math.round(canvas.clientHeight * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
}

export function requiredPathContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Path authoring Canvas2D context is unavailable.');
  return context;
}

export function localPathPoint(canvas: HTMLCanvasElement, event: PointerEvent): PathPoint {
  const bounds = canvas.getBoundingClientRect();
  return Object.freeze([event.clientX - bounds.left, event.clientY - bounds.top]);
}

export function normalizePathView(view: PathViewportTransform): PathViewportTransform {
  if (!Number.isFinite(view.zoom) || view.zoom <= 0 || view.pan.some(value => !Number.isFinite(value))) {
    throw new Error('Path viewport zoom/pan must be finite and zoom must be positive.');
  }
  return Object.freeze({ zoom: view.zoom, pan: Object.freeze([...view.pan] as [number, number]) });
}

export function applyPathView(context: CanvasRenderingContext2D, view: PathViewportTransform): void {
  context.translate(view.pan[0], view.pan[1]);
  context.scale(view.zoom, view.zoom);
}

export function drawPathPoint(
  context: CanvasRenderingContext2D, point: PathPoint, radius: number, fill: string, stroke = '#111827',
): void {
  context.beginPath(); context.arc(point[0], point[1], radius, 0, Math.PI * 2);
  context.fillStyle = fill; context.fill(); context.strokeStyle = stroke; context.stroke();
}

export function schedulePathFrame(owner: { frame: number | null }, render: () => void): void {
  if (owner.frame !== null) return;
  owner.frame = requestAnimationFrame(() => { owner.frame = null; render(); });
}
