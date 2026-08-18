import type { EditorSessionPersistence } from '../../domain/store/SessionState';

export class LocalStorageEditorSessionPersistence implements EditorSessionPersistence {
  constructor(
    private readonly _storage: Storage,
    private readonly _key = 'haiyue.editor.session.v1',
  ) {}

  load(): string | null { return this._storage.getItem(this._key); }
  save(value: string): void { this._storage.setItem(this._key, value); }
}

export function createBrowserEditorSessionPersistence(): EditorSessionPersistence | null {
  try {
    return globalThis.localStorage ? new LocalStorageEditorSessionPersistence(globalThis.localStorage) : null;
  } catch {
    return null;
  }
}

