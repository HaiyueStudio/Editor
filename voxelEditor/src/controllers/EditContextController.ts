import { ModuleResizeCommand, SceneResizeCommand, type CommandHistory } from '../commands';
import { translate, type TranslationKey } from '../localization';
import type { VoxelDocument } from '../model';

export interface EditContextControllerOptions {
  document: VoxelDocument;
  history: CommandHistory;
  notify(message: string, error?: boolean): void;
  resetCamera(): void;
  root?: Document;
}

/** Owns scene/module context presentation and the context-sensitive size command. */
export class EditContextController {
  private readonly _document: VoxelDocument;
  private readonly _history: CommandHistory;
  private readonly _notify: EditContextControllerOptions['notify'];
  private readonly _resetCamera: () => void;
  private readonly _heading: HTMLElement;
  private readonly _kind: HTMLElement;
  private readonly _sizeLabel: HTMLElement;
  private readonly _sizeInputs: readonly [HTMLInputElement, HTMLInputElement, HTMLInputElement];
  private readonly _applySize: HTMLButtonElement;
  private readonly _clear: HTMLButtonElement;
  private readonly _sceneOnly: readonly HTMLElement[];

  constructor(options: EditContextControllerOptions) {
    const root = options.root ?? document;
    this._document = options.document;
    this._history = options.history;
    this._notify = options.notify;
    this._resetCamera = options.resetCamera;
    this._heading = element(root, 'edit-context-heading');
    this._kind = element(root, 'edit-context-kind');
    this._sizeLabel = element(root, 'edit-size-label');
    this._sizeInputs = [element(root, 'size-x'), element(root, 'size-y'), element(root, 'size-z')];
    this._applySize = element(root, 'apply-size');
    this._clear = element(root, 'clear-scene');
    this._sceneOnly = [...root.querySelectorAll<HTMLElement>('[data-edit-context="scene"]')];
    this._applySize.addEventListener('click', () => this._apply());
  }

  sync(): void {
    const editingModule = this._document.editingModuleId
      ? this._document.getModule(this._document.editingModuleId)
      : null;
    const isModule = editingModule !== null;
    const size = this._document.viewSize;
    this._sizeInputs[0].value = String(size.x);
    this._sizeInputs[1].value = String(size.y);
    this._sizeInputs[2].value = String(size.z);
    this._setLocalizedText(this._heading, isModule ? 'panel.moduleSettings' : 'panel.sceneSettings');
    this._kind.textContent = isModule ? 'MODULE' : 'WORLD';
    this._setLocalizedText(this._sizeLabel, isModule ? 'module.size' : 'scene.size');
    this._setLocalizedText(this._applySize, isModule ? 'module.applySize' : 'scene.applySize');
    this._setLocalizedText(this._clear, isModule ? 'module.clear' : 'scene.clear');
    for (const node of this._sceneOnly) node.hidden = isModule;
  }

  private _apply(): void {
    const size = {
      x: Number(this._sizeInputs[0].value),
      y: Number(this._sizeInputs[1].value),
      z: Number(this._sizeInputs[2].value),
    };
    const moduleId = this._document.editingModuleId;
    const command = moduleId
      ? new ModuleResizeCommand(this._document, moduleId, size)
      : new SceneResizeCommand(this._document, size);
    if (!this._history.execute(command)) {
      this.sync();
      this._notify(moduleId ? '模块尺寸没有变化。' : '场景尺寸没有变化。');
      return;
    }
    this._resetCamera();
    const target = moduleId ? '模块' : '场景';
    this._notify(command.removedCount > 0
      ? `${target}尺寸已更新，移除了 ${command.removedCount} 个越界体素。`
      : `${target}尺寸已更新。`);
  }

  private _setLocalizedText(target: HTMLElement, key: TranslationKey): void {
    target.dataset.i18n = key;
    target.textContent = translate(key);
  }
}

function element<T extends Element = HTMLElement>(root: Document, id: string): T {
  const value = root.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}
