export type EditorPlayState = 'editing' | 'playing' | 'paused';

export interface PlayStateSnapshot {
  readonly state: EditorPlayState;
  readonly previous: EditorPlayState;
}

const ALLOWED_TRANSITIONS: Readonly<Record<EditorPlayState, readonly EditorPlayState[]>> = {
  editing: ['playing'],
  playing: ['paused', 'editing'],
  paused: ['playing', 'editing'],
};

export class PlayState {
  private _state: EditorPlayState = 'editing';
  private _previous: EditorPlayState = 'editing';

  constructor(private readonly _changed: (snapshot: PlayStateSnapshot) => void) {}

  snapshot(): PlayStateSnapshot {
    return Object.freeze({ state: this._state, previous: this._previous });
  }

  transition(state: EditorPlayState): void {
    if (state === this._state) return;
    if (!ALLOWED_TRANSITIONS[this._state].includes(state)) {
      throw new Error(`Invalid editor play transition: ${this._state} -> ${state}`);
    }
    this._previous = this._state;
    this._state = state;
    this._changed(this.snapshot());
  }

  restore(snapshot: PlayStateSnapshot): void {
    this._state = snapshot.state;
    this._previous = snapshot.previous;
  }
}

