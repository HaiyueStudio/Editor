import {
  NATIVE_3D_PROJECT_FORMAT,
  NATIVE_3D_PROJECT_SCHEMA_VERSION,
  freezeNative3dProject,
  type Native3dBinding,
  type Native3dProject,
} from './Native3dProject';
import { validateParticle3DDescriptor } from '../Particle3DAuthoring';

export const NATIVE_3D_PROJECT_FILE_SUFFIX = '.hya-project.json' as const;
export const NATIVE_3D_PROJECT_MIME_TYPE = 'application/vnd.haiyue.animation-project+json' as const;
export const NATIVE_3D_PROJECT_MAX_BYTES = 64 * 1024 * 1024;

export type Native3dProjectDiagnosticCode =
  | 'E_PROJECT_INVALID_JSON'
  | 'E_PROJECT_INVALID_FORMAT'
  | 'E_PROJECT_UNSUPPORTED_VERSION'
  | 'E_PROJECT_MIXED_DIMENSIONS'
  | 'E_PROJECT_INVALID_VALUE'
  | 'E_PROJECT_UNKNOWN_REFERENCE'
  | 'E_PROJECT_LIMIT_EXCEEDED';

export class Native3dProjectFormatError extends Error {
  readonly name = 'Native3dProjectFormatError';

  constructor(
    readonly code: Native3dProjectDiagnosticCode,
    message: string,
    readonly path: string,
  ) {
    super(`${message} (${path})`);
  }
}

export function parseNative3dProject(source: string | unknown): Native3dProject {
  let value: unknown = source;
  if (typeof source === 'string') {
    if (new TextEncoder().encode(source).byteLength > NATIVE_3D_PROJECT_MAX_BYTES) {
      fail('E_PROJECT_LIMIT_EXCEEDED', 'Project exceeds the 64 MiB input budget.', '$');
    }
    try {
      value = JSON.parse(source) as unknown;
    } catch (error) {
      fail('E_PROJECT_INVALID_JSON', error instanceof Error ? error.message : 'Project JSON cannot be decoded.', '$');
    }
  }
  let detached: unknown;
  try {
    detached = structuredClone(value);
  } catch {
    fail('E_PROJECT_INVALID_VALUE', 'Project must contain detached JSON-compatible data.', '$');
  }
  validateNative3dProject(detached);
  return freezeNative3dProject(detached as Native3dProject);
}

export function serializeNative3dProject(project: Native3dProject): string {
  const parsed = parseNative3dProject(project);
  return `${JSON.stringify(canonicalize(parsed), null, 2)}\n`;
}

