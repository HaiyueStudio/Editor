import type { AnimationEditorProject } from '../../domain/AnimationEditorProject';
import {
  generateSpriteSheetProjectAnimation,
  reorderSpriteSheetSequence,
  spriteSheetScheduledFrameAtTime,
} from '../../domain/SpriteSheetSequenceAuthoring';
import { requiredSpriteSheetFrame } from '../../domain/SpriteSheetGridAuthoring';
import type {
  SpriteSheetFrame,
  SpriteSheetFrameMap,
  SpriteSheetGenerationResult,
  SpriteSheetSchedule,
  SpriteSheetSequence,
} from '../../domain/SpriteSheetTypes';
import { SpriteSheetAuthoringError } from '../../domain/SpriteSheetTypes';
import {
  SpriteSheetResourceSession,
  createBrowserSpriteSheetImageLoader,
  type SpriteSheetImageLoader,
  type SpriteSheetResourceMetrics,
} from './SpriteSheetResourceSession';

export interface SpriteSheetAuthoringAdapterOptions {
  readonly project: () => AnimationEditorProject;
  readonly nodeId: string;
  readonly componentId: string;
  readonly loader?: SpriteSheetImageLoader;
  readonly onSelectionChange?: (frameId: string) => void;
  readonly onSequenceChange?: (sequence: SpriteSheetSequence) => void;
  readonly onCommit: (project: AnimationEditorProject, label: string) => void;
  readonly onExactPreviewRequested?: (result: SpriteSheetGenerationResult) => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly label?: string;
}

export interface SpriteSheetAuthoringMetrics {
  readonly resource: SpriteSheetResourceMetrics;
  readonly renderPasses: number;
  readonly atlasDraws: number;
  readonly previewDraws: number;
  readonly pixelCopies: 0;
  readonly perFrameResources: 0;
}

/** Canvas adapter for atlas boundaries, selection, scrub, onion skin and sequence ordering. */
export class SpriteSheetAuthoringAdapter {
  private readonly _atlasCanvas: HTMLCanvasElement;
  private readonly _previewCanvas: HTMLCanvasElement;
  private readonly _options: SpriteSheetAuthoringAdapterOptions;
  private readonly _resources: SpriteSheetResourceSession;
  private _frameMap: SpriteSheetFrameMap | null = null;
  private _sequence: SpriteSheetSequence | null = null;
  private _schedule: SpriteSheetSchedule | null = null;
  private _selectedFrameId: string | null = null;
  private _selectedSequenceIndex = -1;
  private _onionSkin = true;
  private _animationFrame: number | null = null;
  private _disposed = false;
  private _renderPasses = 0;
  private _atlasDraws = 0;
  private _previewDraws = 0;

  constructor(
    atlasCanvas: HTMLCanvasElement,
    previewCanvas: HTMLCanvasElement,
    options: SpriteSheetAuthoringAdapterOptions,
  ) {
    this._atlasCanvas = atlasCanvas;
    this._previewCanvas = previewCanvas;
    this._options = options;
    this._resources = new SpriteSheetResourceSession(
      options.loader ?? createBrowserSpriteSheetImageLoader(),
      () => this.renderNow(),
    );
    atlasCanvas.tabIndex = atlasCanvas.tabIndex >= 0 ? atlasCanvas.tabIndex : 0;
    atlasCanvas.setAttribute('role', 'grid');
    atlasCanvas.setAttribute('aria-label', options.label ?? 'SpriteSheet 图集切片');
    atlasCanvas.style.touchAction = 'none';
    previewCanvas.setAttribute('role', 'img');
    previewCanvas.setAttribute('aria-label', 'SpriteSheet 当前帧与前后帧预览');
    atlasCanvas.addEventListener('pointerdown', this._pointerDown);
    atlasCanvas.addEventListener('keydown', this._keyDown);
  }

  get selectedFrameId(): string | null { return this._selectedFrameId; }
  get sequence(): SpriteSheetSequence | null { return this._sequence; }
  get metrics(): SpriteSheetAuthoringMetrics {
    return Object.freeze({
      resource: this._resources.metrics,
      renderPasses: this._renderPasses,
      atlasDraws: this._atlasDraws,
      previewDraws: this._previewDraws,
      pixelCopies: 0,
      perFrameResources: 0,
    });
  }

  async replaceImage(source: unknown): Promise<void> {
    await this._resources.replace(source, image => {
      if (this._frameMap
        && (image.width !== this._frameMap.imageWidth || image.height !== this._frameMap.imageHeight)) {
        throw new SpriteSheetAuthoringError(
          'E_SPRITESHEET_IMAGE_DIMENSIONS', '$.resource',
          `SpriteSheet frame map expects ${this._frameMap.imageWidth}×${this._frameMap.imageHeight}, received ${image.width}×${image.height}.`,
        );
      }
    });
  }

