import type {
  AnimationEditorAsset,
  AnimationEditorNode,
  AnimationEditorProject,
  DeepMutable,
} from './AnimationEditorProject';
import { createAdvancedVectorComponent, createTextAnimatorParts } from './AdvancedContentAuthoring';

export type AnimationEditorBasicNodeKind =
  | 'group'
  | 'rectangle'
  | 'ellipse'
  | 'path'
  | 'vector'
  | 'text'
  | 'sprite'
  | 'particle'
  | 'audio';

export interface AnimationEditorHierarchyNode {
  id: string;
  label: string;
  expanded?: boolean;
  sourceNodeId?: string;
  children?: AnimationEditorHierarchyNode[];
}

export interface DeleteNodesResult {
  readonly deletedNodeIds: ReadonlySet<string>;
  readonly deletedTrackCount: number;
  readonly deletedCompositeCount: number;
}

export function createBasicAnimationNode(
  project: AnimationEditorProject,
  kind: AnimationEditorBasicNodeKind,
  options: { readonly parentId?: string; readonly imageAssetId?: string } = {},
): DeepMutable<AnimationEditorNode> {
  const definitions = {
    group: { id: 'group', name: 'Group' },
    rectangle: { id: 'rectangle', name: 'Rectangle' },
    ellipse: { id: 'ellipse', name: 'Ellipse' },
    path: { id: 'path', name: 'Path' },
    vector: { id: 'vector', name: 'Vector Shape' },
    text: { id: 'text', name: 'Text' },
    sprite: { id: 'sprite', name: 'Sprite' },
    particle: { id: 'particle', name: 'Particle Emitter' },
    audio: { id: 'audio', name: 'Audio' },
  } as const;
  const definition = definitions[kind];
  const id = uniqueId(definition.id, new Set(project.nodes.map(node => node.id)));
  const offset = project.nodes.length % 12 * 14;
  const components: DeepMutable<AnimationEditorNode['components']> = [];

  if (kind === 'rectangle' || kind === 'ellipse') {
    components.push({
      id: `${id}-shape`,
      name: kind === 'rectangle' ? 'Rectangle' : 'Ellipse',
      component: {
        type: 'shape2d',
        shape: kind === 'rectangle' ? 'rect' : 'ellipse',
        size: [160, 100],
        fill: kind === 'rectangle' ? [0.12, 0.55, 1, 1] : [0.55, 0.35, 1, 1],
      },
    });
  } else if (kind === 'path') {
    components.push({
      id: `${id}-path`,
      name: 'Triangle Path',
      component: {
        type: 'path2d',
        commands: 'MLLZ',
        values: [0, -70, 72, 58, -72, 58],
        fill: [0.18, 0.78, 0.63, 1],
        fillRule: 'nonzero',
        tolerance: 0.35,
      },
    });
  } else if (kind === 'vector') {
    components.push(createAdvancedVectorComponent(`${id}-vector`));
  } else if (kind === 'text') {
    const textAuthoring = createTextAnimatorParts(`${id}-text`);
    components.push({
      id: `${id}-text`,
      name: 'Text',
      component: {
        type: 'text2d',
        text: 'Haiyue',
        size: [280, 80],
        color: [0.93, 0.97, 1, 1],
        fontFamily: 'system-ui',
        fontSize: 42,
        fontWeight: 600,
        textAlign: 'center',
        verticalAlign: 'middle',
        documents: [{ time: 0, text: 'Haiyue', fontFamily: 'system-ui', fontSize: 42, fontWeight: 600 }],
        animators: textAuthoring.animators,
      },
      parts: textAuthoring.parts,
    });
  } else if (kind === 'sprite') {
    const asset = project.assets.find(candidate => (
      candidate.id === options.imageAssetId && candidate.type === 'image'
    )) ?? project.assets.find(candidate => candidate.type === 'image');
    if (!asset) throw new Error('Create a sprite after importing an image asset.');
    components.push({
      id: `${id}-sprite`,
      name: 'Sprite',
      component: {
        type: 'sprite2d',
        resource: asset.id,
        size: fitSpriteSize(asset),
        tint: [1, 1, 1, 1],
        uvRect: [0, 0, 1, 1],
      },
    });
  } else if (kind === 'particle') {
    components.push({
      id: `${id}-particle`,
      name: 'Particle2D',
      component: {
        type: 'particle2d', maxParticles: 512, emissionRate: 48, duration: 2, loop: true, seed: 1,
        lifetime: [0.6, 1.4], speed: [35, 110], angle: [-110, -70], gravity: [0, 80],
        startSize: [5, 12], endSize: [0, 3], startColor: [0.2, 0.75, 1, 1], endColor: [0.55, 0.3, 1, 0],
        shape: 'circle', shapeRadius: 12, blendMode: 'additive', radial: false,
      },
    });
  } else if (kind === 'audio') {
    const asset = project.assets.find(candidate => candidate.type === 'audio');
    if (!asset) throw new Error('Create an audio node after importing an audio asset.');
    components.push({
      id: `${id}-audio`,
      name: 'Timeline Audio',
      component: { type: 'audio', resource: asset.id, volume: 1, loop: false, startOffset: 0, playbackRate: 1 },
    });
  }

  return {
    id,
    name: definition.name,
    ...(options.parentId === undefined ? {} : { parent: options.parentId }),
    transform: {
      position: options.parentId === undefined
        ? [project.composition.canvas.width / 2 + offset, project.composition.canvas.height / 2 + offset]
        : [0, 0],
      rotation: 0,
      scale: [1, 1],
      anchor: [0, 0],
      opacity: 1,
    },
    components,
    effects: [],
    compositeLayers: [],
    editor: { expanded: true, hidden: false, locked: false, color: nodeColor(kind) },
  };
}

