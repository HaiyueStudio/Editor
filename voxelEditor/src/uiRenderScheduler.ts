import type { PackedVoxelKey, VoxelDocumentChangeImpact, VoxelDocumentDirtyFlags } from './model';

type FrameRequest = (callback: FrameRequestCallback) => number;
export interface VoxelRenderInvalidation {
  fullRender: boolean;
  voxelKeys: ReadonlySet<PackedVoxelKey>;
  instanceIds: ReadonlySet<string>;
  materialIds: ReadonlySet<string>;
}

type Commit = (dirty: Readonly<VoxelDocumentDirtyFlags>, invalidation: Readonly<VoxelRenderInvalidation>) => void;

function emptyDirtyFlags(): VoxelDocumentDirtyFlags {
  return {
    scene: false,
    view: false,
    render: false,
    palette: false,
    modules: false,
    animation: false,
    grid: false,
    selection: 'none',
  };
}

/** Coalesces document invalidations into one UI/render commit per animation frame. */
export class UiRenderScheduler {
  private _pending = emptyDirtyFlags();
  private _fullRender = false;
  private readonly _voxelKeys = new Set<PackedVoxelKey>();
  private readonly _instanceIds = new Set<string>();
  private readonly _materialIds = new Set<string>();
  private _frameId: number | null = null;

  constructor(
    private readonly _commit: Commit,
    private readonly _requestFrame: FrameRequest = callback => requestAnimationFrame(callback),
  ) {}

  schedule(source: Readonly<VoxelDocumentDirtyFlags>, impact?: Readonly<VoxelDocumentChangeImpact>): void {
    const pending = this._pending;
    pending.scene ||= source.scene;
    pending.view ||= source.view;
    pending.render ||= source.render;
    pending.palette ||= source.palette;
    pending.modules ||= source.modules;
    pending.animation ||= source.animation;
    pending.grid ||= source.grid;
    if (source.selection === 'clear' || (source.selection === 'retain' && pending.selection === 'none')) {
      pending.selection = source.selection;
    }
    if (impact) {
      this._fullRender ||= impact.fullRender;
      for (const key of impact.voxelKeys) this._voxelKeys.add(key);
      for (const id of impact.instanceIds) this._instanceIds.add(id);
      for (const id of impact.materialIds) this._materialIds.add(id);
    } else if (source.render) this._fullRender = true;
    this._requestCommit();
  }

  requestRender(): void {
    this._pending.render = true;
    this._fullRender = true;
    this._requestCommit();
  }

  private _requestCommit(): void {
    if (this._frameId !== null) return;
    this._frameId = this._requestFrame(() => this._flush());
  }

  private _flush(): void {
    this._frameId = null;
    const dirty = this._pending;
    this._pending = emptyDirtyFlags();
    const invalidation: VoxelRenderInvalidation = {
      fullRender: this._fullRender,
      voxelKeys: new Set(this._voxelKeys),
      instanceIds: new Set(this._instanceIds),
      materialIds: new Set(this._materialIds),
    };
    this._fullRender = false;
    this._voxelKeys.clear();
    this._instanceIds.clear();
    this._materialIds.clear();
    this._commit(dirty, invalidation);
  }
}
