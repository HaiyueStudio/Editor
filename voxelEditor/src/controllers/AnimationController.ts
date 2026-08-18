import { animationPlaybackRange } from '../animation';
import { translate } from '../localization';
import {
  AnimationCreateCommand,
  AnimationDuplicateCommand,
  AnimationKeyframeCommand,
  AnimationRemoveCommand,
  AnimationUpdateCommand,
  type CommandHistory,
} from '../commands';
import type { RenderableVoxel, VoxelAnimationClip, VoxelAnimationKeyframe, VoxelDocument } from '../model';
import type { VoxelRenderer } from '../VoxelRenderer';
import { AnimationTimelineController } from './AnimationTimelineController';

type Notify = (message: string, error?: boolean) => void;

export interface AnimationControllerOptions {
  document: VoxelDocument;
  history: CommandHistory;
  notify: Notify;
  getSelectedInstanceId(): string | null;
  getRenderer(): VoxelRenderer | null;
}

/** Owns animation clips, playback, saved-state feedback, and viewport onion skin. */
export class AnimationController {
  private readonly _document: VoxelDocument;
  private readonly _history: CommandHistory;
  private readonly _notify: Notify;
  private readonly _selectedInstanceId: () => string | null;
  private readonly _getRenderer: () => VoxelRenderer | null;
  private readonly _library = element<HTMLSelectElement>('animation-library');
  private readonly _frame = element<HTMLInputElement>('animation-frame');
  private readonly _frameLabel = element<HTMLElement>('animation-frame-label');
  private readonly _play = element<HTMLButtonElement>('animation-play');
  private readonly _rangeStart = element<HTMLInputElement>('animation-range-start');
  private readonly _rangeEnd = element<HTMLInputElement>('animation-range-end');
  private readonly _onionPrevious = element<HTMLInputElement>('onion-previous');
  private readonly _onionNext = element<HTMLInputElement>('onion-next');
  private readonly _timeline: AnimationTimelineController;
  private _playbackId = 0;
  private _playbackTime = 0;

  constructor(options: AnimationControllerOptions) {
    this._document = options.document;
    this._history = options.history;
    this._notify = options.notify;
    this._selectedInstanceId = options.getSelectedInstanceId;
    this._getRenderer = options.getRenderer;
    this._timeline = new AnimationTimelineController({
      document: this._document,
      history: this._history,
      notify: this._notify,
      getSelectedInstanceId: this._selectedInstanceId,
      onLocalStateChange: () => this.sync(),
    });
    this._bind();
  }

  sync(): void {
    const animations = this._document.animationSummaries;
    const active = this._document.activeAnimationView;
    this._library.replaceChildren();
    if (animations.length === 0) this._library.add(new Option(translate('animation.empty'), ''));
    else animations.forEach(clip => this._library.add(new Option(translate('animation.clipSummary', {
      name: clip.name,
      count: clip.frameCount,
    }), clip.id)));
    this._library.value = active?.id ?? '';
    const disabled = !active;
    const name = element<HTMLInputElement>('animation-name');
    const fps = element<HTMLInputElement>('animation-fps');
    const count = element<HTMLInputElement>('animation-frame-count');
    const loop = element<HTMLInputElement>('animation-loop');
    name.disabled = disabled;
    fps.disabled = disabled;
    count.disabled = disabled;
    loop.disabled = disabled;
    name.value = active?.name ?? '';
    fps.value = String(active?.fps ?? 12);
    count.value = String(active?.frameCount ?? 1);
    loop.checked = active?.loop ?? true;
    const range = active ? animationPlaybackRange(active) : { start: 0, end: 0 };
    this._rangeStart.disabled = disabled;
    this._rangeEnd.disabled = disabled;
    this._rangeStart.max = String(active?.frameCount ?? 1);
    this._rangeEnd.max = String(active?.frameCount ?? 1);
    this._rangeStart.value = String(range.start + 1);
    this._rangeEnd.value = String(range.end + 1);
    this._frame.disabled = disabled;
    this._frame.max = String(Math.max(0, (active?.frameCount ?? 1) - 1));
    this._frame.value = String(this._document.animationFrame);
    this._frameLabel.textContent = translate('animation.frame', {
      current: this._document.animationFrame + 1,
      total: active?.frameCount ?? 1,
    });
    for (const id of [
      'remove-animation', 'duplicate-animation', 'save-animation-settings',
      'animation-prev', 'animation-play', 'animation-next',
    ]) element<HTMLButtonElement>(id).disabled = disabled;

    this._timeline.sync(active);
    const instanceId = this._selectedInstanceId();
    const track = active?.tracks.find(value => value.instanceId === instanceId);
    const keyframe = track?.keyframes.find(value => value.frame === this._document.animationFrame) ?? null;
    element<HTMLButtonElement>('set-animation-keyframe').disabled = disabled || !instanceId;
    element<HTMLButtonElement>('select-current-keyframe').disabled = !keyframe;
    element<HTMLButtonElement>('remove-animation-keyframe').disabled = !this._timeline.hasSelection && !keyframe;
    element<HTMLButtonElement>('copy-animation-keyframes').disabled = !this._timeline.hasSelection && !keyframe;
    element<HTMLButtonElement>('paste-animation-keyframes').disabled = disabled || !this._timeline.hasClipboard;
    this._syncKeyframeStatus(active, instanceId, track?.keyframes.length ?? 0, keyframe);
    this._syncOnionSkin(active);
  }