export function buildAnimationNodeHierarchy(
  nodes: readonly AnimationEditorNode[],
): AnimationEditorHierarchyNode[] {
  const ids = new Set(nodes.map(node => node.id));
  const byParent = new Map<string | null, AnimationEditorNode[]>();
  for (const node of nodes) {
    const parent = node.parent && ids.has(node.parent) ? node.parent : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(node);
    byParent.set(parent, siblings);
  }
  const visit = (node: AnimationEditorNode): AnimationEditorHierarchyNode => ({
    id: node.id,
    label: node.name,
    expanded: node.editor?.expanded ?? true,
    sourceNodeId: node.id,
    children: (byParent.get(node.id) ?? []).map(visit),
  });
  return (byParent.get(null) ?? []).map(visit);
}

export function applyAnimationNodeHierarchy(
  project: DeepMutable<AnimationEditorProject>,
  hierarchy: readonly AnimationEditorHierarchyNode[],
): void {
  const existing = new Map(project.nodes.map(node => [node.id, node]));
  const seen = new Set<string>();
  const ordered: DeepMutable<AnimationEditorNode>[] = [];
  const visit = (items: readonly AnimationEditorHierarchyNode[], parent: string | undefined) => {
    for (const item of items) {
      const node = existing.get(item.id);
      if (!node || seen.has(item.id)) continue;
      seen.add(item.id);
      if (parent === undefined) delete node.parent;
      else node.parent = parent;
      ordered.push(node);
      visit(item.children ?? [], item.id);
    }
  };
  visit(hierarchy, undefined);
  for (const node of project.nodes) {
    if (seen.has(node.id)) continue;
    delete node.parent;
    ordered.push(node);
  }
  project.nodes = ordered;
}

export function deleteAnimationNodeSubtrees(
  project: DeepMutable<AnimationEditorProject>,
  rootIds: readonly string[],
): DeleteNodesResult {
  const deleting = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of project.nodes) {
      if (node.parent && deleting.has(node.parent) && !deleting.has(node.id)) {
        deleting.add(node.id);
        changed = true;
      }
    }
  }
  const previousTrackCount = project.timeline.tracks.length;
  const previousCompositeCount = project.nodes.reduce((sum, node) => sum + node.compositeLayers.length, 0);
  project.nodes = project.nodes
    .filter(node => !deleting.has(node.id))
    .map(node => ({
      ...node,
      compositeLayers: node.compositeLayers.filter(layer => !deleting.has(layer.sourceNodeId)),
    }));
  project.timeline.tracks = project.timeline.tracks.filter(track => !deleting.has(track.target.nodeId));
  for (const layer of project.stateMachine?.layers ?? []) {
    if (layer.mask?.include) layer.mask.include = layer.mask.include.filter(id => !deleting.has(id));
    if (layer.mask?.exclude) layer.mask.exclude = layer.mask.exclude.filter(id => !deleting.has(id));
  }
  const nextCompositeCount = project.nodes.reduce((sum, node) => sum + node.compositeLayers.length, 0);
  return Object.freeze({
    deletedNodeIds: deleting,
    deletedTrackCount: previousTrackCount - project.timeline.tracks.length,
    deletedCompositeCount: previousCompositeCount - nextCompositeCount,
  });
}