  setFrameMap(frameMap: SpriteSheetFrameMap): void {
    const image = this._resources.image;
    if (image && (image.width !== frameMap.imageWidth || image.height !== frameMap.imageHeight)) {
      throw new Error(`SpriteSheet frame map expects ${frameMap.imageWidth}×${frameMap.imageHeight}, received ${image.width}×${image.height}.`);
    }
    this._frameMap = frameMap;
    if (!this._selectedFrameId || !frameMap.frames.some(frame => frame.id === this._selectedFrameId)) {
      this._selectedFrameId = frameMap.frames[0]?.id ?? null;
    }
    this.renderNow();
  }

  setSequence(sequence: SpriteSheetSequence, schedule?: SpriteSheetSchedule): void {
    if (this._frameMap && sequence.resourceId !== this._frameMap.resourceId) {
      throw new Error('SpriteSheet sequence and frame map must share one image resource.');
    }
    if (schedule && schedule.sequenceId !== sequence.id) {
      throw new Error('SpriteSheet schedule identity does not match the active sequence.');
    }
    this._sequence = sequence;
    this._schedule = schedule ?? null;
    if (sequence.frames[0]) this._selectSequenceFrame(0);
    else this.renderNow();
  }

  setSchedule(schedule: SpriteSheetSchedule): void {
    if (this._sequence && schedule.sequenceId !== this._sequence.id) {
      throw new Error('SpriteSheet schedule identity does not match the active sequence.');
    }
    this._schedule = schedule;
  }

  setOnionSkin(enabled: boolean): void {
    this._onionSkin = enabled;
    this.renderNow();
  }

  selectFrame(frameId: string): void {
    if (!this._frameMap) throw new Error('Set a SpriteSheet frame map before selecting a frame.');
    requiredSpriteSheetFrame(this._frameMap, frameId);
    this._selectedFrameId = frameId;
    this._selectedSequenceIndex = this._sequence?.frames.findIndex(frame => frame.frameId === frameId) ?? -1;
    this._options.onSelectionChange?.(frameId);
    this._announceSelection();
    this.renderNow();
  }

  scrub(time: number): string {
    if (!this._schedule) throw new Error('Set a generated SpriteSheet schedule before scrubbing.');
    const frame = spriteSheetScheduledFrameAtTime(this._schedule, time);
    this._selectSequenceFrame(frame.sequenceIndex);
    return frame.frameId;
  }

  reorder(fromIndex: number, toIndex: number): SpriteSheetSequence {
    if (!this._sequence) throw new Error('Set a SpriteSheet sequence before reordering it.');
    this._sequence = reorderSpriteSheetSequence(this._sequence, fromIndex, toIndex);
    this._selectedSequenceIndex = this._sequence.frames.findIndex(frame => frame.frameId === this._selectedFrameId);
    this._options.onSequenceChange?.(this._sequence);
    this.renderNow();
    return this._sequence;
  }

  generate(): SpriteSheetGenerationResult {
    if (!this._frameMap || !this._sequence) throw new Error('SpriteSheet frame map and sequence are required before generation.');
    const result = generateSpriteSheetProjectAnimation(
      this._options.project(), this._options.nodeId, this._options.componentId, this._frameMap, this._sequence,
    );
    this._schedule = result.schedule;
    this._options.onCommit(result.project, '生成 SpriteSheet 动画');
    this._options.onExactPreviewRequested?.(result);
    return result;
  }

