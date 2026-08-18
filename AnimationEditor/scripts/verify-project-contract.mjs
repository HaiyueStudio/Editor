import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const ANIMATION_SPEC_ROOT = new URL('../', import.meta.resolve('@haiyue/animation-spec'));
const schema = await readJson(new URL('schema/project.schema.json', ROOT));
const project = await readJson(new URL('examples/state-machine-multitrack.hya-project.json', ROOT));
const schema3d = await readJson(new URL('schema/project-3d.schema.json', ROOT));
const extensionSchema3d = await readJson(new URL('schema/animation-3d-extension.schema.json', ANIMATION_SPEC_ROOT));
const contract3d = await readJson(new URL('schema/animation-3d.contract.json', ANIMATION_SPEC_ROOT));
const project3d = await readJson(new URL('schema/fixtures/native-3d-project-valid.json', ROOT));
const expectedHya3d = await readJson(new URL('schema/fixtures/native-3d-valid.hya.json', ANIMATION_SPEC_ROOT));
const mixedProject3d = await readJson(new URL('schema/fixtures/native-3d-project-mixed-invalid.json', ROOT));

assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.equal(schema.properties.format.const, 'haiyue-animation-editor-project@1');
assert.equal(schema.properties.schemaVersion.const, 1);
verifyLocalReferences(schema);
verifyProject(project);

assert.equal(schema3d.properties.format.const, contract3d.projects['3d'].format);
assert.equal(schema3d.properties.schemaVersion.const, contract3d.projects['3d'].schemaVersion);
assert.equal(schema3d.properties.mode.const, contract3d.projects['3d'].mode);
verifyProject3dSchemaReferences(schema3d, extensionSchema3d);
verifyProject3d(project3d, contract3d);
assert.deepEqual(lowerProject3dFixture(project3d, contract3d), expectedHya3d);
assert.throws(
  () => verifyProject3d(mixedProject3d.project, contract3d),
  error => error?.code === mixedProject3d.expectedDiagnostic.code
    && error?.path === mixedProject3d.expectedDiagnostic.path,
);

const invalid = structuredClone(project);
invalid.timeline.tracks[1].id = invalid.timeline.tracks[0].id;
assert.throws(() => verifyProject(invalid), /Duplicate track id/);

const invalidMotion = structuredClone(project);
invalidMotion.stateMachine.layers[0].states[0].motion.clipId = 'missing-clip';
assert.throws(() => verifyProject(invalidMotion), /Unknown clip/);

const invalidInlineTrack = structuredClone(project);
invalidInlineTrack.nodes[1].components[0].component.opacityTrack = { times: [0], values: [1] };
assert.throws(() => verifyProject(invalidInlineTrack), /contains inline track/);

const invalidCycle = structuredClone(project);
invalidCycle.nodes[0].compositeLayers.push({
  id: 'root-mask', kind: 'mask', sourceNodeId: 'body', mode: 'alpha',
});
invalidCycle.nodes[1].compositeLayers.push({
  id: 'body-mask', kind: 'mask', sourceNodeId: 'character-root', mode: 'alpha',
});
assert.throws(() => verifyProject(invalidCycle), /Composite cycle/);

console.log('[animation-editor] project contract passed: 2D compatibility + native 3D schema/lowering/diagnostics');

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function verifyLocalReferences(value) {
  visit(value, (entry, path) => {
    if (typeof entry?.$ref !== 'string' || !entry.$ref.startsWith('#/$defs/')) return;
    const name = entry.$ref.slice('#/$defs/'.length);
    assert.ok(schema.$defs[name], `Unknown local schema reference ${entry.$ref} at ${path}`);
  });
}

