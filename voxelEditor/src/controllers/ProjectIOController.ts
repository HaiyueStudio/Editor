import type { GEDropdown, GEDropdownSelectDetail } from '@haiyue/ui';
import { DocumentSnapshotCommand, ModuleCreateCommand, type CommandHistory } from '../commands';
import type { ExportSuccessMessage, ExportWorkerMessage, ExportWorkerRequest } from '../exportProtocol';
import { pixelArtDimension, rasterizePixelArt } from '../imageImporter';
import type { VoxelDocument } from '../model';
import { parseProjectImport, type ProjectImportFormat, type ProjectImportResult } from '../projectImport';
import type { ProjectImportWorkerMessage, ProjectImportWorkerRequest } from '../projectImportProtocol';
import {
  scaleSpriteExportOptions,
  type SpriteDirection,
  type SpriteExportOptions,
  type SpriteSheetLayout,
  type SpriteView,
} from '../spriteExporter';
import type { ProjectFileFormat } from '../projectStorage';
import { getEditorLocale, translate } from '../localization';

export type ExportFormat = 'json' | 'vox' | 'gltf' | 'sprite';
type Notify = (message: string, error?: boolean) => void;
type ExportRequestInput =
  | Omit<Extract<ExportWorkerRequest, { format: 'json' }>, 'id' | 'project' | 'locale'>
  | Omit<Extract<ExportWorkerRequest, { format: 'glb' }>, 'id' | 'project' | 'locale'>
  | Omit<Extract<ExportWorkerRequest, { format: 'vox' }>, 'id' | 'project' | 'locale'>
  | Omit<Extract<ExportWorkerRequest, { format: 'sprite' }>, 'id' | 'project' | 'locale'>;

class ExportCancelledError extends Error {}

export interface ProjectIOControllerOptions {
  document: VoxelDocument;
  history: CommandHistory;
  notify: Notify;
  resetCamera(): void;
  setCopiedModuleId(moduleId: string): void;
  onProjectOpened?(name: string, format: ProjectFileFormat): void;
  confirmReplaceProject?(): boolean;
}

export class ProjectIOController {
  private readonly _document: VoxelDocument;
  private readonly _history: CommandHistory;
  private readonly _notify: Notify;
  private readonly _resetCamera: () => void;
  private readonly _setCopiedModuleId: (moduleId: string) => void;
  private readonly _onProjectOpened: (name: string, format: ProjectFileFormat) => void;
  private readonly _confirmReplaceProject: () => boolean;
  private readonly _projectFile = element<HTMLInputElement>('project-file');
  private readonly _imageFile = element<HTMLInputElement>('image-file');
  private readonly _progress = element<HTMLElement>('export-progress');
  private readonly _progressLabel = element<HTMLElement>('export-progress-label');
  private readonly _progressPercent = element<HTMLElement>('export-progress-percent');
  private readonly _progressBar = element<HTMLProgressElement>('export-progress-bar');
  private _nextRequestId = 1;
  private _active: { id: number; worker: Worker; reject: (reason: Error) => void } | null = null;
  private _projectName = 'voxel-project';

  constructor(options: ProjectIOControllerOptions) {
    this._document = options.document;
    this._history = options.history;
    this._notify = options.notify;
    this._resetCamera = options.resetCamera;
    this._setCopiedModuleId = options.setCopiedModuleId;
    this._onProjectOpened = options.onProjectOpened ?? (() => {});
    this._confirmReplaceProject = options.confirmReplaceProject ?? (() => true);
    this._bind();
  }

  private _bind(): void {
    const exportMenu = element<GEDropdown>('export-menu');
    this.syncLocale();
    const handleExport = (event: Event): void => {
      const format = (event as CustomEvent<GEDropdownSelectDetail>).detail.value as ExportFormat;
      void this.exportProject(format).catch(error => this._reportExportError(error));
    };
    exportMenu.addEventListener('item-select', handleExport);

    const chooseProject = (): void => this._projectFile.click();
    element('import-project').addEventListener('click', chooseProject);
    this._projectFile.addEventListener('change', () => void this._importProjectInput());

    const chooseImage = (): void => this._imageFile.click();
    for (const id of ['import-image', 'import-image-header']) {
      element(id).addEventListener('click', chooseImage);
    }
    this._imageFile.addEventListener('change', () => void this._importImageInput());
    element('cancel-export').addEventListener('click', () => this.cancel());
    element('export-sprite-frame').addEventListener('click', () => void this._exportSprite(true).catch(error => this._reportExportError(error)));
    element('export-sprite-sheet').addEventListener('click', () => void this._exportSprite(false).catch(error => this._reportExportError(error)));
  }

