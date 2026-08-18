import { Camera3D, CartesianTransform3D, Entity, SphericalTransform3D, type World } from '@haiyue/engine';
import { mat4 } from 'wgpu-matrix';
import type { CommandBus } from '../../commands/CommandBus';
import type { SelectionController } from '../../domain/selection/SelectionState';
import type { TransformSnapshot, Vec3Tuple } from '../../types';
import { applyTransformSnapshot, snapshotTransform } from '../inspector/transformEditor';
import { updateWorldMatrix } from './viewportInteraction';
import type { EditorShortcutRegistry } from '../../infra/shortcuts/EditorShortcutRegistry';

const localRotationX = mat4.identity() as Float32Array;
const localRotationY = mat4.identity() as Float32Array;
const localRotationZ = mat4.identity() as Float32Array;
const localRotationYX = mat4.identity() as Float32Array;
const localRotation = mat4.identity() as Float32Array;

export type TransformGizmoMode = 'translate' | 'rotate' | 'scale';
export type TransformGizmoSpace = 'local' | 'world';
export type TransformGizmoPivot = 'active' | 'center';

export interface TransformGizmoElements {
  readonly host: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly translateButton: HTMLElement | null;
  readonly rotateButton: HTMLElement | null;
  readonly scaleButton: HTMLElement | null;
  readonly spaceSelect: HTMLSelectElement | null;
  readonly pivotSelect: HTMLSelectElement | null;
  readonly snapEnabled: HTMLInputElement | null;
  readonly snapValue: HTMLInputElement | null;
  readonly focusButton: HTMLElement | null;
}

export interface TransformGizmoOptions {
  readonly world: World;
  readonly cameraEntity: Entity;
  readonly selection: SelectionController;
  readonly getCommandBus: () => CommandBus | null;
  readonly elements: TransformGizmoElements;
  readonly onChange: () => void;
  readonly shortcuts: EditorShortcutRegistry;
}

interface TransformRecord {
  readonly entity: Entity;
  readonly transform: CartesianTransform3D;
  readonly before: TransformSnapshot;
  after: TransformSnapshot;
}

interface DragState {
  readonly pointerId: number;
  readonly axis: 'x' | 'y' | 'z' | 'all';
  readonly startX: number;
  readonly startY: number;
  readonly pivot: Vec3Tuple;
  readonly records: TransformRecord[];
}

export class TransformGizmoController {
  private readonly _options: TransformGizmoOptions;
  private readonly _root: HTMLElement;
  private readonly _handles: HTMLElement[] = [];
  private readonly _listeners = new AbortController();
  private _mode: TransformGizmoMode = 'translate';
  private _space: TransformGizmoSpace = 'world';
  private _pivotMode: TransformGizmoPivot = 'active';
  private _drag: DragState | null = null;
  private _frame = 0;

  constructor(options: TransformGizmoOptions) {
    this._options = options;
    this._root = createGizmoRoot();
    options.elements.host.append(this._root);
    this._handles = Array.from(this._root.querySelectorAll<HTMLElement>('[data-gizmo-axis]'));
    this._bind();
    this._syncToolbar();
    this._frame = requestAnimationFrame(this._update);
  }

  setMode(mode: TransformGizmoMode): void {
    this._mode = mode;
    this._root.dataset.mode = mode;
    if (this._options.elements.snapValue) {
      this._options.elements.snapValue.value = mode === 'rotate' ? '15' : mode === 'scale' ? '0.1' : '0.5';
    }
    this._syncToolbar();
  }

  focusSelection(): boolean {
    const records = this._selectedTransforms();
    if (records.length === 0) return false;
    const pivot = this._getPivot(records);
    let radius = 0;
    for (const record of records) {
      updateWorldMatrix(record.entity);
      const matrix = record.transform.worldMatrix;
      radius = Math.max(radius, Math.hypot(matrix[12]! - pivot[0], matrix[13]! - pivot[1], matrix[14]! - pivot[2]));
    }
    const orbit = this._options.cameraEntity.getComponent(SphericalTransform3D);
    if (!orbit) return false;
    orbit.setTarget(pivot[0], pivot[1], pivot[2]);
    orbit.radius = Math.max(1, radius * 2.5);
    return true;
  }

  dispose(): void {
    cancelAnimationFrame(this._frame);
    this._listeners.abort();
    this._root.remove();
  }

