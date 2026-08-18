import {
  cloneAnimationEditorProject,
  freezeAnimationEditorProject,
  type AnimationEditorAsset,
  type AnimationEditorProject,
} from './AnimationEditorProject';
import {
  SpriteSheetAuthoringError,
  type SpriteSheetAssetReference,
  type SpriteSheetFrameMap,
} from './SpriteSheetTypes';
import { validateSpriteSheetImageBudget } from './SpriteSheetGridAuthoring';

export function spriteSheetAssetReferences(
  project: AnimationEditorProject,
  assetId: string,
): readonly SpriteSheetAssetReference[] {
  const references: SpriteSheetAssetReference[] = [];
  for (const node of project.nodes) {
    for (const record of node.components) {
      if (record.component.type === 'sprite2d' && record.component.resource === assetId) {
        references.push(Object.freeze({ nodeId: node.id, componentId: record.id, field: 'resource' }));
      }
    }
  }
  return Object.freeze(references);
}

export function replaceSpriteSheetImageAsset(
  project: AnimationEditorProject,
  assetId: string,
  replacement: AnimationEditorAsset,
  frameMap?: SpriteSheetFrameMap,
): AnimationEditorProject {
  const index = project.assets.findIndex(candidate => candidate.id === assetId);
  if (index < 0 || project.assets[index]!.type !== 'image' || replacement.type !== 'image') {
    throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_ASSET_TYPE', `$.assets.${assetId}`, 'SpriteSheet replacement requires existing and replacement image assets.',
    );
  }
  const width = replacement.delivery.width;
  const height = replacement.delivery.height;
  if (!width || !height) throw new SpriteSheetAuthoringError(
    'E_SPRITESHEET_IMAGE_DIMENSIONS', `$.assets.${assetId}.delivery`, 'Replacement image dimensions are required.',
  );
  validateSpriteSheetImageBudget(width, height);
  if (frameMap) {
    if (frameMap.resourceId !== assetId) throw new SpriteSheetAuthoringError(
      'E_SPRITESHEET_ASSET_REFERENCE', '$.frameMap.resourceId', 'Replacement frame map must reference the existing asset identity.',
    );
    for (const frame of frameMap.frames) {
      if (frame.rect.x + frame.rect.width > width || frame.rect.y + frame.rect.height > height) {
        throw new SpriteSheetAuthoringError(
          'E_SPRITESHEET_FRAME_BOUNDS', `$.frameMap.frames.${frame.id}`, 'Replacement image no longer contains every authored frame.',
        );
      }
    }
  }
  const draft = cloneAnimationEditorProject(project);
  draft.assets[index] = { ...structuredClone(replacement), id: assetId };
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}

export function deleteSpriteSheetImageAsset(
  project: AnimationEditorProject,
  assetId: string,
): AnimationEditorProject {
  const references = spriteSheetAssetReferences(project, assetId);
  if (references.length > 0) throw new SpriteSheetAuthoringError(
    'E_SPRITESHEET_ASSET_REFERENCE',
    `$.assets.${assetId}`,
    `SpriteSheet image is still referenced by ${references.map(reference => `${reference.nodeId}/${reference.componentId}`).join(', ')}.`,
  );
  const draft = cloneAnimationEditorProject(project);
  const before = draft.assets.length;
  draft.assets = draft.assets.filter(asset => asset.id !== assetId);
  if (draft.assets.length === before) throw new SpriteSheetAuthoringError(
    'E_SPRITESHEET_ASSET_TYPE', `$.assets.${assetId}`, 'Unknown SpriteSheet image asset.',
  );
  return freezeAnimationEditorProject(draft as AnimationEditorProject);
}
