import type { AnimationEditorProject } from '../../domain/AnimationEditorProject';
import { readParticle2DDescriptor, type Particle2DAuthoringEdit } from '../../domain/ParticleProjectAuthoring';
import type { ParticlePreviewStatistics, ParticleStateSnapshot } from '../../domain/ParticleAuthoringTypes';
import { Particle2DPreviewSession } from './Particle2DPreviewSession';
import { ParticleTextureResourceSession, type ParticleTextureLoader } from './ParticleTextureResourceSession';

export interface ParticleCanvasAuthoringAdapterOptions {
  readonly project: () => AnimationEditorProject;
  readonly nodeId: string;
  readonly componentId: string;
  readonly textureLoader?: ParticleTextureLoader;
  readonly onEdit: (edit: Particle2DAuthoringEdit, label: string) => void;
  readonly onExactPreviewRequested?: () => void;
  readonly onStatistics?: (statistics: ParticlePreviewStatistics) => void;
  readonly onTimeChange?: (time: number) => void;
}

export interface ParticleCanvasAdapterMetrics {
  readonly renderPasses: number;
  readonly scrubs: number;
  readonly editCommits: number;
  readonly exactPreviewRequests: number;
  readonly listenerCount: number;
}

/** Leaf authoring-canvas adapter; shell and shared Inspector wiring stay with G09. */
export class ParticleCanvasAuthoringAdapter {
  private readonly _context: CanvasRenderingContext2D;
  private _session: Particle2DPreviewSession;
  private readonly _resources: ParticleTextureResourceSession | null;
  private _snapshot: ParticleStateSnapshot;
  private _disposed = false;
  private _renderPasses = 0;
  private _scrubs = 0;
  private _editCommits = 0;
  private _exactPreviewRequests = 0;
  private readonly _onPointerDown = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
    this.scrub(ratio * this._options.project().composition.duration);
  };
  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const project = this._options.project();
    const step = 1 / project.composition.frameRate;
    const time = event.key === 'Home' ? 0
      : event.key === 'End' ? project.composition.duration
        : this._snapshot.canonicalTime + (event.key === 'ArrowLeft' ? -step : step);
    this.scrub(time);
  };

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly _options: ParticleCanvasAuthoringAdapterOptions,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Particle authoring requires a 2D canvas context.');
    this._context = context;
    const project = _options.project();
    const descriptor = readParticle2DDescriptor(project, _options.nodeId, _options.componentId);
    this._session = new Particle2DPreviewSession(descriptor, {
      duration: project.composition.duration,
      loop: descriptor.loop ?? project.composition.endBehavior === 'loop',
      project,
    });
    this._snapshot = this._session.scrub(project.editor?.timeline?.playhead ?? 0);
    this._resources = _options.textureLoader
      ? new ParticleTextureResourceSession(_options.textureLoader, () => this.render())
      : null;
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    canvas.setAttribute('role', 'slider');
    canvas.setAttribute('aria-label', 'Particle preview timeline');
    canvas.setAttribute('aria-valuemin', '0');
    canvas.setAttribute('aria-valuemax', String(project.composition.duration));
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('keydown', this._onKeyDown);
    this.render();
  }

  get metrics(): ParticleCanvasAdapterMetrics {
    return Object.freeze({
      renderPasses: this._renderPasses,
      scrubs: this._scrubs,
      editCommits: this._editCommits,
      exactPreviewRequests: this._exactPreviewRequests,
      listenerCount: this._disposed ? 0 : 2,
    });
  }

  get snapshot(): ParticleStateSnapshot { return this._snapshot; }

  edit(edit: Particle2DAuthoringEdit, label = 'Edit particle emitter'): void {
    this._assertActive();
    this._options.onEdit(structuredClone(edit), label);
    this._editCommits++;
    this.refresh();
    if (this._options.onExactPreviewRequested) {
      this._options.onExactPreviewRequested();
      this._exactPreviewRequests++;
    }
  }

  /** Rebinds the engine emitter after an external Inspector/project edit without changing DOM listeners. */
  refresh(): void {
    this._assertActive();
    const time = this._snapshot.canonicalTime;
    const project = this._options.project();
    const descriptor = readParticle2DDescriptor(project, this._options.nodeId, this._options.componentId);
    const previous = this._session;
    this._session = new Particle2DPreviewSession(descriptor, {
      duration: project.composition.duration,
      loop: descriptor.loop ?? project.composition.endBehavior === 'loop',
      project,
    });
    this._snapshot = this._session.scrub(time);
    previous.dispose();
    this.render();
  }

  scrub(time: number): ParticleStateSnapshot {
    this._assertActive();
    this._snapshot = this._session.scrub(time);
    this._scrubs++;
    this.canvas.setAttribute('aria-valuenow', String(this._snapshot.canonicalTime));
    this._options.onTimeChange?.(this._snapshot.canonicalTime);
    this.render();
    return this._snapshot;
  }

  async replaceTexture(source: unknown): Promise<void> {
    this._assertActive();
    if (!this._resources) throw new Error('Particle canvas was created without a texture loader.');
    await this._resources.replace(source);
    this._publishStatistics();
  }

  render(): void {
    this._assertActive();
    sizeCanvas(this.canvas);
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    const scaleX = this.canvas.width / Math.max(1, width);
    const scaleY = this.canvas.height / Math.max(1, height);
    const context = this._context;
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0b1018';
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(width / 2, height / 2);
    context.globalCompositeOperation = this._session.descriptor.blendMode === 'additive' ? 'lighter' : 'source-over';
    const data = this._snapshot.instanceData;
    for (let offset = 0; offset < data.length; offset += 8) {
      const x = data[offset]!;
      const y = -data[offset + 1]!;
      const size = data[offset + 2]!;
      const rotation = -data[offset + 3]!;
      const alpha = data[offset + 7]!;
      if (size <= 0 || alpha <= 0) continue;
      context.save();
      context.translate(x, y);
      context.rotate(rotation);
      context.globalAlpha = alpha;
      const texture = this._resources?.texture;
      if (texture) context.drawImage(texture.source, -size / 2, -size / 2, size, size);
      else {
        context.fillStyle = rgba(data[offset + 4]!, data[offset + 5]!, data[offset + 6]!);
        context.fillRect(-size / 2, -size / 2, size, size);
      }
      context.restore();
    }
    context.restore();
    this._renderPasses++;
    this._publishStatistics();
  }

  dispose(): void {
    if (this._disposed) return;
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('keydown', this._onKeyDown);
    this._resources?.dispose();
    this._session.dispose();
    this._disposed = true;
  }

  private _publishStatistics(): void {
    const base = this._session.statistics(this._resources?.metrics.liveTextures ?? 0);
    this._options.onStatistics?.(Object.freeze({ ...base, listenerCount: this._disposed ? 0 : 2 }));
  }

  private _assertActive(): void {
    if (this._disposed) throw new Error('Particle canvas adapter has been disposed.');
  }
}

function sizeCanvas(canvas: HTMLCanvasElement): void {
  const ratio = typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1;
  const width = Math.max(1, Math.round((canvas.clientWidth || canvas.width || 1) * ratio));
  const height = Math.max(1, Math.round((canvas.clientHeight || canvas.height || 1) * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function rgba(red: number, green: number, blue: number): string {
  return `rgb(${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)})`;
}
