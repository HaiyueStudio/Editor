import type { EditorDisposable, EditorJsonValue, EditorOperationSchema } from '@haiyue/editor-plugin-sdk';
import type { EditorPlatform } from '@haiyue/editor-platform';
import type { AnimationEditorStore } from '../domain/AnimationEditorStore';
import { createBasicAnimationNode } from '../domain/SceneAuthoring';
import { createCoreTransformTrack, createTimelineKeyframe, type CoreTransformProperty } from '../domain/TimelineAuthoring';
import type { AnimationEditorProject, DeepMutable } from '../domain/AnimationEditorProject';
import { createProjectMutationCommand } from '../domain/CommandHistory';
import { parseAnimationEditorProject, serializeAnimationEditorProject } from '../persistence/ProjectCodec';

const empty = { type: 'object', properties: {} } as const;
const string = { type: 'string', minLength: 1, maxLength: 256 } as const;
type Params = { readonly [key: string]: EditorJsonValue };

/** Binds the authoring store and the UI's history; Native 3D is a separate document kind. */
export function registerAnimationEditorOperations(platform: EditorPlatform, store: AnimationEditorStore): EditorDisposable {
  const owned: EditorDisposable[] = [];
  function register<T>(id: string, input: EditorOperationSchema, access: 'read' | 'write',
    prepare: (params: Params) => T | Promise<T>, commit: (prepared: T) => EditorJsonValue) {
    owned.push(platform.operations.register({ ownerId: 'hya.operations',
      descriptor: { id: `hya.${id}`, version: 1, title: id, target: 'document', documentKinds: ['haiyue.animation-project'], access, input, output: { type: 'json' } },
      prepare: (params: Params, context) => { if (context.document?.id !== 'animation.current') throw new Error('Operation targets a different document.'); return prepare(params); }, commit: value => access === 'write' ? store.runAtomic(() => platform.history.runAtomic(() => commit(value))) : commit(value),
      // Synchronous writes restore both store and history before propagating a failure.
      rollback() {},
    }));
  }
  register('document.open', { type: 'object', properties: { resourceId: string }, required: ['resourceId'] }, 'write',
    params => {
      const project = parseAnimationEditorProject(new TextDecoder('utf-8', { fatal: true }).decode(platform.resources.read(params.resourceId as string)));
      return createProjectMutationCommand(store, 'API: open HYA project', draft => { delete draft.editor; Object.assign(draft, project); });
    }, command => ({ applied: command ? platform.history.execute(command) : false }));
  register('document.query', empty, 'read', () => store.project, project => ({
    name: project.name, dirty: store.isDirty, canUndo: platform.history.canUndo, canRedo: platform.history.canRedo,
    nodeCount: project.nodes.length, nodes: project.nodes.slice(0, 100).map(node => ({ id: node.id, name: node.name, transform: { ...node.transform } })),
  }));
  register('node.rename', { type: 'object', properties: { nodeId: string, name: string }, required: ['nodeId', 'name'] }, 'write',
    params => createProjectMutationCommand(store, 'API: rename node', draft => {
      unlocked(draft, params.nodeId as string);
      const node = draft.nodes.find(item => item.id === params.nodeId)!;
      node.name = params.name as string;
      parseAnimationEditorProject(draft);
    }), command => ({ applied: command ? platform.history.execute(command) : false }));
  register('node.opacity', { type: 'object', properties: { nodeId: string, opacity: { type: 'number', minimum: 0, maximum: 1 } }, required: ['nodeId', 'opacity'] }, 'write',
    params => createProjectMutationCommand(store, 'API: node opacity', draft => {
      unlocked(draft, params.nodeId as string);
      const node = draft.nodes.find(item => item.id === params.nodeId)!;
      node.transform.opacity = params.opacity as number;
      parseAnimationEditorProject(draft);
    }), command => ({ applied: command ? platform.history.execute(command) : false }));
  register('history.undo' , empty, 'write', () => null, () => ({ applied: platform.history.undo() }));
  function mutation(label: string, apply: (draft: DeepMutable<AnimationEditorProject>) => void) {
    return createProjectMutationCommand(store, label, draft => { apply(draft); parseAnimationEditorProject(draft); });
  }
  function unlocked(project: AnimationEditorProject, id: string) {
    const node = project.nodes.find(item => item.id === id);
    if (!node) throw new Error('Animation node is unavailable.');
    let current: typeof node | undefined = node;
    while (current) { if (current.editor?.locked) throw new Error('Animation node or parent is locked.'); current = current.parent ? project.nodes.find(item => item.id === current!.parent) : undefined; }
    return node;
  }
  register('history.redo', empty, 'write', () => null, () => ({ applied: platform.history.redo() }));
  register('node.create', { type: 'object', properties: { kind: { type: 'string', enum: ['group', 'rectangle', 'ellipse'] }, name: string }, required: ['kind', 'name'] }, 'write',
    params => { let id = ''; const command = mutation('API: create node', draft => {
      const node = createBasicAnimationNode(draft, params.kind as 'group' | 'rectangle' | 'ellipse'); node.name = params.name as string; id = node.id; draft.nodes.push(node);
    }); return { command, id }; }, ({ command, id }) => ({ applied: command ? platform.history.execute(command) : false, nodeId: id }));
  const scalar = { type: 'number' } as const;
  register('node.transform', { type: 'object', properties: { nodeId: string, patch: { type: 'object', properties: { x: scalar, y: scalar, scaleX: scalar, scaleY: scalar, rotation: scalar, opacity: { type: 'number', minimum: 0, maximum: 1 } } } }, required: ['nodeId', 'patch'] }, 'write',
    params => mutation('API: transform node', draft => {
      unlocked(draft, params.nodeId as string);
      const node = draft.nodes.find(item => item.id === params.nodeId)!, patch = params.patch as Record<string, number>;
      const position = node.transform.position ?? [0, 0], scale = node.transform.scale ?? [1, 1];
      if (patch.x !== undefined || patch.y !== undefined) node.transform.position = [patch.x ?? position[0], patch.y ?? position[1]];
      if (patch.scaleX !== undefined || patch.scaleY !== undefined) node.transform.scale = [patch.scaleX ?? scale[0], patch.scaleY ?? scale[1]];
      if (patch.rotation !== undefined) node.transform.rotation = patch.rotation;
      if (patch.opacity !== undefined) node.transform.opacity = patch.opacity;
    }), command => ({ applied: command ? platform.history.execute(command) : false }));
  register('track.create', { type: 'object', properties: { nodeId: string, property: { type: 'string', enum: ['position', 'rotation', 'scale', 'opacity'] } }, required: ['nodeId', 'property'] }, 'write',
    params => { let id = ''; const command = mutation('API: create track', draft => {
      unlocked(draft, params.nodeId as string); const track = createCoreTransformTrack(draft, params.nodeId as string, params.property as CoreTransformProperty, 0); id = track.id; draft.timeline.tracks.push(track);
    }); return { command, id }; }, ({ command, id }) => ({ applied: command ? platform.history.execute(command) : false, trackId: id }));
  register('keyframe.set', { type: 'object', properties: { trackId: string, time: { type: 'number', minimum: 0 }, value: { type: 'array', items: scalar, maxItems: 16 } }, required: ['trackId', 'time', 'value'] }, 'write',
    params => { let id = ''; const command = mutation('API: set keyframe', draft => {
      const track = draft.timeline.tracks.find(item => item.id === params.trackId); if (!track) throw new Error('Track is unavailable.');
      unlocked(draft, track.target.nodeId);
      if ((params.time as number) > draft.composition.duration) throw new Error('Keyframe exceeds composition duration.');
      id = createTimelineKeyframe(draft, track.id, params.time as number, params.value as number[]).id;
    }); return { command, id }; }, ({ command, id }) => ({ applied: command ? platform.history.execute(command) : false, keyframeId: id }));
  const offset = { type: 'integer', minimum: 0 } as const, limit = { type: 'integer', minimum: 1, maximum: 100 } as const;
  register('tracks.query', { type: 'object', properties: { offset, limit } }, 'read', params => ({ offset: params.offset as number ?? 0, limit: params.limit as number ?? 100 }),
    ({ offset, limit }) => ({ total: store.project.timeline.tracks.length, tracks: store.project.timeline.tracks.slice(offset, offset + limit).map(track => ({ id: track.id, name: track.name, target: { ...track.target }, valueSize: track.valueSize, keyframes: track.keyframes.length })) }));
  register('keyframes.query', { type: 'object', properties: { trackId: string, offset, limit }, required: ['trackId'] }, 'read', params => {
    const track = store.project.timeline.tracks.find(item => item.id === params.trackId); if (!track) throw new Error('Track is unavailable.');
    const offset = params.offset as number ?? 0; return { total: track.keyframes.length, keyframes: track.keyframes.slice(offset, offset + (params.limit as number ?? 100)).map(key => ({ id: key.id, time: key.time, value: [...key.value], interpolation: key.interpolation })) };
  }, result => result);
  register('document.export', { type: 'object', properties: { format: { type: 'string', enum: ['project', 'hya'] } }, required: ['format'] }, 'read',
    async params => {
      const project = structuredClone(store.project);
      const bytes = params.format === 'hya'
        ? new Uint8Array((await import('../compiler/AnimationEditorCompiler')).compileAnimationEditorProject(project).binary)
        : new TextEncoder().encode(serializeAnimationEditorProject(project));
      return { bytes, format: params.format as string };
    }, ({ bytes, format }) => ({ ...platform.resources.put(bytes), format }));
  return { async dispose() { await Promise.all(owned.map(item => item.dispose())); } };
}
