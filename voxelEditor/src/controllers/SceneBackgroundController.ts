import { SceneBackgroundColorCommand, type CommandHistory } from '../commands';
import {
  DEFAULT_SCENE_BACKGROUND_COLOR,
  normalizeColor,
  type VoxelDocument,
} from '../model';
import { translate } from '../localization';
import type { VoxelRenderer } from '../VoxelRenderer';

interface SceneBackgroundControllerOptions {
  document: VoxelDocument;
  history: CommandHistory;
  getRenderer(): VoxelRenderer | null;
  notify(message: string, error?: boolean): void;
}

/** Owns scene background editing, preview, history, and renderer synchronization. */
export class SceneBackgroundController {
  private readonly _document: VoxelDocument;
  private readonly _history: CommandHistory;
  private readonly _getRenderer: () => VoxelRenderer | null;
  private readonly _notify: SceneBackgroundControllerOptions['notify'];
  private readonly _color = element<HTMLInputElement>('scene-background-color');
  private readonly _hex = element<HTMLInputElement>('scene-background-hex');

  constructor(options: SceneBackgroundControllerOptions) {
    this._document = options.document;
    this._history = options.history;
    this._getRenderer = options.getRenderer;
    this._notify = options.notify;
    this._color.addEventListener('input', () => this._preview(this._color.value));
    this._color.addEventListener('change', () => this._commit(this._color.value));
    this._hex.addEventListener('input', () => this._preview(this._hex.value));
    this._hex.addEventListener('change', () => this._commit(this._hex.value));
    this._hex.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this._commit(this._hex.value);
      this._hex.blur();
    });
    element('reset-scene-background').addEventListener('click', () => this._commit(DEFAULT_SCENE_BACKGROUND_COLOR));
    this.sync();
  }

  sync(): void {
    const color = this._document.sceneBackgroundColor;
    this._color.value = color;
    this._hex.value = color.toUpperCase();
    this._getRenderer()?.setBackgroundColor(color);
  }

  private _preview(value: string): void {
    try { this._getRenderer()?.setBackgroundColor(normalizeColor(value)); }
    catch { /* An incomplete hex value is valid while typing. */ }
  }

  private _commit(value: string): void {
    try {
      const command = new SceneBackgroundColorCommand(
        this._document,
        value,
        translate('scene.backgroundCommand'),
      );
      if (this._history.execute(command)) this._notify(translate('scene.backgroundUpdated'));
      else this.sync();
    } catch (error) {
      this.sync();
      this._notify(error instanceof Error ? error.message : String(error), true);
    }
  }
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as T;
}
