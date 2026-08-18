import type { GETree } from '@haiyue/ui';
import { Camera2D, Camera3D, Entity, Mesh2D, Mesh3D, Transform2D, HaiyueEngine, World } from '@haiyue/engine';
import { MeshHelper, Transform3D } from '@haiyue/engine/components';
import { Ray, type RayHit } from '@haiyue/engine/math';
import { type BoxSelectionMode, type BoxSelectionRect } from '@haiyue/engine/controls';
import { queryEditorMeshRayCandidates, type EditorMeshSpatialEntry } from '../../engine-adapter/EditorSpatialIndexAdapter';
import { mat4 } from 'wgpu-matrix';
import type { PickHit } from '../../types';
import { requiredNumberAt } from '../../utils/arrayAccess';

export type ViewportSelectionTarget = '3d' | '2d' | 'all';

const selectionHelperPools = new WeakMap<HTMLElement, HTMLElement[]>();
const pickRay = new Ray();
const pickCandidates: EditorMeshSpatialEntry[] = [];
const pickMeshHit: RayHit = {
  distance: Number.POSITIVE_INFINITY,
  point: new Float32Array(3),
  normal: new Float32Array(3),
};
const pickCameraPosition = new Float32Array(3);

export function updateWorldMatrix(entity: Entity): void {
  const transform = entity.getComponent(Transform3D);
  if (!transform) return;

  const parent = entity.parent as Entity | null;
  if (parent) {
    const parentTransform = parent.getComponent(Transform3D);
    if (parentTransform) {
      updateWorldMatrix(parent);
      transform.updateWorldMatrix(parentTransform.worldMatrix);
      return;
    }
  }
  transform.updateWorldMatrix();
}

export function updateWorldMatrix2D(entity: Entity): Float32Array {
  const transform = entity.getComponent(Transform2D);
  if (!transform) return mat4.identity() as Float32Array;
  const parent = entity.parent as Entity | null;
  const parentMatrix = parent ? updateWorldMatrix2D(parent) : undefined;
  transform.updateWorldMatrix(parentMatrix);
  return transform.worldMatrix;
}

export function isEntityDisabledInHierarchy(entity: Entity): boolean {
  let current: Entity | null = entity;
  while (current) {
    if (current.disabled) return true;
    current = current.parent as Entity | null;
  }
  return false;
}

export function markSelectedEntities3D(entities: Entity[], treeElement: GETree | null, previousSelected: Set<Entity>): void {
  const nextSelection = new Set(entities);

  for (const entity of previousSelected) {
    if (!nextSelection.has(entity)) entity.removeComponent(MeshHelper);
  }

  for (const entity of nextSelection) {
    if (entity.getComponent(Mesh3D)) {
      entity.addComponent(new MeshHelper({ mode: 'aabb', color: [0.25, 0.75, 1, 1] }));
    }
  }

  if (treeElement) {
    treeElement.selectedIds = entities.map(entity => String(entity.id));
  }
}

export function update2DSelectionHelpers(
  layer: HTMLElement | null,
  selection: Set<Entity>,
  cameraEntity: Entity | null,
  engine?: HaiyueEngine,
): void {
  if (!layer) return;
  if (!engine || !cameraEntity) {
    hideSelectionHelperPool(layer);
    return;
  }

  const viewProjection = getCamera2DViewProjection(cameraEntity, engine);
  const canvas = engine.canvas;
  if (!canvas) {
    hideSelectionHelperPool(layer);
    return;
  }
  const rect = canvas.getBoundingClientRect();
  if (!viewProjection || rect.width <= 0 || rect.height <= 0) {
    hideSelectionHelperPool(layer);
    return;
  }

  let usedHelperCount = 0;
  for (const entity of selection) {
    const mesh = entity.getComponent(Mesh2D);
    if (!mesh || isEntityDisabledInHierarchy(entity)) continue;
    const worldMatrix = updateWorldMatrix2D(entity);
    const bounds = getPointsBounds(getMesh2DScreenPoints(mesh, worldMatrix, viewProjection, rect));
    if (!bounds || bounds.width < 0 || bounds.height < 0) continue;

    const helper = getSelectionHelper(layer, usedHelperCount++);
    helper.style.left = `${Math.round(bounds.x)}px`;
    helper.style.top = `${Math.round(bounds.y)}px`;
    helper.style.width = `${Math.max(2, Math.round(bounds.width))}px`;
    helper.style.height = `${Math.max(2, Math.round(bounds.height))}px`;
  }
  hideSelectionHelperPool(layer, usedHelperCount);
}

