import { createReplaceVoxelsCommand, type CommandHistory } from '../commands';
import type { RenderableVoxel, Voxel, VoxelDocument } from '../model';
import { VoxelSelection, type SelectionApplyMode } from '../selection';
import {
  createVoxelClipboard,
  flipVoxels,
  pasteVoxelClipboard,
  rotateVoxels90,
  rotateVoxels90AroundPivot,
  translateVoxels,
  type TransformAxis,
  type VoxelClipboard,
} from '../selectionTransform';
import type { VoxelRenderer } from '../VoxelRenderer';

export interface VoxelSelectionActionElements {
  readonly selectAll: HTMLElement;
  readonly invert: HTMLElement;
  readonly clear: HTMLElement;
  readonly move: HTMLElement;
  readonly duplicate: HTMLElement;
  readonly copy: HTMLElement;
  readonly cut: HTMLElement;
  readonly paste: HTMLElement;
  readonly delete: HTMLElement;
  readonly rotateButtons: readonly HTMLButtonElement[];
  readonly flipButtons: readonly HTMLButtonElement[];
}

export interface VoxelSelectionControllerOptions {
  readonly document: VoxelDocument;
  readonly history: CommandHistory;
  readonly selection: VoxelSelection;
  readonly countElement: HTMLElement;
  readonly getRenderer: () => VoxelRenderer | null;
  readonly getOffset: () => { x: number; y: number; z: number };
  readonly getPivot: () => { x: number; y: number; z: number } | null;
  readonly syncTransform: () => boolean;
  readonly syncViewportCount: (count: number) => void;
  readonly requestRender: () => void;
  readonly notify: (message: string, error?: boolean) => void;
}

/**
 * Owns voxel selection semantics, clipboard state, transform commands, and
 * selection toolbar bindings. Pointer interpretation remains in the viewport
 * input controller.
 */
export class VoxelSelectionController {
  private _clipboard: VoxelClipboard | null = null;

  constructor(private readonly _options: VoxelSelectionControllerOptions) {}

  get count(): number { return this._options.selection.count; }
  get keys(): ReadonlySet<string> { return this._options.selection.keys; }

  bindActions(elements: VoxelSelectionActionElements): void {
    elements.selectAll.addEventListener('click', () => this.selectAll());
    elements.invert.addEventListener('click', () => this.invert());
    elements.clear.addEventListener('click', () => this.clear());
    elements.move.addEventListener('click', () => this.run(() => this.move()));
    elements.duplicate.addEventListener('click', () => this.run(() => this.duplicate()));
    for (const button of elements.rotateButtons) {
      button.addEventListener('click', () => this.run(() =>
        this.rotate(button.dataset.selectionRotate as TransformAxis)));
    }
    for (const button of elements.flipButtons) {
      button.addEventListener('click', () => this.run(() =>
        this.flip(button.dataset.selectionFlip as TransformAxis)));
    }
    elements.copy.addEventListener('click', () => this.run(() => this.copy()));
    elements.cut.addEventListener('click', () => this.run(() => this.cut()));
    elements.paste.addEventListener('click', () => this.run(() => this.paste()));
    elements.delete.addEventListener('click', () => this.run(() => this.delete()));
  }

  sync(queueRender = true): boolean {
    const { selection } = this._options;
    this._options.countElement.textContent = selection.count.toLocaleString();
    this._options.syncViewportCount(selection.count);
    const changed = this._options.getRenderer()?.setSelection(selection.keys) ?? false;
    const transformChanged = this._options.syncTransform();
    if ((changed || transformChanged) && queueRender) this._options.requestRender();
    return changed || transformChanged;
  }

  viewVoxels(): RenderableVoxel[] {
    const voxels: RenderableVoxel[] = [];
    for (const key of this.keys) {
      const voxel = this._options.document.viewVoxels.get(key);
      if (voxel) voxels.push(voxel);
    }
    return voxels;
  }

  editableVoxels(): RenderableVoxel[] {
    const document = this._options.document;
    const selected = this.viewVoxels();
    if (selected.length === 0) throw new Error('请先选择体素。');
    if (!document.isEditingModule && selected.some(voxel => voxel.source === 'module-instance')) {
      throw new Error('模块实例中的体素不能在主场景中单独变换，请进入模块编辑模式。');
    }
    if (!document.isEditingModule && selected.some(voxel =>
      voxel.source === 'base' && !document.isBaseVoxelEditable(voxel))) {
      throw new Error('选择中包含隐藏或锁定图层的基础体素。');
    }
    return selected;
  }