  /** Lightweight RAF update: keep clip structure and the library untouched. */
  syncFrame(): void {
    const active = this._document.activeAnimationView;
    this._frame.value = String(this._document.animationFrame);
    this._frameLabel.textContent = translate('animation.frame', {
      current: this._document.animationFrame + 1,
      total: active?.frameCount ?? 1,
    });
    this._timeline.syncFrame(active);
    const instanceId = this._selectedInstanceId();
    const track = active?.tracks.find(value => value.instanceId === instanceId);
    const keyframe = track?.keyframes.find(value => value.frame === this._document.animationFrame) ?? null;
    this._syncKeyframeStatus(active, instanceId, track?.keyframes.length ?? 0, keyframe);
    this._syncOnionSkin(active);
  }

  stopPlayback(): void {
    if (this._playbackId) cancelAnimationFrame(this._playbackId);
    this._playbackId = 0;
    this._playbackTime = 0;
    this._play.textContent = '▶';
    this._play.title = translate('animation.play');
  }

  private _togglePlayback(): void {
    if (this._playbackId) { this.stopPlayback(); return; }
    const active = this._document.activeAnimationView;
    if (!active) return;
    const initialRange = animationPlaybackRange(active);
    if (this._document.animationFrame < initialRange.start || this._document.animationFrame > initialRange.end) {
      this._document.setAnimationFrame(initialRange.start);
    }
    this._play.textContent = 'Ⅱ';
    this._play.title = translate('animation.pause');
    const tick = (time: number): void => {
      const clip = this._document.activeAnimationView;
      if (!clip) { this.stopPlayback(); return; }
      if (this._playbackTime === 0) this._playbackTime = time;
      const interval = 1000 / clip.fps;
      const elapsed = time - this._playbackTime;
      if (elapsed >= interval) {
        const steps = Math.max(1, Math.floor(elapsed / interval));
        const range = animationPlaybackRange(clip);
        let next = this._document.animationFrame + steps;
        if (next > range.end) {
          if (!clip.loop) {
            this._document.setAnimationFrame(range.end);
            this.stopPlayback();
            return;
          }
          next = range.start + ((next - range.start) % (range.end - range.start + 1));
        }
        this._document.setAnimationFrame(next);
        this._playbackTime += steps * interval;
      }
      this._playbackId = requestAnimationFrame(tick);
    };
    this._playbackId = requestAnimationFrame(tick);
  }

