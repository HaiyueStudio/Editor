import {
  setNative3dNodeTransform,
  type Native3dProject,
  type Native3dTransform,
  type Native3dVec3,
  type Native3dVec4,
} from '../../domain/native3d';

export type Native3dGizmoTool = 'translate' | 'rotate' | 'scale';
export type Native3dGizmoSpace = 'local' | 'world';
export type Native3dGizmoAxis = 'x' | 'y' | 'z';

export interface Native3dGizmoControllerOptions {
  readonly container: HTMLElement;
  readonly readProject: () => Native3dProject;
  readonly selectedNodeId: () => string | null;
  readonly onPreview: (project: Native3dProject) => void;
  readonly onCommit: (before: Native3dProject, after: Native3dProject, label: string) => void;
  readonly pixelsPerUnit?: number;
  readonly radiansPerPixel?: number;
}

interface DragState {
  readonly pointerId: number;
  readonly axis: Native3dGizmoAxis;
  readonly startX: number;
  readonly startY: number;
  readonly project: Native3dProject;
  readonly nodeId: string;
  readonly transform: Native3dTransform;
  latest: Native3dProject;
}

/** Leaf UI adapter. One pointer gesture commits one project transaction. */
export class Native3dGizmoController {
  readonly element: HTMLElement;
  private readonly _options: Native3dGizmoControllerOptions;
  private readonly _pixelsPerUnit: number;
  private readonly _radiansPerPixel: number;
  private _tool: Native3dGizmoTool = 'translate';
  private _space: Native3dGizmoSpace = 'local';
  private _drag: DragState | null = null;
  private _destroyed = false;

  constructor(options: Native3dGizmoControllerOptions) {
    this._options = options;
    this._pixelsPerUnit = options.pixelsPerUnit ?? 80;
    this._radiansPerPixel = options.radiansPerPixel ?? Math.PI / 360;
    this.element = createGizmoElement(options.container.ownerDocument);
    options.container.append(this.element);
    this.element.addEventListener('pointerdown', this._onPointerDown);
    this.element.addEventListener('pointermove', this._onPointerMove);
    this.element.addEventListener('pointerup', this._onPointerUp);
    this.element.addEventListener('pointercancel', this._onPointerCancel);
    this._syncClass();
  }

  get tool(): Native3dGizmoTool { return this._tool; }
  get space(): Native3dGizmoSpace { return this._space; }
  get dragging(): boolean { return this._drag !== null; }

  setTool(tool: Native3dGizmoTool): void { this._tool = tool; this._syncClass(); }
  setSpace(space: Native3dGizmoSpace): void { this._space = space; this._syncClass(); }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._drag = null;
    this.element.removeEventListener('pointerdown', this._onPointerDown);
    this.element.removeEventListener('pointermove', this._onPointerMove);
    this.element.removeEventListener('pointerup', this._onPointerUp);
    this.element.removeEventListener('pointercancel', this._onPointerCancel);
    this.element.remove();
  }

  private _onPointerDown = (event: PointerEvent): void => {
    if (this._destroyed || event.button !== 0) return;
    const handle = (event.target as Element | null)?.closest<HTMLElement>('[data-native-3d-gizmo-axis]');
    const axis = handle?.dataset.native3dGizmoAxis as Native3dGizmoAxis | undefined;
    const nodeId = this._options.selectedNodeId();
    if (!axis || !nodeId || !handle) return;
    const project = this._options.readProject();
    const node = project.nodes.find(item => item.id === nodeId);
    if (!node) return;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    this._drag = {
      pointerId: event.pointerId,
      axis,
      startX: event.clientX,
      startY: event.clientY,
      project,
      nodeId,
      transform: node.transform,
      latest: project,
    };
    this.element.dataset.dragging = 'true';
  };

  private _onPointerMove = (event: PointerEvent): void => {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pixels = event.clientX - drag.startX - (event.clientY - drag.startY);
    const next = applyGizmoDelta(drag.project, drag.nodeId, drag.transform, this._tool, this._space, drag.axis, pixels, this._pixelsPerUnit, this._radiansPerPixel);
    drag.latest = next;
    this._options.onPreview(next);
  };

  private _onPointerUp = (event: PointerEvent): void => {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this._drag = null;
    delete this.element.dataset.dragging;
    if (drag.latest !== drag.project) this._options.onCommit(drag.project, drag.latest, `${toolLabel(this._tool)} ${drag.axis.toUpperCase()}`);
  };

  private _onPointerCancel = (event: PointerEvent): void => {
    if (this._drag?.pointerId !== event.pointerId) return;
    const project = this._drag.project;
    this._drag = null;
    delete this.element.dataset.dragging;
    this._options.onPreview(project);
  };

  private _syncClass(): void {
    this.element.dataset.tool = this._tool;
    this.element.dataset.space = this._space;
    this.element.setAttribute('aria-label', `${toolLabel(this._tool)} · ${this._space === 'local' ? '局部' : '世界'}坐标`);
  }
}

