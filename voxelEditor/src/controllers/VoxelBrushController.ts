import { createVoxelPatchCommand, type CommandHistory, type VoxelChange } from '../commands';
import { generateInteractiveBrushVoxels, type BrushKind, type InteractiveBrushKind } from '../brushes';
import { voxelKey, type VoxelDocument, type VoxelPosition } from '../model';
import type { GridPlaneNormal } from '../picking';
import type { VoxelRenderer } from '../VoxelRenderer';
import type { PaletteController } from './PaletteController';
import type { ViewportTool } from './ViewportInteractionController';
import { floodFillVoxels, mirrorVoxelPositions, surfacePaintVoxels, type MirrorAxes } from '../voxelPaint';
import { packVoxelKey } from '../model';
import type { VoxelDocumentTransaction } from '../document/VoxelTransaction';
import { translate } from '../localization';

type BrushTool = Exclude<ViewportTool, 'select'>;
type Notify = (message: string, error?: boolean) => void;

interface BrushStroke {
  transaction: VoxelDocumentTransaction;
  tool: BrushTool;
  kind: BrushKind;
  mirror: MirrorAxes;
  size: number;
  color: string;
  materialId: string;
  moduleId: string | null;
  start: VoxelPosition;
  planeNormal: GridPlaneNormal;
  planeSurfaceOffset: number;
  lastCell: VoxelPosition | null;
  lastKey: string | null;
  changes: Map<string, VoxelChange>;
}

export class VoxelBrushController {
  private readonly _document: VoxelDocument;
  private readonly _history: CommandHistory;
  private readonly _palette: PaletteController;
  private readonly _getRenderer: () => VoxelRenderer | null;
  private readonly _notify: Notify;
  private readonly _kind = element<HTMLSelectElement>('brush-kind');
  private readonly _size = element<HTMLInputElement>('brush-size');
  private readonly _mirrorX = element<HTMLInputElement>('mirror-x');
  private readonly _mirrorY = element<HTMLInputElement>('mirror-y');
  private readonly _mirrorZ = element<HTMLInputElement>('mirror-z');
  private _stroke: BrushStroke | null = null;

  constructor(options: { document: VoxelDocument; history: CommandHistory; palette: PaletteController; getRenderer(): VoxelRenderer | null; notify: Notify }) {
    this._document = options.document;
    this._history = options.history;
    this._palette = options.palette;
    this._getRenderer = options.getRenderer;
    this._notify = options.notify;
    this._kind.addEventListener('change', () => this.syncLocale());
    this.syncLocale();
  }

  get isActive(): boolean { return this._stroke !== null; }

  syncLocale(): void {
    const immediate = isImmediateBrush(this._kind.value as BrushKind);
    this._size.disabled = immediate;
    this._size.title = immediate ? translate('brush.sizeNotUsed') : '';
  }

  begin(event: PointerEvent, tool: BrushTool): void {
    if (event.altKey) {
      const voxel = this._getRenderer()?.pick(event.clientX, event.clientY).voxel;
      if (voxel) { this._palette.applyColor(voxel.color); this._notify(`已吸取颜色 ${voxel.color.toUpperCase()}。`); }
      else this._notify('没有命中可吸取颜色的体素。', true);
      return;
    }
    const kind = this._kind.value as BrushKind;
    if (isImmediateBrush(kind) && tool === 'add') {
      this._notify('Flood Fill 和 Surface Paint 需要命中已有体素，请使用着色或擦除模式。', true);
      return;
    }
    const picked = this._startAt(event.clientX, event.clientY, tool);
    if (!picked) { this._notify(tool === 'add' ? '没有命中可编辑网格。' : '没有命中可编辑体素。', true); return; }
    if (!this._document.isEditingModule) {
      const target = this._document.getTargetVoxel(null, picked.cell.x, picked.cell.y, picked.cell.z);
      if (!this._document.isBaseVoxelEditable(target ?? null)) {
        this._notify('目标基础体素图层已隐藏或锁定。', true);
        return;
      }
    }
    const size = Math.max(1, Math.min(16, Math.round(Number(this._size.value) || 1)));
    this._size.value = String(size);
    const transaction = this._document.beginTransaction();
    this._stroke = {
      transaction,
      tool,
      kind,
      mirror: { x: this._mirrorX.checked, y: this._mirrorY.checked, z: this._mirrorZ.checked },
      size,
      color: this._document.currentColor,
      materialId: this._document.currentMaterialId,
      moduleId: this._document.editingModuleId,
      start: picked.cell,
      planeNormal: picked.normal,
      planeSurfaceOffset: picked.surfaceOffset,
      lastCell: null,
      lastKey: null,
      changes: new Map(),
    };
    try {
      if (isImmediateBrush(kind)) {
        this._applyImmediate(this._stroke);
        return;
      }
      this._updatePreview(this._stroke, picked.cell);
    } catch (error) {
      transaction.cancel();
      this._stroke = null;
      throw error;
    }
  }