function getSelectionHelper(layer: HTMLElement, index: number): HTMLElement {
  let pool = selectionHelperPools.get(layer);
  if (!pool) {
    pool = [];
    selectionHelperPools.set(layer, pool);
  }
  let helper = pool[index];
  if (!helper) {
    helper = document.createElement('div');
    helper.className = 'selection-helper-2d';
    pool[index] = helper;
  }
  if (helper.parentElement !== layer) layer.append(helper);
  helper.hidden = false;
  return helper;
}

function hideSelectionHelperPool(layer: HTMLElement, startIndex = 0): void {
  const pool = selectionHelperPools.get(layer);
  if (!pool) return;
  for (let i = startIndex; i < pool.length; i += 1) {
    const helper = pool[i];
    if (helper) helper.hidden = true;
  }
}

function getCamera2DViewProjection(cameraEntity: Entity | null, engine: HaiyueEngine): Float32Array | null {
  if (!cameraEntity) return null;
  const camera = cameraEntity.getComponent(Camera2D);
  if (!camera) return null;
  camera.resize(engine.displayWidth, engine.displayHeight);
  const transform = cameraEntity.getComponent(Transform3D);
  if (!transform) return camera.projectionMatrix;
  updateWorldMatrix(cameraEntity);
  const viewMatrix = mat4.inverse(transform.worldMatrix) as Float32Array;
  return mat4.multiply(camera.projectionMatrix, viewMatrix) as Float32Array;
}

function transformPoint2D(matrix: Float32Array, x: number, y: number): [number, number] {
  return [
    requiredNumberAt(matrix, 0, '2D transform matrix') * x
      + requiredNumberAt(matrix, 4, '2D transform matrix') * y
      + requiredNumberAt(matrix, 12, '2D transform matrix'),
    requiredNumberAt(matrix, 1, '2D transform matrix') * x
      + requiredNumberAt(matrix, 5, '2D transform matrix') * y
      + requiredNumberAt(matrix, 13, '2D transform matrix'),
  ];
}

function transformPoint4(matrix: Float32Array, x: number, y: number, z: number, w = 1): [number, number, number, number] {
  return [
    requiredNumberAt(matrix, 0, '4D transform matrix') * x
      + requiredNumberAt(matrix, 4, '4D transform matrix') * y
      + requiredNumberAt(matrix, 8, '4D transform matrix') * z
      + requiredNumberAt(matrix, 12, '4D transform matrix') * w,
    requiredNumberAt(matrix, 1, '4D transform matrix') * x
      + requiredNumberAt(matrix, 5, '4D transform matrix') * y
      + requiredNumberAt(matrix, 9, '4D transform matrix') * z
      + requiredNumberAt(matrix, 13, '4D transform matrix') * w,
    requiredNumberAt(matrix, 2, '4D transform matrix') * x
      + requiredNumberAt(matrix, 6, '4D transform matrix') * y
      + requiredNumberAt(matrix, 10, '4D transform matrix') * z
      + requiredNumberAt(matrix, 14, '4D transform matrix') * w,
    requiredNumberAt(matrix, 3, '4D transform matrix') * x
      + requiredNumberAt(matrix, 7, '4D transform matrix') * y
      + requiredNumberAt(matrix, 11, '4D transform matrix') * z
      + requiredNumberAt(matrix, 15, '4D transform matrix') * w,
  ];
}