export function native3dProjectFileName(name: string): string {
  const stem = name.trim()
    .replace(/\.hya-project\.json$/iu, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-')
    .trim()
    .replace(/[. ]+$/gu, '') || 'untitled-3d-animation';
  return `${stem}${NATIVE_3D_PROJECT_FILE_SUFFIX}`;
}

export function validateNative3dProject(value: unknown): asserts value is Native3dProject {
  const root = record(value, '$');
  known(root, ['format', 'schemaVersion', 'mode', 'id', 'name', 'composition', 'assets', 'materials', 'nodes', 'timeline', 'stateMachine', 'editor'], '$');
  if (root.format !== NATIVE_3D_PROJECT_FORMAT) fail('E_PROJECT_INVALID_FORMAT', `Expected format "${NATIVE_3D_PROJECT_FORMAT}".`, '$.format');
  if (root.schemaVersion !== NATIVE_3D_PROJECT_SCHEMA_VERSION) fail('E_PROJECT_UNSUPPORTED_VERSION', `Unsupported 3D project schema "${String(root.schemaVersion)}".`, '$.schemaVersion');
  if (root.mode !== '3d') fail('E_PROJECT_MIXED_DIMENSIONS', 'Native 3D projects must use mode "3d" and cannot contain mixed 2D data.', '$.mode');
  nonEmpty(root.id, '$.id');
  nonEmpty(root.name, '$.name');

  const composition = record(root.composition, '$.composition');
  known(composition, ['viewport', 'coordinateSystem', 'duration', 'frameRate', 'endBehavior'], '$.composition');
  const viewport = record(composition.viewport, '$.composition.viewport');
  known(viewport, ['width', 'height'], '$.composition.viewport');
  positive(viewport.width, '$.composition.viewport.width');
  positive(viewport.height, '$.composition.viewport.height');
  const coordinate = record(composition.coordinateSystem, '$.composition.coordinateSystem');
  known(coordinate, ['handedness', 'upAxis', 'forwardAxis', 'unit', 'angles', 'rotationStorage'], '$.composition.coordinateSystem');
  exact(coordinate.handedness, 'right', '$.composition.coordinateSystem.handedness');
  exact(coordinate.upAxis, '+y', '$.composition.coordinateSystem.upAxis');
  exact(coordinate.forwardAxis, '-z', '$.composition.coordinateSystem.forwardAxis');
  exact(coordinate.unit, 'meter', '$.composition.coordinateSystem.unit');
  exact(coordinate.angles, 'radian', '$.composition.coordinateSystem.angles');
  exact(coordinate.rotationStorage, 'normalized-xyzw-quaternion', '$.composition.coordinateSystem.rotationStorage');
  const duration = positive(composition.duration, '$.composition.duration');
  positive(composition.frameRate, '$.composition.frameRate');
  oneOf(composition.endBehavior, ['hold', 'loop', 'destroy'] as const, '$.composition.endBehavior');

  const assetIds = validateAssets(root.assets);
  const materialIds = validateMaterials(root.materials, assetIds);
  const nodes = validateNodes(root.nodes, materialIds, assetIds, duration);
  const { clipIds, bindingIds } = validateTimeline(root.timeline, nodes, materialIds, duration);
  if (root.stateMachine !== undefined && root.stateMachine !== null) validateStateMachineShape(root.stateMachine, clipIds, bindingIds);
  if (root.editor !== undefined) validateEditor(root.editor, nodes, clipIds);
}

function validateAssets(value: unknown): Set<string> {
  const ids = new Set<string>();
  array(value, '$.assets', 10_000).forEach((entry, index) => {
    const path = `$.assets[${index}]`;
    const asset = record(entry, path);
    known(asset, ['id', 'name', 'type', 'source', 'delivery', 'dependencyAssetIds', 'provenance'], path);
    unique(ids, nonEmpty(asset.id, `${path}.id`), `${path}.id`);
    nonEmpty(asset.name, `${path}.name`);
    oneOf(asset.type, ['image', 'audio', 'binary', 'model'] as const, `${path}.type`);
    const source = record(asset.source, `${path}.source`);
    if (source.kind === 'external') {
      known(source, ['kind', 'uri'], `${path}.source`);
      nonEmpty(source.uri, `${path}.source.uri`);
    } else if (source.kind === 'embedded') {
      known(source, ['kind', 'encoding', 'data'], `${path}.source`);
      exact(source.encoding, 'base64', `${path}.source.encoding`);
      const data = text(source.data, `${path}.source.data`);
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data)) fail('E_PROJECT_INVALID_VALUE', 'Embedded asset data must be base64.', `${path}.source.data`);
    } else fail('E_PROJECT_INVALID_VALUE', 'Asset source kind must be external or embedded.', `${path}.source.kind`);
    const delivery = record(asset.delivery, `${path}.delivery`);
    known(delivery, ['uri', 'mimeType', 'integrity'], `${path}.delivery`);
    deliveryUri(delivery.uri, `${path}.delivery.uri`);
    nonEmpty(delivery.mimeType, `${path}.delivery.mimeType`);
    if (delivery.integrity !== undefined) nonEmpty(delivery.integrity, `${path}.delivery.integrity`);
    if (asset.dependencyAssetIds !== undefined) {
      const dependencies = new Set<string>();
      array(asset.dependencyAssetIds, `${path}.dependencyAssetIds`, 10_000).forEach((id, dependencyIndex) => unique(dependencies, nonEmpty(id, `${path}.dependencyAssetIds[${dependencyIndex}]`), `${path}.dependencyAssetIds[${dependencyIndex}]`));
    }
    if (asset.provenance !== undefined) {
      const provenance = record(asset.provenance, `${path}.provenance`);
      known(provenance, ['importer', 'sourceFormat', 'sourceHash'], `${path}.provenance`);
      for (const key of ['importer', 'sourceFormat', 'sourceHash']) if (provenance[key] !== undefined) nonEmpty(provenance[key], `${path}.provenance.${key}`);
    }
  });
  for (let index = 0; index < (value as unknown[]).length; index++) {
    const asset = value as Native3dProject['assets'];
    for (let dependencyIndex = 0; dependencyIndex < (asset[index]!.dependencyAssetIds?.length ?? 0); dependencyIndex++) {
      const id = asset[index]!.dependencyAssetIds![dependencyIndex]!;
      if (!ids.has(id)) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown dependency asset "${id}".`, `$.assets[${index}].dependencyAssetIds[${dependencyIndex}]`);
    }
  }
  return ids;
}

function validateMaterials(value: unknown, assetIds: Set<string>): Set<string> {
  const ids = new Set<string>();
  array(value, '$.materials', 10_000).forEach((entry, index) => {
    const path = `$.materials[${index}]`;
    const material = record(entry, path);
    known(material, ['id', 'name', 'baseColorFactor', 'metallicFactor', 'roughnessFactor', 'emissiveFactor', 'alphaMode', 'alphaCutoff', 'doubleSided', 'baseColorTexture', 'normalTexture', 'metallicRoughnessTexture', 'emissiveTexture'], path);
    unique(ids, nonEmpty(material.id, `${path}.id`), `${path}.id`);
    text(material.name, `${path}.name`);
    vector(material.baseColorFactor, 4, `${path}.baseColorFactor`, 0, 1);
    bounded(material.metallicFactor, `${path}.metallicFactor`, 0, 1);
    bounded(material.roughnessFactor, `${path}.roughnessFactor`, 0, 1);
    vector(material.emissiveFactor, 3, `${path}.emissiveFactor`, 0);
    oneOf(material.alphaMode, ['opaque', 'mask', 'blend'] as const, `${path}.alphaMode`);
    if (material.alphaCutoff !== undefined) bounded(material.alphaCutoff, `${path}.alphaCutoff`, 0, 1);
    bool(material.doubleSided, `${path}.doubleSided`);
    for (const key of ['baseColorTexture', 'normalTexture', 'metallicRoughnessTexture', 'emissiveTexture']) {
      if (material[key] !== undefined && !assetIds.has(nonEmpty(material[key], `${path}.${key}`))) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown texture asset "${String(material[key])}".`, `${path}.${key}`);
    }
  });
  return ids;
}