function verifyProject(value) {
  assert.equal(value.format, 'haiyue-animation-editor-project@1');
  assert.equal(value.schemaVersion, 1);
  nonEmpty(value.id, '$.id');
  nonEmpty(value.name, '$.name');
  positive(value.composition.duration, '$.composition.duration');
  positive(value.composition.frameRate, '$.composition.frameRate');
  positive(value.composition.canvas.width, '$.composition.canvas.width');
  positive(value.composition.canvas.height, '$.composition.canvas.height');
  assert.equal(value.composition.canvas.coordinateSystem, 'screen-y-down');

  const duration = value.composition.duration;
  const assets = uniqueMap(value.assets, '$.assets', 'asset');
  for (const [id, asset] of assets) {
    assert.equal(id, asset.id);
    nonEmpty(asset.delivery?.uri, `$.assets[${id}].delivery.uri`);
    if (asset.source?.kind === 'embedded') {
      assert.equal(asset.source.encoding, 'base64');
      assert.match(asset.source.data, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
    }
  }

  const nodes = uniqueMap(value.nodes, '$.nodes', 'node');
  for (const [id, node] of nodes) {
    if (node.parent !== undefined) {
      assert.ok(nodes.has(node.parent), `Unknown parent ${node.parent} on node ${id}`);
      assert.notEqual(node.parent, id, `Node ${id} cannot parent itself`);
    }
    const start = node.start ?? 0;
    const nodeDuration = node.duration ?? duration - start;
    nonNegative(start, `node ${id} start`);
    positive(nodeDuration, `node ${id} duration`);
    assert.ok(start + nodeDuration <= duration + 1e-6, `Node ${id} range exceeds composition`);
    const components = uniqueMap(node.components, `node ${id} components`, 'component');
    uniqueMap(node.effects, `node ${id} effects`, 'effect');
    uniqueMap(node.compositeLayers, `node ${id} composite layers`, 'composite layer');
    for (const component of components.values()) {
      uniqueMap(component.parts ?? [], `node ${id} component ${component.id} parts`, 'component part');
      rejectInlineTracks(component.component, `node ${id} component ${component.id}`);
    }
    for (const effect of node.effects) rejectInlineTracks(effect.effect, `node ${id} effect ${effect.id}`);
    for (const layer of node.compositeLayers) {
      assert.ok(nodes.has(layer.sourceNodeId), `Unknown composite source ${layer.sourceNodeId} on node ${id}`);
      assert.notEqual(layer.sourceNodeId, id, `Node ${id} cannot composite itself`);
    }
  }
  verifyParentCycles(nodes);
  verifyCompositeCycles(nodes);

  const tracks = uniqueMap(value.timeline.tracks, '$.timeline.tracks', 'track');
  const enabledTargets = new Set();
  for (const [id, track] of tracks) {
    assert.ok(Number.isSafeInteger(track.valueSize) && track.valueSize > 0, `Invalid valueSize on track ${id}`);
    verifyTrackTarget(track, nodes);
    const targetKey = JSON.stringify(track.target);
    if (track.enabled !== false) {
      assert.ok(!enabledTargets.has(targetKey), `Duplicate enabled target on track ${id}`);
      enabledTargets.add(targetKey);
    }
    const expected = track.target.kind === 'node-transform'
      ? ({ position: 2, scale: 2, rotation: 1, opacity: 1 })[track.target.property]
      : undefined;
    if (expected !== undefined) assert.equal(track.valueSize, expected, `Invalid core valueSize on track ${id}`);
    const keyframes = uniqueMap(track.keyframes, `track ${id} keyframes`, 'keyframe');
    let previous = -Infinity;
    for (const keyframe of keyframes.values()) {
      finite(keyframe.time, `track ${id} keyframe ${keyframe.id} time`);
      assert.ok(keyframe.time >= 0 && keyframe.time <= duration, `Keyframe ${keyframe.id} is outside composition`);
      assert.ok(keyframe.time > previous, `Keyframes on track ${id} must be strictly increasing`);
      previous = keyframe.time;
      assert.equal(keyframe.value.length, track.valueSize, `Keyframe ${keyframe.id} valueSize mismatch`);
      keyframe.value.forEach((number, index) => finite(number, `keyframe ${keyframe.id} value[${index}]`));
      if (keyframe.easing !== undefined) {
        assert.equal(keyframe.interpolation, 'cubic-bezier', `Keyframe ${keyframe.id} easing requires cubic-bezier`);
        assert.equal(keyframe.easing.length, 4, `Keyframe ${keyframe.id} easing must have four values`);
        assert.ok(keyframe.easing[0] >= 0 && keyframe.easing[0] <= 1 && keyframe.easing[2] >= 0 && keyframe.easing[2] <= 1,
          `Keyframe ${keyframe.id} easing x controls must be in [0,1]`);
      }
      if (keyframe.spatialIn !== undefined || keyframe.spatialOut !== undefined) {
        assert.equal(track.target.kind, 'node-transform', `Spatial handles require a node transform track`);
        assert.equal(track.target.property, 'position', `Spatial handles require a position track`);
        assert.equal(track.valueSize, 2, `Spatial handles require valueSize 2`);
      }
    }
  }

  const clips = uniqueMap(value.timeline.clips, '$.timeline.clips', 'clip');
  for (const [id, clip] of clips) {
    nonNegative(clip.start, `clip ${id} start`);
    positive(clip.duration, `clip ${id} duration`);
    assert.ok(clip.start + clip.duration <= duration + 1e-6, `Clip ${id} range exceeds composition`);
  }

  if (value.stateMachine !== null && value.stateMachine !== undefined) {
    verifyStateMachine(value.stateMachine, clips, nodes);
  }
}

function verifyProject3dSchemaReferences(projectSchema, extensionSchema) {
  visit(projectSchema, (entry, path) => {
    if (typeof entry?.$ref !== 'string') return;
    if (entry.$ref.startsWith('#/$defs/')) {
      const name = entry.$ref.slice('#/$defs/'.length);
      assert.ok(projectSchema.$defs[name], `Unknown local 3D project schema reference ${entry.$ref} at ${path}`);
      return;
    }
    const prefix = 'https://haiyue.dev/schema/animation/extension/animation-3d/1.json#/$defs/';
    assert.ok(entry.$ref.startsWith(prefix), `Unexpected external 3D project schema reference ${entry.$ref} at ${path}`);
    const name = entry.$ref.slice(prefix.length);
    assert.ok(extensionSchema.$defs[name], `Unknown Animation3D schema reference ${entry.$ref} at ${path}`);
  });
}

function verifyProject3d(value, contract) {
  if (value?.mode !== contract.projects['3d'].mode) {
    failContract(
      contract.projects.mixedComposition.code,
      contract.projects.mixedComposition.path,
      `Native 3D project mode must be "${contract.projects['3d'].mode}".`,
    );
  }
  if (value.format !== contract.projects['3d'].format) {
    failContract('E_PROJECT_INVALID_FORMAT', '$.format', `Unknown native 3D project format "${String(value.format)}".`);
  }
  if (value.schemaVersion !== contract.projects['3d'].schemaVersion) {
    failContract('E_PROJECT_UNSUPPORTED_VERSION', '$.schemaVersion', `Unsupported native 3D schema ${String(value.schemaVersion)}.`);
  }

  nonEmpty(value.id, '$.id');
  nonEmpty(value.name, '$.name');
  positive(value.composition.duration, '$.composition.duration');
  positive(value.composition.frameRate, '$.composition.frameRate');
  positive(value.composition.viewport.width, '$.composition.viewport.width');
  positive(value.composition.viewport.height, '$.composition.viewport.height');
  assert.deepEqual(value.composition.coordinateSystem, {
    handedness: contract.coordinates.handedness,
    upAxis: contract.coordinates.upAxis,
    forwardAxis: contract.coordinates.forwardAxis,
    unit: contract.coordinates.linearUnit,
    angles: contract.coordinates.angles,
    rotationStorage: contract.coordinates.rotationStorage,
  });

  const assets = uniqueMap(value.assets, '$.assets', 'asset');
  for (const [assetId, asset] of assets) {
    nonEmpty(asset.delivery?.uri, `$.assets[${assetId}].delivery.uri`);
    assert.ok(isDeliveryUri3d(asset.delivery.uri), `Unsupported delivery URI on ${assetId}`);
    for (const dependencyId of asset.dependencyAssetIds ?? []) {
      assert.ok(assets.has(dependencyId), `Unknown dependency asset ${dependencyId} on ${assetId}`);
      assert.notEqual(dependencyId, assetId, `Asset ${assetId} cannot depend on itself`);
    }
  }

  const materials = uniqueMap(value.materials, '$.materials', 'material');
  const nodes = uniqueMap(value.nodes, '$.nodes', 'node');
  for (const [nodeId, node] of nodes) {
    verifyTransform3d(node.transform, `node ${nodeId} transform`);
    if (node.parent !== undefined) {
      assert.ok(nodes.has(node.parent), `Unknown 3D parent ${node.parent} on ${nodeId}`);
      assert.notEqual(node.parent, nodeId, `3D node ${nodeId} cannot parent itself`);
    }
    const components = uniqueMap(node.components, `node ${nodeId} components`, 'component');
    for (const component of components.values()) {
      if (component.kind === 'primitive3d') {
        assert.ok(materials.has(component.materialId), `Unknown material ${component.materialId} on ${component.id}`);
      } else if (component.kind === 'model3d') {
        assert.equal(assets.get(component.resource)?.type, 'model', `Model ${component.id} must reference a model asset`);
        for (const override of component.materialOverrides ?? []) {
          assert.ok(materials.has(override.materialId), `Unknown override material ${override.materialId} on ${component.id}`);
        }
      } else if (component.kind === 'particle3d' && component.descriptor.textureResource !== undefined) {
        assert.equal(assets.get(component.descriptor.textureResource)?.type, 'image', `Particle ${component.id} must reference an image asset`);
      } else if (component.kind === 'camera3d') {
        positive(component.projection.far, `camera ${component.id} far`);
        nonNegative(component.projection.near, `camera ${component.id} near`);
        assert.ok(component.projection.far > component.projection.near, `Camera ${component.id} far must exceed near`);
      }
    }
  }
  verifyParentCycles(nodes);

  const clips = uniqueMap(value.timeline.clips, '$.timeline.clips', 'clip');
  const bindingIds = new Set();
  for (const [clipId, clip] of clips) {
    positive(clip.duration, `clip ${clipId} duration`);
    assert.ok(clip.duration <= value.composition.duration + 1e-6, `Clip ${clipId} exceeds composition`);
    const tracks = uniqueMap(clip.tracks, `clip ${clipId} tracks`, 'track');
    for (const [trackId, track] of tracks) {
      nonEmpty(track.binding?.id, `track ${trackId} binding id`);
      assert.ok(!bindingIds.has(track.binding.id), `Duplicate Animation3D binding id ${track.binding.id}`);
      bindingIds.add(track.binding.id);
      verifyBinding3d(track.binding, nodes, contract, `clip ${clipId} track ${trackId}`);
      const keyframes = uniqueMap(track.keyframes, `track ${trackId} keyframes`, 'keyframe');
      let previousTime = -Infinity;
      for (const [keyframeId, keyframe] of keyframes) {
        finite(keyframe.time, `keyframe ${keyframeId} time`);
        assert.ok(keyframe.time > previousTime, `Keyframes on ${trackId} must be strictly increasing`);
        assert.ok(keyframe.time >= 0 && keyframe.time <= clip.duration, `Keyframe ${keyframeId} exceeds clip`);
        previousTime = keyframe.time;
        assert.equal(keyframe.value.length, track.binding.valueSize, `Keyframe ${keyframeId} value width mismatch`);
        keyframe.value.forEach((entry, index) => finite(entry, `keyframe ${keyframeId} value[${index}]`));
        if (track.interpolation === 'cubic-spline') {
          assert.equal(keyframe.inTangent?.length, track.binding.valueSize, `Keyframe ${keyframeId} in tangent width mismatch`);
          assert.equal(keyframe.outTangent?.length, track.binding.valueSize, `Keyframe ${keyframeId} out tangent width mismatch`);
        } else {
          assert.equal(keyframe.inTangent, undefined, `Non-cubic keyframe ${keyframeId} cannot store in tangent`);
          assert.equal(keyframe.outTangent, undefined, `Non-cubic keyframe ${keyframeId} cannot store out tangent`);
        }
      }
      if (track.binding.path === 'transform.rotation') {
        for (const keyframe of track.keyframes) {
          const length = Math.hypot(...keyframe.value);
          assert.ok(Math.abs(length - 1) <= 1e-5, `Quaternion ${keyframe.id} must be normalized`);
        }
      }
    }
    const events = uniqueMap(clip.events, `clip ${clipId} events`, 'event');
    for (const event of events.values()) assert.ok(event.time <= clip.duration, `Event ${event.id} exceeds clip`);
  }

  if (value.stateMachine !== null && value.stateMachine !== undefined) {
    assert.equal(value.stateMachine.format, contract.runtime.stateMachineFormat);
    for (const layer of value.stateMachine.layers) {
      const states = uniqueMap(layer.states, `3D layer ${layer.id} states`, 'state');
      assert.ok(states.has(layer.initialStateId), `Unknown 3D initial state ${layer.initialStateId}`);
      for (const state of states.values()) verifyMotion3d(state.motion, clips, `3D state ${state.id}`);
      for (const bindingId of [...(layer.mask?.include ?? []), ...(layer.mask?.exclude ?? [])]) {
        assert.ok(bindingIds.has(bindingId), `Unknown Animation3D mask binding ${bindingId}`);
      }
    }
  }
}

function verifyTransform3d(transform, path) {
  assert.equal(transform.translation.length, 3, `${path} translation must be vec3`);
  assert.equal(transform.rotation.length, 4, `${path} rotation must be quaternion`);
  assert.equal(transform.scale.length, 3, `${path} scale must be vec3`);
  for (const [key, values] of Object.entries(transform)) values.forEach((entry, index) => finite(entry, `${path}.${key}[${index}]`));
  const rotationLength = Math.hypot(...transform.rotation);
  assert.ok(Math.abs(rotationLength - 1) <= 1e-5, `${path} quaternion must be normalized`);
}

function verifyBinding3d(binding, nodes, contract, path) {
  if (binding.target.kind === 'node-id') assert.ok(nodes.has(binding.target.nodeId), `${path} targets unknown node ${binding.target.nodeId}`);
  if (binding.target.kind === 'node-path') assert.ok(binding.target.segments.length > 0, `${path} node path must not be empty`);
  if (binding.target.kind === 'slot') nonEmpty(binding.target.slot, `${path} slot`);
  const fixedWidths = {
    'transform.translation': ['vec3', 3],
    'transform.rotation': ['quaternion', 4],
    'transform.scale': ['vec3', 3],
  };
  if (fixedWidths[binding.path]) {
    assert.deepEqual([binding.valueType, binding.valueSize], fixedWidths[binding.path], `${path} transform binding width mismatch`);
    return;
  }
  if (binding.path === 'morph.weights') {
    assert.equal(binding.valueType, 'weights', `${path} Morph binding must use weights`);
    assert.ok(Number.isSafeInteger(binding.valueSize) && binding.valueSize > 0, `${path} Morph width must be positive`);
    return;
  }
  assert.equal(binding.path, 'property', `${path} has unsupported binding path ${binding.path}`);
  const table = binding.component === contract.bindings.materialComponent
    ? contract.bindings.materialProperties
    : binding.component === contract.bindings.cameraComponent
      ? contract.bindings.cameraProperties
      : undefined;
  const definition = table?.[binding.property];
  assert.ok(definition, `${path} has unsupported ${binding.component}.${binding.property}`);
  assert.equal(binding.valueType, definition.valueType, `${path} property value type mismatch`);
  assert.equal(binding.valueSize, definition.valueSize, `${path} property value width mismatch`);
}

function verifyMotion3d(motion, clips, path) {
  if (motion.kind === 'clip') {
    assert.ok(clips.has(motion.clipId), `Unknown 3D clip ${motion.clipId} in ${path}`);
    return;
  }
  for (const child of motion.children) verifyMotion3d(child.motion, clips, path);
}

function lowerProject3dFixture(projectValue, contract) {
  return {
    format: contract.extension.carrierFormat,
    version: contract.extension.carrierVersion,
    name: projectValue.name,
    canvas: {
      width: projectValue.composition.viewport.width,
      height: projectValue.composition.viewport.height,
      coordinateSystem: 'screen-y-down',
    },
    duration: projectValue.composition.duration,
    frameRate: projectValue.composition.frameRate,
    endBehavior: projectValue.composition.endBehavior,
    resources: projectValue.assets.map(asset => ({
      id: asset.id,
      type: asset.type === 'model' ? contract.resources.modelCoreType : asset.type,
      uri: asset.delivery.uri,
      mimeType: asset.delivery.mimeType,
      ...(asset.delivery.integrity === undefined ? {} : { integrity: asset.delivery.integrity }),
      ...(asset.type === 'image' ? { colorSpace: 'srgb' } : {}),
    })),
    nodes: [],
    tracks: [],
    extensionsUsed: [contract.extension.id],
    extensionsRequired: [contract.extension.id],
    extensions: {
      [contract.extension.id]: {
        format: contract.extension.payloadFormat,
        mode: 'native-3d',
        coordinateSystem: projectValue.composition.coordinateSystem,
        viewport: projectValue.composition.viewport,
        materials: projectValue.materials,
        nodes: projectValue.nodes,
        clips: projectValue.timeline.clips.map(clip => ({
          format: contract.runtime.clipFormat,
          id: clip.id,
          name: clip.name,
          duration: clip.duration,
          tracks: clip.tracks.map(track => ({
            id: track.id,
            binding: track.binding,
            interpolation: track.interpolation,
            times: track.keyframes.map(keyframe => keyframe.time),
            values: track.keyframes.flatMap(keyframe => track.interpolation === 'cubic-spline'
              ? [...keyframe.inTangent, ...keyframe.value, ...keyframe.outTangent]
              : keyframe.value),
          })),
          events: clip.events,
        })),
        stateMachine: projectValue.stateMachine ?? null,
      },
    },
  };
}

function failContract(code, path, message) {
  const error = new Error(`${message} (${path})`);
  error.code = code;
  error.path = path;
  throw error;
}

function isDeliveryUri3d(value) {
  if (/^(?:https:\/\/|data:)/.test(value)) return true;
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    && !value.startsWith('/')
    && !value.split('/').includes('..');
}

function verifyTrackTarget(track, nodes) {
  const target = track.target;
  const node = nodes.get(target.nodeId);
  assert.ok(node, `Unknown track node ${target.nodeId}`);
  if (target.kind === 'component-property') {
    const component = node.components.find(item => item.id === target.componentId);
    assert.ok(component, `Unknown component ${target.componentId} on track ${track.id}`);
    if (target.partId !== undefined) {
      assert.ok(component.parts?.some(item => item.id === target.partId), `Unknown component part ${target.partId} on track ${track.id}`);
    }
    if (target.property.startsWith('vector.modifier.') || target.property.startsWith('text.')) {
      nonEmpty(target.partId, `Track ${track.id} target.partId`);
    }
  } else if (target.kind === 'effect-property') {
    const effect = node.effects.find(item => item.id === target.effectId);
    assert.ok(effect, `Unknown effect ${target.effectId} on track ${track.id}`);
    assert.equal(target.property.split('.')[0], effect.effect.kind === 'opacity' ? 'opacity' : effect.effect.kind,
      `Effect property ${target.property} does not match ${effect.effect.kind} on track ${track.id}`);
  } else if (target.kind === 'composite-property') {
    assert.ok(node.compositeLayers.some(item => item.id === target.compositeLayerId), `Unknown composite layer ${target.compositeLayerId} on track ${track.id}`);
  }
}

function verifyParentCycles(nodes) {
  for (const id of nodes.keys()) {
    const visited = new Set([id]);
    let parent = nodes.get(id).parent;
    while (parent !== undefined) {
      assert.ok(!visited.has(parent), `Node parent cycle includes ${parent}`);
      visited.add(parent);
      parent = nodes.get(parent)?.parent;
    }
  }
}

function verifyCompositeCycles(nodes) {
  const visitNode = (nodeId, active, complete) => {
    if (complete.has(nodeId)) return;
    assert.ok(!active.has(nodeId), `Composite cycle includes ${nodeId}`);
    active.add(nodeId);
    for (const layer of nodes.get(nodeId).compositeLayers) visitNode(layer.sourceNodeId, active, complete);
    active.delete(nodeId);
    complete.add(nodeId);
  };
  const complete = new Set();
  for (const nodeId of nodes.keys()) visitNode(nodeId, new Set(), complete);
}

function verifyStateMachine(machine, clips, nodes) {
  assert.equal(machine.format, 'haiyue-animation-state-machine@1');
  const parameters = uniqueMap(machine.parameters.map(parameter => ({ ...parameter, id: parameter.name })), 'state-machine parameters', 'parameter');
  const layers = uniqueMap(machine.layers, 'state-machine layers', 'layer');
  for (const [layerId, layer] of layers) {
    const states = uniqueMap(layer.states, `layer ${layerId} states`, 'state');
    assert.ok(states.has(layer.initialStateId), `Unknown initial state ${layer.initialStateId} in layer ${layerId}`);
    for (const state of states.values()) {
      verifyMotion(state.motion, clips, parameters, `state ${state.id}`);
      if (state.speedParameter !== undefined) requireNumericParameter(parameters, state.speedParameter, `state ${state.id} speedParameter`);
    }
    uniqueMap(layer.transitions, `layer ${layerId} transitions`, 'transition');
    for (const transition of layer.transitions) {
      assert.ok(transition.from === '*' || states.has(transition.from), `Unknown transition source ${transition.from}`);
      assert.ok(states.has(transition.to), `Unknown transition destination ${transition.to}`);
      for (const condition of transition.conditions) verifyCondition(condition, parameters);
    }
    for (const nodeId of [...(layer.mask?.include ?? []), ...(layer.mask?.exclude ?? [])]) {
      assert.ok(nodes.has(nodeId), `Unknown binding-mask node ${nodeId}`);
    }
  }
}

function verifyMotion(motion, clips, parameters, path) {
  if (motion.kind === 'clip') {
    assert.ok(clips.has(motion.clipId), `Unknown clip ${motion.clipId} in ${path}`);
    return;
  }
  if (motion.kind === 'blend-1d') {
    requireNumericParameter(parameters, motion.parameter, `${path} blend parameter`);
    let threshold = -Infinity;
    for (const child of motion.children) {
      assert.ok(child.threshold > threshold, `${path} blend-1d thresholds must increase`);
      threshold = child.threshold;
      verifyMotion(child.motion, clips, parameters, path);
    }
    return;
  }
  requireNumericParameter(parameters, motion.parameterX, `${path} blend parameterX`);
  requireNumericParameter(parameters, motion.parameterY, `${path} blend parameterY`);
  for (const child of motion.children) verifyMotion(child.motion, clips, parameters, path);
}

function verifyCondition(condition, parameters) {
  const parameter = parameters.get(condition.parameter);
  assert.ok(parameter, `Unknown condition parameter ${condition.parameter}`);
  const numeric = parameter.type === 'float' || parameter.type === 'integer';
  const boolean = parameter.type === 'boolean';
  const trigger = parameter.type === 'trigger';
  const numericOperator = ['greater', 'greater-or-equal', 'less', 'less-or-equal', 'equal', 'not-equal'].includes(condition.operator);
  const booleanOperator = ['is-true', 'is-false'].includes(condition.operator);
  assert.ok((numeric && numericOperator) || (boolean && booleanOperator) || (trigger && condition.operator === 'triggered'),
    `Operator ${condition.operator} is incompatible with ${parameter.type} parameter ${parameter.id}`);
}

function requireNumericParameter(parameters, name, path) {
  const parameter = parameters.get(name);
  assert.ok(parameter && (parameter.type === 'float' || parameter.type === 'integer'), `${path} must reference a numeric parameter`);
}

function rejectInlineTracks(value, path) {
  visit(value, (entry, entryPath) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    for (const key of Object.keys(entry)) {
      assert.ok(!key.endsWith('Track'), `${path} contains inline track at ${entryPath}.${key}`);
    }
  });
}

function uniqueMap(values, path, label) {
  assert.ok(Array.isArray(values), `${path} must be an array`);
  const result = new Map();
  for (const value of values) {
    nonEmpty(value?.id, `${path} ${label} id`);
    assert.ok(!result.has(value.id), `Duplicate ${label} id ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

function visit(value, callback, path = '$') {
  callback(value, path);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, callback, `${path}[${index}]`));
  else for (const [key, entry] of Object.entries(value)) visit(entry, callback, `${path}.${key}`);
}

function nonEmpty(value, path) {
  assert.ok(typeof value === 'string' && value.length > 0, `${path} must be a non-empty string`);
}

function finite(value, path) {
  assert.ok(Number.isFinite(value), `${path} must be finite`);
}

function positive(value, path) {
  finite(value, path);
  assert.ok(value > 0, `${path} must be positive`);
}

function nonNegative(value, path) {
  finite(value, path);
  assert.ok(value >= 0, `${path} must be non-negative`);
}
