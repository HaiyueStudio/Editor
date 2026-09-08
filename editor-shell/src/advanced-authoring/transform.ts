import type { AdvancedAuthoringIntent, AdvancedAuthoringView, AuthoringGizmoAxis, AuthoringGizmoMode, AuthoringGizmoSpace, AuthoringPreview, AuthoringTransform, AuthoringTransformItem, AuthoringVec3 } from './types.js';
import { fail, finite, freeze, transform } from './validation.js';

type Vec3 = [number, number, number];
type Matrix = number[];
const radians = Math.PI / 180;
const identity = (): Matrix => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const clone = (value: AuthoringTransform) => ({ position: [...value.position] as Vec3, rotationDegrees: [...value.rotationDegrees] as Vec3, scale: [...value.scale] as Vec3 });
export function multiplyTransformMatrices(a: readonly number[], b: readonly number[]): Matrix {
  const result = Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) result[column * 4 + row]! += a[k * 4 + row]! * b[column * 4 + k]!;
  return result;
}
/** Euler order follows the existing authoring convention: Y * X * Z, degrees. */
export function authoringTransformMatrix(value: AuthoringTransform): Matrix {
  const [x,y,z] = value.rotationDegrees.map(value => value * radians), [sx,cx,sy,cy,sz,cz] = [Math.sin(x!),Math.cos(x!),Math.sin(y!),Math.cos(y!),Math.sin(z!),Math.cos(z!)];
  const [a,b,c] = value.scale;
  return [(cy!*cz!+sy!*sx!*sz!)*a, cx!*sz!*a, (-sy!*cz!+cy!*sx!*sz!)*a, 0,
    (-cy!*sz!+sy!*sx!*cz!)*b, cx!*cz!*b, (sy!*sz!+cy!*sx!*cz!)*b, 0,
    sy!*cx!*c, -sx!*c, cy!*cx!*c, 0, ...value.position, 1];
}
function inverse(matrix: readonly number[]): Matrix {
  const [a,b,c,d,e,f,g,h,i] = [matrix[0]!,matrix[4]!,matrix[8]!,matrix[1]!,matrix[5]!,matrix[9]!,matrix[2]!,matrix[6]!,matrix[10]!];
  const determinant = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if (!finite(determinant) || Math.abs(determinant) < 1e-18) fail('singular-transform');
  const result = [(e*i-f*h)/determinant,(f*g-d*i)/determinant,(d*h-e*g)/determinant,0,
    (c*h-b*i)/determinant,(a*i-c*g)/determinant,(b*g-a*h)/determinant,0,
    (b*f-c*e)/determinant,(c*d-a*f)/determinant,(a*e-b*d)/determinant,0,0,0,0,1];
  const offset = direction(result, [-matrix[12]!, -matrix[13]!, -matrix[14]!]); result[12] = offset[0]; result[13] = offset[1]; result[14] = offset[2]; return result;
}
function direction(matrix: readonly number[], vector: AuthoringVec3): Vec3 {
  return [matrix[0]!*vector[0]+matrix[4]!*vector[1]+matrix[8]!*vector[2], matrix[1]!*vector[0]+matrix[5]!*vector[1]+matrix[9]!*vector[2], matrix[2]!*vector[0]+matrix[6]!*vector[1]+matrix[10]!*vector[2]];
}
function point(matrix: readonly number[], vector: AuthoringVec3): Vec3 { const result = direction(matrix, vector); return [result[0]+matrix[12]!,result[1]+matrix[13]!,result[2]+matrix[14]!]; }
const magnitude = (vector: AuthoringVec3): number => Math.hypot(...vector);
const normalize = (vector: AuthoringVec3): Vec3 => { const length = magnitude(vector); if (length < 1e-12 || !finite(length)) fail('gizmo-axis'); return vector.map(value => value / length) as Vec3; };
const dot = (a: AuthoringVec3, b: AuthoringVec3): number => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function rotationMatrix(axis: AuthoringVec3, angle: number): Matrix {
  const [x,y,z] = normalize(axis), c = Math.cos(angle), s = Math.sin(angle), t = 1-c;
  return [t*x*x+c,t*x*y+s*z,t*x*z-s*y,0, t*x*y-s*z,t*y*y+c,t*y*z+s*x,0, t*x*z+s*y,t*y*z-s*x,t*z*z+c,0, 0,0,0,1];
}
function pureRotation(matrix: readonly number[], requireUniform = false): Matrix {
  const columns = [[matrix[0]!,matrix[1]!,matrix[2]!],[matrix[4]!,matrix[5]!,matrix[6]!],[matrix[8]!,matrix[9]!,matrix[10]!]] as Vec3[];
  const lengths = columns.map(magnitude), axes = columns.map(normalize);
  if (Math.abs(dot(axes[0]!, axes[1]!)) > 1e-5 || Math.abs(dot(axes[0]!, axes[2]!)) > 1e-5 || Math.abs(dot(axes[1]!, axes[2]!)) > 1e-5
    || requireUniform && lengths.some(length => Math.abs(length / lengths[0]! - 1) > 1e-5)) fail('world-rotation-not-representable');
  return [...axes[0]!,0,...axes[1]!,0,...axes[2]!,0,0,0,0,1];
}
function angles(matrix: readonly number[]): Vec3 {
  const x = Math.asin(Math.max(-1, Math.min(1, -matrix[9]!))), cx = Math.cos(x);
  const y = Math.abs(cx) > 1e-7 ? Math.atan2(matrix[8]!, matrix[10]!) : Math.atan2(-matrix[2]!, matrix[0]!);
  const z = Math.abs(cx) > 1e-7 ? Math.atan2(matrix[1]!, matrix[5]!) : 0;
  return [x / radians, y / radians, z / radians];
}

