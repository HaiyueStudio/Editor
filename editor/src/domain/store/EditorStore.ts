import type { Entity } from '@haiyue/engine';
import type { ScriptResource } from '@haiyue/engine/components';
import type { CommandBus } from '../../commands/CommandBus';
import type { SerializedGlobalSettings } from '../../export/runtimeScene';
import { EditorEventBus, type EditorEvent } from '../events/EditorEventBus';
import { SelectionState, type EditorResourceSelection, type SelectionSnapshot } from '../selection/SelectionState';
import { InspectorState, type InspectorStateSnapshot } from './InspectorState';
import { PlayState, type EditorPlayState, type PlayStateSnapshot } from './PlayState';
import { ProjectState, type ProjectStateSnapshot } from './ProjectState';
import { RuntimeState, type EditorRuntimeContext, type RuntimeStateSnapshot } from './RuntimeState';
import {
  SessionState,
  parseEditorSessionState,
  type EditorLayoutSession,
  type EditorPlayDeviceSession,
  type EditorRecentFileSession,
  type EditorSessionPersistence,
  type EditorSessionState,
  type SessionStateSnapshot,
} from './SessionState';

export type {
  EditorLayoutSession,
  EditorPlayDeviceSession,
  EditorRecentFileSession,
  EditorSessionPersistence,
  EditorSessionState,
  EditorPlayState,
  EditorRuntimeContext,
  EditorResourceSelection,
};
export { parseEditorSessionState };

export interface EditorStoreOptions {
  settings: SerializedGlobalSettings;
  resourceSelection?: Partial<EditorResourceSelection>;
  session?: Partial<EditorSessionState>;
  sessionPersistence?: EditorSessionPersistence | null;
}

export interface EditorStoreEventMap {
  'project.changed': ProjectStateSnapshot;
  'session.changed': SessionStateSnapshot;
  'runtime.changed': RuntimeStateSnapshot;
  'selection.changed': SelectionSnapshot;
  'inspector.changed': InspectorStateSnapshot;
  'play.changed': PlayStateSnapshot;
  'transaction.committed': Readonly<{ label: string }>;
  'transaction.rolled-back': Readonly<{ label: string; error: unknown }>;
}

export type EditorStoreEvent = EditorEvent<keyof EditorStoreEventMap & string, EditorStoreEventMap[keyof EditorStoreEventMap]>;
export type EditorStoreSlice = keyof EditorStoreSnapshot;
export type EditorStoreSelector<T> = ((snapshot: EditorStoreSnapshot) => T) & {
  readonly slices?: readonly EditorStoreSlice[];
};
export interface EditorStoreSubscriptionOptions<T> {
  readonly equals?: (previous: T, next: T) => boolean;
  readonly emitInitial?: boolean;
}

export interface EditorStoreSnapshot {
  readonly project: ProjectStateSnapshot;
  readonly session: SessionStateSnapshot;
  readonly runtime: RuntimeStateSnapshot;
  readonly selection: SelectionSnapshot;
  readonly inspector: InspectorStateSnapshot;
  readonly play: PlayStateSnapshot;
}

export const editorSelectors = {
  settings: defineEditorSelector(['project'], snapshot => snapshot.project.settings),
  activeScriptResource: defineEditorSelector(['project'], snapshot => snapshot.project.activeScriptResource),
  runtimeContext: defineEditorSelector(['runtime'], snapshot => snapshot.runtime.context),
  commandBus: defineEditorSelector(['runtime'], snapshot => snapshot.runtime.context?.commandBus ?? null),
  inspectorContext: defineEditorSelector(['inspector'], snapshot => snapshot.inspector.context),
  selectedComponentName: defineEditorSelector(['inspector'], snapshot => snapshot.inspector.selectedComponentName),
  playState: defineEditorSelector(['play'], snapshot => snapshot.play.state),
  layout: defineEditorSelector(['session'], snapshot => snapshot.session.layout),
  playDevice: defineEditorSelector(['session'], snapshot => snapshot.session.playDevice),
  recentFiles: defineEditorSelector(['session'], snapshot => snapshot.session.recentFiles),
  resourceSelection: defineEditorSelector(['selection'], snapshot => snapshot.selection.resources),
  projectDocument: defineEditorSelector(['project'], snapshot => Object.freeze({
    currentRevision: snapshot.project.currentRevision,
    savedRevision: snapshot.project.savedRevision,
    documentName: snapshot.project.documentName,
    dirty: snapshot.project.dirty,
  })),
} as const;