  private _bind(): void {
    const signal = this._listeners.signal;
    this._options.elements.translateButton?.addEventListener('click', () => this.setMode('translate'), { signal });
    this._options.elements.rotateButton?.addEventListener('click', () => this.setMode('rotate'), { signal });
    this._options.elements.scaleButton?.addEventListener('click', () => this.setMode('scale'), { signal });
    this._options.elements.focusButton?.addEventListener('click', () => this.focusSelection(), { signal });
    this._options.elements.spaceSelect?.addEventListener('change', () => {
      this._space = this._options.elements.spaceSelect?.value === 'local' ? 'local' : 'world';
    }, { signal });
    this._options.elements.pivotSelect?.addEventListener('change', () => {
      this._pivotMode = this._options.elements.pivotSelect?.value === 'center' ? 'center' : 'active';
    }, { signal });
    for (const handle of this._handles) handle.addEventListener('pointerdown', this._onPointerDown, { signal });
    window.addEventListener('pointermove', this._onPointerMove, { signal });
    window.addEventListener('pointerup', this._onPointerUp, { signal });
    window.addEventListener('pointercancel', this._onPointerCancel, { signal });
    const shortcutDisposers = [
      this._options.shortcuts.register({ id: 'viewport.translate', chord: 'W', context: 'viewport', handler: () => this.setMode('translate') }),
      this._options.shortcuts.register({ id: 'viewport.rotate', chord: 'E', context: 'viewport', handler: () => this.setMode('rotate') }),
      this._options.shortcuts.register({ id: 'viewport.scale', chord: 'R', context: 'viewport', handler: () => this.setMode('scale') }),
      this._options.shortcuts.register({ id: 'viewport.focus', chord: 'F', context: 'viewport', handler: () => this.focusSelection() }),
    ];
    signal.addEventListener('abort', () => shortcutDisposers.forEach(dispose => dispose()), { once: true });
  }

  private readonly _onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const axis = handle.dataset.gizmoAxis as DragState['axis'] | undefined;
    if (!axis) return;
    const transforms = this._selectedTransforms();
    if (transforms.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture?.(event.pointerId);
    const records = transforms.map(({ entity, transform }) => ({
      entity,
      transform,
      before: snapshotTransform(transform),
      after: snapshotTransform(transform),
    }));
    this._drag = {
      pointerId: event.pointerId,
      axis,
      startX: event.clientX,
      startY: event.clientY,
      pivot: this._getPivot(transforms),
      records,
    };
  };

  private readonly _onPointerMove = (event: PointerEvent): void => {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    this._applyDrag(drag, dx, dy);
    this._options.onChange();
  };

  private readonly _onPointerUp = (event: PointerEvent): void => {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this._drag = null;
    if (!drag.records.some(record => !sameSnapshot(record.before, record.after))) return;
    const records = drag.records;
    this._options.getCommandBus()?.execute({
      label: `${capitalize(this._mode)} ${records.length} ${records.length === 1 ? 'Entity' : 'Entities'}`,
      execute: () => {
        for (const record of records) applyTransformSnapshot(record.transform, record.after);
        this._options.onChange();
      },
      undo: () => {
        for (const record of records) applyTransformSnapshot(record.transform, record.before);
        this._options.onChange();
      },
    });
  };

  private readonly _onPointerCancel = (event: PointerEvent): void => {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this._drag = null;
    for (const record of drag.records) applyTransformSnapshot(record.transform, record.before);
    this._options.onChange();
  };

  private _applyDrag(drag: DragState, dx: number, dy: number): void {
    const scalarPixels = drag.axis === 'y' ? -dy : dx - dy;
    const orbit = this._options.cameraEntity.getComponent(SphericalTransform3D);
    const canvasHeight = Math.max(1, this._options.elements.canvas.getBoundingClientRect().height);
    const translation = this._snap(scalarPixels * (orbit?.radius ?? 10) / canvasHeight, 1);
    const angle = this._snap(scalarPixels * 0.01, Math.PI / 180);
    const scaleDelta = this._snap(scalarPixels * 0.01, 1);
    for (const record of drag.records) {
      const before = record.before;
      const next = cloneSnapshot(before);
      const axisIndex: 0 | 1 | 2 | null = drag.axis === 'x' ? 0 : drag.axis === 'y' ? 1 : drag.axis === 'z' ? 2 : null;
      if (this._mode === 'translate') {
        if (axisIndex !== null) {
          const delta = this._translationDelta(record.entity, axisIndex, translation);
          next.position[0] += delta[0]; next.position[1] += delta[1]; next.position[2] += delta[2];
        } else {
          next.position[0] += this._snap(dx * (orbit?.radius ?? 10) / canvasHeight, 1);
          next.position[1] -= this._snap(dy * (orbit?.radius ?? 10) / canvasHeight, 1);
        }
      } else if (this._mode === 'rotate') {
        next.rotation[axisIndex ?? 1] += angle;
        if (this._pivotMode === 'center' && drag.records.length > 1 && axisIndex !== null) {
          rotatePositionAroundPivot(next.position, this._pivotInParent(record.entity, drag.pivot), axisIndex, angle);
        }
      } else {
        const factor = Math.max(0.001, 1 + scaleDelta);
        if (axisIndex !== null) next.scale[axisIndex] = Math.max(0.001, before.scale[axisIndex] * factor);
        else for (let i = 0; i < 3; i++) next.scale[i] = Math.max(0.001, before.scale[i]! * factor);
        if (this._pivotMode === 'center' && drag.records.length > 1) {
          const localPivot = this._pivotInParent(record.entity, drag.pivot);
          for (let i = 0; i < 3; i++) next.position[i] = localPivot[i]! + (before.position[i]! - localPivot[i]!) * factor;
        }
      }
      record.after = next;
      applyTransformSnapshot(record.transform, next);
    }
  }

