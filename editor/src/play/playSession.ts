import type { ScriptResource } from '@haiyue/engine/components';
import type { World } from '@haiyue/engine';
import type { SerializedEditorScene, SerializedScript } from '../export/runtimeScene';
import type { EditorPlayState } from '../domain/store/PlayState';
import { createPlayerDocument } from './playerDocument';
import type { PlayOutput } from './playOutput';
import type { RuntimeInspectorFieldEdit, RuntimeInspectorSnapshot, RuntimePerformanceSnapshot } from './runtimeDebugPanel';

export type PlayCommand = 'pause' | 'resume' | 'restart' | 'stop';

export interface PlaySessionDebugPanel {
  readonly breakpoints: string[];
  setBreakpointsChangeHandler(handler: (breakpoints: string[]) => void): void;
  setFieldEditHandler(handler: (edit: RuntimeInspectorFieldEdit) => void): void;
  clear(): void;
  renderBreakpointHit(details: { breakpoint?: string; entity?: { id?: number; name?: string }; script?: { id?: number; name?: string }; lifecycle?: string }): void;
  renderInspector(snapshot: RuntimeInspectorSnapshot | null): void;
  renderPerformance(snapshot: RuntimePerformanceSnapshot | null): void;
}

export interface PlaySessionOptions {
  overlay: HTMLElement | null;
  frame: HTMLIFrameElement | null;
  pauseButton: HTMLButtonElement | null;
  output: PlayOutput;
  debugPanel?: PlaySessionDebugPanel;
  serializeScene: (world: World, signal?: AbortSignal) => Promise<SerializedEditorScene>;
  getDevicePixelRatio: () => number;
  getSelectedEntityId?: () => number | null;
  subscribeSelectedEntityId?: (listener: (entityId: number | null) => void) => () => void;
  getOrigin?: () => string;
  onStateChange?: (state: EditorPlayState) => void;
}

export class PlaySession {
  private _paused = false;
  private _messageHandler: ((event: MessageEvent) => void) | null = null;
  private _currentScene: SerializedEditorScene | null = null;
  private _unsubscribeSelection: (() => void) | null = null;
  private _lastSelectedEntityId: number | null = null;
  private _inspectorRevision = 0;

  constructor(private readonly _options: PlaySessionOptions) {
    this._options.debugPanel?.setBreakpointsChangeHandler(() => this._sendBreakpoints());
    this._options.debugPanel?.setFieldEditHandler(edit => this._sendRuntimeInspectorEdit(edit));
  }

  get paused(): boolean {
    return this._paused;
  }

  get diagnostics(): Readonly<{ messageListeners: number; selectionSubscriptions: number; sceneReferences: number }> {
    return Object.freeze({
      messageListeners: this._messageHandler ? 1 : 0,
      selectionSubscriptions: this._unsubscribeSelection ? 1 : 0,
      sceneReferences: this._currentScene ? 1 : 0,
    });
  }

  async prepare(world: World, signal?: AbortSignal): Promise<SerializedEditorScene> {
    signal?.throwIfAborted();
    const scene = await this._options.serializeScene(world, signal);
    signal?.throwIfAborted();
    return scene;
  }

  open(scene: SerializedEditorScene): void {
    const { overlay, frame } = this._options;
    if (!overlay || !frame) return;
    this._currentScene = scene;
    this._options.output.clear();
    this._options.debugPanel?.clear();
    this._setPaused(false);
    overlay.hidden = false;
    overlay.tabIndex = -1;
    overlay.focus();

    if (this._messageHandler) window.removeEventListener('message', this._messageHandler);
    this._messageHandler = (event: MessageEvent) => this._handleMessage(event, scene);
    window.addEventListener('message', this._messageHandler);
    frame.srcdoc = createPlayerDocument();
    this._startSelectionSync();
  }

