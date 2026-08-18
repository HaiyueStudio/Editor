import { ColorSRGB, type Material2D, type Mesh2D } from '@haiyue/engine';
import { toColorSRGB, type ColorValue } from '@haiyue/engine/color';
import { type DataComponent, type JsonObject } from '@haiyue/engine/components';
import { type CssMaterialStyle } from '@haiyue/engine/material';
import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import { Tilemap2DComponent } from '@haiyue/extensions/tilemap';
import type { Tilemap2DSnapshot } from '../../types';
import { toVec4 } from '../../domain/scene/tupleUtils';
import { readNumber } from '../../utils/formValues';

export interface Mesh2DFormElements {
  colorInput: HTMLInputElement | null;
  alphaInput: HTMLInputElement | null;
  blendingSelect: HTMLSelectElement | null;
}

export interface CanvasTextFormElements {
  textInput: HTMLTextAreaElement | null;
  styleInput: HTMLTextAreaElement | null;
}

export interface DataComponentFormElements {
  input: HTMLTextAreaElement | null;
}

export interface Tilemap2DFormElements {
  columnsInput: HTMLInputElement | null;
  rowsInput: HTMLInputElement | null;
  cellWidthInput: HTMLInputElement | null;
  cellHeightInput: HTMLInputElement | null;
  gapInput: HTMLInputElement | null;
  originXInput: HTMLInputElement | null;
  originYInput: HTMLInputElement | null;
  paletteInput: HTMLTextAreaElement | null;
  cellsInput: HTMLTextAreaElement | null;
}

export interface Mesh2DSnapshot {
  color: ColorValue;
  blending: Material2D['blending'];
}

export interface CanvasTextSnapshot {
  text: string;
  style: CssMaterialStyle;
}

export function snapshotMesh2D(mesh: Mesh2D): Mesh2DSnapshot {
  return {
    color: mesh.material.color.clone(),
    blending: mesh.material.blending,
  };
}

export function readMesh2DInputs(mesh: Mesh2D, elements: Mesh2DFormElements): Mesh2DSnapshot {
  const color = elements.colorInput ? ColorSRGB.fromHex(elements.colorInput.value) : toColorSRGB(mesh.material.color);
  const alpha = Math.max(0, Math.min(1, readNumber(elements.alphaInput, mesh.material.color.a)));
  const blending = (elements.blendingSelect?.value as Material2D['blending']) || mesh.material.blending;
  return {
    color: new ColorSRGB(color.r, color.g, color.b, alpha),
    blending,
  };
}

export function applyMesh2DSnapshot(mesh: Mesh2D, snapshot: Mesh2DSnapshot): void {
  mesh.material.color = snapshot.color.clone();
  mesh.material.blending = snapshot.blending;
}

export function renderMesh2DInputs(mesh: Mesh2D, elements: Mesh2DFormElements, formatNumber: (value: number) => string): void {
  if (elements.colorInput) elements.colorInput.value = toColorSRGB(mesh.material.color).toHex();
  if (elements.alphaInput) elements.alphaInput.value = formatNumber(mesh.material.color.a);
  if (elements.blendingSelect) elements.blendingSelect.value = mesh.material.blending;
}

export function snapshotCanvasText(component: CanvasTextComponent): CanvasTextSnapshot {
  return {
    text: component.text,
    style: { ...component.style },
  };
}

export function readCanvasTextInputs(component: CanvasTextComponent, elements: CanvasTextFormElements): CanvasTextSnapshot | null {
  const nextText = elements.textInput?.value ?? component.text;
  const nextStyle = readCanvasTextStyleInput(component.style, elements.styleInput);
  if (!nextStyle) return null;
  return {
    text: nextText,
    style: { ...nextStyle },
  };
}

export function applyCanvasTextSnapshot(component: CanvasTextComponent, snapshot: CanvasTextSnapshot): void {
  component.material.setText(snapshot.text);
  component.material.setStyle(snapshot.style);
}

export function renderCanvasTextInputs(component: CanvasTextComponent, elements: CanvasTextFormElements): void {
  if (elements.textInput) elements.textInput.value = component.text;
  if (elements.styleInput) elements.styleInput.value = JSON.stringify(component.style, null, 2);
}