  syncLocale(): void {
    const items = [
      { label: translate('export.jsonProject'), value: 'json' },
      { label: translate('export.voxProject'), value: 'vox' },
      { separator: true },
      { label: translate('export.glbModel'), value: 'gltf' },
      { label: translate('export.spriteSheet'), value: 'sprite' },
    ];
    element<GEDropdown>('export-menu').items = items;
  }

  cancel(): void {
    const job = this._active;
    if (!job) return;
    job.worker.terminate();
    this._active = null;
    this._progress.classList.remove('visible');
    job.reject(new ExportCancelledError('导出已取消。'));
  }

  setProjectName(name: string): void {
    this._projectName = normalizedProjectName(name);
  }

  async exportProject(format: ExportFormat): Promise<void> {
    if (format === 'json') {
      const result = await this._runWorker({ format: 'json' });
      download(`${downloadBaseName(this._projectName)}.json`, new Uint8Array(result.data), 'application/json');
      this._notify('JSON 完整工程已导出。');
      return;
    }
    if (format === 'sprite') {
      await this._exportSprite(false);
      return;
    }
    if (format === 'vox') {
      const result = await this._runWorker({ format: 'vox' });
      download(`${downloadBaseName(this._projectName)}.vox`, new Uint8Array(result.data), 'application/octet-stream');
      const paletteHint = result.metadata.quantized
        ? `，颜色已量化至 ${result.metadata.paletteSize} 色`
        : `，使用 ${result.metadata.paletteSize} 色`;
      const animationHint = Number(result.metadata.animationFrameCount) > 1
        ? `，动画 ${result.metadata.animationFrameCount} 帧`
        : '';
      const materialHint = Number(result.metadata.partialMaterialCount) > 0
        ? `；${result.metadata.partialMaterialCount} 个 Glass / Emit / Media 材质保留了 VOX 原始参数，编辑器 PBR 预览为近似效果`
        : '';
      this._notify(`VOX 完整工程已导出：${result.metadata.modelCount} 个模型，${result.metadata.instanceCount} 个实例，${Number(result.metadata.voxelCount).toLocaleString()} 个定义体素${animationHint}${paletteHint}${materialHint}。`);
      return;
    }
    const result = await this._runWorker({
      format: 'glb',
      mode: element<HTMLSelectElement>('glb-export-mode').value as 'merged' | 'instances',
      includeAnimations: element<HTMLInputElement>('glb-include-animations').checked,
    });
    download('voxel-model.glb', new Uint8Array(result.data), 'model/gltf-binary');
    const structureHint = result.metadata.instanceCount
      ? `，${result.metadata.meshCount} 个共享网格、${result.metadata.nodeCount} 个节点、${result.metadata.animationCount} 段动画`
      : '，静态合并模式';
    this._notify(`GLB 已导出：${Number(result.metadata.exposedFaceCount).toLocaleString()} 个合并面，${Number(result.metadata.triangleCount).toLocaleString()} 个三角面${structureHint}。`);
  }

