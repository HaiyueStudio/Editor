import type {
  PackedVoxelKey,
  VoxelDocumentChangeDetail,
  VoxelDocumentChangeImpact,
  VoxelDocumentDirtyFlags,
} from '../model';

export interface VoxelDocumentTransaction {
  readonly active: boolean;
  commit(): void;
  cancel(): void;
}

export interface PendingVoxelDocumentChange {
  reason: VoxelDocumentChangeDetail['reason'];
  dirty: VoxelDocumentDirtyFlags;
  voxelKeys: Set<PackedVoxelKey>;
  instanceIds: Set<string>;
  materialIds: Set<string>;
  fullRender: boolean;
}

type DispatchChange = (detail: Readonly<VoxelDocumentChangeDetail>) => void;

interface TransactionFrame {
  change: PendingVoxelDocumentChange | null;
  dispatch: DispatchChange;
}

/** Owns nesting, coalescing and idempotent close semantics for document transactions. */
export class VoxelTransactionCoordinator {
  private readonly _frames: TransactionFrame[] = [];

  begin(dispatch: DispatchChange): VoxelDocumentTransaction {
    const frame: TransactionFrame = { change: null, dispatch };
    this._frames.push(frame);
    let active = true;
    const close = (commit: boolean): void => {
      if (!active) return;
      if (this._frames.at(-1) !== frame) {
        throw new Error('Voxel document transactions must close in reverse order.');
      }
      active = false;
      this._frames.pop();
      if (!commit || !frame.change) return;
      const parent = this._frames.at(-1);
      if (parent) {
        if (parent.change) mergePendingChange(parent.change, frame.change);
        else parent.change = frame.change;
      } else {
        frame.dispatch(detailFromPending(frame.change));
      }
    };
    return {
      get active() { return active; },
      commit: () => close(true),
      cancel: () => close(false),
    };
  }

  transact<T>(operation: () => T, dispatch: DispatchChange): T {
    const transaction = this.begin(dispatch);
    try {
      const result = operation();
      transaction.commit();
      return result;
    } catch (error) {
      transaction.cancel();
      throw error;
    }
  }

  publish(detail: Readonly<VoxelDocumentChangeDetail>, dispatch: DispatchChange): void {
    const frame = this._frames.at(-1);
    if (!frame) {
      dispatch(detail);
    } else if (frame.change) {
      mergePendingChange(frame.change, detail);
    } else {
      frame.change = pendingChange(detail);
    }
  }
}

export function pendingChange(detail: Readonly<VoxelDocumentChangeDetail>): PendingVoxelDocumentChange {
  return {
    reason: detail.reason,
    dirty: { ...detail.dirty },
    voxelKeys: new Set(detail.impact.voxelKeys),
    instanceIds: new Set(detail.impact.instanceIds),
    materialIds: new Set(detail.impact.materialIds),
    fullRender: detail.impact.fullRender,
  };
}

export function mergePendingChange(
  target: PendingVoxelDocumentChange,
  source: Readonly<VoxelDocumentChangeDetail> | PendingVoxelDocumentChange,
): void {
  target.reason = source.reason;
  target.dirty.scene ||= source.dirty.scene;
  target.dirty.view ||= source.dirty.view;
  target.dirty.render ||= source.dirty.render;
  target.dirty.palette ||= source.dirty.palette;
  target.dirty.modules ||= source.dirty.modules;
  target.dirty.animation ||= source.dirty.animation;
  target.dirty.grid ||= source.dirty.grid;
  target.dirty.selection = mergeSelectionDirty(target.dirty.selection, source.dirty.selection);
  const impact: Readonly<VoxelDocumentChangeImpact> | PendingVoxelDocumentChange = 'impact' in source
    ? source.impact
    : source;
  target.fullRender ||= impact.fullRender;
  for (const key of impact.voxelKeys) target.voxelKeys.add(key);
  for (const id of impact.instanceIds) target.instanceIds.add(id);
  for (const id of impact.materialIds) target.materialIds.add(id);
}

export function detailFromPending(change: PendingVoxelDocumentChange): VoxelDocumentChangeDetail {
  return {
    reason: change.reason,
    dirty: Object.freeze({ ...change.dirty }),
    impact: Object.freeze({
      fullRender: change.fullRender,
      voxelKeys: Object.freeze([...change.voxelKeys]),
      instanceIds: Object.freeze([...change.instanceIds]),
      materialIds: Object.freeze([...change.materialIds]),
    }),
  };
}

function mergeSelectionDirty(
  left: VoxelDocumentDirtyFlags['selection'],
  right: VoxelDocumentDirtyFlags['selection'],
): VoxelDocumentDirtyFlags['selection'] {
  if (left === 'clear' || right === 'clear') return 'clear';
  if (left === 'retain' || right === 'retain') return 'retain';
  return 'none';
}
