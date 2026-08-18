import type { VoxelProject } from '../model';

const PROJECT_FORMAT = 'haiyue-voxel';
const CURRENT_PROJECT_VERSION = 1;

export class VoxelProjectMigrationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'VoxelProjectMigrationError';
  }
}

/**
 * Migrates supported legacy payloads into the current persisted shape.
 * Version 1 values are returned unchanged so save/load remains byte-shape
 * compatible (apart from the existing serializer's deterministic ordering).
 */
export function migrateVoxelProject(input: unknown): VoxelProject {
  if (!isRecord(input)) throw new VoxelProjectMigrationError('$', '项目必须是对象。');
  if (input.format !== PROJECT_FORMAT) {
    throw new VoxelProjectMigrationError('$.format', `必须是 "${PROJECT_FORMAT}"。`);
  }
  if (input.version === CURRENT_PROJECT_VERSION) return input as unknown as VoxelProject;
  if (input.version !== 0) {
    throw new VoxelProjectMigrationError(
      '$.version',
      `不支持版本 ${String(input.version)}；当前版本为 ${CURRENT_PROJECT_VERSION}。`,
    );
  }

  const legacyEditor = isRecord(input.editor) ? input.editor : {};
  return {
    ...input,
    format: PROJECT_FORMAT,
    version: CURRENT_PROJECT_VERSION,
    editor: {
      ...legacyEditor,
      currentColor: typeof legacyEditor.currentColor === 'string' ? legacyEditor.currentColor : '#69d2e7',
      ...(typeof legacyEditor.currentMaterialId === 'string'
        ? { currentMaterialId: legacyEditor.currentMaterialId }
        : {}),
    },
  } as unknown as VoxelProject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
