import {
  createDeleteAnimationKeyframesCommand,
  createMoveAnimationKeyframesCommand,
  createPasteAnimationKeyframesCommand,
  type AnimationKeyframeClipboardEntry,
  type AnimationKeyframeRef,
  type CommandHistory,
} from '../commands';
import { animationPlaybackRange } from '../animation';
import { getEditorLocale, translate } from '../localization';
import type { VoxelAnimationClip, VoxelAnimationKeyframe, VoxelDocument } from '../model';

type Notify = (message: string, error?: boolean) => void;

interface TimelineDrag {
  pointerId: number;
  startX: number;
  delta: number;
  duplicate: boolean;
  refs: AnimationKeyframeRef[];
}

/** Visual timeline and its local selection/clipboard state. Document edits remain differential commands. */
export class AnimationTimelineController {
  private readonly _timeline = element<HTMLElement>('animation-timeline');
  private readonly _selectedKeyframes = new Set<string>();
  private _selectionAnchor: AnimationKeyframeRef | null = null;
  private _clipboard: AnimationKeyframeClipboardEntry[] = [];
  private _timelineAnimationId: string | null = null;
  private _timelineSignature = '';
  private _drag: TimelineDrag | null = null;

  constructor(private readonly _options: {
    document: VoxelDocument;
    history: CommandHistory;
    notify: Notify;
    getSelectedInstanceId(): string | null;
    onLocalStateChange(): void;
  }) {
    this._timeline.addEventListener('keydown', event => this._keyDown(event));
  }

  get hasSelection(): boolean { return this._selectedKeyframes.size > 0; }
  get hasClipboard(): boolean { return this._clipboard.length > 0; }

  sync(clip: VoxelAnimationClip | null): void {
    if (clip?.id !== this._timelineAnimationId) {
      this._timelineAnimationId = clip?.id ?? null;
      this._selectedKeyframes.clear();
      this._selectionAnchor = null;
      this._timelineSignature = '';
    }
    this._discardMissingSelection(clip);
    const signature = `${getEditorLocale()}|${clip ? this._structureSignature(clip) : 'empty'}`;
    if (signature !== this._timelineSignature) {
      this._timelineSignature = signature;
      this._render(clip);
    } else this._syncState(clip);
  }

  syncFrame(clip: VoxelAnimationClip | null): void {
    this._syncState(clip);
  }

  select(instanceId: string, frame: number): void {
    this._selectedKeyframes.clear();
    this._selectedKeyframes.add(keyframeRefKey(instanceId, frame));
    this._selectionAnchor = { instanceId, frame };
    this._syncState(this._options.document.activeAnimationView);
  }

  selectCurrent(): void {
    const clip = this._options.document.activeAnimationView;
    const instanceId = this._options.getSelectedInstanceId();
    const frame = this._options.document.animationFrame;
    if (!clip || !instanceId || !this._options.document.getAnimationKeyframe(clip.id, instanceId, frame)) return;
    this.select(instanceId, frame);
    this._options.onLocalStateChange();
  }

  copySelected(): void {
    const clip = this._options.document.activeAnimationView;
    const refs = this._selectedRefsOrCurrent();
    if (!clip || refs.length === 0) return;
    const start = animationRefBounds(refs).min;
    this._clipboard = refs.flatMap(ref => {
      const keyframe = this._options.document.getAnimationKeyframe(clip.id, ref.instanceId, ref.frame);
      return keyframe ? [{ instanceId: ref.instanceId, relativeFrame: ref.frame - start, keyframe }] : [];
    });
    this._options.onLocalStateChange();
    this._options.notify(translate('animation.keysCopied', { count: this._clipboard.length }));
  }

  pasteAtCurrent(): void {
    const clip = this._options.document.activeAnimationView;
    if (!clip || this._clipboard.length === 0) return;
    const frame = this._options.document.animationFrame;
    const command = createPasteAnimationKeyframesCommand(this._options.document, clip.id, this._clipboard, frame);
    if (!command || !this._options.history.execute(command)) return;
    this._selectedKeyframes.clear();
    for (const entry of this._clipboard) {
      this._selectedKeyframes.add(keyframeRefKey(entry.instanceId, frame + entry.relativeFrame));
    }
    this._options.notify(translate('animation.keysPasted', { count: this._clipboard.length }));
  }