const EDITOR_STORE_SLICES = ['project', 'session', 'runtime', 'selection', 'inspector', 'play'] as const;

interface SelectorCacheEntry {
  readonly slices: readonly EditorStoreSlice[];
  readonly versions: number[];
  value: unknown;
}

export class EditorStore {
  private readonly _events = new EditorEventBus<EditorStoreEventMap>();
  private readonly _project: ProjectState;
  private readonly _session: SessionState;
  private readonly _runtime: RuntimeState;
  private readonly _selection: SelectionState;
  private readonly _inspector: InspectorState;
  private readonly _play: PlayState;
  private _sliceSnapshots!: EditorStoreSnapshot;
  private readonly _sliceVersions: Record<EditorStoreSlice, number> = {
    project: 0, session: 0, runtime: 0, selection: 0, inspector: 0, play: 0,
  };
  private readonly _selectorCache = new WeakMap<EditorStoreSelector<unknown>, SelectorCacheEntry>();

  readonly commands: EditorStoreCommands;

  constructor(options: EditorStoreOptions) {
    this._project = new ProjectState(options.settings, snapshot => this._publishSlice('project', 'project.changed', snapshot));
    this._session = new SessionState({
      ...(options.session === undefined ? {} : { initial: options.session }),
      ...(options.sessionPersistence === undefined ? {} : { persistence: options.sessionPersistence }),
      changed: snapshot => this._publishSlice('session', 'session.changed', snapshot),
    });
    this._runtime = new RuntimeState(snapshot => this._publishSlice('runtime', 'runtime.changed', snapshot));
    this._selection = new SelectionState(snapshot => this._publishSlice('selection', 'selection.changed', snapshot), options.resourceSelection);
    this._inspector = new InspectorState(snapshot => this._publishSlice('inspector', 'inspector.changed', snapshot));
    this._play = new PlayState(snapshot => this._publishSlice('play', 'play.changed', snapshot));
    this._sliceSnapshots = freezeStoreSnapshot({
      project: this._project.snapshot(),
      session: this._session.snapshot(),
      runtime: this._runtime.snapshot(),
      selection: this._selection.snapshot(),
      inspector: this._inspector.snapshot(),
      play: this._play.snapshot(),
    });
    this.commands = this._createCommands();
  }

  snapshot(): EditorStoreSnapshot { return this._sliceSnapshots; }

  select<T>(selector: EditorStoreSelector<T>): T {
    const slices = selector.slices ?? EDITOR_STORE_SLICES;
    const cached = this._selectorCache.get(selector as EditorStoreSelector<unknown>);
    if (cached && selectorVersionsMatch(cached, this._sliceVersions)) return cached.value as T;
    const value = selector(this._sliceSnapshots);
    this._selectorCache.set(selector as EditorStoreSelector<unknown>, {
      slices,
      versions: slices.map(slice => this._sliceVersions[slice]),
      value,
    });
    return value;
  }

  selectSlice<K extends EditorStoreSlice, T>(slice: K, selector: (snapshot: EditorStoreSnapshot[K]) => T): T {
    return selector(this._sliceSnapshots[slice]);
  }

  getSliceVersion(slice: EditorStoreSlice): number { return this._sliceVersions[slice]; }

  subscribeSelector<T>(
    selector: EditorStoreSelector<T>,
    listener: (value: T, previous: T) => void,
    options: EditorStoreSubscriptionOptions<T> = {},
  ): () => void {
    const equals = options.equals ?? Object.is;
    let current = this.select(selector);
    if (options.emitInitial) listener(current, current);
    return this.subscribe(() => {
      const next = this.select(selector);
      if (equals(current, next)) return;
      const previous = current;
      current = next;
      listener(next, previous);
    });
  }