function project2DPointToCanvas(
  x: number,
  y: number,
  worldMatrix: Float32Array,
  viewProjection: Float32Array,
  rect: DOMRect,
): [number, number] | null {
  const [wx, wy] = transformPoint2D(worldMatrix, x, y);
  const [cx, cy, , cw] = transformPoint4(viewProjection, wx, wy, 0, 1);
  if (Math.abs(cw) < 1e-6) return null;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  return [
    (ndcX * 0.5 + 0.5) * rect.width,
    (0.5 - ndcY * 0.5) * rect.height,
  ];
}

function pointInTriangle2D(
  px: number,
  py: number,
  a: [number, number],
  b: [number, number],
  c: [number, number],
): boolean {
  const v0x = c[0] - a[0];
  const v0y = c[1] - a[1];
  const v1x = b[0] - a[0];
  const v1y = b[1] - a[1];
  const v2x = px - a[0];
  const v2y = py - a[1];
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-6) return false;
  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function pointSegmentDistance2D(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-6) return Math.hypot(px - a[0], py - a[1]);
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}

function getMesh2DScreenPoints(
  mesh: Mesh2D,
  worldMatrix: Float32Array,
  viewProjection: Float32Array,
  rect: DOMRect,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i + 1 < mesh.geometry.positions.length; i += 2) {
    const point = project2DPointToCanvas(
      requiredNumberAt(mesh.geometry.positions, i, '2D mesh positions'),
      requiredNumberAt(mesh.geometry.positions, i + 1, '2D mesh positions'),
      worldMatrix,
      viewProjection,
      rect,
    );
    if (point) points.push(point);
  }
  return points;
}