export function applyGizmoDelta(
  project: Native3dProject,
  nodeId: string,
  transform: Native3dTransform,
  tool: Native3dGizmoTool,
  space: Native3dGizmoSpace,
  axis: Native3dGizmoAxis,
  pixels: number,
  pixelsPerUnit = 80,
  radiansPerPixel = Math.PI / 360,
): Native3dProject {
  if (!Number.isFinite(pixels)) return project;
  if (tool === 'translate') {
    const amount = pixels / pixelsPerUnit;
    const basis = space === 'local' ? rotateAxis(axisVector(axis), transform.rotation) : axisVector(axis);
    return setNative3dNodeTransform(project, nodeId, { translation: addScaled(transform.translation, basis, amount) });
  }
  if (tool === 'scale') {
    const factor = Math.max(0.001, 1 + pixels / pixelsPerUnit);
    const next = [...transform.scale] as [number, number, number];
    next[axisIndex(axis)] *= factor;
    return setNative3dNodeTransform(project, nodeId, { scale: next });
  }
  const delta = axisAngle(axisVector(axis), pixels * radiansPerPixel);
  const rotation = space === 'local' ? multiplyQuaternion(transform.rotation, delta) : multiplyQuaternion(delta, transform.rotation);
  return setNative3dNodeTransform(project, nodeId, { rotation });
}

function createGizmoElement(document: Document): HTMLElement {
  const root = document.createElement('div');
  root.className = 'native-3d-gizmo';
  root.setAttribute('role', 'toolbar');
  for (const axis of ['x', 'y', 'z'] as const) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = `native-3d-gizmo-axis native-3d-gizmo-${axis}`;
    handle.dataset.native3dGizmoAxis = axis;
    handle.textContent = axis.toUpperCase();
    handle.setAttribute('aria-label', `${axis.toUpperCase()} 轴`);
    root.append(handle);
  }
  return root;
}

function axisIndex(axis: Native3dGizmoAxis): 0 | 1 | 2 { return axis === 'x' ? 0 : axis === 'y' ? 1 : 2; }
function axisVector(axis: Native3dGizmoAxis): Native3dVec3 { return axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1]; }

function addScaled(value: Native3dVec3, axis: Native3dVec3, amount: number): Native3dVec3 {
  return [value[0] + axis[0] * amount, value[1] + axis[1] * amount, value[2] + axis[2] * amount];
}

function rotateAxis(value: Native3dVec3, quaternion: Native3dVec4): Native3dVec3 {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = value;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
}

function axisAngle(axis: Native3dVec3, angle: number): Native3dVec4 {
  const sine = Math.sin(angle * 0.5);
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(angle * 0.5)];
}

function multiplyQuaternion(left: Native3dVec4, right: Native3dVec4): Native3dVec4 {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  const result: Native3dVec4 = [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
  const length = Math.hypot(...result) || 1;
  return [result[0] / length, result[1] / length, result[2] / length, result[3] / length];
}

function toolLabel(tool: Native3dGizmoTool): string {
  return tool === 'translate' ? '移动' : tool === 'rotate' ? '旋转' : '缩放';
}
