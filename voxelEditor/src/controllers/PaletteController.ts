import {
  PaletteMaterialCreateCommand,
  PaletteMaterialRemoveCommand,
  PaletteMaterialUpdateCommand,
  type CommandHistory,
} from '../commands';
import type { VoxelDocument } from '../model';
import { getEditorLocale, translate } from '../localization';

type Notify = (message: string, error?: boolean) => void;

export interface PaletteControllerOptions {
  document: VoxelDocument;
  history: CommandHistory;
  notify: Notify;
}

/** Owns palette selection, PBR material editing, and palette-derived usage UI. */
export class PaletteController {
  private readonly _document: VoxelDocument;
  private readonly _history: CommandHistory;
  private readonly _notify: Notify;
  private readonly _color = element<HTMLInputElement>('color-input');
  private readonly _replaceTarget = element<HTMLElement>('replace-target-color');
  private readonly _hex = element<HTMLInputElement>('color-hex');
  private readonly _name = element<HTMLInputElement>('pbr-material-name');
  private readonly _metallic = element<HTMLInputElement>('pbr-metallic');
  private readonly _roughness = element<HTMLInputElement>('pbr-roughness');
  private readonly _usage = element<HTMLElement>('pbr-material-usage');
  private readonly _palette = requiredQuery<HTMLElement>('.palette');
  private _paletteSignature = '';

  constructor(options: PaletteControllerOptions) {
    this._document = options.document;
    this._history = options.history;
    this._notify = options.notify;
    this._bind();
  }

  applyColor(value: string): void {
    this._run(() => { this._document.currentColor = value; });
  }

  sync(): void {
    this._color.value = this._document.currentColor;
    this._hex.value = this._document.currentColor.toUpperCase();
    this._replaceTarget.style.setProperty('--replace-target-color', this._document.currentColor);
    this._replaceTarget.title = this._document.currentColor.toUpperCase();

    const materials = this._document.paletteMaterials;
    const signature = `${getEditorLocale()}|${this._document.currentMaterialId}|${materials.map(material =>
      `${material.id}:${material.color}:${material.name}:${material.metallic}:${material.roughness}:${material.vox?.type ?? ''}`).join('|')}`;
    if (signature !== this._paletteSignature) {
      this._paletteSignature = signature;
      const fragment = document.createDocumentFragment();
      for (const material of materials) {
        const button = document.createElement('button');
        button.className = 'palette-swatch';
        button.classList.toggle('selected', material.id === this._document.currentMaterialId);
        button.style.setProperty('--swatch', material.color);
        button.dataset.color = material.color;
        button.dataset.materialId = material.id;
        const compatibility = material.vox?.compatibility === 'partial'
          ? ` · ${translate('material.voxPartial', { type: material.vox.type.toUpperCase() })}`
          : material.vox ? ` · VOX ${material.vox.type.toUpperCase()}` : '';
        button.title = `${material.name} · M ${material.metallic.toFixed(2)} · R ${material.roughness.toFixed(2)}${compatibility}`;
        button.setAttribute('aria-label', translate('material.select', { name: material.name }));
        button.addEventListener('click', () => this._document.selectPaletteMaterial(material.id));
        fragment.append(button);
      }
      this._palette.replaceChildren(fragment);
    }

    const current = this._document.getPaletteMaterial(this._document.currentMaterialId);
    this._name.value = current.name;
    this._name.title = current.vox?.compatibility === 'partial'
      ? translate('material.voxPartialDetail', { type: current.vox.type.toUpperCase() })
      : '';
    this._metallic.value = current.metallic.toFixed(2);
    this._roughness.value = current.roughness.toFixed(2);
    const usage = this._document.getMaterialUsageCount(current.id);
    this._usage.textContent = usage > 0
      ? translate('material.usage', { count: usage.toLocaleString() })
      : translate('material.unused');
  }

  private _bind(): void {
    this._color.addEventListener('change', () => this.applyColor(this._color.value));
    this._hex.addEventListener('change', () => this.applyColor(this._hex.value));

    element('save-pbr-material').addEventListener('click', () => this._run(() => {
      const changed = this._history.execute(new PaletteMaterialUpdateCommand(
        this._document,
        this._document.currentMaterialId,
        { name: this._name.value, metallic: Number(this._metallic.value), roughness: Number(this._roughness.value) },
      ));
      this._notify(changed ? 'PBR 材质已更新，所有引用体素已同步。' : 'PBR 材质没有变化。');
    }));

    element('duplicate-pbr-material').addEventListener('click', () => this._run(() => {
      const source = this._document.getPaletteMaterial(this._document.currentMaterialId);
      const rawColor = window.prompt('新材质颜色', source.color);
      if (rawColor === null) return;
      this._history.execute(new PaletteMaterialCreateCommand(
        this._document,
        rawColor.trim().toLowerCase(),
        `${source.name} 副本`,
        { metallic: source.metallic, roughness: source.roughness },
      ));
      this._notify('已创建独立 PBR 材质副本。');
    }));

    element('delete-pbr-material').addEventListener('click', () => this._run(() => {
      if (this._history.execute(new PaletteMaterialRemoveCommand(this._document, this._document.currentMaterialId))) {
        this._notify('未使用的 PBR 材质已删除。');
      }
    }));
  }

  private _run(action: () => void): void {
    try { action(); }
    catch (error) { this._notify(error instanceof Error ? error.message : String(error), true); }
  }
}

function element<T extends Element = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}

function requiredQuery<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}