function readCanvasTextStyleInput(fallback: CssMaterialStyle, input: HTMLTextAreaElement | null): CssMaterialStyle | null {
  if (!input) return fallback;
  try {
    const value = JSON.parse(input.value || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    input.setCustomValidity('');
    return value as CssMaterialStyle;
  } catch (error) {
    input.setCustomValidity(error instanceof Error ? error.message : 'Invalid JSON');
    input.reportValidity();
    return null;
  }
}

export function snapshotDataComponent(component: DataComponent): JsonObject {
  return structuredClone(component.value);
}

export function readDataComponentInput(component: DataComponent, elements: DataComponentFormElements): JsonObject | null {
  const input = elements.input;
  if (!input) return component.value;
  try {
    const value = JSON.parse(input.value || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('DataComponent value must be a JSON object.');
    }
    input.setCustomValidity('');
    return value as JsonObject;
  } catch (error) {
    input.setCustomValidity(error instanceof Error ? error.message : 'Invalid JSON');
    input.reportValidity();
    return null;
  }
}

export function applyDataComponentSnapshot(component: DataComponent, snapshot: JsonObject): void {
  component.value = snapshot;
}

export function renderDataComponentInput(component: DataComponent, elements: DataComponentFormElements): void {
  if (!elements.input) return;
  elements.input.value = JSON.stringify(component.value, null, 2);
  elements.input.setCustomValidity('');
}

export function snapshotTilemap2D(tilemap: Tilemap2DComponent): Tilemap2DSnapshot {
  return {
    columns: tilemap.columns,
    rows: tilemap.rows,
    cellWidth: tilemap.cellWidth,
    cellHeight: tilemap.cellHeight,
    originX: tilemap.originX,
    originY: tilemap.originY,
    gap: tilemap.gap,
    cells: Array.from(tilemap.cells),
    palette: tilemap.palette.map(toVec4),
  };
}

export function readTilemap2DInputs(tilemap: Tilemap2DComponent, elements: Tilemap2DFormElements): Tilemap2DSnapshot | null {
  const columns = Math.max(1, Math.floor(readNumber(elements.columnsInput, tilemap.columns)));
  const rows = Math.max(1, Math.floor(readNumber(elements.rowsInput, tilemap.rows)));
  const snapshot = snapshotTilemap2D(tilemap);
  const palette = readTilemapPaletteInput(snapshot.palette, elements.paletteInput);
  const cells = readTilemapCellsInput(columns * rows, snapshot.cells, elements.cellsInput);
  if (!palette || !cells) return null;
  return {
    columns,
    rows,
    cellWidth: Math.max(0.001, readNumber(elements.cellWidthInput, tilemap.cellWidth)),
    cellHeight: Math.max(0.001, readNumber(elements.cellHeightInput, tilemap.cellHeight)),
    originX: readNumber(elements.originXInput, tilemap.originX),
    originY: readNumber(elements.originYInput, tilemap.originY),
    gap: Math.max(0, readNumber(elements.gapInput, tilemap.gap)),
    cells,
    palette,
  };
}

export function applyTilemap2DSnapshot(tilemap: Tilemap2DComponent, snapshot: Tilemap2DSnapshot): void {
  tilemap.columns = Math.max(1, Math.floor(snapshot.columns));
  tilemap.rows = Math.max(1, Math.floor(snapshot.rows));
  tilemap.cellWidth = snapshot.cellWidth;
  tilemap.cellHeight = snapshot.cellHeight;
  tilemap.originX = snapshot.originX;
  tilemap.originY = snapshot.originY;
  tilemap.gap = Math.max(0, snapshot.gap);
  tilemap.cells = new Int16Array(tilemap.columns * tilemap.rows);
  tilemap.cells.set(snapshot.cells.slice(0, tilemap.cells.length));
  tilemap.palette = snapshot.palette.map(toVec4);
}

export function renderTilemap2DInputs(tilemap: Tilemap2DComponent, elements: Tilemap2DFormElements, formatNumber: (value: number) => string): void {
  if (elements.columnsInput) elements.columnsInput.value = String(tilemap.columns);
  if (elements.rowsInput) elements.rowsInput.value = String(tilemap.rows);
  if (elements.cellWidthInput) elements.cellWidthInput.value = formatNumber(tilemap.cellWidth);
  if (elements.cellHeightInput) elements.cellHeightInput.value = formatNumber(tilemap.cellHeight);
  if (elements.gapInput) elements.gapInput.value = formatNumber(tilemap.gap);
  if (elements.originXInput) elements.originXInput.value = formatNumber(tilemap.originX);
  if (elements.originYInput) elements.originYInput.value = formatNumber(tilemap.originY);
  if (elements.paletteInput) {
    elements.paletteInput.value = JSON.stringify(tilemap.palette, null, 2);
    elements.paletteInput.setCustomValidity('');
  }
  if (elements.cellsInput) {
    elements.cellsInput.value = JSON.stringify(Array.from(tilemap.cells), null, 2);
    elements.cellsInput.setCustomValidity('');
  }
}

function readTilemapPaletteInput(fallback: Tilemap2DSnapshot['palette'], input: HTMLTextAreaElement | null): Tilemap2DSnapshot['palette'] | null {
  if (!input) return fallback;
  try {
    const value = JSON.parse(input.value || '[]');
    if (!Array.isArray(value)) throw new Error('Palette must be an array.');
    const palette = value.map((item, index) => {
      if (!Array.isArray(item) || item.length < 4) throw new Error(`Palette color ${index} must be [r,g,b,a].`);
      return toVec4([
        Number(item[0] ?? 0),
        Number(item[1] ?? 0),
        Number(item[2] ?? 0),
        Number(item[3] ?? 1),
      ]);
    });
    input.setCustomValidity('');
    return palette.length ? palette : fallback;
  } catch (error) {
    input.setCustomValidity(error instanceof Error ? error.message : 'Invalid JSON');
    input.reportValidity();
    return null;
  }
}

function readTilemapCellsInput(expectedLength: number, fallback: number[], input: HTMLTextAreaElement | null): number[] | null {
  if (!input) return fallback;
  try {
    const value = JSON.parse(input.value || '[]');
    if (!Array.isArray(value)) throw new Error('Cells must be an array.');
    const cells = new Array(expectedLength).fill(0);
    for (let i = 0; i < Math.min(value.length, expectedLength); i++) {
      const cell = Number(value[i] ?? 0);
      cells[i] = Number.isFinite(cell) ? Math.trunc(cell) : 0;
    }
    input.setCustomValidity('');
    return cells;
  } catch (error) {
    input.setCustomValidity(error instanceof Error ? error.message : 'Invalid JSON');
    input.reportValidity();
    return null;
  }
}
