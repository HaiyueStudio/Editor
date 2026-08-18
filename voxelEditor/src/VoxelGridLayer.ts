import { CartesianTransform3D, ColorSRGB, Entity, HaiyueEngine } from '@haiyue/engine';
import { Line3D } from '@haiyue/engine/components';
import { LineGeometry } from '@haiyue/engine/geometry';
import { LineMaterial } from '@haiyue/engine/material';
import type { SceneSize } from './model';
import type { ViewportSliceState } from './viewportSlice';

type GridLineLevel = 'minor' | 'medium' | 'major';

/** Owns the editor floor-grid entities and their 1/5/10-unit visual hierarchy. */
export class VoxelGridLayer {
  private readonly _scene: ReturnType<HaiyueEngine['createScene']>;
  private readonly _geometries = new Map<GridLineLevel, LineGeometry>();
  private readonly _workPlaneGeometries = new Map<GridLineLevel, LineGeometry>();

  constructor(scene: ReturnType<HaiyueEngine['createScene']>) {
    this._scene = scene;
    for (const level of ['minor', 'medium', 'major'] as const) {
      const geometry = new LineGeometry([], { topology: 'segments' });
      const entity = new Entity(level === 'major' ? 'Major Grid Lines' : level === 'medium' ? 'Medium Grid Lines' : 'Grid Lines');
      entity.addComponent(new CartesianTransform3D({ position: [0, 0, 0] }));
      entity.addComponent(new Line3D(geometry, gridMaterial(level)));
      this._scene.world.addEntity(entity);
      this._geometries.set(level, geometry);

      const workGeometry = new LineGeometry([], { topology: 'segments' });
      const workEntity = new Entity(`Work Plane ${level}`);
      workEntity.addComponent(new CartesianTransform3D({ position: [0, 0, 0] }));
      workEntity.addComponent(new Line3D(workGeometry, workPlaneMaterial(level)));
      this._scene.world.addEntity(workEntity);
      this._workPlaneGeometries.set(level, workGeometry);
    }
  }

  rebuild(size: Readonly<SceneSize>, slice: Readonly<ViewportSliceState> | null = null): void {
    const points: Record<GridLineLevel, number[]> = { minor: [], medium: [], major: [] };
    for (let x = 0; x <= size.x; x += 1) {
      points[lineLevel(x)].push(x - size.x / 2, 0, -size.z / 2, x - size.x / 2, 0, size.z / 2);
    }
    for (let z = 0; z <= size.z; z += 1) {
      points[lineLevel(z)].push(-size.x / 2, 0, z - size.z / 2, size.x / 2, 0, z - size.z / 2);
    }
    for (const level of ['minor', 'medium', 'major'] as const) this._geometries.get(level)!.setPoints(points[level]);
    this._rebuildWorkPlane(size, slice?.workPlaneEnabled ? slice : null);
  }

  private _rebuildWorkPlane(size: Readonly<SceneSize>, slice: Readonly<ViewportSliceState> | null): void {
    const points: Record<GridLineLevel, number[]> = { minor: [], medium: [], major: [] };
    if (slice) {
      const offset = 0.008;
      if (slice.axis === 'y') {
        const y = slice.index + offset;
        for (let x = 0; x <= size.x; x += 1) {
          points[lineLevel(x)].push(x - size.x / 2, y, -size.z / 2, x - size.x / 2, y, size.z / 2);
        }
        for (let z = 0; z <= size.z; z += 1) {
          points[lineLevel(z)].push(-size.x / 2, y, z - size.z / 2, size.x / 2, y, z - size.z / 2);
        }
      } else if (slice.axis === 'x') {
        const x = slice.index - size.x / 2 + offset;
        for (let y = 0; y <= size.y; y += 1) {
          points[lineLevel(y)].push(x, y, -size.z / 2, x, y, size.z / 2);
        }
        for (let z = 0; z <= size.z; z += 1) {
          points[lineLevel(z)].push(x, 0, z - size.z / 2, x, size.y, z - size.z / 2);
        }
      } else {
        const z = slice.index - size.z / 2 + offset;
        for (let x = 0; x <= size.x; x += 1) {
          points[lineLevel(x)].push(x - size.x / 2, 0, z, x - size.x / 2, size.y, z);
        }
        for (let y = 0; y <= size.y; y += 1) {
          points[lineLevel(y)].push(-size.x / 2, y, z, size.x / 2, y, z);
        }
      }
    }
    for (const level of ['minor', 'medium', 'major'] as const) {
      this._workPlaneGeometries.get(level)!.setPoints(points[level]);
    }
  }
}

function gridMaterial(level: GridLineLevel): LineMaterial {
  const color = level === 'major'
    ? new ColorSRGB(0.5, 0.61, 0.75, 0.96)
    : level === 'medium'
      ? new ColorSRGB(0.39, 0.48, 0.6, 0.86)
      : new ColorSRGB(0.19, 0.24, 0.31, 0.72);
  return new LineMaterial({
    color,
    width: level === 'major' ? 2.1 : level === 'medium' ? 1.5 : 1,
    screenSpace: true,
    cap: 'butt',
  });
}

function workPlaneMaterial(level: GridLineLevel): LineMaterial {
  const color = level === 'major'
    ? new ColorSRGB(0.18, 0.9, 0.92, 1)
    : level === 'medium'
      ? new ColorSRGB(0.15, 0.67, 0.76, 0.94)
      : new ColorSRGB(0.12, 0.42, 0.51, 0.75);
  return new LineMaterial({
    color,
    width: level === 'major' ? 2.3 : level === 'medium' ? 1.65 : 1.05,
    screenSpace: true,
    cap: 'butt',
  });
}

function lineLevel(coordinate: number): GridLineLevel {
  if (coordinate % 10 === 0) return 'major';
  return coordinate % 5 === 0 ? 'medium' : 'minor';
}