  async importProjectFile(file: File): Promise<boolean> {
    if (!this._confirmReplaceProject()) return false;
    try {
      const fileName = file.name.toLowerCase();
      if (fileName.endsWith('.json') || file.type === 'application/json') {
        const imported = await this._runImportWorker(file, 'json');
        this.openProjectSnapshot(imported.project, file.name, 'json', '导入 JSON 工程');
        this._notify(`已导入 JSON 完整工程，共 ${this._document.sceneVoxelCount.toLocaleString()} 个场景体素。`);
        return true;
      }
      if (!fileName.endsWith('.vox')) throw new Error('请选择 JSON 或 VOX 工程文件。');
      const imported = await this._runImportWorker(file, 'vox');
      this.openProjectSnapshot(imported.project, file.name, 'vox', '导入 MagicaVoxel VOX');
      const voxelTotal = Number(imported.metadata.voxelCount ?? 0);
      const animationHint = imported.metadata.animated ? `；已保留 ${imported.project.animations?.[0]?.frameCount ?? 1} 帧动画` : '';
      const partialMaterials = Number(imported.metadata.partialMaterialCount ?? 0);
      const materialHint = partialMaterials > 0
        ? `；${partialMaterials} 个 Glass / Emit / Media 材质已保留原始 MATL，PBR 视口仅近似显示`
        : '';
      this._notify(`已导入 VOX 完整工程：${imported.metadata.modelCount} 个模型，${imported.metadata.instanceCount} 个实例，${voxelTotal.toLocaleString()} 个定义体素${animationHint}${materialHint}。`);
      return true;
    } catch (error) {
      this._notify(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  openProjectSnapshot(project: unknown, name: string, format: ProjectFileFormat, label: string): void {
    const changed = this._history.execute(new DocumentSnapshotCommand(this._document, label, () => {
      this._document.load(project);
      return true;
    }));
    if (!changed) return;
    this._projectName = normalizedProjectName(name);
    this._resetCamera();
    this._onProjectOpened(this._projectName, format);
  }

  async importImageFile(file: File): Promise<boolean> {
    try {
      const width = pixelArtDimension(numberValue('pixel-art-width'), '像素画宽度');
      const height = pixelArtDimension(numberValue('pixel-art-height'), '像素画高度');
      const imageData = await readImagePixels(file);
      const pixels = rasterizePixelArt(imageData, width, height, {
        maxColors: numberValue('pixel-art-colors'),
        dither: element<HTMLInputElement>('pixel-art-dither').checked,
        mergeThreshold: element<HTMLInputElement>('pixel-art-merge').checked ? 12 : 0,
      });
      if (pixels.length === 0) throw new Error('图片中没有可生成的非透明像素。');
      const moduleName = file.name.replace(/\.[^.]+$/, '').trim() || '图片模块';
      const command = new ModuleCreateCommand(
        this._document,
        moduleName,
        { x: width, y: height, z: 1 },
        pixels.map(pixel => ({ x: pixel.x, y: pixel.y, z: 0, color: pixel.color })),
        false,
        '导入图片为模块',
      );
      const changed = this._history.execute(command);
      const created = command.module;
      if (!changed || !created) throw new Error('无法创建图片模块。');
      this._setCopiedModuleId(created.id);
      const colors = new Set(pixels.map(pixel => pixel.color)).size;
      this._notify(`已从 ${imageData.width}×${imageData.height} 图片创建模块“${moduleName}”：${width}×${height}，${colors} 色、共 ${pixels.length.toLocaleString()} 个方块，可直接粘贴复用。`);
      return true;
    } catch (error) {
      this._notify(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  async importDroppedFiles(files: readonly File[]): Promise<void> {
    const project = files.find(file => isProjectFile(file));
    if (project) {
      await this.importProjectFile(project);
      return;
    }
    const images = files.filter(file => isImageFile(file));
    if (images.length === 0) {
      this._notify('拖放仅支持 JSON、VOX 或常见图片格式。', true);
      return;
    }
    for (const image of images) await this.importImageFile(image);
  }

  private async _exportSprite(singleFrame: boolean): Promise<void> {
    const options = this._spriteOptions();
    const active = this._document.activeAnimation;
    const requestedEnd = numberValue('sprite-frame-end');
    const result = await this._runWorker({
      format: 'sprite',
      singleFrame,
      currentFrame: this._document.animationFrame,
      options,
      layout: element<HTMLSelectElement>('sprite-layout').value as SpriteSheetLayout,
      columns: numberValue('sprite-columns'),
      frameStart: Math.max(0, Math.round(numberValue('sprite-frame-start')) - 1),
      frameEnd: requestedEnd <= 0 ? (active?.frameCount ?? 1) - 1 : Math.max(0, Math.round(requestedEnd) - 1),
      directions: this._spriteDirections(),
      pivot: {
        x: numberValue('sprite-pivot-x'),
        y: numberValue('sprite-pivot-y'),
      },
    });
    download(
      singleFrame ? `voxel-sprite-${this._document.animationFrame + 1}.png` : 'voxel-sprite-sheet.png',
      new Uint8Array(result.data),
      'image/png',
    );
    if (!singleFrame && typeof result.metadata.atlasJson === 'string') {
      download('voxel-sprite-sheet.json', result.metadata.atlasJson, 'application/json');
    }
    const { frameCount = 1, columns = 1, rows = 1, width = options.width, height = options.height } = result.metadata;
    this._notify(singleFrame
      ? `当前帧 Sprite 已输出：${width}×${height}。`
      : `Sprite Sheet 与 atlas JSON 已输出：${frameCount} 帧 × ${result.metadata.directionCount ?? 1} 个方向，${columns}×${rows} 排列，尺寸 ${width}×${height}。`);
  }

  private _spriteOptions(): SpriteExportOptions {
    return scaleSpriteExportOptions({
      width: numberValue('sprite-width'),
      height: numberValue('sprite-height'),
      view: element<HTMLSelectElement>('sprite-view').value as SpriteView,
      padding: numberValue('sprite-padding'),
      background: element<HTMLInputElement>('sprite-transparent').checked ? null : '#0e131b',
    }, numberValue('sprite-resolution-scale'));
  }

  private _spriteDirections(): SpriteDirection[] {
    const mode = element<HTMLSelectElement>('sprite-direction-mode').value;
    if (mode === 'four') return ['front', 'right', 'back', 'left'];
    if (mode === 'six') return ['front', 'right', 'back', 'left', 'top', 'bottom'];
    const view = element<HTMLSelectElement>('sprite-view').value as SpriteView;
    return [view === 'side' ? 'right' : view];
  }

  private _runWorker(input: ExportRequestInput): Promise<ExportSuccessMessage> {
    if (this._active) return Promise.reject(new Error('已有导出任务正在运行。'));
    const id = this._nextRequestId++;
    const worker = new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' });
    this._progressBar.value = 0;
    this._progressPercent.textContent = '0%';
    this._progressLabel.textContent = translate('export.preparing');
    this._progress.classList.add('visible');
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        worker.terminate();
        if (this._active?.id === id) this._active = null;
        this._progress.classList.remove('visible');
      };
      this._active = { id, worker, reject };
      worker.onmessage = (event: MessageEvent<ExportWorkerMessage>) => {
        const message = event.data;
        if (message.id !== id) return;
        if (message.type === 'progress') {
          this._progressBar.value = message.progress;
          this._progressPercent.textContent = `${Math.round(message.progress * 100)}%`;
          this._progressLabel.textContent = message.label;
          return;
        }
        cleanup();
        if (message.type === 'error') reject(new Error(message.message));
        else resolve(message);
      };
      worker.onerror = event => {
        cleanup();
        reject(new Error(event.message || '导出 Worker 运行失败。'));
      };
      requestAnimationFrame(() => {
        if (this._active?.id !== id) return;
        try {
          const request = {
            ...input,
            id,
            project: this._document.toJSON(),
            locale: getEditorLocale(),
          } as ExportWorkerRequest;
          worker.postMessage(request);
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  private async _runImportWorker(file: File, format: ProjectImportFormat): Promise<ProjectImportResult> {
    const data = typeof file.arrayBuffer === 'function'
      ? await file.arrayBuffer()
      : new TextEncoder().encode(await file.text()).buffer;
    if (typeof Worker === 'undefined') return parseProjectImport(format, data);
    const id = this._nextRequestId++;
    const worker = new Worker(new URL('./project-import-worker.js', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      const cleanup = (): void => worker.terminate();
      worker.onmessage = (event: MessageEvent<ProjectImportWorkerMessage>) => {
        const message = event.data;
        if (message.id !== id) return;
        cleanup();
        if (message.type === 'error') reject(new Error(message.message));
        else resolve(message.result);
      };
      worker.onerror = event => {
        cleanup();
        reject(new Error(event.message || '导入 Worker 运行失败。'));
      };
      const request: ProjectImportWorkerRequest = { id, format, data };
      worker.postMessage(request, [data]);
    });
  }

  private async _importProjectInput(): Promise<void> {
    const file = this._projectFile.files?.[0];
    if (!file) return;
    try {
      await this.importProjectFile(file);
    } finally {
      this._projectFile.value = '';
    }
  }

  private async _importImageInput(): Promise<void> {
    const file = this._imageFile.files?.[0];
    if (!file) return;
    try {
      await this.importImageFile(file);
    } finally {
      this._imageFile.value = '';
    }
  }

  private _reportExportError(error: unknown): void {
    this._notify(error instanceof Error ? error.message : String(error), !(error instanceof ExportCancelledError));
  }
}

function normalizedProjectName(name: string): string {
  return name.replace(/\.(json|vox)$/i, '').trim() || 'voxel-project';
}

function downloadBaseName(name: string): string {
  const normalized = normalizedProjectName(name).replace(/[\\/:*?"<>|]+/g, '-').trim();
  return normalized === '未命名工程' ? 'voxel-project' : normalized || 'voxel-project';
}

function isProjectFile(file: File): boolean {
  return /\.(json|vox)$/i.test(file.name) || file.type === 'application/json';
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

function element<T extends Element = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as unknown as T;
}

function numberValue(id: string): number {
  return Number(element<HTMLInputElement>(id).value);
}

function download(name: string, content: string | Uint8Array<ArrayBuffer>, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function readImagePixels(file: File): Promise<ImageData> {
  if (typeof createImageBitmap !== 'function') throw new Error('当前浏览器不支持图片解码。');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法读取图片像素。');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
