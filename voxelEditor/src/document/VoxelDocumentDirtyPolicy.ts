import type { VoxelDocumentChangeReason, VoxelDocumentDirtyFlags } from '../model';

/** Maps domain changes to UI-independent projection invalidation. */
export function dirtyFlagsForReason(reason: VoxelDocumentChangeReason): VoxelDocumentDirtyFlags {
  const dirty: VoxelDocumentDirtyFlags = {
    scene: false,
    view: false,
    render: false,
    palette: false,
    modules: false,
    animation: false,
    grid: false,
    selection: 'none',
  };
  if (reason === 'color') {
    dirty.palette = true;
    return dirty;
  }
  if (reason === 'scene-background') return dirty;
  if (reason === 'palette-create' || reason === 'palette-remove') {
    dirty.palette = true;
    return dirty;
  }
  if (reason === 'palette-update') {
    dirty.palette = true;
    dirty.render = true;
    return dirty;
  }
  if (reason === 'animation-frame') {
    dirty.scene = true;
    dirty.view = true;
    dirty.render = true;
    return dirty;
  }
  if (reason === 'layer-create' || reason === 'module-update') {
    dirty.modules = true;
    return dirty;
  }
  if (reason === 'module-create' || reason === 'module-remove' || reason === 'edit-target') {
    dirty.view = true;
    dirty.render = true;
    dirty.modules = true;
    dirty.grid = true;
    dirty.selection = 'clear';
    return dirty;
  }
  if (reason === 'load') {
    dirty.scene = true;
    dirty.view = true;
    dirty.render = true;
    dirty.palette = true;
    dirty.modules = true;
    dirty.animation = true;
    dirty.grid = true;
    dirty.selection = 'clear';
    return dirty;
  }

  dirty.scene = true;
  dirty.view = true;
  dirty.render = true;
  dirty.selection = 'retain';
  if (reason === 'add' || reason === 'paint' || reason === 'command-patch' || reason === 'batch' || reason === 'remove') {
    dirty.palette = true;
    dirty.modules = true;
  } else if (reason === 'resize') {
    dirty.modules = true;
    dirty.grid = true;
  } else if (reason === 'clear') {
    dirty.palette = true;
    dirty.modules = true;
    dirty.animation = true;
  } else if (reason.startsWith('module-instance-')) {
    dirty.modules = true;
    if (reason === 'module-instance-remove') dirty.animation = true;
  } else if (reason.startsWith('animation-')) {
    dirty.modules = true;
    dirty.animation = true;
  } else if (reason === 'layer-update' || reason === 'layer-remove') {
    dirty.modules = true;
  }
  return dirty;
}