  move(event: PointerEvent): void {
    const stroke = this._stroke;
    const renderer = this._getRenderer();
    if (!stroke || !renderer || (event.buttons & 1) === 0) return;
    try {
      const cell = renderer.pickCellOnPlane(event.clientX, event.clientY, stroke.start, stroke.planeNormal, stroke.planeSurfaceOffset);
      if (cell) this._updatePreview(stroke, cell);
      else this._clearPreview(stroke);
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  complete(event: PointerEvent): void {
    const stroke = this._stroke;
    const renderer = this._getRenderer();
    if (!stroke || !renderer) return;
    this._clearPreview(stroke);
    const end = stroke.kind === 'voxel'
      ? null
      : renderer.pickCellOnPlane(event.clientX, event.clientY, stroke.start, stroke.planeNormal, stroke.planeSurfaceOffset) ?? stroke.start;
    this._finish(end);
  }

  cancel(): void {
    const stroke = this._stroke;
    if (!stroke) return;
    try {
      if (stroke.kind === 'voxel' && stroke.changes.size > 0) {
        this._document.applyVoxelPatch(stroke.moduleId, Array.from(stroke.changes.values(), change => ({
          x: change.x,
          y: change.y,
          z: change.z,
          color: change.before,
          materialId: change.beforeMaterialId,
          layerId: change.beforeLayerId,
        })));
        this._refreshChangedVoxels(stroke, stroke.changes.values());
      }
      stroke.transaction.cancel();
    } finally {
      if (stroke.transaction.active) stroke.transaction.cancel();
      this._getRenderer()?.clearBrushPreview();
      this._stroke = null;
    }
  }

  adjustSize(delta: number): void {
    this._size.value = String(Math.max(1, Math.min(16, Math.round(Number(this._size.value) || 1) + delta)));
  }

  private _startAt(clientX: number, clientY: number, tool: BrushTool): { cell: VoxelPosition; normal: GridPlaneNormal; surfaceOffset: number } | null {
    const renderer = this._getRenderer();
    if (!renderer) return null;
    const pick = renderer.pick(clientX, clientY);
    if (tool !== 'add' && !this._document.isEditingModule && pick.voxel?.source === 'module-instance') return null;
    const cell = tool === 'add' ? pick.target : pick.voxel;
    if (!cell) return null;
    const pickedNormal = pick.normal;
    const normal: GridPlaneNormal = pickedNormal && pickedNormal.some(value => value !== 0) ? pickedNormal : [0, 1, 0];
    return { cell: { x: cell.x, y: cell.y, z: cell.z }, normal, surfaceOffset: tool === 'add' ? -0.5 : 0.5 };
  }

  private _applyPositions(stroke: BrushStroke, positions: Iterable<VoxelPosition>, renderPreview = true): void {
    const staged: VoxelChange[] = [];
    for (const position of positions) {
      const key = voxelKey(position.x, position.y, position.z);
      const visible = this._document.getViewVoxel(position.x, position.y, position.z);
      if (!this._document.isEditingModule && visible?.source === 'module-instance') continue;
      const current = this._document.getTargetVoxel(stroke.moduleId, position.x, position.y, position.z);
      if (stroke.moduleId === null && !this._document.isBaseVoxelEditable(current ?? null)) {
        throw new Error('笔刷范围涉及隐藏或锁定图层。');
      }
      const previous = stroke.changes.get(key);
      if (stroke.tool !== 'add' && !current) continue;
      const color = stroke.tool === 'erase' ? null : stroke.color;
      const materialId = stroke.tool === 'erase' ? null : stroke.materialId;
      if ((current?.color ?? null) === color && (current?.materialId ?? null) === materialId) continue;
      staged.push({
        ...position,
        before: previous ? previous.before : current?.color ?? null,
        after: color,
        beforeMaterialId: previous ? previous.beforeMaterialId ?? null : current?.materialId ?? null,
        afterMaterialId: materialId,
        beforeLayerId: previous ? previous.beforeLayerId ?? null : current?.layerId ?? null,
        afterLayerId: stroke.moduleId === null
          ? current ? current.layerId ?? null : this._document.activeVoxelLayerId
          : null,
      });
    }
    if (staged.length === 0) return;
    if (stroke.kind === 'voxel') this._document.applyVoxelPatch(stroke.moduleId, staged.map(change => ({
      ...change, color: change.after, materialId: change.afterMaterialId, layerId: change.afterLayerId,
    })));
    for (const change of staged) stroke.changes.set(voxelKey(change.x, change.y, change.z), change);
    if (stroke.kind === 'voxel') this._refreshChangedVoxels(stroke, staged);
    if (stroke.kind !== 'voxel' && renderPreview) this._renderPreview(stroke);
  }

  private _applyImmediate(stroke: BrushStroke): void {
    try {
      const source = this._document.isEditingModule
        ? this._document.viewVoxels.values()
        : this._document.voxels.values();
      const affected = stroke.kind === 'surface'
        ? surfacePaintVoxels(source, stroke.start)
        : floodFillVoxels(source, stroke.start);
      const positions = mirrorVoxelPositions(affected, this._document.viewSize, stroke.mirror);
      this._applyPositions(stroke, positions, false);
      const label = stroke.kind === 'surface'
        ? (stroke.tool === 'erase' ? '擦除外露表面' : '外露表面着色')
        : (stroke.tool === 'erase' ? '连通填充擦除' : '连通填充着色');
      const command = createVoxelPatchCommand(this._document, stroke.moduleId, stroke.changes.values(), label);
      if (!command || !this._history.execute(command)) {
        stroke.transaction.cancel();
        this._notify('没有需要更新的体素。');
      } else {
        stroke.transaction.commit();
        this._notify(`${label}：${stroke.changes.size.toLocaleString()} 个体素。`);
      }
    } finally {
      if (stroke.transaction.active) stroke.transaction.cancel();
      this._getRenderer()?.clearBrushPreview();
      this._stroke = null;
    }
  }

  private _renderPreview(stroke: BrushStroke): void {
    const material = this._document.getPaletteMaterial(stroke.materialId);
    this._getRenderer()?.setBrushPreview(
      Array.from(stroke.changes.values(), change => ({ x: change.x, y: change.y, z: change.z })),
      stroke.tool === 'erase' ? '#ff5c68' : stroke.color,
      stroke.tool === 'erase' ? 0 : material.metallic,
      stroke.tool === 'erase' ? 0.55 : material.roughness,
    );
  }

  private _applyAt(stroke: BrushStroke, end: VoxelPosition): void {
    const key = voxelKey(end.x, end.y, end.z);
    if (stroke.kind === 'voxel' && stroke.lastKey === key) return;
    const start = stroke.kind === 'voxel' ? stroke.lastCell ?? end : stroke.start;
    stroke.lastKey = key;
    const kind: InteractiveBrushKind = stroke.kind === 'voxel' ? 'line' : stroke.kind as InteractiveBrushKind;
    const generated = generateInteractiveBrushVoxels(kind, start, end, stroke.size, this._document.viewSize);
    this._applyPositions(stroke, mirrorVoxelPositions(generated, this._document.viewSize, stroke.mirror));
    stroke.lastCell = end;
  }

  private _clearPreview(stroke: BrushStroke): void {
    if (stroke.kind === 'voxel') return;
    this._getRenderer()?.clearBrushPreview();
    stroke.changes.clear();
    stroke.lastKey = null;
    stroke.lastCell = null;
  }

  private _updatePreview(stroke: BrushStroke, end: VoxelPosition): void {
    if (stroke.lastKey === voxelKey(end.x, end.y, end.z)) return;
    this._clearPreview(stroke);
    this._applyAt(stroke, end);
  }

  private _finish(end: VoxelPosition | null = null): void {
    const stroke = this._stroke;
    if (!stroke) return;
    try {
      if (end && stroke.kind !== 'voxel') this._updatePreview(stroke, end);
      if (!end && stroke.kind !== 'voxel') return;
      const command = createVoxelPatchCommand(
        this._document, stroke.moduleId, stroke.changes.values(),
        stroke.tool === 'add' ? '笔刷添加方块' : stroke.tool === 'erase' ? '笔刷擦除方块' : '笔刷着色',
      );
      if (command) {
        if (stroke.kind === 'voxel') this._history.recordApplied(command);
        else this._history.execute(command);
        stroke.transaction.commit();
      } else {
        stroke.transaction.cancel();
      }
    } finally {
      if (stroke.transaction.active) stroke.transaction.cancel();
      this._getRenderer()?.clearBrushPreview();
      this._stroke = null;
    }
  }

  private _refreshChangedVoxels(stroke: BrushStroke, changes: Iterable<VoxelPosition>): void {
    const renderer = this._getRenderer();
    if (!renderer) return;
    renderer.refreshVoxels?.({
      fullRender: false,
      voxelKeys: new Set(Array.from(changes, change => packVoxelKey(change.x, change.y, change.z))),
      instanceIds: new Set(),
      materialIds: new Set(),
    });
  }
}

function isImmediateBrush(kind: BrushKind): kind is 'flood' | 'surface' {
  return kind === 'flood' || kind === 'surface';
}

function element<T extends Element>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}