  deleteSelected(): void {
    const clip = this._options.document.activeAnimationView;
    const refs = this._selectedRefsOrCurrent();
    if (!clip || refs.length === 0) return;
    const command = createDeleteAnimationKeyframesCommand(this._options.document, clip.id, refs);
    if (!command || !this._options.history.execute(command)) return;
    this._selectedKeyframes.clear();
    this._selectionAnchor = null;
    this._options.notify(translate('animation.keysDeleted', { count: refs.length }));
  }

  private _selectedRefsOrCurrent(): AnimationKeyframeRef[] {
    const refs = Array.from(this._selectedKeyframes, parseKeyframeRef);
    if (refs.length > 0) return refs;
    const clip = this._options.document.activeAnimationView;
    const instanceId = this._options.getSelectedInstanceId();
    const frame = this._options.document.animationFrame;
    return clip && instanceId && this._options.document.getAnimationKeyframe(clip.id, instanceId, frame)
      ? [{ instanceId, frame }]
      : [];
  }

  private _render(clip: VoxelAnimationClip | null): void {
    this._timeline.replaceChildren();
    if (!clip) {
      this._timeline.append(emptyTimeline(translate('animation.timelineEmpty')));
      return;
    }
    const frameWidth = timelineFrameWidth(clip.frameCount);
    this._timeline.style.setProperty('--timeline-frame-width', `${frameWidth}px`);
    const ruler = document.createElement('div');
    ruler.className = 'timeline-ruler';
    const corner = document.createElement('div');
    corner.className = 'timeline-corner';
    corner.textContent = translate('animation.timelineCorner');
    const rulerCells = this._timelineCells(clip, 'timeline-ruler-cells');
    const tickStep = timelineTickStep(clip.frameCount);
    for (let frame = 0; frame < clip.frameCount; frame += tickStep) {
      const tick = document.createElement('span');
      tick.className = 'timeline-tick';
      tick.style.left = `${(frame + 0.5) * frameWidth}px`;
      tick.textContent = String(frame + 1);
      rulerCells.append(tick);
    }
    ruler.append(corner, rulerCells);
    this._timeline.append(ruler);

    const tracks = this._options.document.moduleInstances.map(instance =>
      clip.tracks.find(track => track.instanceId === instance.id) ?? { instanceId: instance.id, keyframes: [] })
      .sort((a, b) => instanceName(this._options.document, a.instanceId)
        .localeCompare(instanceName(this._options.document, b.instanceId), getEditorLocale(), { numeric: true }));
    if (tracks.length === 0) this._timeline.append(emptyTimeline(translate('animation.timelineNoInstances')));
    for (const track of tracks) {
      const row = document.createElement('div');
      row.className = 'timeline-track';
      const label = document.createElement('div');
      label.className = 'timeline-track-label';
      label.textContent = instanceName(this._options.document, track.instanceId);
      label.title = label.textContent;
      const cells = this._timelineCells(clip);
      cells.dataset.instanceId = track.instanceId;
      cells.addEventListener('pointerdown', event => this._cellPointerDown(event, cells, clip));
      for (const keyframe of track.keyframes) cells.append(this._keyframeMarker(clip, track.instanceId, keyframe));
      row.append(label, cells);
      this._timeline.append(row);
    }
    this._syncState(clip);
  }

  private _timelineCells(clip: VoxelAnimationClip, extraClass = ''): HTMLElement {
    const cells = document.createElement('div');
    cells.className = `timeline-cells ${extraClass}`.trim();
    const frameWidth = timelineFrameWidth(clip.frameCount);
    cells.style.width = `${clip.frameCount * frameWidth}px`;
    const range = animationPlaybackRange(clip);
    const rangeElement = document.createElement('div');
    rangeElement.className = 'timeline-play-range';
    rangeElement.style.left = `${range.start * frameWidth}px`;
    rangeElement.style.width = `${(range.end - range.start + 1) * frameWidth}px`;
    const playhead = document.createElement('div');
    playhead.className = 'timeline-playhead';
    cells.append(rangeElement, playhead);
    return cells;
  }

  private _keyframeMarker(clip: VoxelAnimationClip, instanceId: string, keyframe: VoxelAnimationKeyframe): HTMLButtonElement {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'timeline-keyframe';
    marker.dataset.instanceId = instanceId;
    marker.dataset.frame = String(keyframe.frame);
    marker.style.left = `${(keyframe.frame + 0.5) * timelineFrameWidth(clip.frameCount)}px`;
    marker.title = translate('animation.keyframeTitle', {
      name: instanceName(this._options.document, instanceId),
      frame: keyframe.frame + 1,
    });
    marker.addEventListener('pointerdown', event => this._keyframePointerDown(event, clip, marker));
    return marker;
  }

