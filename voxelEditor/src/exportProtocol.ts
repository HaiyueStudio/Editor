import type { VoxelProject } from './model';
import type { SpriteDirection, SpriteExportOptions, SpriteSheetLayout } from './spriteExporter';
import type { EditorLocale } from './localization';

interface ExportRequestBase {
  id: number;
  project: VoxelProject;
  locale: EditorLocale;
}

export interface GlbExportRequest extends ExportRequestBase {
  format: 'glb';
  mode: 'merged' | 'instances';
  includeAnimations: boolean;
}

export interface VoxExportRequest extends ExportRequestBase {
  format: 'vox';
}

export interface JsonExportRequest extends ExportRequestBase {
  format: 'json';
}

export interface SpriteExportRequest extends ExportRequestBase {
  format: 'sprite';
  singleFrame: boolean;
  currentFrame: number;
  options: SpriteExportOptions;
  layout: SpriteSheetLayout;
  columns: number;
  frameStart: number;
  frameEnd: number;
  directions: SpriteDirection[];
  pivot: { x: number; y: number };
}

export type ExportWorkerRequest = GlbExportRequest | VoxExportRequest | JsonExportRequest | SpriteExportRequest;

export interface ExportProgressMessage {
  type: 'progress';
  id: number;
  progress: number;
  label: string;
}

export interface ExportSuccessMessage {
  type: 'success';
  id: number;
  format: ExportWorkerRequest['format'];
  data: ArrayBuffer;
  metadata: Record<string, number | boolean | string>;
}

export interface ExportErrorMessage {
  type: 'error';
  id: number;
  message: string;
}

export type ExportWorkerMessage = ExportProgressMessage | ExportSuccessMessage | ExportErrorMessage;
