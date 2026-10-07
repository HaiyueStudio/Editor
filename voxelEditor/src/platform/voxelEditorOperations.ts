import type { EditorDisposable, EditorJsonValue, EditorOperationSchema } from '@haiyue/editor-plugin-sdk';
import type { EditorPlatform } from '@haiyue/editor-platform';
import { VoxelDocument, type VoxelProject } from '../model';
import { createVoxelPatchCommand } from '../commands';

const empty = { type: 'object', properties: {} } as const;
const string = { type: 'string', minLength: 1, maxLength: 256 } as const;
type Params = { readonly [key: string]: EditorJsonValue };

export function registerVoxelEditorOperations(platform: EditorPlatform, document: VoxelDocument): EditorDisposable {
  const owned: EditorDisposable[] = [];
  function register<T>(id: string, input: EditorOperationSchema, access: 'read' | 'write',
    prepare: (params: Params) => T | Promise<T>, commit: (prepared: T) => EditorJsonValue) {
    owned.push(platform.operations.register({ ownerId: 'voxel.operations',
      descriptor: { id: `voxel.${id}`, version: 1, title: id, target: 'document', documentKinds: ['haiyue.voxel-project'], access, input, output: { type: 'json' } },
      prepare: (params: Params, context) => { if (context.document?.id !== 'voxel.current') throw new Error('Operation targets a different document.'); return prepare(params); }, commit: value => access === 'write' ? document.runAtomic(() => platform.history.runAtomic(() => commit(value))) : commit(value),
      // The synchronous transaction restores aggregate/history before any error escapes.
      rollback() {},
    }));
  }
  register('document.open', { type: 'object', properties: { resourceId: string }, required: ['resourceId'] }, 'write',
    params => {
      const candidate = new VoxelDocument();
      candidate.load(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(platform.resources.read(params.resourceId as string))));
      const before = document.toJSON(), after = candidate.toJSON(), editingModuleId = document.editingModuleId, layerId = document.activeVoxelLayerId;
      return { label: 'API: open voxel project', estimatedBytes: (JSON.stringify(before).length + JSON.stringify(after).length) * 2,
        execute() { document.load(after); return true; },
        undo() { document.load(before); document.setActiveVoxelLayer(layerId); if (editingModuleId) document.editModule(editingModuleId); },
      };
    }, command => ({ applied: platform.history.execute(command) }));
  register('document.query', empty, 'read', () => document.toJSON(), project => ({
    size: { ...project.size }, voxelCount: project.voxels.length, canUndo: platform.history.canUndo, canRedo: platform.history.canRedo,
    layers: (project.layers ?? []).map(layer => ({ ...layer })),
    voxels: project.voxels.slice(0, 100).map(voxel => ({ x: voxel.x, y: voxel.y, z: voxel.z, color: voxel.color })),
  }));
  const coordinate = { type: 'integer', minimum: 0, maximum: 4095 } as const;
  register('cell.set', { type: 'object', properties: { x: coordinate, y: coordinate, z: coordinate, color: { type: 'string', minLength: 7, maxLength: 7 } }, required: ['x', 'y', 'z', 'color'] }, 'write',
    params => {
      const x = params.x as number, y = params.y as number, z = params.z as number, color = params.color as string;
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Expected #RRGGBB color.');
      // Explicitly targets base scene cells, independent of the UI module editing cursor.
      if (x >= document.size.x || y >= document.size.y || z >= document.size.z) throw new Error('Cell is outside the scene.');
      const before = document.getTargetVoxel(null, x, y, z);
      if (!document.isBaseVoxelEditable(before)) throw new Error('Voxel layer is locked or hidden.');
      const beforeProject = document.toJSON(), staged = new VoxelDocument();
      staged.load(beforeProject);
      const command = createVoxelPatchCommand(staged, null, [{ x, y, z, before: before?.color ?? null, after: color.toLowerCase(),
        beforeMaterialId: before?.materialId ?? null, beforeLayerId: before?.layerId ?? null,
        afterLayerId: before?.layerId ?? document.activeVoxelLayerId }], 'API: set voxel');
      if (!command || !command.execute()) return null;
      const after = staged.toJSON(), editingModuleId = document.editingModuleId, layerId = document.activeVoxelLayerId;
      const restore = (project: typeof after) => {
        document.load(project); document.setActiveVoxelLayer(layerId);
        if (editingModuleId) document.editModule(editingModuleId);
      };
      return { label: 'API: set voxel', estimatedBytes: (JSON.stringify(beforeProject).length + JSON.stringify(after).length) * 2,
        execute() { restore(after); return true; }, undo() { restore(beforeProject); } };
    }, command => ({ applied: command ? platform.history.execute(command) : false }));
  register('history.undo', empty, 'write', () => null, () => ({ applied: platform.history.undo() }));
  function prepareSnapshot(label: string, change: (staged: VoxelDocument) => void) {
    const before = document.toJSON(), staged = new VoxelDocument(); staged.load(before);
    staged.setActiveVoxelLayer(document.activeVoxelLayerId); change(staged);
    const after = staged.toJSON(), moduleId = document.editingModuleId, layerId = document.activeVoxelLayerId;
    const restore = (project: VoxelProject) => { document.load(project); document.setActiveVoxelLayer(layerId); if (moduleId) document.editModule(moduleId); };
    return { label, estimatedBytes: (JSON.stringify(before).length + JSON.stringify(after).length) * 2,
      execute() { restore(after); return true; }, undo() { restore(before); } };
  }
  register('history.redo', empty, 'write', () => null, () => ({ applied: platform.history.redo() }));
  register('cells.patch', { type: 'object', properties: { cells: { type: 'array', maxItems: 10000, items: { type: 'object', properties: {
    x: coordinate, y: coordinate, z: coordinate, action: { type: 'string', enum: ['set', 'remove'] }, color: { type: 'string', minLength: 7, maxLength: 7 }, layerId: string,
  }, required: ['x', 'y', 'z', 'action'] } } }, required: ['cells'] }, 'write',
    params => prepareSnapshot('API: patch cells', staged => {
      const cells = params.cells as readonly Record<string, EditorJsonValue>[], seen = new Set<string>();
      for (const cell of cells) {
        const x = cell.x as number, y = cell.y as number, z = cell.z as number, key = `${x},${y},${z}`;
        if (seen.has(key) || x >= staged.size.x || y >= staged.size.y || z >= staged.size.z) throw new Error('Duplicate cell or coordinate outside scene.'); seen.add(key);
        const before = staged.getTargetVoxel(null, x, y, z), layerId = cell.layerId as string | undefined;
        if (layerId) { if (!staged.getLayer(layerId)) throw new Error('Layer unavailable.'); staged.setActiveVoxelLayer(layerId); }
        else staged.setActiveVoxelLayer(document.activeVoxelLayerId);
        if (!staged.isBaseVoxelEditable(before) || !staged.isBaseVoxelEditable(null)) throw new Error('Layer locked or hidden.');
        if (cell.action === 'remove') { if (cell.color !== undefined || layerId) throw new Error('Remove accepts only a coordinate.'); staged.removeVoxel(x, y, z); }
        else {
          if (typeof cell.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(cell.color)) throw new Error('Set requires #RRGGBB.');
          const command = createVoxelPatchCommand(staged, null, [{ x, y, z, before: before?.color ?? null, beforeMaterialId: before?.materialId ?? null, beforeLayerId: before?.layerId ?? null,
            after: cell.color.toLowerCase(), afterLayerId: layerId ?? before?.layerId ?? staged.activeVoxelLayerId }], 'API: cell'); command?.execute();
        }
      }
    }), command => ({ applied: platform.history.execute(command) }));
  register('layer.create', { type: 'object', properties: { name: string }, required: ['name'] }, 'write', params => {
    let id = ''; const command = prepareSnapshot('API: create layer', staged => { id = staged.createLayer(params.name as string).id; }); return { command, id };
  }, ({ command, id }) => ({ applied: platform.history.execute(command), layerId: id }));
  register('layer.update', { type: 'object', properties: { layerId: string, patch: { type: 'object', properties: { name: string, visible: { type: 'boolean' }, locked: { type: 'boolean' } } } }, required: ['layerId', 'patch'] }, 'write',
    params => prepareSnapshot('API: update layer', staged => { if (!staged.getLayer(params.layerId as string)) throw new Error('Layer unavailable.'); staged.updateLayer(params.layerId as string, params.patch as { name?: string; visible?: boolean; locked?: boolean }); }),
    command => ({ applied: platform.history.execute(command) }));
  register('document.export', { type: 'object', properties: { format: { type: 'string', enum: ['project', 'vox'] } }, required: ['format'] }, 'read',
    async params => {
      const snapshot = structuredClone(document.toJSON());
      const bytes = params.format === 'vox'
        ? (await import('../voxExporter')).exportVoxelProjectAsVox(snapshot).data
        : new TextEncoder().encode(JSON.stringify(snapshot));
      return { bytes, format: params.format as string };
    }, ({ bytes, format }) => ({ ...platform.resources.put(bytes), format }));
  return { async dispose() { await Promise.all(owned.map(item => item.dispose())); } };
}