  private _cellPointerDown(event: PointerEvent, cells: HTMLElement, clip: VoxelAnimationClip): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.timeline-keyframe')) return;
    const rect = cells.getBoundingClientRect();
    const frame = Math.max(0, Math.min(clip.frameCount - 1,
      Math.floor((event.clientX - rect.left) / timelineFrameWidth(clip.frameCount))));
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) this._selectedKeyframes.clear();
    this._options.document.setAnimationFrame(frame);
    this._syncState(clip);
    this._options.onLocalStateChange();
  }

  private _keyframePointerDown(event: PointerEvent, clip: VoxelAnimationClip, marker: HTMLButtonElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const ref = { instanceId: marker.dataset.instanceId!, frame: Number(marker.dataset.frame) };
    const key = keyframeRefKey(ref.instanceId, ref.frame);
    if (event.shiftKey && this._selectionAnchor?.instanceId === ref.instanceId) {
      if (!event.ctrlKey && !event.metaKey) this._selectedKeyframes.clear();
      const min = Math.min(this._selectionAnchor.frame, ref.frame);
      const max = Math.max(this._selectionAnchor.frame, ref.frame);
      const track = clip.tracks.find(candidate => candidate.instanceId === ref.instanceId);
      for (const keyframe of track?.keyframes ?? []) {
        if (keyframe.frame >= min && keyframe.frame <= max) this._selectedKeyframes.add(keyframeRefKey(ref.instanceId, keyframe.frame));
      }
    } else if (event.ctrlKey || event.metaKey) {
      if (this._selectedKeyframes.has(key)) this._selectedKeyframes.delete(key);
      else this._selectedKeyframes.add(key);
      this._selectionAnchor = ref;
    } else {
      if (!this._selectedKeyframes.has(key)) {
        this._selectedKeyframes.clear();
        this._selectedKeyframes.add(key);
      }
      this._selectionAnchor = ref;
    }
    this._options.document.setAnimationFrame(ref.frame);
    this._syncState(clip);
    this._options.onLocalStateChange();
    marker.setPointerCapture(event.pointerId);
    this._drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      delta: 0,
      duplicate: event.altKey,
      refs: Array.from(this._selectedKeyframes, parseKeyframeRef),
    };
    const move = (moveEvent: PointerEvent): void => this._keyframePointerMove(moveEvent, clip);
    const finish = (upEvent: PointerEvent): void => {
      marker.removeEventListener('pointermove', move);
      marker.removeEventListener('pointerup', finish);
      marker.removeEventListener('pointercancel', finish);
      this._keyframePointerUp(upEvent, clip);
    };
    marker.addEventListener('pointermove', move);
    marker.addEventListener('pointerup', finish);
    marker.addEventListener('pointercancel', finish);
  }

  private _keyframePointerMove(event: PointerEvent, clip: VoxelAnimationClip): void {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const requested = Math.round((event.clientX - drag.startX) / timelineFrameWidth(clip.frameCount));
    const { min, max } = animationRefBounds(drag.refs);
    drag.delta = Math.max(-min, Math.min(clip.frameCount - 1 - max, requested));
    for (const marker of this._timeline.querySelectorAll<HTMLElement>('.timeline-keyframe')) {
      const key = keyframeRefKey(marker.dataset.instanceId!, Number(marker.dataset.frame));
      marker.classList.toggle('dragging', drag.delta !== 0 && this._selectedKeyframes.has(key));
      marker.style.marginLeft = this._selectedKeyframes.has(key) ? `${drag.delta * timelineFrameWidth(clip.frameCount)}px` : '';
    }
  }

  private _keyframePointerUp(event: PointerEvent, clip: VoxelAnimationClip): void {
    const drag = this._drag;
    this._drag = null;
    for (const marker of this._timeline.querySelectorAll<HTMLElement>('.timeline-keyframe')) {
      marker.classList.remove('dragging');
      marker.style.marginLeft = '';
    }
    if (!drag || drag.pointerId !== event.pointerId || drag.delta === 0) { this._options.onLocalStateChange(); return; }
    this._run(() => {
      const command = createMoveAnimationKeyframesCommand(
        this._options.document, clip.id, drag.refs, drag.delta, drag.duplicate,
      );
      if (!command || !this._options.history.execute(command)) return;
      this._selectedKeyframes.clear();
      for (const ref of drag.refs) this._selectedKeyframes.add(keyframeRefKey(ref.instanceId, ref.frame + drag.delta));
      this._selectionAnchor = drag.refs.length > 0
        ? { instanceId: drag.refs[0]!.instanceId, frame: drag.refs[0]!.frame + drag.delta }
        : null;
      this._options.document.setAnimationFrame(Math.max(0, this._options.document.animationFrame + drag.delta));
      this._options.notify(translate(drag.duplicate ? 'animation.keysDuplicated' : 'animation.keysMoved', {
        count: drag.refs.length,
      }));
    });
  }

  private _keyDown(event: KeyboardEvent): void {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); this.copySelected(); return; }
    if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); this._run(() => this.pasteAtCurrent()); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this._run(() => this.deleteSelected());
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 5 : 1);
    const clip = this._options.document.activeAnimationView;
    const refs = Array.from(this._selectedKeyframes, parseKeyframeRef);
    if (!clip || refs.length === 0) {
      this._options.document.setAnimationFrame(this._options.document.animationFrame + delta);
      return;
    }
    this._run(() => {
      const { min, max } = animationRefBounds(refs);
      const safeDelta = Math.max(-min, Math.min(clip.frameCount - 1 - max, delta));
      const command = createMoveAnimationKeyframesCommand(
        this._options.document, clip.id, refs, safeDelta, event.altKey,
      );
      if (!command || !this._options.history.execute(command)) return;
      this._selectedKeyframes.clear();
      for (const ref of refs) this._selectedKeyframes.add(keyframeRefKey(ref.instanceId, ref.frame + safeDelta));
    });
  }

  private _syncState(clip: VoxelAnimationClip | null): void {
    const frameWidth = timelineFrameWidth(clip?.frameCount ?? 1);
    for (const playhead of this._timeline.querySelectorAll<HTMLElement>('.timeline-playhead')) {
      playhead.style.left = `${(this._options.document.animationFrame + 0.5) * frameWidth}px`;
    }
    for (const marker of this._timeline.querySelectorAll<HTMLElement>('.timeline-keyframe')) {
      marker.classList.toggle('selected', this._selectedKeyframes.has(
        keyframeRefKey(marker.dataset.instanceId!, Number(marker.dataset.frame)),
      ));
    }
  }

  private _structureSignature(clip: VoxelAnimationClip): string {
    const range = animationPlaybackRange(clip);
    const tracks = new Map(clip.tracks.map(track => [track.instanceId, track]));
    return [clip.id, clip.frameCount, range.start, range.end, ...this._options.document.moduleInstances.flatMap(instance => [
      instance.name,
      instance.id,
      ...(tracks.get(instance.id)?.keyframes.map(keyframe => keyframe.frame) ?? []),
    ])].join('|');
  }

  private _discardMissingSelection(clip: VoxelAnimationClip | null): void {
    if (!clip) { this._selectedKeyframes.clear(); return; }
    const valid = new Set(clip.tracks.flatMap(track =>
      track.keyframes.map(keyframe => keyframeRefKey(track.instanceId, keyframe.frame))));
    for (const key of this._selectedKeyframes) if (!valid.has(key)) this._selectedKeyframes.delete(key);
  }

  private _run(action: () => void): void {
    try { action(); }
    catch (error) { this._options.notify(error instanceof Error ? error.message : String(error), true); }
  }
}

function element<T extends Element = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}

function emptyTimeline(message: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'timeline-empty';
  empty.textContent = message;
  return empty;
}

function keyframeRefKey(instanceId: string, frame: number): string { return `${instanceId}\u0000${Math.round(frame)}`; }

function parseKeyframeRef(key: string): AnimationKeyframeRef {
  const separator = key.lastIndexOf('\u0000');
  return { instanceId: key.slice(0, separator), frame: Number(key.slice(separator + 1)) };
}

function timelineFrameWidth(frameCount: number): number {
  if (frameCount > 1000) return 5;
  if (frameCount > 300) return 7;
  if (frameCount > 120) return 10;
  return 14;
}

function timelineTickStep(frameCount: number): number {
  if (frameCount > 1000) return 100;
  if (frameCount > 300) return 50;
  if (frameCount > 120) return 20;
  if (frameCount > 60) return 10;
  return 5;
}

function instanceName(document: VoxelDocument, instanceId: string): string {
  return document.getModuleInstance(instanceId)?.name ?? instanceId;
}

function animationRefBounds(refs: readonly Readonly<AnimationKeyframeRef>[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const ref of refs) {
    min = Math.min(min, ref.frame);
    max = Math.max(max, ref.frame);
  }
  return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
}