  private _bind(): void {
    this._library.addEventListener('change', () => this._document.setActiveAnimation(this._library.value || null));
    element('new-animation').addEventListener('click', () => this._run(() => {
      const name = window.prompt('动画名称', `动画 ${this._document.animationSummaries.length + 1}`);
      if (name === null) return;
      this._history.execute(new AnimationCreateCommand(this._document, name, 12, 12));
      this._notify('动画片段已创建。选择实例并在不同帧记录关键帧。');
    }));
    element('duplicate-animation').addEventListener('click', () => this._run(() => this._duplicateAnimation()));
    element('remove-animation').addEventListener('click', () => this._run(() => {
      const clip = this._document.activeAnimationView;
      if (!clip || !window.confirm(`确定删除动画“${clip.name}”吗？`)) return;
      this._history.execute(new AnimationRemoveCommand(this._document, clip.id));
    }));
    element('save-animation-settings').addEventListener('click', () => this._run(() => this._saveSettings()));
    this._frame.addEventListener('input', () => this._document.setAnimationFrame(Number(this._frame.value)));
    element('animation-prev').addEventListener('click', () => this._stepFrame(-1));
    element('animation-next').addEventListener('click', () => this._stepFrame(1));
    this._play.addEventListener('click', () => this._togglePlayback());
    element('set-animation-keyframe').addEventListener('click', () => this._run(() => this._setKeyframe()));
    element('select-current-keyframe').addEventListener('click', () => this._timeline.selectCurrent());
    element('remove-animation-keyframe').addEventListener('click', () => this._run(() => this._timeline.deleteSelected()));
    element('copy-animation-keyframes').addEventListener('click', () => this._timeline.copySelected());
    element('paste-animation-keyframes').addEventListener('click', () => this._run(() => this._timeline.pasteAtCurrent()));
    this._onionPrevious.addEventListener('change', () => this._syncOnionSkin(this._document.activeAnimationView));
    this._onionNext.addEventListener('change', () => this._syncOnionSkin(this._document.activeAnimationView));
    for (const id of [
      'module-pos-x', 'module-pos-y', 'module-pos-z',
      'module-rot-x', 'module-rot-y', 'module-rot-z',
      'module-scale-x', 'module-scale-y', 'module-scale-z',
    ]) element<HTMLInputElement>(id).addEventListener('input', () => this._syncCurrentStatusOnly());
    element('module-library').addEventListener('change', () => this._syncCurrentStatusOnly());
  }

  private _saveSettings(): void {
    const clip = this._document.activeAnimationView;
    if (!clip) return;
    const changed = this._history.execute(new AnimationUpdateCommand(this._document, clip.id, {
      name: element<HTMLInputElement>('animation-name').value,
      fps: numberValue('animation-fps'),
      frameCount: numberValue('animation-frame-count'),
      loop: element<HTMLInputElement>('animation-loop').checked,
      playbackStart: numberValue('animation-range-start') - 1,
      playbackEnd: numberValue('animation-range-end') - 1,
    }));
    this._notify(changed ? '动画设置和播放区间已更新。' : '动画设置没有变化。');
  }

  private _duplicateAnimation(): void {
    const clip = this._document.activeAnimationView;
    if (!clip) return;
    const name = window.prompt('复制动画名称', `${clip.name} 副本`);
    if (name === null) return;
    if (this._history.execute(new AnimationDuplicateCommand(this._document, clip.id, name))) {
      this._notify(`已复制动画片段“${clip.name}”。`);
    }
  }

  private _stepFrame(delta: number): void {
    const clip = this._document.activeAnimationView;
    if (!clip) return;
    const range = animationPlaybackRange(clip);
    let next = this._document.animationFrame + delta;
    if (next < range.start) next = clip.loop ? range.end : range.start;
    if (next > range.end) next = clip.loop ? range.start : range.end;
    this._document.setAnimationFrame(next);
  }

  private _setKeyframe(): void {
    const clip = this._document.activeAnimationView;
    const selectedId = this._selectedInstanceId();
    const instance = selectedId ? this._document.getEvaluatedModuleInstance(selectedId) : null;
    if (!clip || !instance) { this._notify('请先选择动画和模块实例。', true); return; }
    const state = {
      ...instance,
      moduleId: element<HTMLSelectElement>('module-library').value || instance.moduleId,
      position: vectorInputs('module-pos'),
      rotation: scaleVector(vectorInputs('module-rot'), 1 / 90),
      scale: vectorInputs('module-scale'),
    };
    const changed = this._history.execute(new AnimationKeyframeCommand(
      this._document, clip.id, instance.id, this._document.animationFrame, state,
    ));
    if (changed) this._timeline.select(instance.id, this._document.animationFrame);
    this._notify(changed ? `已记录第 ${this._document.animationFrame + 1} 帧关键帧。` : '当前关键帧没有变化。');
  }