  subscribeSlice<K extends EditorStoreSlice, T>(
    slice: K,
    selector: (snapshot: EditorStoreSnapshot[K]) => T,
    listener: (value: T, previous: T) => void,
    options: EditorStoreSubscriptionOptions<T> = {},
  ): () => void {
    const equals = options.equals ?? Object.is;
    let version = this._sliceVersions[slice];
    let current = this.selectSlice(slice, selector);
    if (options.emitInitial) listener(current, current);
    return this.subscribe(() => {
      const nextVersion = this._sliceVersions[slice];
      if (nextVersion === version) return;
      version = nextVersion;
      const next = this.selectSlice(slice, selector);
      if (equals(current, next)) return;
      const previous = current;
      current = next;
      listener(next, previous);
    });
  }

  subscribe(listener: (event: EditorStoreEvent) => void): () => void;
  subscribe<K extends keyof EditorStoreEventMap>(type: K, listener: (payload: EditorStoreEventMap[K]) => void): () => void;
  subscribe<K extends keyof EditorStoreEventMap>(
    typeOrListener: K | ((event: EditorStoreEvent) => void),
    maybeListener?: (payload: EditorStoreEventMap[K]) => void,
  ): () => void {
    if (typeof typeOrListener === 'function') return this._events.subscribe(typeOrListener);
    return this._events.subscribe(typeOrListener, maybeListener!);
  }

  dispose(): void {
    this._runtime.clear();
    this._events.clear();
  }

  get listenerCount(): number { return this._events.listenerCount; }

  private _publishSlice<K extends EditorStoreSlice, E extends keyof EditorStoreEventMap>(
    slice: K,
    event: E,
    snapshot: EditorStoreSnapshot[K] & EditorStoreEventMap[E],
  ): void {
    this._sliceSnapshots = freezeStoreSnapshot({ ...this._sliceSnapshots, [slice]: snapshot });
    this._sliceVersions[slice]++;
    this._events.emit(event, snapshot);
  }

  private _restoreCachedSnapshot(snapshot: EditorStoreSnapshot): void {
    for (const slice of EDITOR_STORE_SLICES) {
      if (this._sliceSnapshots[slice] !== snapshot[slice]) this._sliceVersions[slice]++;
    }
    this._sliceSnapshots = snapshot;
  }

  private _transaction<T>(label: string, operation: () => T): T {
    const before = this.snapshot();
    const commandBus = before.runtime.context?.commandBus ?? null;
    this._events.beginBatch();
    commandBus?.beginGroup(label);
    try {
      const result = operation();
      commandBus?.endGroup();
      this._events.emit('transaction.committed', Object.freeze({ label }));
      this._events.commitBatch();
      return result;
    } catch (error) {
      commandBus?.cancelGroup();
      this._project.restore(before.project);
      this._session.restore(before.session);
      this._selection.restore(before.selection);
      this._inspector.restore(before.inspector);
      this._play.restore(before.play);
      this._restoreCachedSnapshot(before);
      this._events.rollbackBatch();
      this._events.emit('transaction.rolled-back', Object.freeze({ label, error }));
      throw error;
    }
  }