  private _translationDelta(entity: Entity, axis: number, amount: number): Vec3Tuple {
    const delta: Vec3Tuple = [0, 0, 0];
    delta[axis] = amount;
    if (this._space === 'local') {
      const transform = entity.getComponent(CartesianTransform3D);
      if (!transform) return delta;
      mat4.rotationY(transform.rotation[1]!, localRotationY);
      mat4.rotationX(transform.rotation[0]!, localRotationX);
      mat4.rotationZ(transform.rotation[2]!, localRotationZ);
      mat4.multiply(localRotationY, localRotationX, localRotationYX);
      mat4.multiply(localRotationYX, localRotationZ, localRotation);
      const offset = axis * 4;
      const x = localRotation[offset]!;
      const y = localRotation[offset + 1]!;
      const z = localRotation[offset + 2]!;
      const length = Math.hypot(x, y, z) || 1;
      return [x / length * amount, y / length * amount, z / length * amount];
    }
    const parent = entity.parent as Entity | null;
    if (!parent) return delta;
    updateWorldMatrix(parent);
    const parentTransform = parent.getComponent(CartesianTransform3D);
    if (!parentTransform) return delta;
    const inverse = mat4.inverse(parentTransform.worldMatrix) as Float32Array;
    return [
      inverse[0]! * delta[0] + inverse[4]! * delta[1] + inverse[8]! * delta[2],
      inverse[1]! * delta[0] + inverse[5]! * delta[1] + inverse[9]! * delta[2],
      inverse[2]! * delta[0] + inverse[6]! * delta[1] + inverse[10]! * delta[2],
    ];
  }

  private _pivotInParent(entity: Entity, worldPivot: Vec3Tuple): Vec3Tuple {
    const parent = entity.parent as Entity | null;
    if (!parent) return [...worldPivot];
    updateWorldMatrix(parent);
    const parentTransform = parent.getComponent(CartesianTransform3D);
    if (!parentTransform) return [...worldPivot];
    const inverse = mat4.inverse(parentTransform.worldMatrix) as Float32Array;
    return [
      inverse[0]! * worldPivot[0] + inverse[4]! * worldPivot[1] + inverse[8]! * worldPivot[2] + inverse[12]!,
      inverse[1]! * worldPivot[0] + inverse[5]! * worldPivot[1] + inverse[9]! * worldPivot[2] + inverse[13]!,
      inverse[2]! * worldPivot[0] + inverse[6]! * worldPivot[1] + inverse[10]! * worldPivot[2] + inverse[14]!,
    ];
  }

  private _snap(value: number, unit: number): number {
    if (!this._options.elements.snapEnabled?.checked) return value;
    const raw = Number(this._options.elements.snapValue?.value);
    const step = Number.isFinite(raw) && raw > 0 ? raw * unit : unit;
    return Math.round(value / step) * step;
  }

  private _selectedTransforms(): Array<{ entity: Entity; transform: CartesianTransform3D }> {
    const result: Array<{ entity: Entity; transform: CartesianTransform3D }> = [];
    const selection = this._options.selection.selection;
    for (const entity of selection) {
      let ancestor = entity.parent as Entity | null;
      let coveredBySelectedAncestor = false;
      while (ancestor) {
        if (selection.has(ancestor)) {
          coveredBySelectedAncestor = true;
          break;
        }
        ancestor = ancestor.parent as Entity | null;
      }
      if (coveredBySelectedAncestor) continue;
      const transform = entity.getComponent(CartesianTransform3D);
      if (transform) result.push({ entity, transform });
    }
    return result;
  }

