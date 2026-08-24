import type { EditorElectronRendererBridge } from '@haiyue/editor-app-kit';
import { getEditorLocale } from '../localization';
import type { ProjectSessionController, ProjectSessionSnapshot } from './ProjectSessionController';

type ProjectSessionPort = Pick<ProjectSessionController, 'dirty' | 'projectName' | 'save'> & {
  subscribe(listener: (snapshot: ProjectSessionSnapshot) => void): () => void;
};

/** Connects the browser-owned project session to the narrow Electron preload bridge. */
export class ElectronCloseController {
  private readonly _session: ProjectSessionPort;
  private readonly _bridge: EditorElectronRendererBridge | null;
  private readonly _getLocale: () => string;
  private _unsubscribeSession: (() => void) | null = null;
  private _unsubscribeSaveRequest: (() => void) | null = null;

  constructor(
    session: ProjectSessionPort,
    bridge: EditorElectronRendererBridge | null = window.haiyueEditorHost ?? null,
    getLocale: () => string = getEditorLocale,
  ) {
    this._session = session;
    this._bridge = bridge;
    this._getLocale = getLocale;
    if (!bridge) return;

    // Register the save callback before publishing state so main never observes a ready bridge without a handler.
    this._unsubscribeSaveRequest = bridge.onSaveAndClose(async () => {
      const saved = await this._session.save();
      this._publish();
      return saved;
    });
    this._unsubscribeSession = session.subscribe(() => this._publish());
  }

  dispose(): void {
    this._unsubscribeSession?.();
    this._unsubscribeSession = null;
    this._unsubscribeSaveRequest?.();
    this._unsubscribeSaveRequest = null;
  }

  private _publish(): void {
    this._bridge?.updateDocumentState({
      dirty: this._session.dirty,
      name: this._session.projectName,
      locale: this._getLocale(),
    });
  }
}
