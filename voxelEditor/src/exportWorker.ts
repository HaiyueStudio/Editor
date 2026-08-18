import type { ExportWorkerMessage, ExportWorkerRequest } from './exportProtocol';
import { translate } from './localization';
import { exportVoxelProjectAsGlb } from './gltfSceneExporter';
import { VoxelDocument } from './model';
import {
  createVoxelSpriteFrame,
  createSpriteAtlas,
  drawVoxelSpriteFrame,
  mergeSpriteProjectionBounds,
  spriteSheetPlan,
  voxelSpriteProjectionBounds,
} from './spriteExporter';
import type { SpriteProjectionBounds } from './spriteExporter';
import type { SpriteDirection, SpriteView } from './spriteExporter';
import { exportVoxelProjectAsVox } from './voxExporter';

interface WorkerScope {
  onmessage: ((event: MessageEvent<ExportWorkerRequest>) => void) | null;
  postMessage(message: ExportWorkerMessage, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = event => {
  void runExport(event.data).catch(error => {
    scope.postMessage({
      type: 'error',
      id: event.data.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

async function runExport(request: ExportWorkerRequest): Promise<void> {
  progress(request.id, 0.02, translate('export.progress.project', {}, request.locale));
  if (request.format === 'json') {
    progress(request.id, 0.45, translate('export.progress.json', {}, request.locale));
    const bytes = new TextEncoder().encode(JSON.stringify(request.project, null, 2));
    success(request, bytes.buffer, { byteLength: bytes.byteLength });
    return;
  }
  if (request.format === 'vox') {
    const result = exportVoxelProjectAsVox(request.project, value => {
      progress(request.id, 0.05 + value * 0.9, translate('export.progress.vox', {}, request.locale));
    });
    success(request, result.data.buffer, {
      voxelCount: result.voxelCount,
      paletteSize: result.paletteSize,
      quantized: result.quantized,
      modelCount: result.modelCount,
      instanceCount: result.instanceCount,
      layerCount: result.layerCount,
      animationFrameCount: result.animationFrameCount,
      partialMaterialCount: result.partialMaterialCount,
    });
    return;
  }

  if (request.format === 'glb') {
    progress(request.id, 0.06, translate('export.progress.compose', {}, request.locale));
    const result = exportVoxelProjectAsGlb(
      request.project,
      { mode: request.mode, includeAnimations: request.includeAnimations },
      value => progress(request.id, 0.08 + value * 0.87, translate('export.progress.glb', {}, request.locale)),
    );
    success(request, result.data.buffer, {
      exposedFaceCount: result.exposedFaceCount,
      vertexCount: result.vertexCount,
      triangleCount: result.triangleCount,
      nodeCount: result.nodeCount,
      meshCount: result.meshCount,
      animationCount: result.animationCount,
      instanceCount: result.instanceCount,
    });
    return;
  }

  const document = new VoxelDocument(request.project.size);
  document.load(request.project);
  if (typeof OffscreenCanvas === 'undefined') throw new Error('当前浏览器不支持在后台线程生成 Sprite。');
  const active = document.activeAnimation;
  const frameCount = active?.frameCount ?? 1;
  const start = request.singleFrame ? request.currentFrame : clampFrame(request.frameStart, frameCount);
  const end = request.singleFrame ? request.currentFrame : clampFrame(request.frameEnd, frameCount);
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);
  const frames = Array.from({ length: rangeEnd - rangeStart + 1 }, (_value, index) => rangeStart + index);
  const directions: SpriteDirection[] = request.directions.length > 0 ? [...request.directions] : ['front'];
  const outputs = directions.flatMap(direction => frames.map(frame => ({ direction, frame })));
  const sheet = spriteSheetPlan(
    outputs.length,
    request.options.width,
    request.options.height,
    request.singleFrame ? 'horizontal' : request.layout,
    request.columns,
  );
  const output = new OffscreenCanvas(sheet.width, sheet.height);
  const context = output.getContext('2d');
  if (!context) throw new Error('浏览器无法创建后台 Sprite 画布。');
  const boundsByDirection = new Map<SpriteDirection, SpriteProjectionBounds | null>();
  if (outputs.length > 1) {
    for (let index = 0; index < outputs.length; index += 1) {
      const item = outputs[index]!;
      const voxels = document.getSceneVoxelsAtFrame(item.frame);
      const view = directionView(item.direction);
      boundsByDirection.set(item.direction, mergeSpriteProjectionBounds(
        boundsByDirection.get(item.direction) ?? null,
        voxelSpriteProjectionBounds(voxels, view),
      ));
      progress(request.id, 0.08 + ((index + 1) / outputs.length) * 0.22, translate('export.progress.spriteBounds', {
        current: index + 1,
        total: outputs.length,
      }, request.locale));
    }
  }
  let visibleVoxelCount = 0;
  const atlasFrames = [];
  const animationName = safeFrameName(active?.name || 'scene');
  for (let index = 0; index < outputs.length; index += 1) {
    const item = outputs[index]!;
    const voxels = document.getSceneVoxelsAtFrame(item.frame);
    visibleVoxelCount += voxels.length;
    const plan = createVoxelSpriteFrame(
      document.size,
      voxels,
      { ...request.options, view: directionView(item.direction) },
      boundsByDirection.get(item.direction) ?? null,
    );
    const column = index % sheet.columns;
    const row = Math.floor(index / sheet.columns);
    drawVoxelSpriteFrame(
      context as unknown as CanvasRenderingContext2D,
      plan,
      column * plan.width,
      row * plan.height,
      request.options.background,
    );
    atlasFrames.push({
      name: `${animationName}/${item.direction}_${String(item.frame).padStart(4, '0')}`,
      frame: item.frame,
      direction: item.direction,
      column,
      row,
      plan,
    });
    progress(request.id, 0.3 + ((index + 1) / outputs.length) * 0.58, translate('export.progress.spriteFrame', {
      current: index + 1,
      total: outputs.length,
    }, request.locale));
  }
  if (visibleVoxelCount === 0) throw new Error('当前输出范围内没有可见体素。');
  progress(request.id, 0.92, translate('export.progress.png', {}, request.locale));
  const blob = await output.convertToBlob({ type: 'image/png' });
  const data = await blob.arrayBuffer();
  const atlas = createSpriteAtlas(atlasFrames, {
    image: 'voxel-sprite-sheet.png',
    sheet,
    frameWidth: request.options.width,
    frameHeight: request.options.height,
    pivot: request.pivot,
    fps: active?.fps ?? 1,
    loop: active?.loop ?? false,
    frameStart: rangeStart,
    frameEnd: rangeEnd,
    directions,
  });
  success(request, data, {
    frameCount: frames.length,
    outputFrameCount: outputs.length,
    directionCount: directions.length,
    columns: sheet.columns,
    rows: sheet.rows,
    width: sheet.width,
    height: sheet.height,
    atlasJson: JSON.stringify(atlas, null, 2),
  });
}

function directionView(direction: SpriteDirection): SpriteView {
  return direction === 'right' ? 'side' : direction;
}

function clampFrame(value: number, frameCount: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, Math.min(frameCount - 1, rounded));
}

function safeFrameName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|\s]+/g, '_') || 'scene';
}

function progress(id: number, value: number, label: string): void {
  scope.postMessage({ type: 'progress', id, progress: Math.max(0, Math.min(1, value)), label });
}

function success(
  request: ExportWorkerRequest,
  data: ArrayBuffer,
  metadata: Record<string, number | boolean | string>,
): void {
  scope.postMessage({ type: 'success', id: request.id, format: request.format, data, metadata }, [data]);
}
