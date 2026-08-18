import type { Entity, Mesh3D, World } from '@haiyue/engine';
import { getSpatialIndexService, type MeshSpatialEntry } from '@haiyue/engine/experimental';

export interface EditorMeshSpatialEntry {
  readonly entity: Entity;
  readonly mesh: Mesh3D;
  readonly worldMatrix: Float32Array;
}

/** Keeps the experimental spatial service behind the editor's engine-adapter boundary. */
export function queryEditorMeshRayCandidates(
  world: World,
  origin: Float32Array,
  direction: Float32Array,
  out: EditorMeshSpatialEntry[],
): EditorMeshSpatialEntry[] {
  const spatial = getSpatialIndexService(world).syncMeshIndex();
  spatial.queryRay(origin, direction, Number.POSITIVE_INFINITY, out as MeshSpatialEntry[]);
  return out;
}
