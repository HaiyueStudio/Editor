import type { ScriptResource } from '@haiyue/engine/components';
import type { SerializedGlobalSettings } from '../../export/runtimeScene';
import { cloneGlobalSettings } from '../settings/globalSettings';

export interface ProjectStateSnapshot {
  readonly settings: SerializedGlobalSettings;
  readonly activeScriptResource: ScriptResource | null;
  readonly sceneRevision: number;
  readonly resourceRevision: number;
  readonly currentRevision: number;
  readonly savedRevision: number;
  readonly documentName: string | null;
  readonly dirty: boolean;
}

export class ProjectState {
  private _settings: SerializedGlobalSettings;
  private _activeScriptResource: ScriptResource | null = null;
  private _sceneRevision = 0;
  private _resourceRevision = 0;
  private _currentRevision = 0;
  private _savedRevision = 0;
  private _documentName: string | null = null;

  constructor(
    settings: SerializedGlobalSettings,
    private readonly _changed: (snapshot: ProjectStateSnapshot) => void,
  ) {
    this._settings = cloneGlobalSettings(settings);
  }

  snapshot(): ProjectStateSnapshot {
    return Object.freeze({
      settings: cloneGlobalSettings(this._settings),
      activeScriptResource: this._activeScriptResource,
      sceneRevision: this._sceneRevision,
      resourceRevision: this._resourceRevision,
      currentRevision: this._currentRevision,
      savedRevision: this._savedRevision,
      documentName: this._documentName,
      dirty: this._currentRevision !== this._savedRevision,
    });
  }

  setSettings(settings: SerializedGlobalSettings): void {
    this._settings = cloneGlobalSettings(settings);
    this._sceneRevision++;
    this._currentRevision++;
    this._changed(this.snapshot());
  }

  setActiveScriptResource(resource: ScriptResource | null): void {
    if (resource === this._activeScriptResource) return;
    this._activeScriptResource = resource;
    this._changed(this.snapshot());
  }

  markSceneChanged(): void {
    this._sceneRevision++;
    this._currentRevision++;
    this._changed(this.snapshot());
  }

  markResourcesChanged(): void {
    this._resourceRevision++;
    this._currentRevision++;
    this._changed(this.snapshot());
  }

  markSaved(revision = this._currentRevision, documentName = this._documentName): void {
    const normalized = Math.max(0, Math.min(this._currentRevision, Math.floor(revision)));
    if (normalized === this._savedRevision && documentName === this._documentName) return;
    this._savedRevision = normalized;
    this._documentName = documentName;
    this._changed(this.snapshot());
  }

  openDocument(documentName: string | null): void {
    this._currentRevision++;
    this._savedRevision = this._currentRevision;
    this._documentName = documentName;
    this._changed(this.snapshot());
  }

  restoreRecovery(documentName: string | null): void {
    this._currentRevision++;
    this._documentName = documentName;
    this._changed(this.snapshot());
  }

  restore(snapshot: ProjectStateSnapshot): void {
    this._settings = cloneGlobalSettings(snapshot.settings);
    this._activeScriptResource = snapshot.activeScriptResource;
    this._sceneRevision = snapshot.sceneRevision;
    this._resourceRevision = snapshot.resourceRevision;
    this._currentRevision = snapshot.currentRevision;
    this._savedRevision = snapshot.savedRevision;
    this._documentName = snapshot.documentName;
  }
}
