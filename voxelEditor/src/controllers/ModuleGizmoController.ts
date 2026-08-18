import {
  AnimationKeyframeCommand,
  ModuleInstanceTransformCommand,
  type CommandHistory,
} from '../commands';
import type {
  VoxelAnimationKeyframe,
  VoxelDocument,
  VoxelModuleInstance,
} from '../model';
import type { ModuleGizmoAxis, VoxelRenderer } from '../VoxelRenderer';
import type { VoxelDocumentTransaction } from '../document/VoxelTransaction';

interface ActiveGizmoDrag {
  transaction: VoxelDocumentTransaction;
  axis: ModuleGizmoAxis;
  mode: 'move' | 'scale';
  startX: number;
  startY: number;
  steps: number;
  before: VoxelModuleInstance;
  animationId: string | null;
  beforeKeyframe: VoxelAnimationKeyframe | null;
}

export interface ModuleGizmoControllerOptions {
  readonly document: VoxelDocument;
  readonly history: CommandHistory;
  readonly getRenderer: () => VoxelRenderer | null;
  readonly getSelectedInstanceId: () => string | null;
  readonly getMode: () => 'move' | 'rotate' | 'scale';
  readonly getEditableSelectedInstance: () => VoxelModuleInstance;
  readonly executeInstanceTransform: (after: VoxelModuleInstance, label: string) => void;
}

/** Owns the pointer-drag transaction for module-instance gizmos. */
export class ModuleGizmoController {
  private _drag: ActiveGizmoDrag | null = null;

  constructor(private readonly _options: ModuleGizmoControllerOptions) {}

  get active(): boolean { return this._drag !== null; }

  begin(event: PointerEvent): boolean {
    const { document } = this._options;
    const renderer = this._options.getRenderer();
    if (!renderer || !this._options.getSelectedInstanceId() || document.isEditingModule) return false;
    const axis = renderer.pickModuleGizmo(event.clientX, event.clientY);
    if (!axis) return false;
    const before = this._options.getEditableSelectedInstance();
    const mode = this._options.getMode();
    if (mode === 'rotate') {
      const after: VoxelModuleInstance = {
        ...before,
        position: { ...before.position },
        rotation: { ...before.rotation, [axis]: before.rotation[axis] + 1 },
        scale: { ...before.scale },
      };
      this._options.executeInstanceTransform(after, `绕 ${axis.toUpperCase()} 轴旋转模块实例`);
      return true;
    }
    this._drag = {
      transaction: document.beginTransaction(),
      axis,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      steps: 0,
      before,
      animationId: document.activeAnimationId,
      beforeKeyframe: document.activeAnimationId
        ? document.getAnimationKeyframe(document.activeAnimationId, before.id, document.animationFrame)
        : null,
    };
    return true;
  }

  move(event: PointerEvent): void {
    const renderer = this._options.getRenderer();
    const drag = this._drag;
    if (!renderer || !drag) return;
    try {
      const steps = renderer.moduleGizmoDragSteps(
        drag.axis,
        drag.startX,
        drag.startY,
        event.clientX,
        event.clientY,
      );
      if (steps === drag.steps) return;
      drag.steps = steps;
      const before = drag.before;
      const document = this._options.document;
      if (drag.animationId) {
        const next = drag.mode === 'move'
          ? { ...before, position: { ...before.position, [drag.axis]: before.position[drag.axis] + steps } }
          : { ...before, scale: { ...before.scale, [drag.axis]: before.scale[drag.axis] + steps } };
        document.setAnimationKeyframe(drag.animationId, before.id, document.animationFrame, next);
        this._refreshDraggedInstance(before.id);
        return;
      }
      if (drag.mode === 'move') {
        document.updateModuleInstance(before.id, {
          position: { ...before.position, [drag.axis]: before.position[drag.axis] + steps },
        });
      } else {
        document.updateModuleInstance(before.id, {
          scale: { ...before.scale, [drag.axis]: before.scale[drag.axis] + steps },
        });
      }
      this._refreshDraggedInstance(before.id);
    } catch (error) {
      this.finish(true);
      throw error;
    }
  }

  finish(cancel = false): boolean {
    const drag = this._drag;
    if (!drag) return false;
    this._drag = null;
    const document = this._options.document;
    try {
      const current = drag.animationId
        ? document.getEvaluatedModuleInstance(drag.before.id)
        : document.getModuleInstance(drag.before.id);
      if (!current) {
        drag.transaction.commit();
        return true;
      }
      if (drag.animationId) {
        if (cancel) {
          document.applyAnimationKeyframeSnapshot(
            drag.animationId,
            drag.before.id,
            document.animationFrame,
            drag.beforeKeyframe,
          );
          this._refreshDraggedInstance(drag.before.id);
          drag.transaction.cancel();
        } else if (drag.steps !== 0) {
          this._options.history.recordApplied(new AnimationKeyframeCommand(
            document,
            drag.animationId,
            drag.before.id,
            document.animationFrame,
            current,
            drag.mode === 'move' ? 'Gizmo 移动动画关键帧' : 'Gizmo 缩放动画关键帧',
            { before: drag.beforeKeyframe, alreadyApplied: true },
          ));
          drag.transaction.commit();
        } else {
          drag.transaction.cancel();
        }
        return true;
      }
      if (cancel) {
        document.updateModuleInstance(drag.before.id, {
          position: drag.before.position,
          rotation: drag.before.rotation,
          scale: drag.before.scale,
          layerId: drag.before.layerId,
        });
        this._refreshDraggedInstance(drag.before.id);
        drag.transaction.cancel();
      } else if (drag.steps !== 0) {
        this._options.history.recordApplied(new ModuleInstanceTransformCommand(
          document,
          drag.before,
          current,
          drag.mode === 'move' ? 'Gizmo 移动模块实例' : 'Gizmo 缩放模块实例',
        ));
        drag.transaction.commit();
      } else {
        drag.transaction.cancel();
      }
      return true;
    } finally {
      if (drag.transaction.active) drag.transaction.cancel();
    }
  }

  private _refreshDraggedInstance(instanceId: string): void {
    this._options.getRenderer()?.refreshVoxels?.({
      fullRender: false,
      voxelKeys: new Set(),
      instanceIds: new Set([instanceId]),
      materialIds: new Set(),
    });
  }
}