  private _syncOnionSkin(clip: VoxelAnimationClip | null): void {
    const renderer = this._getRenderer();
    if (!renderer) return;
    if (!clip || this._document.isEditingModule || (!this._onionPrevious.checked && !this._onionNext.checked)) {
      renderer.clearOnionSkin();
      return;
    }
    const range = animationPlaybackRange(clip);
    const frame = this._document.animationFrame;
    const adjacent = (delta: number): number | null => {
      const candidate = frame + delta;
      if (candidate >= range.start && candidate <= range.end) return candidate;
      if (!clip.loop) return null;
      return delta < 0 ? range.end : range.start;
    };
    const current = this._document.sceneVoxelsAtFrame(frame);
    const ghosts = (target: number | null): RenderableVoxel[] => target === null
      ? []
      : Array.from(this._document.sceneVoxelsAtFrame(target).entries()).flatMap(([key, voxel]) => {
        if (voxel.source !== 'module-instance') return [];
        const currentVoxel = current.get(key);
        return currentVoxel?.source === 'module-instance'
          && currentVoxel.moduleInstanceId === voxel.moduleInstanceId
          && currentVoxel.color === voxel.color
          ? []
          : [voxel];
      });
    renderer.setOnionSkin(
      this._onionPrevious.checked ? ghosts(adjacent(-1)) : [],
      this._onionNext.checked ? ghosts(adjacent(1)) : [],
    );
  }

  private _syncCurrentStatusOnly(): void {
    const clip = this._document.activeAnimationView;
    const instanceId = this._selectedInstanceId();
    const track = clip?.tracks.find(candidate => candidate.instanceId === instanceId);
    const keyframe = track?.keyframes.find(candidate => candidate.frame === this._document.animationFrame) ?? null;
    this._syncKeyframeStatus(clip, instanceId, track?.keyframes.length ?? 0, keyframe);
  }

  private _syncKeyframeStatus(
    clip: VoxelAnimationClip | null,
    instanceId: string | null,
    trackCount: number,
    keyframe: VoxelAnimationKeyframe | null,
  ): void {
    const status = element<HTMLElement>('animation-keyframe-status');
    status.classList.remove('saved', 'inherited');
    if (!clip || !instanceId) {
      status.textContent = translate('animation.statusSelect');
    } else if (!keyframe) {
      status.classList.add('inherited');
      status.textContent = translate('animation.statusInherited', { count: trackCount });
    } else if (!this._inputsMatchKeyframe(keyframe)) {
      status.classList.add('inherited');
      status.textContent = translate('animation.statusModified');
    } else {
      status.classList.add('saved');
      status.textContent = translate('animation.statusSaved', { count: trackCount });
    }
  }

  private _inputsMatchKeyframe(keyframe: VoxelAnimationKeyframe): boolean {
    const moduleId = element<HTMLSelectElement>('module-library').value;
    return (!moduleId || moduleId === keyframe.moduleId)
      && sameVector(vectorInputs('module-pos'), keyframe.position)
      && sameVector(scaleVector(vectorInputs('module-rot'), 1 / 90), keyframe.rotation)
      && sameVector(vectorInputs('module-scale'), keyframe.scale);
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

function numberValue(id: string): number { return Number(element<HTMLInputElement>(id).value); }

function vectorInputs(prefix: string): { x: number; y: number; z: number } {
  return { x: numberValue(`${prefix}-x`), y: numberValue(`${prefix}-y`), z: numberValue(`${prefix}-z`) };
}

function scaleVector(value: { x: number; y: number; z: number }, scale: number): { x: number; y: number; z: number } {
  return { x: value.x * scale, y: value.y * scale, z: value.z * scale };
}

function sameVector(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