export function pickEntity2D(
  world: World,
  cameraEntity: Entity | null,
  engine: HaiyueEngine,
  clientX: number,
  clientY: number,
): PickHit | null {
  const canvas = engine.canvas;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const viewProjection = getCamera2DViewProjection(cameraEntity, engine);
  if (!viewProjection || rect.width <= 0 || rect.height <= 0) return null;

  const px = clientX - rect.left;
  const py = clientY - rect.top;
  let closest: PickHit | null = null;
  let drawOrder = 0;
  for (const entity of world.entities.values()) {
    if (isEntityDisabledInHierarchy(entity)) continue;
    const mesh = entity.getComponent(Mesh2D);
    if (!mesh) continue;

    const worldMatrix = updateWorldMatrix2D(entity);
    const points = getMesh2DScreenPoints(mesh, worldMatrix, viewProjection, rect);
    if (points.length === 0) continue;
    const indices = mesh.geometry.indices ?? new Uint16Array(Array.from({ length: mesh.geometry.vertexCount }, (_, index) => index));
    const topology = mesh.geometry.topology ?? 'triangle-list';
    let hit = false;
    if (topology === 'point-list') {
      hit = indices.some(index => {
        const point = points[index];
        return point ? Math.hypot(px - point[0], py - point[1]) <= 6 : false;
      });
    } else if (topology === 'line-list' || topology === 'line-strip') {
      const step = topology === 'line-list' ? 2 : 1;
      for (let i = 0; i < indices.length - 1; i += step) {
        const firstIndex = indices[i];
        const secondIndex = indices[i + 1];
        const first = firstIndex === undefined ? undefined : points[firstIndex];
        const second = secondIndex === undefined ? undefined : points[secondIndex];
        if (first && second && pointSegmentDistance2D(px, py, first, second) <= 6) {
          hit = true;
          break;
        }
      }
    } else {
      for (let i = 0; i < indices.length - 2; i += 3) {
        const aIndex = indices[i];
        const bIndex = indices[i + 1];
        const cIndex = indices[i + 2];
        const a = aIndex === undefined ? undefined : points[aIndex];
        const b = bIndex === undefined ? undefined : points[bIndex];
        const c = cIndex === undefined ? undefined : points[cIndex];
        if (a && b && c && pointInTriangle2D(px, py, a, b, c)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) closest = { entity, distance: drawOrder, kind: '2d' };
    drawOrder++;
  }
  return closest;
}

export function pickEntity3D(
  world: World,
  cameraEntity: Entity,
  engine: HaiyueEngine,
  clientX: number,
  clientY: number,
): PickHit | null {
  const camera = cameraEntity.getComponent(Camera3D);
  if (!camera) return null;

  const canvas = engine.canvas;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;

  updateWorldMatrix(cameraEntity);
  const cameraTransform = cameraEntity.getComponent(Transform3D);
  if (!cameraTransform) return null;

  camera.updateAspect(engine.width / engine.height);
  const cameraWorldMatrix = cameraTransform.worldMatrix;
  pickCameraPosition[0] = requiredNumberAt(cameraWorldMatrix, 12, 'camera world matrix');
  pickCameraPosition[1] = requiredNumberAt(cameraWorldMatrix, 13, 'camera world matrix');
  pickCameraPosition[2] = requiredNumberAt(cameraWorldMatrix, 14, 'camera world matrix');
  const viewMatrix = mat4.inverse(cameraWorldMatrix) as Float32Array;
  const viewProjection = mat4.multiply(camera.projectionMatrix, viewMatrix) as Float32Array;
  const inverseViewProjection = mat4.inverse(viewProjection) as Float32Array;
  const ray = pickRay.setFromCamera(ndcX, ndcY, pickCameraPosition, inverseViewProjection);

  let closest: PickHit | null = null;
  const candidates = pickCandidates;
  candidates.length = 0;
  queryEditorMeshRayCandidates(world, ray.origin, ray.direction, candidates);
  for (const entry of candidates) {
    const entity = entry.entity;
    if (isEntityDisabledInHierarchy(entity)) continue;
    const hit = ray.intersectMesh(entry.mesh.geometry, entry.worldMatrix, undefined, pickMeshHit);
    if (hit && (!closest || hit.distance < closest.distance)) {
      closest = { entity, distance: hit.distance, kind: '3d' };
    }
  }
  candidates.length = 0;

  return closest;
}

export function pickEntity(
  world: World,
  camera3DEntity: Entity,
  camera2DEntity: Entity | null,
  engine: HaiyueEngine,
  clientX: number,
  clientY: number,
  target: ViewportSelectionTarget,
): PickHit | null {
  const hit2D = target !== '3d' ? pickEntity2D(world, camera2DEntity, engine, clientX, clientY) : null;
  if (target === '2d') return hit2D;
  if (hit2D && target === 'all') return hit2D;
  return pickEntity3D(world, camera3DEntity, engine, clientX, clientY);
}

function rectContainsPoint(rect: BoxSelectionRect, point: [number, number]): boolean {
  return point[0] >= rect.x &&
    point[0] <= rect.x + rect.width &&
    point[1] >= rect.y &&
    point[1] <= rect.y + rect.height;
}

function rectsIntersect(a: BoxSelectionRect, b: BoxSelectionRect): boolean {
  return a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y;
}

function getPointsBounds(points: Array<[number, number]>): BoxSelectionRect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function getBoxSelected2DEntities(
  world: World,
  cameraEntity: Entity | null,
  engine: HaiyueEngine,
  rect: BoxSelectionRect,
  selectionMode: BoxSelectionMode,
): Entity[] {
  const viewProjection = getCamera2DViewProjection(cameraEntity, engine);
  const canvas = engine.canvas;
  if (!canvas) return [];
  const canvasRect = canvas.getBoundingClientRect();
  if (!viewProjection || canvasRect.width <= 0 || canvasRect.height <= 0) return [];

  const selected: Entity[] = [];
  for (const entity of world.entities.values()) {
    if (isEntityDisabledInHierarchy(entity)) continue;
    const mesh = entity.getComponent(Mesh2D);
    if (!mesh) continue;

    const worldMatrix = updateWorldMatrix2D(entity);
    const points = getMesh2DScreenPoints(mesh, worldMatrix, viewProjection, canvasRect);
    const bounds = getPointsBounds(points);
    if (!bounds) continue;

    if (selectionMode === 'center') {
      const center: [number, number] = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
      if (rectContainsPoint(rect, center)) selected.push(entity);
    } else if (selectionMode === 'all') {
      if (points.every(point => rectContainsPoint(rect, point))) selected.push(entity);
    } else if (rectsIntersect(rect, bounds)) {
      selected.push(entity);
    }
  }
  return selected;
}
