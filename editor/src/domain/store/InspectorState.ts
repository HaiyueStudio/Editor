import type { InspectorContext, SphericalTransformSnapshot, Transform2DSnapshot, TransformSnapshot } from '../../types';
import type { CartesianTransform3D, Entity } from '@haiyue/engine';

export interface InspectorMultiTransformEditRecord {
  readonly entity: Entity;
  readonly transform: CartesianTransform3D;
  readonly before: TransformSnapshot;
}

export interface InspectorCommitSnapshot {
  nameEditStartValue: string | null;
  transformEditStartValue: TransformSnapshot | null;
  multiTransformEditStartValue: InspectorMultiTransformEditRecord[] | null;
  sphericalTransformEditStartValue: SphericalTransformSnapshot | null;
  transform2DEditStartValue: Transform2DSnapshot | null;
}

export interface InspectorStateSnapshot extends InspectorCommitSnapshot {
  readonly context: InspectorContext | null;
  readonly selectedComponentName: string;
}

export class InspectorState {
  private _context: InspectorContext | null = null;
  private _selectedComponentName = '';
  readonly commit: InspectorCommitSnapshot = {
    nameEditStartValue: null,
    transformEditStartValue: null,
    multiTransformEditStartValue: null,
    sphericalTransformEditStartValue: null,
    transform2DEditStartValue: null,
  };

  constructor(private readonly _changed: (snapshot: InspectorStateSnapshot) => void) {}

  snapshot(): InspectorStateSnapshot {
    return Object.freeze({
      context: this._context,
      selectedComponentName: this._selectedComponentName,
      ...this.commit,
    });
  }

  setContext(context: InspectorContext | null): void {
    if (context === this._context) return;
    this._context = context;
    this._changed(this.snapshot());
  }

  setSelectedComponentName(name: string): void {
    if (name === this._selectedComponentName) return;
    this._selectedComponentName = name;
    this._changed(this.snapshot());
  }

  clear(): void {
    this._context = null;
    this._selectedComponentName = '';
    this.commit.nameEditStartValue = null;
    this.commit.transformEditStartValue = null;
    this.commit.multiTransformEditStartValue = null;
    this.commit.sphericalTransformEditStartValue = null;
    this.commit.transform2DEditStartValue = null;
    this._changed(this.snapshot());
  }

  restore(snapshot: InspectorStateSnapshot): void {
    this._context = snapshot.context;
    this._selectedComponentName = snapshot.selectedComponentName;
    this.commit.nameEditStartValue = snapshot.nameEditStartValue;
    this.commit.transformEditStartValue = snapshot.transformEditStartValue;
    this.commit.multiTransformEditStartValue = snapshot.multiTransformEditStartValue;
    this.commit.sphericalTransformEditStartValue = snapshot.sphericalTransformEditStartValue;
    this.commit.transform2DEditStartValue = snapshot.transform2DEditStartValue;
  }
}