  private _getPivot(records: readonly { entity: Entity; transform: CartesianTransform3D }[]): Vec3Tuple {
    const active = this._options.selection.active;
    const chosen = this._pivotMode === 'active' ? records.find(record => record.entity === active) : undefined;
    if (chosen) {
      updateWorldMatrix(chosen.entity);
      return [chosen.transform.worldMatrix[12]!, chosen.transform.worldMatrix[13]!, chosen.transform.worldMatrix[14]!];
    }
    const pivot: Vec3Tuple = [0, 0, 0];
    for (const record of records) {
      updateWorldMatrix(record.entity);
      pivot[0] += record.transform.worldMatrix[12]!;
      pivot[1] += record.transform.worldMatrix[13]!;
      pivot[2] += record.transform.worldMatrix[14]!;
    }
    const count = Math.max(1, records.length);
    pivot[0] /= count; pivot[1] /= count; pivot[2] /= count;
    return pivot;
  }

  private readonly _update = (): void => {
    const records = this._selectedTransforms();
    const position = records.length > 0 ? projectWorldPoint(this._getPivot(records), this._options) : null;
    this._root.hidden = position === null;
    if (position) this._root.style.transform = `translate(${position[0]}px, ${position[1]}px)`;
    this._frame = requestAnimationFrame(this._update);
  };

  private _syncToolbar(): void {
    this._root.dataset.mode = this._mode;
    this._options.elements.translateButton?.classList.toggle('active', this._mode === 'translate');
    this._options.elements.rotateButton?.classList.toggle('active', this._mode === 'rotate');
    this._options.elements.scaleButton?.classList.toggle('active', this._mode === 'scale');
  }
}

function createGizmoRoot(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'transform-gizmo';
  root.hidden = true;
  root.innerHTML = '<button class="gizmo-axis gizmo-x" data-gizmo-axis="x" aria-label="X axis">X</button>'
    + '<button class="gizmo-axis gizmo-y" data-gizmo-axis="y" aria-label="Y axis">Y</button>'
    + '<button class="gizmo-axis gizmo-z" data-gizmo-axis="z" aria-label="Z axis">Z</button>'
    + '<button class="gizmo-center" data-gizmo-axis="all" aria-label="All axes"></button>';
  return root;
}

function projectWorldPoint(point: Vec3Tuple, options: TransformGizmoOptions): [number, number] | null {
  const camera = options.cameraEntity.getComponent(Camera3D);
  if (!camera) return null;
  updateWorldMatrix(options.cameraEntity);
  const cameraTransform = options.cameraEntity.getComponent(CartesianTransform3D)
    ?? options.cameraEntity.getComponent(SphericalTransform3D);
  if (!cameraTransform) return null;
  camera.updateAspect(options.elements.canvas.width / Math.max(1, options.elements.canvas.height));
  const view = mat4.inverse(cameraTransform.worldMatrix) as Float32Array;
  const vp = mat4.multiply(camera.projectionMatrix, view) as Float32Array;
  const x = vp[0]! * point[0] + vp[4]! * point[1] + vp[8]! * point[2] + vp[12]!;
  const y = vp[1]! * point[0] + vp[5]! * point[1] + vp[9]! * point[2] + vp[13]!;
  const w = vp[3]! * point[0] + vp[7]! * point[1] + vp[11]! * point[2] + vp[15]!;
  if (w <= 0.0001) return null;
  const rect = options.elements.canvas.getBoundingClientRect();
  const hostRect = options.elements.host.getBoundingClientRect();
  return [rect.left - hostRect.left + (x / w * 0.5 + 0.5) * rect.width, rect.top - hostRect.top + (0.5 - y / w * 0.5) * rect.height];
}

function cloneSnapshot(value: TransformSnapshot): TransformSnapshot {
  return { position: [...value.position], rotation: [...value.rotation], scale: [...value.scale] };
}

function sameSnapshot(left: TransformSnapshot, right: TransformSnapshot): boolean {
  return left.position.every((value, i) => value === right.position[i])
    && left.rotation.every((value, i) => value === right.rotation[i])
    && left.scale.every((value, i) => value === right.scale[i]);
}

function rotatePositionAroundPivot(position: Vec3Tuple, pivot: Vec3Tuple, axis: number, angle: number): void {
  const a = (axis + 1) % 3;
  const b = (axis + 2) % 3;
  const x = position[a]! - pivot[a]!;
  const y = position[b]! - pivot[b]!;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  position[a] = pivot[a]! + x * c - y * s;
  position[b] = pivot[b]! + x * s + y * c;
}

function capitalize(value: string): string { return value[0]!.toUpperCase() + value.slice(1); }