  close(): void {
    const { overlay, frame } = this._options;
    this.sendCommand('stop');
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = null;
    }
    this._stopSelectionSync();
    if (overlay) overlay.hidden = true;
    if (frame) frame.srcdoc = '';
    this._currentScene = null;
    this._options.debugPanel?.clear();
    this._setPaused(false);
  }

  reload(): void {
    if (!this._currentScene || !this._options.frame?.contentWindow) return;
    this.sendCommand('stop');
    this._sendScene(this._currentScene);
  }

  syncSelection(): void {
    this._sendSelectedEntity();
  }

  updateScriptResource(resource: ScriptResource): void {
    const contentWindow = this._options.frame?.contentWindow;
    if (!contentWindow) return;
    const script: SerializedScript = {
      id: resource.id,
      name: resource.name,
      scripts: { ...resource.scripts },
    };
    contentWindow.postMessage({
      type: 'game-editor-player-update-script',
      script,
    }, this._getOrigin());
  }

  sendCommand(command: PlayCommand): void {
    this._options.frame?.contentWindow?.postMessage({ type: `game-editor-player-${command}` }, this._getOrigin());
  }

  restart(): void {
    this._options.output.append('lifecycle', 'restart requested');
    this.sendCommand('restart');
  }

  togglePause(): void {
    this.sendCommand(this._paused ? 'resume' : 'pause');
  }

  private _handleMessage(event: MessageEvent<unknown>, scene: SerializedEditorScene): void {
    if (!this._isTrustedMessage(event)) return;
    const data = normalizePlayerMessage(event.data);
    if (!data) return;
    if (data.type === 'game-editor-player-ready') {
      this._sendScene(scene);
      return;
    }
    if (data.type === 'game-editor-player-log') {
      this._options.output.append(asString(data.level, 'log'), asString(data.message), {
        source: asOptionalString(data.source),
        entity: asStringOrNumber(data.entity),
        script: asStringOrNumber(data.script),
        time: asOptionalNumber(data.time),
      });
      return;
    }
    if (data.type === 'game-editor-player-error') {
      this._options.output.append('error', asString(data.message, 'Unknown player error'), {
        source: asString(data.source, 'runtime'),
        time: asOptionalNumber(data.time),
      });
      return;
    }
    if (data.type === 'game-editor-player-inspector') {
      const revision = asOptionalNumber(data.revision) ?? 0;
      if (revision <= this._inspectorRevision) return;
      this._inspectorRevision = revision;
      this._options.debugPanel?.renderInspector(normalizeInspectorSnapshot(data.snapshot));
      return;
    }
    if (data.type === 'game-editor-player-performance') {
      this._options.debugPanel?.renderPerformance(normalizePerformanceSnapshot(data.metrics));
      return;
    }
    if (data.type === 'game-editor-player-breakpoint-hit') {
      const entity = normalizeIdName(data.entity);
      const script = normalizeIdName(data.script);
      const lifecycle = asOptionalString(data.lifecycle);
      const breakpoint = asOptionalString(data.breakpoint);
      const details = {
        ...(breakpoint === undefined ? {} : { breakpoint }),
        ...(entity === undefined ? {} : { entity }),
        ...(script === undefined ? {} : { script }),
        ...(lifecycle === undefined ? {} : { lifecycle }),
      };
      this._options.output.append('debug', `breakpoint hit: ${details.breakpoint ?? ''}`, {
        source: lifecycle ? `script:${lifecycle}` : 'script',
        entity: entity?.id,
        script: script?.id,
        time: asOptionalNumber(data.time),
      });
      this._options.debugPanel?.renderBreakpointHit(details);
      this._setPaused(true);
      return;
    }
    if (data.type === 'game-editor-player-field-edit-result') {
      const success = data.success === true;
      const edit = normalizePlayerMessage(data.edit);
      this._options.output.append(success ? 'debug' : 'warn', success ? 'runtime field edited' : asString(data.message, 'runtime field edit failed'), {
        source: 'runtime-inspector',
        entity: asOptionalNumber(edit?.entityId),
        time: asOptionalNumber(data.time),
      });
      return;
    }
    if (data.type === 'game-editor-player-lifecycle') {
      this._options.output.append('lifecycle', asString(data.phase));
      this._setPaused(data.phase === 'paused');
    }
  }

  private _sendScene(scene: SerializedEditorScene): void {
    const contentWindow = this._options.frame?.contentWindow;
    if (!contentWindow) return;
    contentWindow.postMessage({
      type: 'game-editor-load-scene',
      scene,
      devicePixelRatio: this._options.getDevicePixelRatio(),
      selectedEntityId: this._options.getSelectedEntityId?.() ?? null,
      breakpoints: this._options.debugPanel?.breakpoints ?? [],
    }, this._getOrigin());
    this._sendBreakpoints();
  }

  private _sendSelectedEntity(entityId = this._options.getSelectedEntityId?.() ?? null): void {
    const contentWindow = this._options.frame?.contentWindow;
    if (!contentWindow) return;
    if (entityId === this._lastSelectedEntityId) return;
    this._lastSelectedEntityId = entityId;
    contentWindow.postMessage({
      type: 'game-editor-player-select-entity',
      entityId,
    }, this._getOrigin());
  }

  private _sendBreakpoints(): void {
    const contentWindow = this._options.frame?.contentWindow;
    if (!contentWindow) return;
    contentWindow.postMessage({
      type: 'game-editor-player-breakpoints',
      breakpoints: this._options.debugPanel?.breakpoints ?? [],
    }, this._getOrigin());
  }

  private _sendRuntimeInspectorEdit(edit: RuntimeInspectorFieldEdit): void {
    const contentWindow = this._options.frame?.contentWindow;
    if (!contentWindow) return;
    contentWindow.postMessage({
      type: 'game-editor-player-edit-field',
      edit,
    }, this._getOrigin());
  }

  private _startSelectionSync(): void {
    this._stopSelectionSync();
    this._lastSelectedEntityId = this._options.getSelectedEntityId?.() ?? null;
    this._inspectorRevision = 0;
    this._unsubscribeSelection = this._options.subscribeSelectedEntityId?.(entityId => {
      this._sendSelectedEntity(entityId);
    }) ?? null;
  }

  private _stopSelectionSync(): void {
    this._unsubscribeSelection?.();
    this._unsubscribeSelection = null;
  }

  private _setPaused(paused: boolean): void {
    this._paused = paused;
    if (this._options.pauseButton) this._options.pauseButton.textContent = paused ? 'Resume' : 'Pause';
    this._options.onStateChange?.(paused ? 'paused' : this._currentScene ? 'playing' : 'editing');
  }

  private _isTrustedMessage(event: MessageEvent<unknown>): boolean {
    return event.origin === this._getOrigin() && event.source === this._options.frame?.contentWindow;
  }

  private _getOrigin(): string {
    return this._options.getOrigin?.() ?? window.location.origin;
  }
}

function normalizePlayerMessage(value: unknown): (Record<string, unknown> & { type?: string }) | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown> & { type?: string };
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function normalizeIdName(value: unknown): { id?: number; name?: string } | undefined {
  const record = normalizePlayerMessage(value);
  if (!record) return undefined;
  const id = asOptionalNumber(record.id);
  const name = asOptionalString(record.name);
  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
  };
}

function normalizeInspectorSnapshot(value: unknown): RuntimeInspectorSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as RuntimeInspectorSnapshot;
  if (!snapshot.entity || !Array.isArray(snapshot.components)) return null;
  return snapshot;
}

function normalizePerformanceSnapshot(value: unknown): RuntimePerformanceSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  return value as RuntimePerformanceSnapshot;
}