  private _createCommands(): EditorStoreCommands {
    const store = this;
    return {
      project: {
        setSettings: settings => this._project.setSettings(settings),
        setActiveScriptResource: resource => this._project.setActiveScriptResource(resource),
        markSceneChanged: () => this._project.markSceneChanged(),
        markResourcesChanged: () => this._project.markResourcesChanged(),
        markSaved: (revision, documentName) => this._project.markSaved(revision, documentName),
        openDocument: documentName => this._project.openDocument(documentName),
        restoreRecovery: documentName => this._project.restoreRecovery(documentName),
      },
      session: {
        replace: session => this._session.replace(session),
        setLayout: layout => this._session.setLayout(layout),
        setPlayDevice: device => this._session.setPlayDevice(device),
        addRecentFile: file => this._session.addRecentFile(file),
        clearRecentFiles: () => this._session.clearRecentFiles(),
        removeRecentFile: key => this._session.removeRecentFile(key),
      },
      runtime: {
        attach: context => this._runtime.attach(context),
        clear: () => this._runtime.clear(),
      },
      selection: {
        get active() { return store._selection.active; },
        get selection() { return store._selection.selection; },
        get size() { return store._selection.size; },
        setActive: entity => this._selection.setActive(entity),
        setSelection: (selection, active) => this._selection.setSelection(selection, active),
        setEntities: (entities, active) => this._selection.setEntities(entities, active),
        setResources: selection => this._selection.setResourceSelection(selection),
        clearResources: () => this._selection.clearResourceSelection(),
        clearResourceIf: (type, id) => this._selection.clearResourceIf(type, id),
        clear: () => this._selection.clear(),
      },
      inspector: {
        commit: this._inspector.commit,
        setContext: context => this._inspector.setContext(context),
        setSelectedComponentName: name => this._inspector.setSelectedComponentName(name),
        clear: () => this._inspector.clear(),
      },
      play: { transition: state => this._play.transition(state) },
      transaction: (label, operation) => this._transaction(label, operation),
    };
  }
}

export function defineEditorSelector<T>(
  slices: readonly EditorStoreSlice[],
  selector: (snapshot: EditorStoreSnapshot) => T,
): EditorStoreSelector<T> {
  Object.defineProperty(selector, 'slices', { value: Object.freeze([...slices]), enumerable: false });
  return selector;
}

function freezeStoreSnapshot(snapshot: EditorStoreSnapshot): EditorStoreSnapshot {
  return Object.freeze(snapshot);
}

function selectorVersionsMatch(entry: SelectorCacheEntry, versions: Record<EditorStoreSlice, number>): boolean {
  for (let index = 0; index < entry.slices.length; index++) {
    const slice = entry.slices[index];
    if (slice === undefined || entry.versions[index] !== versions[slice]) return false;
  }
  return true;
}

export interface EditorStoreCommands {
  readonly project: {
    setSettings(settings: SerializedGlobalSettings): void;
    setActiveScriptResource(resource: ScriptResource | null): void;
    markSceneChanged(): void;
    markResourcesChanged(): void;
    markSaved(revision?: number, documentName?: string | null): void;
    openDocument(documentName: string | null): void;
    restoreRecovery(documentName: string | null): void;
  };
  readonly session: {
    replace(session: Partial<EditorSessionState>): void;
    setLayout(layout: Partial<EditorLayoutSession>): void;
    setPlayDevice(device: Partial<EditorPlayDeviceSession>): void;
    addRecentFile(file: { name: string; path?: string; handleId?: string; openedAt?: number }): void;
    clearRecentFiles(): void;
    removeRecentFile(key: string): boolean;
  };
  readonly runtime: {
    attach(context: Omit<EditorRuntimeContext, 'sessionId'>): EditorRuntimeContext;
    clear(): void;
  };
  readonly selection: {
    readonly active: Entity | null;
    readonly selection: Set<Entity>;
    readonly size: number;
    setActive(entity: Entity | null): void;
    setSelection(selection: ReadonlySet<Entity>, active?: Entity | null): void;
    setEntities(entities: readonly Entity[], active?: Entity | null): void;
    setResources(selection: Partial<EditorResourceSelection>): void;
    clearResources(): void;
    clearResourceIf(type: keyof EditorResourceSelection, id: number): void;
    clear(): void;
  };
  readonly inspector: {
    readonly commit: InspectorState['commit'];
    setContext(context: InspectorStateSnapshot['context']): void;
    setSelectedComponentName(name: string): void;
    clear(): void;
  };
  readonly play: { transition(state: EditorPlayState): void };
  transaction<T>(label: string, operation: () => T): T;
}
