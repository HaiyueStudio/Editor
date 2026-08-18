import { createVoxelPatchCommand, type CommandHistory } from '../commands';
import { normalizeColor, type VoxelDocument } from '../model';
import { replacementChanges } from '../voxelPaint';
import { translate } from '../localization';

type Notify = (message: string, error?: boolean) => void;

export interface VoxelPaintControllerOptions {
  document: VoxelDocument;
  history: CommandHistory;
  getSelectionKeys(): ReadonlySet<string>;
  notify: Notify;
}

/** Owns explicit batch recoloring without coupling it to pointer-brush state. */
export class VoxelPaintController {
  private readonly _document: VoxelDocument;
  private readonly _history: CommandHistory;
  private readonly _getSelectionKeys: () => ReadonlySet<string>;
  private readonly _notify: Notify;
  private readonly _source = element<HTMLInputElement>('replace-source-color');
  private readonly _scope = element<HTMLSelectElement>('replace-color-scope');

  constructor(options: VoxelPaintControllerOptions) {
    this._document = options.document;
    this._history = options.history;
    this._getSelectionKeys = options.getSelectionKeys;
    this._notify = options.notify;
    element('replace-color').addEventListener('click', () => this.replace());
  }

  replace(): void {
    try {
      const sourceColor = normalizeColor(this._source.value);
      const selection = this._getSelectionKeys();
      const selectedOnly = this._scope.value === 'selection';
      if (selectedOnly && selection.size === 0) throw new Error(translate('paint.selectionRequired'));
      const candidates = this._document.isEditingModule
        ? this._document.viewVoxels.values()
        : Array.from(this._document.voxels.values()).filter(voxel => this._document.isBaseVoxelEditable(voxel));
      const editableSelection = selectedOnly && !this._document.isEditingModule
        ? new Set([...selection].filter(key => this._document.viewVoxels.get(key)?.source !== 'module-instance'))
        : selection;
      const changes = replacementChanges(
        candidates,
        sourceColor,
        this._document.currentColor,
        this._document.currentMaterialId,
        selectedOnly ? editableSelection : null,
      );
      const command = createVoxelPatchCommand(
        this._document,
        this._document.editingModuleId,
        changes,
        selectedOnly ? translate('paint.replaceSelectionCommand') : translate('paint.replaceGlobalCommand'),
      );
      if (!command || !this._history.execute(command)) {
        this._notify(translate('paint.noMatch'));
        return;
      }
      this._notify(translate('paint.replaced', {
        count: changes.length.toLocaleString(),
        color: this._document.currentColor.toUpperCase(),
      }));
    } catch (error) {
      this._notify(error instanceof Error ? error.message : String(error), true);
    }
  }
}

function element<T extends Element = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}