  baseVoxels(): Voxel[] {
    const document = this._options.document;
    if (document.isEditingModule) return [];
    const result: Voxel[] = [];
    for (const key of this.keys) {
      const [x = 0, y = 0, z = 0] = key.split(',').map(Number);
      const voxel = document.getTargetVoxel(null, x, y, z);
      if (voxel) result.push({ ...voxel });
    }
    return result;
  }

  apply(voxels: Iterable<RenderableVoxel | Voxel>, mode: SelectionApplyMode = 'replace'): void {
    this._options.selection.apply(voxels, mode);
    this.sync();
  }

  clear(sync = true): boolean {
    const changed = this._options.selection.clear();
    if (changed && sync) this.sync();
    return changed;
  }

  retainCurrentView(): void {
    const view = this._options.document.viewVoxels;
    this._options.selection.retainWhere(key => view.has(key));
  }

  selectAll(): void {
    this._options.selection.selectAll(this._options.document.viewVoxels.values());
    this.sync();
  }

  invert(): void {
    this._options.selection.invert(this._options.document.viewVoxels.values());
    this.sync();
  }

  run(action: () => void): void {
    try {
      action();
    } catch (error) {
      this._options.notify(error instanceof Error ? error.message : String(error), true);
    }
  }

  move(): void {
    this.replace(translateVoxels(this.editableVoxels(), this._options.getOffset()), '移动选择');
  }

  duplicate(): void {
    this.replace(
      translateVoxels(this.editableVoxels(), this._options.getOffset()),
      '复制选择',
      false,
    );
  }

  rotate(axis: TransformAxis): void {
    const selected = this.editableVoxels();
    const pivot = this._options.getPivot();
    this.replace(
      pivot ? rotateVoxels90AroundPivot(selected, axis, pivot) : rotateVoxels90(selected, axis),
      `绕 ${axis.toUpperCase()} 轴旋转选择`,
    );
  }

  flip(axis: TransformAxis): void {
    this.replace(flipVoxels(this.editableVoxels(), axis), `沿 ${axis.toUpperCase()} 轴翻转选择`);
  }

  copy(): void {
    const clipboard = this.copySelected();
    this._options.notify(`已复制 ${clipboard.voxels.length.toLocaleString()} 个体素。`);
  }

  cut(): void {
    this.copySelected();
    this.delete('剪切选择');
  }

  paste(): void {
    if (!this._clipboard) throw new Error('剪贴板中没有体素。');
    const offset = this._options.getOffset();
    const origin = {
      x: this._clipboard.origin.x + offset.x,
      y: this._clipboard.origin.y + offset.y,
      z: this._clipboard.origin.z + offset.z,
    };
    const result = pasteVoxelClipboard(this._clipboard, origin);
    const command = createReplaceVoxelsCommand(this._options.document, [], result, '粘贴体素');
    if (!command || !this._options.history.execute(command)) {
      this._options.notify('粘贴没有产生变化。');
      return;
    }
    this._options.selection.apply(result);
    this.sync();
    this._options.notify(`已粘贴 ${result.length.toLocaleString()} 个体素。`);
  }

  delete(label = '删除选择'): void {
    this.replace([], label);
  }

  replace(result: Voxel[], label: string, removeOriginal = true): void {
    const source = this.editableVoxels();
    const command = createReplaceVoxelsCommand(
      this._options.document,
      removeOriginal ? source : [],
      result,
      label,
    );
    if (!command || !this._options.history.execute(command)) {
      this._options.notify('变换没有产生变化。');
      return;
    }
    this._options.selection.apply(result);
    this.sync();
    this._options.notify(`${label}完成，共 ${result.length.toLocaleString()} 个体素。`);
  }

  private copySelected(): VoxelClipboard {
    const clipboard = createVoxelClipboard(this.editableVoxels());
    if (!clipboard) throw new Error('请先选择体素。');
    this._clipboard = clipboard;
    return clipboard;
  }
}
