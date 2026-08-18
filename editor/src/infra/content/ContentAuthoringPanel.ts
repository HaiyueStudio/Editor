import {
  createBlendTreeMotion,
  sampleAnimationTimeline,
  validateAnimationAuthoringDocument,
  type AnimationAuthoringDimension,
  type AnimationAuthoringDocument,
  type AnimationStateMachineMotionDefinition,
} from '../../domain/content/AnimationAuthoring';
import {
  ContentAuthoringStore,
  type HyaAnimationAsset,
  type MaterialGraphAuthoringAsset,
} from '../../domain/content/ContentAuthoringStore';
import { prepareHyaAnimationAsset } from './HyaAnimationImport';
import type {
  MaterialGraphAuthoringDescription,
  MaterialGraphDocumentV1,
  MaterialGraphNodeDescriptorV1,
} from '../../domain/content/MaterialGraphAuthoring';
import { createBrowserMaterialGraphCompilerClient } from './MaterialGraphCompilerClient';

export interface ContentAuthoringPanelOptions {
  readonly animationHost: HTMLElement;
  readonly materialGraphHost: HTMLElement;
  readonly store: ContentAuthoringStore;
  readonly reportError: (message: string, error?: unknown) => void;
}

export interface ContentAuthoringPanel {
  render(): void;
  dispose(): void;
}

type DeepMutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;

