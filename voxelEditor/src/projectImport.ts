import { VoxelDocument, type VoxelProject } from './model';
import { parseMagicaVoxel } from './voxImporter';

export type ProjectImportFormat = 'json' | 'vox';

export interface ProjectImportResult {
  project: VoxelProject;
  metadata: Record<string, number | boolean | string>;
}

/** CPU-heavy parsing and validation shared by the import worker and non-Worker test environments. */
export function parseProjectImport(format: ProjectImportFormat, data: ArrayBuffer): ProjectImportResult {
  if (format === 'json') {
    const raw = JSON.parse(new TextDecoder().decode(data));
    const document = new VoxelDocument();
    document.load(raw);
    const project = document.toJSON();
    return { project, metadata: { voxelCount: document.sceneVoxelCount } };
  }
  const imported = parseMagicaVoxel(data);
  return {
    project: imported.project,
    metadata: {
      modelCount: imported.models.length,
      instanceCount: imported.instances.length,
      voxelCount: imported.models.reduce((sum, model) => sum + model.voxels.length, 0),
      animated: imported.animated,
      partialMaterialCount: imported.materials.filter(material => material.vox?.compatibility === 'partial').length,
    },
  };
}