function validateNodes(value: unknown, materialIds: Set<string>, assetIds: Set<string>, duration: number): Map<string, Native3dProject['nodes'][number]> {
  const values = array(value, '$.nodes', 100_000);
  const ids = new Set<string>();
  const componentIds = new Set<string>();
  const nodes = new Map<string, Native3dProject['nodes'][number]>();
  let particleCapacity = 0;
  values.forEach((entry, index) => {
    const path = `$.nodes[${index}]`;
    const node = record(entry, path);
    known(node, ['id', 'name', 'parent', 'start', 'duration', 'transform', 'components'], path);
    const id = nonEmpty(node.id, `${path}.id`);
    unique(ids, id, `${path}.id`);
    text(node.name, `${path}.name`);
    if (node.parent !== undefined) nonEmpty(node.parent, `${path}.parent`);
    const start = node.start === undefined ? 0 : nonNegative(node.start, `${path}.start`);
    const nodeDuration = node.duration === undefined ? duration - start : positive(node.duration, `${path}.duration`);
    if (start + nodeDuration > duration + 1e-6) fail('E_PROJECT_INVALID_VALUE', 'Node range exceeds the composition.', path);
    validateTransform(node.transform, `${path}.transform`);
    array(node.components, `${path}.components`, 200_000).forEach((componentValue, componentIndex) => {
      const componentPath = `${path}.components[${componentIndex}]`;
      const component = record(componentValue, componentPath);
      unique(componentIds, nonEmpty(component.id, `${componentPath}.id`), `${componentPath}.id`);
      if (component.kind === 'camera3d') validateCamera(component, componentPath);
      else if (component.kind === 'primitive3d') {
        known(component, ['id', 'kind', 'primitive', 'materialId'], componentPath);
        oneOf(component.primitive, ['box', 'sphere', 'plane', 'cylinder', 'cone'] as const, `${componentPath}.primitive`);
        const materialId = nonEmpty(component.materialId, `${componentPath}.materialId`);
        if (!materialIds.has(materialId)) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown material "${materialId}".`, `${componentPath}.materialId`);
      } else if (component.kind === 'model3d') {
        known(component, ['id', 'kind', 'resource', 'materialOverrides'], componentPath);
        const resource = nonEmpty(component.resource, `${componentPath}.resource`);
        if (!assetIds.has(resource)) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown model asset "${resource}".`, `${componentPath}.resource`);
        if (component.materialOverrides !== undefined) array(component.materialOverrides, `${componentPath}.materialOverrides`, 10_000).forEach((overrideValue, overrideIndex) => {
          const overridePath = `${componentPath}.materialOverrides[${overrideIndex}]`;
          const override = record(overrideValue, overridePath);
          known(override, ['slot', 'materialId'], overridePath);
          nonEmpty(override.slot, `${overridePath}.slot`);
          const materialId = nonEmpty(override.materialId, `${overridePath}.materialId`);
          if (!materialIds.has(materialId)) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown material "${materialId}".`, `${overridePath}.materialId`);
        });
      } else if (component.kind === 'particle3d') {
        known(component, ['id', 'kind', 'descriptor'], componentPath);
        try {
          const descriptor = validateParticle3DDescriptor(component.descriptor as never);
          particleCapacity += descriptor.maxParticles;
          if (particleCapacity > 2_000_000) fail('E_PROJECT_LIMIT_EXCEEDED', 'Particle capacity exceeds 2,000,000.', `${componentPath}.descriptor.maxParticles`);
          if (descriptor.textureResource !== undefined && !assetIds.has(descriptor.textureResource)) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown particle texture "${descriptor.textureResource}".`, `${componentPath}.descriptor.textureResource`);
        } catch (error) {
          if (error instanceof Native3dProjectFormatError) throw error;
          fail('E_PROJECT_INVALID_VALUE', error instanceof Error ? error.message : 'Invalid Particle3D descriptor.', `${componentPath}.descriptor`);
        }
      } else fail('E_PROJECT_INVALID_VALUE', `Unsupported 3D component "${String(component.kind)}".`, `${componentPath}.kind`);
    });
    nodes.set(id, node as unknown as Native3dProject['nodes'][number]);
  });
  for (let index = 0; index < values.length; index++) {
    const node = values[index] as Native3dProject['nodes'][number];
    if (node.parent !== undefined && !nodes.has(node.parent)) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown parent "${node.parent}".`, `$.nodes[${index}].parent`);
    const seen = new Set<string>();
    let current: Native3dProject['nodes'][number] | undefined = node;
    while (current?.parent) {
      if (seen.has(current.id)) fail('E_PROJECT_INVALID_VALUE', 'Node hierarchy contains a cycle.', '$.nodes');
      seen.add(current.id);
      current = nodes.get(current.parent);
    }
  }
  return nodes;
}

function validateTimeline(value: unknown, nodes: ReadonlyMap<string, Native3dProject['nodes'][number]>, materialIds: Set<string>, compositionDuration: number): { clipIds: Set<string>; bindingIds: Set<string> } {
  const timeline = record(value, '$.timeline');
  known(timeline, ['clips'], '$.timeline');
  const clipIds = new Set<string>();
  const bindingIds = new Set<string>();
  let tracks = 0;
  let keys = 0;
  array(timeline.clips, '$.timeline.clips', 10_000).forEach((clipValue, clipIndex) => {
    const clipPath = `$.timeline.clips[${clipIndex}]`;
    const clip = record(clipValue, clipPath);
    known(clip, ['id', 'name', 'duration', 'tracks', 'events'], clipPath);
    unique(clipIds, nonEmpty(clip.id, `${clipPath}.id`), `${clipPath}.id`);
    text(clip.name, `${clipPath}.name`);
    const duration = positive(clip.duration, `${clipPath}.duration`);
    if (duration > compositionDuration + 1e-6) fail('E_PROJECT_INVALID_VALUE', 'Clip exceeds the composition duration.', `${clipPath}.duration`);
    const trackIds = new Set<string>();
    const clipBindingIds = new Set<string>();
    array(clip.tracks, `${clipPath}.tracks`, 200_000).forEach((trackValue, trackIndex) => {
      tracks++;
      if (tracks > 200_000) fail('E_PROJECT_LIMIT_EXCEEDED', 'Track count exceeds 200,000.', `${clipPath}.tracks`);
      const trackPath = `${clipPath}.tracks[${trackIndex}]`;
      const track = record(trackValue, trackPath);
      known(track, ['id', 'name', 'binding', 'interpolation', 'keyframes'], trackPath);
      unique(trackIds, nonEmpty(track.id, `${trackPath}.id`), `${trackPath}.id`);
      text(track.name, `${trackPath}.name`);
      const binding = validateBinding(track.binding, `${trackPath}.binding`, nodes, materialIds);
      unique(clipBindingIds, binding.id, `${trackPath}.binding.id`);
      bindingIds.add(binding.id);
      const interpolation = oneOf(track.interpolation, ['step', 'linear', 'cubic-spline'] as const, `${trackPath}.interpolation`);
      const keyframeIds = new Set<string>();
      let previous = -Infinity;
      const keyframes = array(track.keyframes, `${trackPath}.keyframes`, 5_000_000);
      if (keyframes.length === 0) fail('E_PROJECT_INVALID_VALUE', 'Tracks require at least one keyframe.', `${trackPath}.keyframes`);
      keyframes.forEach((keyframeValue, keyframeIndex) => {
        keys++;
        if (keys > 5_000_000) fail('E_PROJECT_LIMIT_EXCEEDED', 'Keyframe count exceeds 5,000,000.', `${trackPath}.keyframes`);
        const keyPath = `${trackPath}.keyframes[${keyframeIndex}]`;
        const keyframe = record(keyframeValue, keyPath);
        known(keyframe, ['id', 'time', 'value', 'inTangent', 'outTangent'], keyPath);
        unique(keyframeIds, nonEmpty(keyframe.id, `${keyPath}.id`), `${keyPath}.id`);
        const time = nonNegative(keyframe.time, `${keyPath}.time`);
        if (time <= previous || time > duration) fail('E_PROJECT_INVALID_VALUE', 'Keyframe times must be strictly increasing and fit the clip.', `${keyPath}.time`);
        previous = time;
        vector(keyframe.value, binding.valueSize, `${keyPath}.value`);
        if (binding.path === 'transform.rotation') normalizedQuaternion(keyframe.value as unknown[], `${keyPath}.value`);
        if (interpolation === 'cubic-spline') {
          vector(keyframe.inTangent, binding.valueSize, `${keyPath}.inTangent`);
          vector(keyframe.outTangent, binding.valueSize, `${keyPath}.outTangent`);
        } else if (keyframe.inTangent !== undefined || keyframe.outTangent !== undefined) {
          fail('E_PROJECT_INVALID_VALUE', 'Tangents are only valid for cubic-spline tracks.', keyPath);
        }
      });
    });
    const eventIds = new Set<string>();
    array(clip.events, `${clipPath}.events`, 100_000).forEach((eventValue, eventIndex) => {
      const eventPath = `${clipPath}.events[${eventIndex}]`;
      const event = record(eventValue, eventPath);
      known(event, ['id', 'time', 'name', 'payload'], eventPath);
      unique(eventIds, nonEmpty(event.id, `${eventPath}.id`), `${eventPath}.id`);
      if (nonNegative(event.time, `${eventPath}.time`) > duration) fail('E_PROJECT_INVALID_VALUE', 'Event exceeds the clip duration.', `${eventPath}.time`);
      nonEmpty(event.name, `${eventPath}.name`);
      if (event.payload !== undefined) jsonObject(event.payload, `${eventPath}.payload`);
    });
  });
  return { clipIds, bindingIds };
}

function validateBinding(value: unknown, path: string, nodes: ReadonlyMap<string, Native3dProject['nodes'][number]>, materials: Set<string>): Native3dBinding {
  const binding = record(value, path);
  const common = ['id', 'target', 'path', 'valueType', 'valueSize'];
  known(binding, binding.path === 'property' ? [...common, 'component', 'property'] : common, path);
  nonEmpty(binding.id, `${path}.id`);
  const target = record(binding.target, `${path}.target`);
  if (target.kind === 'node-id') {
    known(target, ['kind', 'nodeId'], `${path}.target`);
    const id = nonEmpty(target.nodeId, `${path}.target.nodeId`);
    if (!nodes.has(id)) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown binding node "${id}".`, `${path}.target.nodeId`);
  } else if (target.kind === 'node-path') {
    known(target, ['kind', 'segments'], `${path}.target`);
    const segments = array(target.segments, `${path}.target.segments`, 1024);
    if (segments.length === 0) fail('E_PROJECT_INVALID_VALUE', 'Node path cannot be empty.', `${path}.target.segments`);
    const root = nonEmpty(segments[0], `${path}.target.segments[0]`);
    if (!nodes.has(root)) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown path root "${root}".`, `${path}.target.segments[0]`);
    segments.slice(1).forEach((segment, index) => nonEmpty(segment, `${path}.target.segments[${index + 1}]`));
  } else if (target.kind === 'slot') {
    known(target, ['kind', 'slot'], `${path}.target`);
    nonEmpty(target.slot, `${path}.target.slot`);
  } else fail('E_PROJECT_INVALID_VALUE', 'Unknown binding target.', `${path}.target.kind`);
  if (binding.path === 'transform.translation' || binding.path === 'transform.scale') {
    exact(binding.valueType, 'vec3', `${path}.valueType`); exact(binding.valueSize, 3, `${path}.valueSize`);
  } else if (binding.path === 'transform.rotation') {
    exact(binding.valueType, 'quaternion', `${path}.valueType`); exact(binding.valueSize, 4, `${path}.valueSize`);
  } else if (binding.path === 'morph.weights') {
    exact(binding.valueType, 'weights', `${path}.valueType`); positiveInteger(binding.valueSize, `${path}.valueSize`);
  } else if (binding.path === 'property') {
    const component = oneOf(binding.component, ['material3d', 'camera3d'] as const, `${path}.component`);
    const property = nonEmpty(binding.property, `${path}.property`);
    const contracts: Record<string, readonly [string, number]> = component === 'material3d'
      ? { baseColorFactor: ['vec4', 4], metallicFactor: ['scalar', 1], roughnessFactor: ['scalar', 1], emissiveFactor: ['vec3', 3], alphaCutoff: ['scalar', 1] }
      : { fovYRadians: ['scalar', 1], near: ['scalar', 1], far: ['scalar', 1], orthoHeight: ['scalar', 1] };
    const contract = contracts[property];
    if (!contract) fail('E_PROJECT_INVALID_VALUE', `Unsupported ${component} property "${property}".`, `${path}.property`);
    exact(binding.valueType, contract[0], `${path}.valueType`); exact(binding.valueSize, contract[1], `${path}.valueSize`);
    if (component === 'material3d' && (target.kind !== 'slot' || !materials.has(String(target.slot)))) fail('E_PROJECT_UNKNOWN_REFERENCE', 'Material properties require a material-id slot.', `${path}.target`);
    if (component === 'camera3d' && (target.kind !== 'node-id' || !nodes.get(String(target.nodeId))?.components.some(item => item.kind === 'camera3d'))) fail('E_PROJECT_UNKNOWN_REFERENCE', 'Camera properties require a Camera3D node.', `${path}.target`);
  } else fail('E_PROJECT_INVALID_VALUE', `Unsupported binding path "${String(binding.path)}".`, `${path}.path`);
  return binding as unknown as Native3dBinding;
}

function validateTransform(value: unknown, path: string): void {
  const transform = record(value, path);
  known(transform, ['translation', 'rotation', 'scale'], path);
  vector(transform.translation, 3, `${path}.translation`);
  vector(transform.rotation, 4, `${path}.rotation`);
  normalizedQuaternion(transform.rotation as unknown[], `${path}.rotation`);
  vector(transform.scale, 3, `${path}.scale`);
}

function validateCamera(component: Record<string, unknown>, path: string): void {
  known(component, ['id', 'kind', 'projection'], path);
  const projection = record(component.projection, `${path}.projection`);
  if (projection.kind === 'perspective') {
    known(projection, ['kind', 'fovYRadians', 'near', 'far'], `${path}.projection`);
    bounded(projection.fovYRadians, `${path}.projection.fovYRadians`, Number.MIN_VALUE, Math.PI, false);
  } else if (projection.kind === 'orthographic') {
    known(projection, ['kind', 'orthoHeight', 'near', 'far'], `${path}.projection`);
    positive(projection.orthoHeight, `${path}.projection.orthoHeight`);
  } else fail('E_PROJECT_INVALID_VALUE', 'Unknown camera projection.', `${path}.projection.kind`);
  const near = projection.kind === 'orthographic' ? nonNegative(projection.near, `${path}.projection.near`) : positive(projection.near, `${path}.projection.near`);
  const far = positive(projection.far, `${path}.projection.far`);
  if (far <= near) fail('E_PROJECT_INVALID_VALUE', 'Camera far must be greater than near.', `${path}.projection.far`);
}

function validateStateMachineShape(value: unknown, clipIds: Set<string>, bindingIds: Set<string>): void {
  const machine = record(value, '$.stateMachine');
  if (machine.format !== 'haiyue-animation3d-state-machine@1') fail('E_PROJECT_INVALID_VALUE', 'Unknown 3D state-machine format.', '$.stateMachine.format');
  nonEmpty(machine.id, '$.stateMachine.id');
  text(machine.name, '$.stateMachine.name');
  array(machine.parameters, '$.stateMachine.parameters', 10_000);
  const json = jsonObject(machine, '$.stateMachine');
  const serialized = JSON.stringify(json);
  for (const clipId of collectStringProperties(json, 'clipId')) if (!clipIds.has(clipId)) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown state-machine clip "${clipId}".`, '$.stateMachine');
  for (const bindingId of bindingIds) void bindingId;
  if (serialized.length > 8 * 1024 * 1024) fail('E_PROJECT_LIMIT_EXCEEDED', 'State machine exceeds 8 MiB.', '$.stateMachine');
}