export function authoringWorldMatrices(items: readonly AuthoringTransformItem[]): ReadonlyMap<string, readonly number[]> {
  const byId = new Map(items.map(item => [item.id, item])), matrices = new Map<string, readonly number[]>();
  for (const item of items) {
    const chain: AuthoringTransformItem[] = [], seen = new Set<string>(); let cursor: AuthoringTransformItem | undefined = item;
    while (cursor && !matrices.has(cursor.id)) {
      if (seen.has(cursor.id)) fail('hierarchy-cycle'); seen.add(cursor.id); chain.push(cursor);
      if (cursor.parentId && !byId.has(cursor.parentId)) fail('parent-transform-unavailable'); cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    for (let index = chain.length - 1; index >= 0; index--) { const row = chain[index]!; matrices.set(row.id, freeze(multiplyTransformMatrices(row.parentId ? matrices.get(row.parentId)! : identity(), authoringTransformMatrix(row.value)))); }
  }
  return matrices;
}

export interface AuthoringGestureOptions {
  readonly mode: AuthoringGizmoMode;
  readonly space: AuthoringGizmoSpace;
  readonly axis: AuthoringGizmoAxis;
  readonly pivot: 'active' | 'center';
  /** Translation units, degrees or scale delta; zero disables snapping. */
  readonly snap: number;
}
/** The viewport supplies projected world axes; local handles follow the active transform. */
export function authoringProjectedAxes(view: AdvancedAuthoringView, space: AuthoringGizmoSpace): NonNullable<AdvancedAuthoringView['gizmo']['projection']>['axes'] | null {
  const projection = view.gizmo.projection; if (!projection) return null;
  if (space === 'world') return projection.axes;
  try {
    const active = view.selection.active && authoringWorldMatrices(view.gizmo.transforms).get(view.selection.active.id); if (!active) return null;
    const projected = ([x,y,z]: Vec3): readonly [number,number] => [projection.axes.x[0]*x+projection.axes.y[0]*y+projection.axes.z[0]*z,projection.axes.x[1]*x+projection.axes.y[1]*y+projection.axes.z[1]*z];
    return { x: projected(normalize(direction(active,[1,0,0]))), y: projected(normalize(direction(active,[0,1,0]))), z: projected(normalize(direction(active,[0,0,1]))) };
  } catch { return null; }
}
/** Owns only one temporary drag. It never accesses a product store or History. */
export class AuthoringTransformGesture {
  private closed = false;
  private previewValue: AuthoringPreview;
  private readonly matrices: ReadonlyMap<string, readonly number[]>;
  private readonly targets: readonly AuthoringTransformItem[];
  private readonly pivot: Vec3;
  private readonly worldAxis: Vec3;
  private readonly axisIndex: 0 | 1 | 2;
  private readonly screen: readonly [number,number];
  constructor(private readonly view: AdvancedAuthoringView, private readonly options: AuthoringGestureOptions) {
    if (!view.binding || !view.gizmo.enabled || !view.gizmo.projection || !view.selection.active) fail('gizmo-unavailable');
    if (!['translate','rotate','scale'].includes(options.mode) || !['local','world'].includes(options.space) || !['x','y','z','all'].includes(options.axis) || !['active','center'].includes(options.pivot) || !finite(options.snap) || options.snap < 0) fail('gesture');
    if (options.mode === 'scale' && options.space !== 'local') fail('scale-local-only');
    const selected = new Set(view.selection.items.map(item => item.id)), transformIndex = new Map(view.gizmo.transforms.map(item => [item.id, item]));
    for (const id of selected) if (!transformIndex.has(id)) fail('transform-unavailable');
    this.targets = view.gizmo.transforms.filter(item => {
      if (!selected.has(item.id)) return false; let parent = item.parentId;
      while (parent) { if (selected.has(parent)) return false; parent = transformIndex.get(parent)?.parentId ?? null; } return true;
    });
    if (!this.targets.length || this.targets.length > 256) fail('selection-budget');
    this.matrices = authoringWorldMatrices(view.gizmo.transforms);
    this.axisIndex = options.axis === 'x' ? 0 : options.axis === 'z' ? 2 : 1;
    const axis = [0,0,0] as Vec3; axis[this.axisIndex] = 1;
    const active = this.matrices.get(view.selection.active.id)!;
    this.worldAxis = options.space === 'world' ? axis : normalize(direction(active, axis));
    const axes = authoringProjectedAxes(view,options.space); if (!axes) fail('gizmo-unavailable');
    this.screen = options.axis === 'all' ? [1,-1] : axes[options.axis];
    this.pivot = options.pivot === 'center' ? this.targets.map(item => point(this.matrices.get(item.id)!, [0,0,0])).reduce((sum, point) => [sum[0]+point[0]/this.targets.length,sum[1]+point[1]/this.targets.length,sum[2]+point[2]/this.targets.length] as Vec3, [0,0,0] as Vec3) : point(active, [0,0,0]);
    this.previewValue = freeze({ binding: view.binding, changes: [] });
  }
  current(view: AdvancedAuthoringView): boolean { return !this.closed && view.binding?.documentId === this.view.binding?.documentId && view.binding?.revision === this.view.binding?.revision && view.binding?.epoch === this.view.binding?.epoch && view.selection.revision === this.view.selection.revision; }
  update(dx: number, dy: number): AuthoringPreview {
    if (this.closed || !finite(dx) || !finite(dy) || Math.max(Math.abs(dx), Math.abs(dy)) > 1_000_000) fail('gesture');
    const projection = this.view.gizmo.projection!, screen = this.screen;
    const length = Math.hypot(...screen); if (length < 1e-8) fail('axis-edge-on');
    const pixels = (dx*screen[0]!+dy*screen[1]!)/length;
    const snap = (value: number) => this.options.snap ? Math.round(value / this.options.snap) * this.options.snap : value;
    const amount = snap(pixels * (this.options.mode === 'translate' ? projection.unitsPerPixel : this.options.mode === 'rotate' ? .5 : .01));
    const unchanged = this.options.mode === 'translate' && this.options.axis === 'all' ? snap(dx*projection.unitsPerPixel) === 0 && snap(dy*projection.unitsPerPixel) === 0 : amount === 0;
    if (unchanged) { this.previewValue = freeze({ binding: this.view.binding!, changes: this.targets.map(item => ({ reference: this.view.selection.items.find(reference => reference.id === item.id)!, before: item.value, after: item.value })) }); return this.previewValue; }
    const rotation = rotationMatrix(this.worldAxis, amount * radians), factor = Math.max(.000001, 1+amount);
    const changes = this.targets.map(item => {
      const next = clone(item.value), parent = item.parentId ? this.matrices.get(item.parentId)! : identity(), inverseParent = inverse(parent);
      if (this.options.mode === 'translate') {
        const delta = this.options.axis === 'all' ? [snap(dx*projection.unitsPerPixel), -snap(dy*projection.unitsPerPixel), 0] as Vec3 : this.worldAxis.map(value => value*amount) as Vec3;
        const local = direction(inverseParent, delta); for (let i = 0; i < 3; i++) next.position[i]! += local[i]!;
      } else if (this.options.mode === 'rotate') {
        const local = authoringTransformMatrix({ position: [0,0,0], rotationDegrees: item.value.rotationDegrees, scale: [1,1,1] });
        if (this.options.space === 'local' && this.targets.length === 1 && this.options.pivot === 'active') {
          const axis = [0,0,0] as Vec3; axis[this.axisIndex] = 1; next.rotationDegrees = angles(multiplyTransformMatrices(local, rotationMatrix(axis, amount*radians)));
        } else { const parentRotation = pureRotation(parent, true); next.rotationDegrees = angles(multiplyTransformMatrices(inverse(parentRotation), multiplyTransformMatrices(rotation, multiplyTransformMatrices(parentRotation, local)))); }
        if (this.options.pivot === 'center') {
          const beforeWorld = point(this.matrices.get(item.id)!, [0,0,0]), shifted = beforeWorld.map((value,index) => value-this.pivot[index]!) as Vec3;
          const rotated = direction(rotation, shifted); next.position = point(inverseParent, rotated.map((value,index) => value+this.pivot[index]!) as Vec3);
        }
      } else {
        if (this.options.axis === 'all') next.scale = next.scale.map(value => value*factor) as Vec3; else next.scale[this.axisIndex] *= factor;
        if (this.options.pivot === 'center') {
          const beforeWorld = point(this.matrices.get(item.id)!, [0,0,0]), shifted = beforeWorld.map((value,index) => value-this.pivot[index]!) as Vec3;
          const scaled = this.options.axis === 'all' ? shifted.map(value => value*factor) as Vec3 : shifted.map((value,index) => value+this.worldAxis[index]!*dot(shifted,this.worldAxis)*(factor-1)) as Vec3;
          next.position = point(inverseParent, scaled.map((value,index) => value+this.pivot[index]!) as Vec3);
        }
      }
      transform(next);
      return { reference: this.view.selection.items.find(reference => reference.id === item.id)!, before: item.value, after: next };
    });
    this.previewValue = freeze({ binding: this.view.binding!, changes }); return this.previewValue;
  }
  finish(current: AdvancedAuthoringView): Extract<AdvancedAuthoringIntent, { type: 'transform' }> | null {
    if (!this.current(current)) { this.cancel(); return fail('gesture-stale'); }
    this.closed = true;
    const changes = this.previewValue.changes.filter(change => !sameTransform(change.before, change.after));
    return changes.length ? freeze({ type: 'transform', binding: this.view.binding!, changes }) : null;
  }
  cancel(): void { this.closed = true; this.previewValue = freeze({ binding: this.view.binding!, changes: [] }); }
}
function sameTransform(left: AuthoringTransform, right: AuthoringTransform): boolean { return (['position','rotationDegrees','scale'] as const).every(key => left[key].every((value,index) => Math.abs(value-right[key][index]!) < 1e-9)); }