  renderNow(): void {
    if (this._disposed) return;
    if (this._animationFrame !== null) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
    }
    const image = this._resources.image;
    const frameMap = this._frameMap;
    clearCanvas(this._atlasCanvas);
    clearCanvas(this._previewCanvas);
    if (!image || !frameMap || !this._selectedFrameId) return;
    this._drawAtlas(image.source, frameMap);
    this._drawPreview(image.source, frameMap);
    this._renderPasses++;
  }

  scheduleRender(): void {
    if (this._disposed || this._animationFrame !== null) return;
    this._animationFrame = requestAnimationFrame(() => {
      this._animationFrame = null;
      this.renderNow();
    });
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._animationFrame !== null) cancelAnimationFrame(this._animationFrame);
    this._animationFrame = null;
    this._atlasCanvas.removeEventListener('pointerdown', this._pointerDown);
    this._atlasCanvas.removeEventListener('keydown', this._keyDown);
    this._resources.dispose();
  }

  private _drawAtlas(source: CanvasImageSource, frameMap: SpriteSheetFrameMap): void {
    const context = requiredContext(this._atlasCanvas);
    const fit = contain(frameMap.imageWidth, frameMap.imageHeight, this._atlasCanvas.width, this._atlasCanvas.height);
    context.drawImage(source, fit.x, fit.y, fit.width, fit.height);
    this._atlasDraws++;
    for (const frame of frameMap.frames) {
      const rect = mapFrameRect(frame, frameMap, fit);
      context.strokeStyle = frame.id === this._selectedFrameId ? '#facc15' : 'rgba(255,255,255,.65)';
      context.lineWidth = frame.id === this._selectedFrameId ? 3 : 1;
      context.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1));
    }
  }

  private _drawPreview(source: CanvasImageSource, frameMap: SpriteSheetFrameMap): void {
    const selected = requiredSpriteSheetFrame(frameMap, this._selectedFrameId!);
    const context = requiredContext(this._previewCanvas);
    const sequenceIndex = this._selectedSequenceIndex;
    let hasNeighbor = false;
    if (this._onionSkin && this._sequence && sequenceIndex >= 0) {
      const previous = this._sequence.frames[sequenceIndex - 1];
      const next = this._sequence.frames[sequenceIndex + 1];
      if (previous) {
        hasNeighbor = true;
        drawFrame(context, source, requiredSpriteSheetFrame(frameMap, previous.frameId), this._previewCanvas, 0.22);
      }
      if (next) {
        hasNeighbor = true;
        drawFrame(context, source, requiredSpriteSheetFrame(frameMap, next.frameId), this._previewCanvas, 0.22);
      }
    }
    drawFrame(context, source, selected, this._previewCanvas, hasNeighbor ? 0.72 : 1);
    context.globalAlpha = 1;
    this._previewDraws++;
  }

  private _pointerDown = (event: PointerEvent): void => {
    if (!this._frameMap) return;
    const bounds = this._atlasCanvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * this._atlasCanvas.width / Math.max(1, bounds.width);
    const y = (event.clientY - bounds.top) * this._atlasCanvas.height / Math.max(1, bounds.height);
    const fit = contain(this._frameMap.imageWidth, this._frameMap.imageHeight, this._atlasCanvas.width, this._atlasCanvas.height);
    const frame = this._frameMap.frames.find(candidate => {
      const rect = mapFrameRect(candidate, this._frameMap!, fit);
      return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    });
    if (frame) this.selectFrame(frame.id);
    this._atlasCanvas.focus();
  };

  private _keyDown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this._options.onRedo?.();
      else this._options.onUndo?.();
      return;
    }
    if (!this._frameMap || !this._selectedFrameId || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const current = this._frameMap.frames.findIndex(frame => frame.id === this._selectedFrameId);
    const horizontal = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const vertical = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const regularColumns = this._frameMap.source === 'regular-grid'
      ? this._frameMap.frames.filter(frame => frame.rect.y === this._frameMap!.frames[0]!.rect.y).length
      : 1;
    const next = Math.max(0, Math.min(this._frameMap.frames.length - 1, current + horizontal + vertical * regularColumns));
    this.selectFrame(this._frameMap.frames[next]!.id);
  };

  private _announceSelection(): void {
    if (!this._frameMap || !this._selectedFrameId) return;
    const index = this._frameMap.frames.findIndex(frame => frame.id === this._selectedFrameId);
    this._atlasCanvas.setAttribute('aria-rowcount', '1');
    this._atlasCanvas.setAttribute('aria-colcount', String(this._frameMap.frames.length));
    this._atlasCanvas.setAttribute('aria-activedescendant', this._selectedFrameId);
    this._atlasCanvas.setAttribute('aria-valuetext', `第 ${index + 1} 帧，共 ${this._frameMap.frames.length} 帧`);
  }

  private _selectSequenceFrame(index: number): void {
    const sequenceFrame = this._sequence?.frames[index];
    if (!sequenceFrame || !this._frameMap) throw new Error('Unknown SpriteSheet sequence frame.');
    requiredSpriteSheetFrame(this._frameMap, sequenceFrame.frameId);
    this._selectedSequenceIndex = index;
    this._selectedFrameId = sequenceFrame.frameId;
    this._options.onSelectionChange?.(sequenceFrame.frameId);
    this._announceSelection();
    this.renderNow();
  }
}

interface ContainedRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

function requiredContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('SpriteSheet authoring requires a 2D canvas context.');
  return context;
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const context = requiredContext(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function contain(sourceWidth: number, sourceHeight: number, width: number, height: number): ContainedRect {
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  return { x: (width - renderedWidth) / 2, y: (height - renderedHeight) / 2, width: renderedWidth, height: renderedHeight };
}

function mapFrameRect(frame: SpriteSheetFrame, frameMap: SpriteSheetFrameMap, fit: ContainedRect): ContainedRect {
  return {
    x: fit.x + frame.rect.x / frameMap.imageWidth * fit.width,
    y: fit.y + frame.rect.y / frameMap.imageHeight * fit.height,
    width: frame.rect.width / frameMap.imageWidth * fit.width,
    height: frame.rect.height / frameMap.imageHeight * fit.height,
  };
}

function drawFrame(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  frame: SpriteSheetFrame,
  canvas: HTMLCanvasElement,
  alpha: number,
): void {
  const fit = contain(frame.rect.width, frame.rect.height, canvas.width, canvas.height);
  context.globalAlpha = alpha;
  context.drawImage(
    source,
    frame.rect.x, frame.rect.y, frame.rect.width, frame.rect.height,
    fit.x, fit.y, fit.width, fit.height,
  );
}