function validateEditor(value: unknown, nodes: ReadonlyMap<string, unknown>, clipIds: Set<string>): void {
  const editor = record(value, '$.editor');
  known(editor, ['selectedNodeIds', 'activeClipId', 'viewportCamera', 'gizmo'], '$.editor');
  if (editor.selectedNodeIds !== undefined) array(editor.selectedNodeIds, '$.editor.selectedNodeIds', 100_000).forEach((id, index) => {
    const nodeId = nonEmpty(id, `$.editor.selectedNodeIds[${index}]`);
    if (!nodes.has(nodeId)) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown selected node "${nodeId}".`, `$.editor.selectedNodeIds[${index}]`);
  });
  if (editor.activeClipId !== undefined && !clipIds.has(nonEmpty(editor.activeClipId, '$.editor.activeClipId'))) fail('E_PROJECT_UNKNOWN_REFERENCE', `Unknown active clip "${String(editor.activeClipId)}".`, '$.editor.activeClipId');
  if (editor.viewportCamera !== undefined) {
    const camera = record(editor.viewportCamera, '$.editor.viewportCamera');
    known(camera, ['position', 'target', 'up'], '$.editor.viewportCamera');
    vector(camera.position, 3, '$.editor.viewportCamera.position');
    vector(camera.target, 3, '$.editor.viewportCamera.target');
    vector(camera.up, 3, '$.editor.viewportCamera.up');
  }
  if (editor.gizmo !== undefined) {
    const gizmo = record(editor.gizmo, '$.editor.gizmo');
    known(gizmo, ['tool', 'space'], '$.editor.gizmo');
    oneOf(gizmo.tool, ['translate', 'rotate', 'scale'] as const, '$.editor.gizmo.tool');
    oneOf(gizmo.space, ['local', 'world'] as const, '$.editor.gizmo.space');
  }
}

function deliveryUri(value: unknown, path: string): string {
  const uri = nonEmpty(value, path);
  if (/^(?:blob|file|javascript):/iu.test(uri) || uri.startsWith('/') || /(?:^|\/)\.\.(?:\/|$)/u.test(uri)) fail('E_PROJECT_INVALID_VALUE', 'Delivery URI must be package-relative, https, or data and traversal-safe.', path);
  if (!/^(?:https:\/\/|data:|[A-Za-z0-9._~!$&'()*+,;=:@%/-]+)$/u.test(uri)) fail('E_PROJECT_INVALID_VALUE', 'Delivery URI contains unsupported characters.', path);
  return uri;
}

function collectStringProperties(value: unknown, key: string, output: string[] = []): string[] {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) for (const child of value) collectStringProperties(child, key, output);
  else for (const [entryKey, child] of Object.entries(value)) {
    if (entryKey === key && typeof child === 'string') output.push(child);
    collectStringProperties(child, key, output);
  }
  return output;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(key => [key, canonicalize((value as Record<string, unknown>)[key])]));
}

function jsonObject(value: unknown, path: string, depth = 0): Readonly<Record<string, unknown>> {
  if (depth > 64) fail('E_PROJECT_LIMIT_EXCEEDED', 'JSON object nesting exceeds 64.', path);
  const item = record(value, path);
  for (const [key, child] of Object.entries(item)) jsonValue(child, `${path}.${key}`, depth + 1);
  return item;
}

function jsonValue(value: unknown, path: string, depth: number): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { finite(value, path); return; }
  if (Array.isArray(value)) { value.forEach((child, index) => jsonValue(child, `${path}[${index}]`, depth + 1)); return; }
  jsonObject(value, path, depth);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('E_PROJECT_INVALID_VALUE', 'Expected an object.', path);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) fail('E_PROJECT_INVALID_VALUE', 'Expected an array.', path);
  if (value.length > maximum) fail('E_PROJECT_LIMIT_EXCEEDED', `Array exceeds ${maximum} items.`, path);
  return value;
}

function known(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail('E_PROJECT_INVALID_VALUE', `Unknown property "${key}".`, `${path}.${key}`);
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('E_PROJECT_INVALID_VALUE', 'Expected a string.', path);
  return value;
}

function nonEmpty(value: unknown, path: string): string {
  const result = text(value, path);
  if (result.length === 0) fail('E_PROJECT_INVALID_VALUE', 'Expected a non-empty string.', path);
  return result;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('E_PROJECT_INVALID_VALUE', 'Expected a finite number.', path);
  return value;
}

function positive(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result <= 0) fail('E_PROJECT_INVALID_VALUE', 'Expected a positive number.', path);
  return result;
}

function nonNegative(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0) fail('E_PROJECT_INVALID_VALUE', 'Expected a non-negative number.', path);
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) fail('E_PROJECT_INVALID_VALUE', 'Expected a positive safe integer.', path);
  return value;
}

function bounded(value: unknown, path: string, minimum: number, maximum: number, inclusiveMaximum = true): number {
  const result = finite(value, path);
  if (result < minimum || (inclusiveMaximum ? result > maximum : result >= maximum)) fail('E_PROJECT_INVALID_VALUE', 'Number is outside the supported range.', path);
  return result;
}

function vector(value: unknown, size: number, path: string, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE): readonly number[] {
  const values = array(value, path, size);
  if (values.length !== size) fail('E_PROJECT_INVALID_VALUE', `Expected ${size} numbers.`, path);
  values.forEach((entry, index) => bounded(entry, `${path}[${index}]`, minimum, maximum));
  return values as number[];
}

function normalizedQuaternion(value: unknown[], path: string): void {
  const length = Math.hypot(...value.map(Number));
  if (Math.abs(length - 1) > 1e-4) fail('E_PROJECT_INVALID_VALUE', 'Quaternion must be normalized XYZW.', path);
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail('E_PROJECT_INVALID_VALUE', 'Expected a boolean.', path);
  return value;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail('E_PROJECT_INVALID_VALUE', `Expected one of ${values.join(', ')}.`, path);
  return value as T;
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) fail('E_PROJECT_INVALID_VALUE', `Expected ${JSON.stringify(expected)}.`, path);
}

function unique(ids: Set<string>, id: string, path: string): void {
  if (ids.has(id)) fail('E_PROJECT_INVALID_VALUE', `Duplicate id "${id}".`, path);
  ids.add(id);
}

function fail(code: Native3dProjectDiagnosticCode, message: string, path: string): never {
  throw new Native3dProjectFormatError(code, message, path);
}
