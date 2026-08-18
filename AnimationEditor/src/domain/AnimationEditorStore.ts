import {
  animationEditorProjectFingerprint,
  animationEditorProjectSnapshotKey,
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorProject,
  type DeepMutable,
} from './AnimationEditorProject';
import { DirtyState } from './DirtyState';

export interface AnimationEditorStoreChange {
  readonly project: AnimationEditorProject;
  readonly previousProject: AnimationEditorProject;
  readonly revision: number;
  readonly reason: string;
  readonly contentChanged: boolean;
  readonly dirtyChanged: boolean;
  readonly isDirty: boolean;
}

export type AnimationEditorStoreListener = (change: AnimationEditorStoreChange) => void;

export interface ReplaceProjectOptions {
  readonly reason?: string;
  readonly markSaved?: boolean;
  readonly savedFingerprint?: string;
}

export class AnimationEditorStore {
  private _project: AnimationEditorProject;
  private _revision = 0;
  private readonly _dirty: DirtyState;
  private readonly _listeners = new Set<AnimationEditorStoreListener>();

  constructor(initialProject: AnimationEditorProject) {
    this._project = freezeAnimationEditorProject(initialProject);
    this._dirty = new DirtyState(animationEditorProjectFingerprint(this._project));
  }

  get project(): AnimationEditorProject { return this._project; }
  get revision(): number { return this._revision; }
  get isDirty(): boolean { return this._dirty.isDirty; }
  get savedFingerprint(): string { return this._dirty.savedFingerprint; }
  get currentFingerprint(): string { return this._dirty.currentFingerprint; }

  subscribe(listener: AnimationEditorStoreListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  replaceProject(project: AnimationEditorProject, options: ReplaceProjectOptions = {}): boolean {
    const next = freezeAnimationEditorProject(project);
    const previous = this._project;
    const contentChanged = animationEditorProjectSnapshotKey(previous) !== animationEditorProjectSnapshotKey(next);
    const wasDirty = this.isDirty;
    this._project = next;
    if (contentChanged) this._revision++;
    const fingerprint = animationEditorProjectFingerprint(next);
    if (options.markSaved === true) this._dirty.reset(fingerprint);
    else if (options.savedFingerprint !== undefined) this._dirty.restore(options.savedFingerprint, fingerprint);
    else this._dirty.update(fingerprint);
    const dirtyChanged = wasDirty !== this.isDirty;
    if (contentChanged || dirtyChanged) {
      this._emit({
        project: next,
        previousProject: previous,
        revision: this._revision,
        reason: options.reason ?? 'replace-project',
        contentChanged,
        dirtyChanged,
        isDirty: this.isDirty,
      });
    }
    return contentChanged;
  }

  update(
    reason: string,
    mutation: (draft: DeepMutable<AnimationEditorProject>) => void,
  ): boolean {
    const draft = cloneAnimationEditorProject(this._project);
    mutation(draft);
    return this.replaceProject(draft as unknown as AnimationEditorProject, { reason });
  }

  markSaved(reason = 'mark-saved'): boolean {
    const previous = this._project;
    const dirtyChanged = this._dirty.markSaved();
    if (dirtyChanged) {
      this._emit({
        project: previous,
        previousProject: previous,
        revision: this._revision,
        reason,
        contentChanged: false,
        dirtyChanged,
        isDirty: false,
      });
    }
    return dirtyChanged;
  }

  private _emit(change: AnimationEditorStoreChange): void {
    for (const listener of [...this._listeners]) listener(change);
  }
}