export function duplicateAnimationNodes(
  project: DeepMutable<AnimationEditorProject>,
  hierarchy: readonly AnimationEditorHierarchyNode[],
  pastedRoots: readonly AnimationEditorHierarchyNode[],
): readonly string[] {
  const sourceNodes = new Map(project.nodes.map(node => [node.id, node]));
  const copies = new Map<string, DeepMutable<AnimationEditorNode>>();
  const sourceToCopy = new Map<string, string>();
  const visitPasted = (items: readonly AnimationEditorHierarchyNode[]) => {
    for (const item of items) {
      const sourceId = item.sourceNodeId ?? item.id.replace(/-copy(?:-\d+)?$/u, '');
      const source = sourceNodes.get(sourceId);
      if (source) {
        const copy = structuredClone(source);
        copy.id = item.id;
        copy.name = copiedName(source.name);
        const position = copy.transform.position;
        if (position) copy.transform.position = [position[0] + 16, position[1] + 16];
        copies.set(item.id, copy);
        sourceToCopy.set(sourceId, item.id);
      }
      visitPasted(item.children ?? []);
    }
  };
  visitPasted(pastedRoots);
  for (const copy of copies.values()) {
    copy.compositeLayers = copy.compositeLayers.map(layer => ({
      ...layer,
      sourceNodeId: sourceToCopy.get(layer.sourceNodeId) ?? layer.sourceNodeId,
    }));
    project.nodes.push(copy);
  }
  applyAnimationNodeHierarchy(project, hierarchy);
  return Object.freeze([...copies.keys()]);
}

export function animationAssetReferences(
  project: AnimationEditorProject,
  assetId: string,
): readonly Readonly<{ nodeId: string; componentId: string; field: string }>[] {
  const result: { nodeId: string; componentId: string; field: string }[] = [];
  for (const node of project.nodes) {
    for (const record of node.components) {
      for (const field of ['resource', 'fontResource'] as const) {
        if (record.component[field] === assetId) result.push({ nodeId: node.id, componentId: record.id, field });
      }
    }
  }
  return Object.freeze(result.map(reference => Object.freeze(reference)));
}

export function animationNodeContentKind(node: AnimationEditorNode): string {
  const component = node.components[0]?.component;
  if (!component) return 'Group';
  if (component.type === 'shape2d') return component.shape === 'ellipse' ? 'Ellipse' : 'Rectangle';
  if (component.type === 'path2d') return 'Path';
  if (component.type === 'org.haiyue.vector-shape@1') return 'Vector';
  if (component.type === 'text2d') return 'Text';
  if (component.type === 'sprite2d') return 'Sprite';
  if (component.type === 'particle2d') return 'Particle';
  if (component.type === 'audio') return 'Audio';
  return component.type;
}

function fitSpriteSize(asset: AnimationEditorAsset): [number, number] {
  const width = asset.delivery.width ?? 160;
  const height = asset.delivery.height ?? 160;
  const scale = Math.min(1, 320 / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

function uniqueId(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}

function copiedName(name: string): string {
  return / copy(?: \d+)?$/iu.test(name) ? `${name} 2` : `${name} Copy`;
}

function nodeColor(kind: AnimationEditorBasicNodeKind): string {
  return ({
    group: '#94a3b8',
    rectangle: '#5bb8ff',
    ellipse: '#a78bfa',
    path: '#41d89b',
    vector: '#22d3ee',
    text: '#f3b95f',
    sprite: '#fb7185',
    particle: '#38bdf8',
    audio: '#f472b6',
  } as const)[kind];
}