/** Lazy editor contribution; the Shader Language compiler never enters the shell chunk. */
export function createContentAuthoringPanel(options: ContentAuthoringPanelOptions): ContentAuthoringPanel {
  let activeAnimationId = options.store.animations[0]?.id ?? null;
  let activeMaterialId = options.store.materialGraphs[0]?.id ?? null;
  let materialDescription: MaterialGraphAuthoringDescription | null = null;
  let materialDescriptionError: string | null = null;
  let hyaImportFeedback: { state: 'idle' | 'ok' | 'error'; text: string } | null = null;
  let hyaImportAbort: AbortController | null = null;
  let compileGeneration = 0;
  let compileAbort: AbortController | null = null;
  const materialCompileFeedback = new Map<string, {
    readonly state: 'idle' | 'ok' | 'error';
    readonly text: string;
  }>();
  const materialCompiler = createBrowserMaterialGraphCompilerClient();
  const unsubscribe = options.store.subscribe(render);
  if (materialCompiler) void materialCompiler.describe().then(description => {
    materialDescription = description;
    renderMaterialGraphPanel();
  }, error => {
    materialDescriptionError = error instanceof Error ? error.message : String(error);
    renderMaterialGraphPanel();
  });

  function render(): void {
    renderAnimationPanel();
    renderMaterialGraphPanel();
  }

  function renderAnimationPanel(): void {
    const host = options.animationHost;
    host.replaceChildren();
    const animations = options.store.animations;
    if (!activeAnimationId || !animations.some(item => item.id === activeAnimationId)) activeAnimationId = animations[0]?.id ?? null;
    const toolbar = element('div', 'content-authoring-toolbar');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Animation authoring document');
    for (const animation of animations) select.append(new Option(animation.name, animation.id, false, animation.id === activeAnimationId));
    select.addEventListener('change', () => { activeAnimationId = select.value; render(); });
    const create = button('New controller', () => {
      activeAnimationId = options.store.createAnimation().id;
    });
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.hya,application/vnd.haiyue.animation';
    importInput.multiple = true;
    importInput.hidden = true;
    importInput.addEventListener('change', () => {
      const files = [...(importInput.files ?? [])];
      importInput.value = '';
      if (files.length > 0) void importHyaFiles(files);
    });
    toolbar.append(select, create, button('Import HYA', () => importInput.click()), importInput);
    host.append(toolbar);
    const current = animations.find(item => item.id === activeAnimationId);
    host.append(renderHyaLibrary(current ?? null));
    if (hyaImportFeedback) host.append(status(hyaImportFeedback.text, hyaImportFeedback.state));
    if (!current) {
      host.append(status('Import a HYA file or create one dimension-neutral controller. Imported HYA assets retain their original bytes in the editor scene.', 'idle'));
      return;
    }

    host.append(summary([
      `${current.dimension.toUpperCase()} · ${current.sources.length} sources · ${current.timeline.clips.length} timeline clips`,
      `${current.stateMachine.layers.length} layers · ${countStates(current)} states · ${countBlendTrees(current)} Blend Trees`,
    ].join('\n')));

    const sourceActions = element('div', 'content-authoring-actions');
    sourceActions.append(
      button('Add imported HYA source', () => addFirstAvailableHyaSource(current)),
      button('Add Animation3D source', () => addSource(current, '3d')),
      button('Add float parameter', () => addParameter(current)),
      button('Add state', () => addState(current)),
      button('Add transition', () => addTransition(current)),
      button('Make 1D Blend Tree', () => replaceLastMotion(current, 'blend-1d')),
      button('Make 2D Blend Tree', () => replaceLastMotion(current, 'blend-2d')),
    );
    host.append(sourceActions);

    const time = document.createElement('input');
    time.type = 'range';
    time.min = '0';
    time.max = String(current.timeline.duration);
    time.step = String(1 / current.timeline.frameRate);
    time.value = '0';
    const sampleStatus = status('', 'idle');
    const updateSample = (): void => {
      const sample = sampleAnimationTimeline(current, Number(time.value));
      sampleStatus.textContent = `t=${sample.time.toFixed(3)}s · active: ${sample.activeClips.map(clip => `${clip.sourceId}@${clip.localTime.toFixed(3)}s`).join(', ') || 'none'}`;
    };
    time.addEventListener('input', updateSample);
    host.append(time, renderTimeline(current), sampleStatus);
    updateSample();

    const editor = document.createElement('textarea');
    editor.spellcheck = false;
    editor.value = JSON.stringify(current, null, 2);
    editor.setAttribute('aria-label', 'Animation timeline and state-machine source');
    const validation = status('', 'idle');
    const documentActions = element('div', 'content-authoring-actions');
    documentActions.append(
      button('Validate', () => validateAnimationSource(editor, validation, false)),
      button('Apply', () => validateAnimationSource(editor, validation, true)),
    );
    host.append(editor, documentActions, validation);
  }

  async function importHyaFiles(files: readonly File[]): Promise<void> {
    hyaImportAbort?.abort();
    const controller = new AbortController();
    hyaImportAbort = controller;
    hyaImportFeedback = { state: 'idle', text: `Reading and validating ${files.length} HYA file${files.length === 1 ? '' : 's'}…` };
    renderAnimationPanel();
    try {
      // Prepare the entire batch first so one invalid file cannot leave a partial import behind.
      const prepared = await Promise.all(files.map(file => prepareHyaAnimationAsset(file, controller.signal)));
      controller.signal.throwIfAborted();
      let target = options.store.animations.find(animation => animation.id === activeAnimationId) ?? null;
      if (!target) {
        target = options.store.createAnimation();
        activeAnimationId = target.id;
      }
      for (const asset of prepared) options.store.setHyaAnimation(asset);
      for (const asset of prepared) {
        const latest = options.store.animations.find(animation => animation.id === activeAnimationId);
        if (latest) addHyaSource(latest, asset);
      }
      hyaImportFeedback = {
        state: 'ok',
        text: `Imported ${prepared.map(asset => asset.name).join(', ')}. The source bytes and parsed metadata will round-trip with the editor scene.`,
      };
    } catch (error) {
      if (controller.signal.aborted) return;
      hyaImportFeedback = { state: 'error', text: error instanceof Error ? error.message : String(error) };
      options.reportError('Failed to import HYA animation.', error);
    } finally {
      if (hyaImportAbort === controller) hyaImportAbort = null;
      renderAnimationPanel();
    }
  }

  function addFirstAvailableHyaSource(current: AnimationAuthoringDocument): void {
    const asset = options.store.hyaAnimations.find(candidate => !current.sources.some(source => source.assetId === candidate.id));
    if (!asset) {
      options.reportError(options.store.hyaAnimations.length === 0
        ? 'Import a HYA asset before adding it to a controller.'
        : 'Every imported HYA asset is already referenced by this controller.');
      return;
    }
    addHyaSource(current, asset);
  }

  function addHyaSource(current: AnimationAuthoringDocument, asset: HyaAnimationAsset): void {
    if (current.sources.some(source => source.assetId === asset.id)) return;
    const next = structuredClone(current) as DeepMutable<AnimationAuthoringDocument>;
    const sourceId = uniqueId(`hya-${asset.id.replace(/^hya-/, '')}`, next.sources.map(source => source.id));
    next.sources.push({
      id: sourceId,
      assetId: asset.id,
      name: asset.name,
      dimension: '2d',
      duration: asset.metadata.duration,
    });
    next.timeline.clips.push({
      id: uniqueId(`timeline-${sourceId}`, next.timeline.clips.map(clip => clip.id)),
      sourceId,
      start: 0,
      duration: asset.metadata.duration,
      sourceOffset: 0,
      speed: 1,
      lane: next.timeline.clips.reduce((maximum, clip) => Math.max(maximum, clip.lane), -1) + 1,
    });
    next.timeline.duration = Math.max(next.timeline.duration, asset.metadata.duration);
    options.store.setAnimation(next as unknown as AnimationAuthoringDocument);
  }

  function renderHyaLibrary(current: AnimationAuthoringDocument | null): HTMLElement {
    const section = element('div', 'content-authoring-section');
    const assets = options.store.hyaAnimations;
    section.append(summary(`HYA assets · ${assets.length}`));
    if (assets.length === 0) {
      section.append(status('No HYA resources imported. Accepted input: binary or JSON .hya.', 'idle'));
      return section;
    }
    for (const asset of assets) {
      const row = element('div', 'content-authoring-toolbar');
      const metadata = asset.metadata;
      const label = element('span', 'content-authoring-summary');
      label.textContent = `${asset.name} · ${metadata.canvas.width}×${metadata.canvas.height} · ${metadata.duration.toFixed(3)}s · ${metadata.nodeCount} nodes · ${metadata.trackCount} tracks · ${formatBytes(asset.byteLength)}${metadata.hasStateMachine ? ' · state machine' : ''}`;
      label.title = `${asset.fileName}\n${metadata.source.toUpperCase()} · ${metadata.resourceCount} resources\n${metadata.extensionsUsed.join(', ') || 'No extensions'}`;
      const referenced = current?.sources.some(source => source.assetId === asset.id) === true;
      const add = button(referenced ? 'Added' : 'Add to controller', () => {
        const target = options.store.animations.find(animation => animation.id === activeAnimationId);
        if (target) addHyaSource(target, asset);
      });
      add.disabled = referenced || current === null;
      row.append(label, add);
      section.append(row);
    }
    return section;
  }

  function addSource(current: AnimationAuthoringDocument, dimension: AnimationAuthoringDimension): void {
    const next = structuredClone(current) as DeepMutable<AnimationAuthoringDocument>;
    const index = next.sources.length + 1;
    const id = `${dimension}-clip-${index}`;
    next.sources.push({ id, name: `${dimension.toUpperCase()} Clip ${index}`, dimension, duration: 1 });
    next.timeline.clips.push({ id: `timeline-${id}`, sourceId: id, start: 0, duration: 1, sourceOffset: 0, speed: 1, lane: index - 1 });
    next.timeline.duration = Math.max(next.timeline.duration, 1);
    options.store.setAnimation(next as unknown as AnimationAuthoringDocument);
  }

  function addParameter(current: AnimationAuthoringDocument): void {
    const next = structuredClone(current) as DeepMutable<AnimationAuthoringDocument>;
    let index = next.stateMachine.parameters.length + 1;
    let name = `blend${index}`;
    while (next.stateMachine.parameters.some(parameter => parameter.name === name)) name = `blend${++index}`;
    next.stateMachine.parameters.push({ name, type: 'float', defaultValue: 0 });
    options.store.setAnimation(next as unknown as AnimationAuthoringDocument);
  }

  function addState(current: AnimationAuthoringDocument): void {
    if (current.sources.length === 0) {
      options.reportError('Add an Animation2D or Animation3D source before creating a state.');
      return;
    }
    const next = structuredClone(current) as DeepMutable<AnimationAuthoringDocument>;
    if (next.stateMachine.layers.length === 0) next.stateMachine.layers.push({ id: 'base', name: 'Base Layer', initialStateId: 'state-1', states: [], transitions: [] });
    const layer = next.stateMachine.layers[0]!;
    const index = layer.states.length + 1;
    const state = { id: `state-${index}`, name: `State ${index}`, motion: { kind: 'clip' as const, clipId: next.sources[(index - 1) % next.sources.length]!.id }, loop: 'repeat' as const };
    layer.states.push(state);
    if (layer.states.length === 1) layer.initialStateId = state.id;
    options.store.setAnimation(next as unknown as AnimationAuthoringDocument);
  }

  function replaceLastMotion(current: AnimationAuthoringDocument, kind: 'blend-1d' | 'blend-2d'): void {
    try {
      const next = structuredClone(current) as DeepMutable<AnimationAuthoringDocument>;
      const layer = next.stateMachine.layers[0];
      const state = layer?.states.at(-1);
      if (!state) throw new RangeError('Create a state before assigning a Blend Tree.');
      state.motion = createBlendTreeMotion(kind, next.stateMachine.parameters, next.sources.map(source => source.id)) as DeepMutable<AnimationStateMachineMotionDefinition>;
      options.store.setAnimation(next as unknown as AnimationAuthoringDocument);
    } catch (error) {
      options.reportError(`Cannot create ${kind} motion.`, error);
    }
  }

  function addTransition(current: AnimationAuthoringDocument): void {
    const next = structuredClone(current) as DeepMutable<AnimationAuthoringDocument>;
    const layer = next.stateMachine.layers[0];
    if (!layer || layer.states.length < 2) {
      options.reportError('Create at least two states before adding a transition.');
      return;
    }
    const destination = layer.states.at(-1)!;
    const source = layer.states.at(-2)!;
    layer.transitions.push({
      id: `transition-${layer.transitions.length + 1}`,
      from: source.id,
      to: destination.id,
      duration: 0.2,
      conditions: [],
    });
    options.store.setAnimation(next as unknown as AnimationAuthoringDocument);
  }

  function validateAnimationSource(editor: HTMLTextAreaElement, output: HTMLElement, apply: boolean): void {
    try {
      const document = JSON.parse(editor.value) as AnimationAuthoringDocument;
      const issues = validateAnimationAuthoringDocument(document);
      if (issues.length > 0) {
        output.dataset.state = 'error';
        output.textContent = issues.map(issue => `${issue.code} · ${issue.path}: ${issue.message}`).join('\n');
        return;
      }
      if (apply) options.store.setAnimation(document);
      output.dataset.state = 'ok';
      output.textContent = apply ? 'Animation authoring document applied.' : 'Timeline, state machine and Blend Trees are valid.';
    } catch (error) {
      output.dataset.state = 'error';
      output.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function renderMaterialGraphPanel(): void {
    const host = options.materialGraphHost;
    host.replaceChildren();
    const graphs = options.store.materialGraphs;
    if (!activeMaterialId || !graphs.some(item => item.id === activeMaterialId)) activeMaterialId = graphs[0]?.id ?? null;
    const toolbar = element('div', 'content-authoring-toolbar');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Material Graph document');
    for (const graph of graphs) select.append(new Option(graph.name, graph.id, false, graph.id === activeMaterialId));
    select.addEventListener('change', () => { activeMaterialId = select.value; render(); });
    toolbar.append(select, button('New PBR graph', () => {
      const asset = createDefaultMaterialGraph(graphs.length + 1);
      activeMaterialId = asset.id;
      options.store.setMaterialGraph(asset);
    }));
    host.append(toolbar);
    const current = graphs.find(item => item.id === activeMaterialId);
    if (!current) {
      host.append(status('Material Graph authors PBR composition through Shader Language. Typed IR is not exposed here.', 'idle'));
      return;
    }
    host.append(summary('High-level surface graph · PBR lowering · renderer adapter required for live material binding'));
    if (!materialCompiler) {
      host.append(status('Material Graph compiler Worker is unavailable. Compilation will not fall back to the main thread.', 'error'));
    } else if (materialDescriptionError) {
      host.append(status(`Material Graph compiler unavailable: ${materialDescriptionError}`, 'error'));
    } else if (!materialDescription) {
      host.append(status('Loading Material Graph node catalog in the compiler Worker…', 'idle'));
    }
    const catalog = materialDescription?.catalog ?? [];
    const palette = element('div', 'content-authoring-actions');
    for (const descriptor of catalog) {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = `+ ${descriptor.label}`;
      item.title = descriptor.ports.map(port => `${port.direction}: ${port.id}`).join('\n');
      item.addEventListener('click', () => addMaterialNode(current, descriptor.id));
      palette.append(item);
    }
    host.append(palette, renderMaterialNodes(current.graph), renderMaterialConnectionEditor(current, catalog));
    const editor = document.createElement('textarea');
    editor.spellcheck = false;
    editor.value = JSON.stringify(current.graph, null, 2);
    editor.setAttribute('aria-label', 'Material Graph source');
    const previousFeedback = materialCompileFeedback.get(current.id);
    const compileStatus = status(previousFeedback?.text ?? '', previousFeedback?.state ?? 'idle');
    const actions = element('div', 'content-authoring-actions');
    actions.append(button('Compile artifact', async () => {
      try {
        if (!materialCompiler) throw new Error('Material Graph compiler Worker is unavailable.');
        const graph = JSON.parse(editor.value) as MaterialGraphDocumentV1;
        compileAbort?.abort();
        compileAbort = new AbortController();
        const generation = ++compileGeneration;
        compileStatus.dataset.state = 'idle';
        compileStatus.textContent = 'Compiling in Shader Language Worker…';
        materialCompileFeedback.set(current.id, { state: 'idle', text: compileStatus.textContent });
        const result = await materialCompiler.compile(graph, compileAbort.signal);
        if (generation !== compileGeneration) return;
        if (!result.ok) {
          const text = result.diagnostics.map(item => `${item.code}${item.path ? ` · ${item.path}` : ''}: ${item.message}`).join('\n');
          materialCompileFeedback.set(current.id, { state: 'error', text });
          compileStatus.dataset.state = 'error';
          compileStatus.textContent = text;
          return;
        }
        const text = [
          `Compiled ${result.artifact.canonicalHash.slice(0, 12)} · ${result.artifact.source.bytes} source bytes`,
          `${result.artifact.cost.nodeCount} nodes · ${result.artifact.cost.resourceCount} resources · variants ${result.artifact.cost.reachableVariants}/${result.artifact.cost.maximumVariants}`,
          'Runtime status: renderer adapter required (source artifact is valid).',
        ].join('\n');
        materialCompileFeedback.set(current.id, { state: 'ok', text });
        options.store.setMaterialGraph({ ...current, graph });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        materialCompileFeedback.set(current.id, { state: 'error', text });
        compileStatus.dataset.state = 'error';
        compileStatus.textContent = text;
      }
    }));
    host.append(editor, actions, compileStatus);
  }

  function addMaterialNode(current: MaterialGraphAuthoringAsset, nodeType: string): void {
    const graph = structuredClone(current.graph) as DeepMutable<MaterialGraphDocumentV1>;
    const id = `node${graph.nodes.length + 1}`;
    const node = defaultMaterialNode(id, nodeType);
    graph.nodes.push(node as DeepMutable<MaterialGraphDocumentV1['nodes'][number]>);
    materialCompileFeedback.delete(current.id);
    options.store.setMaterialGraph({ ...current, graph });
  }

  function renderMaterialConnectionEditor(
    current: MaterialGraphAuthoringAsset,
    catalog: readonly MaterialGraphNodeDescriptorV1[],
  ): HTMLElement {
    const row = element('div', 'content-authoring-toolbar');
    const output = document.createElement('select');
    output.setAttribute('aria-label', 'Material Graph node output');
    for (const node of current.graph.nodes) {
      const descriptor = catalog.find(item => item.id === node.type);
      for (const port of descriptor?.ports.filter(item => item.direction === 'output') ?? []) {
        output.append(new Option(`${node.id}.${port.id}`, `${node.id}:${port.id}`));
      }
    }
    const slot = document.createElement('select');
    slot.setAttribute('aria-label', 'PBR surface slot');
    for (const name of materialDescription?.surfaceSlots ?? []) slot.append(new Option(name, name));
    row.append(output, slot, button('Connect output', () => {
      const separator = output.value.indexOf(':');
      if (separator < 1) {
        options.reportError('Add a Material Graph node with an output port first.');
        return;
      }
      const graph = structuredClone(current.graph) as DeepMutable<MaterialGraphDocumentV1>;
      graph.outputs[slot.value] = { node: output.value.slice(0, separator), output: output.value.slice(separator + 1) };
      materialCompileFeedback.delete(current.id);
      options.store.setMaterialGraph({ ...current, graph });
    }));
    return row;
  }

  render();
  return Object.freeze({
    render,
    dispose(): void {
      hyaImportAbort?.abort();
      compileAbort?.abort();
      compileGeneration++;
      materialCompiler?.dispose();
      unsubscribe();
    },
  });
}

function uniqueId(base: string, ids: readonly string[]): string {
  if (!ids.includes(base)) return base;
  let index = 2;
  while (ids.includes(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function createDefaultMaterialGraph(index: number): MaterialGraphAuthoringAsset {
  const id = `material-graph-${index}`;
  const graph: MaterialGraphDocumentV1 = {
    format: 'haiyue-shader-graph',
    version: 1,
    kind: 'material',
    profile: 'webgpu-portable',
    resources: [],
    nodes: [],
    outputs: {
      baseColor: { literal: { type: 'color3<f32>', value: [0.22, 0.55, 1], colorSpace: 'linear' } },
      metallic: { literal: { type: 'f32', value: 0.1 } },
      roughness: { literal: { type: 'f32', value: 0.55 } },
    },
    sceneFeatures: [],
    metadata: { label: `Material Graph ${index}` },
  };
  return Object.freeze({
    id,
    name: `Material Graph ${index}`,
    graph,
  });
}

function defaultMaterialNode(id: string, type: string): Record<string, unknown> {
  if (type === 'haiyue.color.multiply') return { id, type, typeVersion: 1, inputs: {
    left: { literal: { type: 'color3<f32>', value: [1, 1, 1], colorSpace: 'linear' } },
    right: { literal: { type: 'color3<f32>', value: [1, 1, 1], colorSpace: 'linear' } },
  }, metadata: { position: [40, 40] } };
  if (type === 'haiyue.color.world-height-gradient') return { id, type, typeVersion: 1, inputs: {
    position: { semantic: 'geometry.position.world' },
    lowColor: { literal: { type: 'color3<f32>', value: [0.1, 0.2, 0.7], colorSpace: 'linear' } },
    highColor: { literal: { type: 'color3<f32>', value: [1, 0.7, 0.2], colorSpace: 'linear' } },
    range: { literal: { type: 'vec2<f32>', value: [-1, 1] } },
  }, metadata: { position: [40, 40] } };
  if (type === 'haiyue.uv.noise-distort') return { id, type, typeVersion: 1, inputs: {
    position: { semantic: 'geometry.position.world' }, uv: { semantic: 'geometry.uv0' },
    scale: { literal: { type: 'f32', value: 1 } }, strength: { literal: { type: 'f32', value: 0.02 } },
  }, metadata: { position: [40, 40] } };
  if (type === 'haiyue.normal.decode-tangent') return { id, type, typeVersion: 1, inputs: {
    sample: { literal: { type: 'vec4<f32>', value: [0.5, 0.5, 1, 1] } },
    scale: { literal: { type: 'vec2<f32>', value: [1, 1] } },
  }, metadata: { position: [40, 40] } };
  return { id, type, typeVersion: 1, inputs: {
    texture: { resource: 'material.texture' }, sampler: { resource: 'material.sampler' }, uv: { semantic: 'geometry.uv0' },
  }, metadata: { position: [40, 40], requiresResources: ['material.texture', 'material.sampler'] } };
}

function renderTimeline(documentValue: AnimationAuthoringDocument): HTMLElement {
  const lanes = element('div', 'timeline-lanes');
  lanes.style.gridTemplateRows = `repeat(${Math.max(1, ...documentValue.timeline.clips.map(clip => clip.lane + 1))}, 22px)`;
  for (const clip of documentValue.timeline.clips) {
    const source = documentValue.sources.find(item => item.id === clip.sourceId);
    const item = element('div', 'timeline-clip');
    item.style.gridRow = String(clip.lane + 1);
    item.style.marginLeft = `${clip.start / documentValue.timeline.duration * 100}%`;
    item.style.width = `${Math.min(100 - clip.start / documentValue.timeline.duration * 100, clip.duration / documentValue.timeline.duration * 100)}%`;
    item.textContent = `${source?.dimension.toUpperCase() ?? '?'} · ${source?.name ?? clip.sourceId}`;
    lanes.append(item);
  }
  return lanes;
}

function renderMaterialNodes(graph: MaterialGraphDocumentV1): HTMLElement {
  const list = element('div', 'material-node-list');
  for (const node of graph.nodes) {
    const card = element('div', 'material-node-card');
    const title = document.createElement('strong');
    title.textContent = node.id;
    const type = document.createElement('small');
    type.textContent = `${node.type}@${node.typeVersion}`;
    const ports = document.createElement('small');
    ports.textContent = `inputs: ${Object.keys(node.inputs).join(', ') || 'none'}`;
    card.append(title, type, ports);
    list.append(card);
  }
  if (graph.nodes.length === 0) list.append(status('No nodes. Surface outputs currently use literals.', 'idle'));
  return list;
}

function countStates(document: AnimationAuthoringDocument): number {
  return document.stateMachine.layers.reduce((total, layer) => total + layer.states.length, 0);
}

function countBlendTrees(document: AnimationAuthoringDocument): number {
  let total = 0;
  const visit = (motion: AnimationStateMachineMotionDefinition): void => {
    if (motion.kind === 'clip') return;
    total++;
    for (const child of motion.children) visit(child.motion);
  };
  for (const layer of document.stateMachine.layers) for (const state of layer.states) visit(state.motion);
  return total;
}

function element(tag: string, className: string): HTMLElement {
  const value = document.createElement(tag);
  value.className = className;
  return value;
}

function button(label: string, action: () => void | Promise<void>): HTMLButtonElement {
  const value = document.createElement('button');
  value.type = 'button';
  value.textContent = label;
  value.addEventListener('click', action);
  return value;
}

function summary(text: string): HTMLElement {
  const value = element('div', 'content-authoring-summary');
  value.textContent = text;
  return value;
}

function status(text: string, state: 'idle' | 'ok' | 'error'): HTMLElement {
  const value = element('div', 'content-authoring-status');
  value.textContent = text;
  value.dataset.state = state;
  return value;
}
