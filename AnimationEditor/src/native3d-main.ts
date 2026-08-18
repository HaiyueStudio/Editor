import { HaiyueEngine, type Scene } from '@haiyue/engine';
import {
  createHyaAnimation3DRuntime,
  type HyaAnimation3DPayload,
  type HyaAnimation3DResource,
  type HyaAnimation3DRuntime,
} from '@haiyue/extensions/animation3d';
import { parseNative3DAnimation } from '@haiyue/animation-spec/native3d';
import {
  addNative3dMaterial,
  addNative3dPrimitive,
  setNative3dNodeTransform,
} from './domain/native3d/Native3dAuthoring';
import { compileNative3dProject } from './domain/native3d/Native3dCompiler';
import { type Native3dProject } from './domain/native3d/Native3dProject';
import { parseNative3dProject } from './domain/native3d/Native3dProjectCodec';
import { Native3dViewportController } from './preview/native3d/Native3dViewportController';
import {
  ANIMATION_EDITOR_LOCALE_STORAGE_KEY,
  normalizeAnimationEditorLocale,
  type AnimationEditorLocale,
} from './localization';
import {
  DESIGNER_TEMPLATES,
  createDesignerTemplateProject,
  type DesignerTemplateId,
} from './integration/DesignerTemplates';
import {
  createDesignerHyaArtifact,
  createDesignerPackageArtifact,
  createDesignerProjectFileArtifact,
} from './integration/DesignerProjectIO';
import { DesignerTaskCoordinator } from './integration/DesignerTaskCoordinator';

type CopyKey = 'template' | 'new' | 'open' | 'save' | 'play' | 'pause' | 'exportHya' | 'exportPackage'
  | 'hierarchy' | 'preview' | 'orbit' | 'properties' | 'timeline';

const copy: Readonly<Record<CopyKey, readonly [string, string]>> = {
  template: ['模板', 'Template'], new: ['新建', 'New'], open: ['打开', 'Open'], save: ['保存', 'Save'],
  play: ['▶ 播放', '▶ Play'], pause: ['Ⅱ 暂停', 'Ⅱ Pause'], exportHya: ['导出 HYA', 'Export HYA'],
  exportPackage: ['导出交付包', 'Export Package'], hierarchy: ['节点层级', 'Hierarchy'],
  preview: ['Exact WebGPU 预览', 'Exact WebGPU Preview'], orbit: ['拖动 Orbit · 滚轮缩放', 'Drag to orbit · Wheel to zoom'],
  properties: ['属性', 'Properties'], timeline: ['时间轴', 'Timeline'],
};

let locale: AnimationEditorLocale = readLocale();
let project = initialProject();
let savedSnapshot = JSON.stringify(project);
let selectedNodeId = project.nodes.find(node => node.components.some(component => component.kind !== 'camera3d'))?.id
  ?? project.nodes[0]?.id ?? null;
let engine: HaiyueEngine | null = null;
let scene: Scene | null = null;
let runtime: HyaAnimation3DRuntime | null = null;
let viewport: Native3dViewportController | null = null;
let runtimeAction: ReturnType<HyaAnimation3DRuntime['playClip']> | null = null;
let playing = false;
let currentTime = 0;
let previousFrame = performance.now();
let animationFrame = 0;
let previewGeneration = 0;
let previewTimer: number | null = null;
let deviceErrorListener: ((event: GPUUncapturedErrorEvent) => void) | null = null;
const undoStack: Native3dProject[] = [];
const redoStack: Native3dProject[] = [];
const tasks = new DesignerTaskCoordinator();

const canvas = q<HTMLCanvasElement>('#preview-canvas');
const fileInput = q<HTMLInputElement>('#project-file');
const templateSelect = q<HTMLSelectElement>('#template-select');
const status = q<HTMLElement>('#status');

configureTemplates();
applyLocale();
bindEvents();
tasks.subscribe(snapshot => {
  const host = q<HTMLElement>('#task');
  host.hidden = snapshot.state !== 'running';
  q<HTMLProgressElement>('#task-value').value = snapshot.progress;
  q<HTMLElement>('#task-label').textContent = snapshot.detail ? `${snapshot.label} · ${snapshot.detail}` : snapshot.label;
});
render();
void refreshPreview();

function bindEvents(): void {
  q<HTMLButtonElement>('#new-project').addEventListener('click', () => {
    if (!confirmReplace()) return;
    activateProject(templateProject(templateSelect.value as DesignerTemplateId), true);
    setStatus(t('已从原生 3D 模板新建工程。', 'Created a project from a native 3D template.'));
  });
  q<HTMLButtonElement>('#open-project').addEventListener('click', () => { if (confirmReplace()) fileInput.click(); });
  fileInput.addEventListener('change', () => void openFile());
  q<HTMLButtonElement>('#save-project').addEventListener('click', () => saveProject());
  q<HTMLButtonElement>('#undo').addEventListener('click', undo);
  q<HTMLButtonElement>('#redo').addEventListener('click', redo);
  q<HTMLButtonElement>('#play').addEventListener('click', togglePlay);
  q<HTMLButtonElement>('#export-hya').addEventListener('click', exportHya);
  q<HTMLButtonElement>('#export-package').addEventListener('click', () => void exportPackage());
  q<HTMLButtonElement>('#add-box').addEventListener('click', addBox);
  q<HTMLButtonElement>('#cancel-task').addEventListener('click', () => void tasks.cancel());
  q<HTMLButtonElement>('#locale').addEventListener('click', () => {
    locale = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
    try { localStorage.setItem(ANIMATION_EDITOR_LOCALE_STORAGE_KEY, locale); } catch { /* optional */ }
    applyLocale();
    render();
  });
  window.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); }
    else if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  });
  window.addEventListener('beforeunload', event => { if (isDirty()) event.preventDefault(); });
  window.addEventListener('pagehide', dispose, { once: true });
}

function configureTemplates(): void {
  const templates = DESIGNER_TEMPLATES.filter(definition => definition.family === '3d');
  templateSelect.replaceChildren(...templates.map(definition => {
    const option = document.createElement('option');
    option.value = definition.id;
    option.textContent = definition.name[locale];
    return option;
  }));
  templateSelect.value = templateFromUrl();
}

function applyLocale(): void {
  document.documentElement.lang = locale;
  document.title = locale === 'zh-CN' ? '海月动画编辑器 · 原生 3D' : 'Haiyue Animation Editor · Native 3D';
  for (const node of document.querySelectorAll<HTMLElement>('[data-copy]')) {
    const key = node.dataset.copy as CopyKey;
    node.textContent = copy[key][locale === 'zh-CN' ? 0 : 1];
  }
  q<HTMLButtonElement>('#locale').textContent = locale === 'zh-CN' ? 'EN' : '中';
  configureTemplates();
}

async function initializeEngine(): Promise<void> {
  if (engine) return;
  if (!('gpu' in navigator)) throw new Error(t('当前浏览器不支持 WebGPU。', 'This browser does not support WebGPU.'));
  const next = new HaiyueEngine({ canvas, clearColor: { r: 0.012, g: 0.022, b: 0.045, a: 1 }, msaaSamples: 4 });
  await next.init();
  deviceErrorListener = event => setStatus(`WebGPU: ${event.error.message}`);
  next.device.addEventListener('uncapturederror', deviceErrorListener);
  const nextScene = next.createScene({
    name: 'Animation Editor Native 3D', render3D: { loadOp: 'clear' }, render2D: false, gui: false,
    pipelineLabel: 'AnimationEditor.native3d',
  });
  next.switchScene(nextScene);
  next.run();
  engine = next;
  scene = nextScene;
  animationFrame = requestAnimationFrame(frame);
}

async function refreshPreview(): Promise<void> {
  const generation = ++previewGeneration;
  q<HTMLElement>('#gpu-status').textContent = 'WEBGPU LOADING';
  try {
    await initializeEngine();
    const compilation = compileNative3dProject(project);
    const exact = parseNative3DAnimation(compilation.binary);
    const nextRuntime = await createHyaAnimation3DRuntime({
      scene: scene!,
      payload: exact.payload as unknown as HyaAnimation3DPayload,
      resources: exact.resources as unknown as readonly HyaAnimation3DResource[],
      useAuthoredCamera: false, addPreviewLights: true,
    });
    if (generation !== previewGeneration) { nextRuntime.destroy(); return; }
    releaseRuntime();
    runtime = nextRuntime;
    viewport = new Native3dViewportController({ scene: scene!, canvas, runtime, gridExtent: 16, gridStep: 1 });
    if (selectedNodeId) viewport.select([selectedNodeId]);
    const clip = project.timeline.clips[0];
    runtimeAction = clip ? runtime.playClip(clip.id, { id: `preview:${generation}`, loop: 'repeat' }) : null;
    runtime.setTime(currentTime);
    q<HTMLElement>('#preview-stats').textContent = `${new Uint8Array(compilation.binary).byteLength} B · ${runtime.diagnostics().entityCount} entities`;
    q<HTMLElement>('#gpu-status').textContent = 'WEBGPU READY';
    setStatus(t('Exact HYA 3D Runtime 已连接。', 'Exact HYA 3D Runtime connected.'));
  } catch (error) {
    if (generation !== previewGeneration) return;
    q<HTMLElement>('#gpu-status').textContent = 'WEBGPU ERROR';
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function schedulePreview(): void {
  q<HTMLElement>('#gpu-status').textContent = 'WEBGPU LOADING';
  if (previewTimer !== null) clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => { previewTimer = null; void refreshPreview(); }, 120);
}

function frame(now: number): void {
  const delta = Math.min(0.1, Math.max(0, (now - previousFrame) / 1000));
  previousFrame = now;
  if (playing && runtime) {
    runtime.update(delta);
    currentTime = (currentTime + delta) % Math.max(0.001, project.composition.duration);
    q<HTMLElement>('#timecode').textContent = `${currentTime.toFixed(3)}s`;
  }
  viewport?.update(delta * 1000);
  animationFrame = requestAnimationFrame(frame);
}

function render(): void {
  q<HTMLElement>('#project-name').textContent = `${isDirty() ? '● ' : ''}${project.name}`;
  const nodeList = q<HTMLElement>('#node-list');
  nodeList.replaceChildren(...project.nodes.map(node => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `node-item${node.id === selectedNodeId ? ' selected' : ''}`;
    button.setAttribute('role', 'treeitem');
    button.setAttribute('aria-selected', String(node.id === selectedNodeId));
    button.append(text('strong', node.name), text('span', `${node.id} · ${node.components.map(component => component.kind).join(', ') || 'group'}`));
    button.addEventListener('click', () => { selectedNodeId = node.id; viewport?.select([node.id]); render(); });
    return button;
  }));
  renderInspector();
  renderTimeline();
  q<HTMLElement>('#stats').textContent = `${project.nodes.length} nodes · ${project.timeline.clips.reduce((sum, clip) => sum + clip.tracks.length, 0)} tracks · ${project.assets.length} assets`;
  q<HTMLButtonElement>('#undo').disabled = undoStack.length === 0;
  q<HTMLButtonElement>('#redo').disabled = redoStack.length === 0;
  q<HTMLButtonElement>('#play').textContent = copy[playing ? 'pause' : 'play'][locale === 'zh-CN' ? 0 : 1];
  q<HTMLButtonElement>('#play').setAttribute('aria-pressed', String(playing));
}

function renderInspector(): void {
  const host = q<HTMLElement>('#inspector');
  host.replaceChildren();
  const node = project.nodes.find(candidate => candidate.id === selectedNodeId);
  q<HTMLElement>('#selection-kind').textContent = node ? 'NODE 3D' : 'COMPOSITION';
  if (!node) {
    host.append(readonlyField(t('工程族', 'Project family'), 'native-3d'), readonlyField(t('总时长', 'Duration'), `${project.composition.duration}s`));
    return;
  }
  host.append(readonlyField('ID', node.id));
  const name = inputField(t('名称', 'Name'), node.name, value => commit(draft => {
    const target = draft.nodes.find(candidate => candidate.id === node.id);
    if (target && value.trim()) target.name = value.trim();
  }));
  const vector = document.createElement('label');
  vector.className = 'field';
  vector.append(text('span', t('平移 XYZ', 'Translation XYZ')));
  const row = document.createElement('div'); row.className = 'vector';
  node.transform.translation.forEach((value, component) => {
    const input = document.createElement('input'); input.type = 'number'; input.step = '0.1'; input.value = String(value);
    input.setAttribute('aria-label', `${t('平移', 'Translation')} ${'XYZ'[component]}`);
    input.addEventListener('change', () => commitNativeTransform(node.id, component, Number(input.value)));
    row.append(input);
  });
  vector.append(row);
  host.append(name, vector, readonlyField(t('组件', 'Components'), node.components.map(component => component.kind).join(', ') || '—'));
}

function renderTimeline(): void {
  const host = q<HTMLElement>('#track-list');
  const tracks = project.timeline.clips.flatMap(clip => clip.tracks.map(track => ({ clip, track })));
  host.replaceChildren(...tracks.map(({ clip, track }) => {
    const item = document.createElement('div'); item.className = 'track-item';
    const keys = document.createElement('div'); keys.className = 'keys';
    for (const key of track.keyframes) {
      const mark = document.createElement('i'); mark.style.left = `${key.time / clip.duration * 100}%`; mark.title = `${key.time.toFixed(3)}s`;
      keys.append(mark);
    }
    item.append(text('strong', track.name), text('span', `${clip.name} · ${track.binding.path} · ${track.interpolation}`), keys);
    return item;
  }));
  if (tracks.length === 0) host.append(text('div', t('当前工程没有动画轨道。', 'This project has no animation tracks.')));
}

function commit(mutation: (draft: Mutable<Native3dProject>) => void): void {
  const before = project;
  const draft = structuredClone(project) as unknown as Mutable<Native3dProject>;
  mutation(draft);
  const next = parseNative3dProject(draft);
  if (JSON.stringify(next) === JSON.stringify(before)) return;
  undoStack.push(before); if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  project = next;
  render();
  schedulePreview();
}

function commitNativeTransform(nodeId: string, component: number, value: number): void {
  if (!Number.isFinite(value)) return;
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  if (!node) return;
  const translation = [...node.transform.translation] as [number, number, number];
  translation[component] = value;
  const before = project;
  const next = setNative3dNodeTransform(project, nodeId, { translation });
  undoStack.push(before); redoStack.length = 0; project = next; render(); schedulePreview();
}

function addBox(): void {
  let next = project;
  let materialId = next.materials[0]?.id;
  if (!materialId) {
    materialId = 'material-default';
    next = addNative3dMaterial(next, {
      id: materialId, name: 'Default PBR', baseColorFactor: [0.12, 0.55, 1, 1], metallicFactor: 0.1,
      roughnessFactor: 0.5, emissiveFactor: [0, 0, 0], alphaMode: 'opaque', doubleSided: false,
    });
  }
  const id = uniqueId('box', new Set(next.nodes.map(node => node.id)));
  next = addNative3dPrimitive(next, { nodeId: id, componentId: `${id}-mesh`, primitive: 'box', materialId });
  undoStack.push(project); redoStack.length = 0; project = next; selectedNodeId = id; render(); schedulePreview();
}

function undo(): void { const next = undoStack.pop(); if (!next) return; redoStack.push(project); project = next; render(); schedulePreview(); }
function redo(): void { const next = redoStack.pop(); if (!next) return; undoStack.push(project); project = next; render(); schedulePreview(); }

function togglePlay(): void {
  playing = !playing;
  if (playing && !runtimeAction && project.timeline.clips[0] && runtime) {
    runtimeAction = runtime.playClip(project.timeline.clips[0].id, { id: `manual:${previewGeneration}`, loop: 'repeat' });
  }
  render();
}

function saveProject(): void {
  const artifact = createDesignerProjectFileArtifact(project);
  download(artifact.fileName, artifact.mimeType, new TextEncoder().encode(artifact.text));
  savedSnapshot = JSON.stringify(project);
  setStatus(t(`已保存 ${artifact.fileName}。`, `Saved ${artifact.fileName}.`));
  render();
}

async function openFile(): Promise<void> {
  const file = fileInput.files?.[0]; fileInput.value = '';
  if (!file) return;
  try {
    const next = parseNative3dProject(await file.text());
    activateProject(next, true);
    setStatus(t(`已打开 ${file.name}。`, `Opened ${file.name}.`));
  } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
}

function exportHya(): void {
  try {
    const artifact = createDesignerHyaArtifact(project);
    const bytes = 'binary' in artifact ? new Uint8Array(artifact.binary) : artifact.bytes;
    download(artifact.fileName, artifact.mimeType, bytes);
    setStatus(t(`已导出 ${artifact.fileName}。`, `Exported ${artifact.fileName}.`));
  } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
}

async function exportPackage(): Promise<void> {
  try {
    const artifact = await tasks.run(t('生成交付包', 'Build delivery package'), async ({ signal, report }) => {
      report(0.15, t('编译并计算完整性', 'Compile and hash'));
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
      const result = await createDesignerPackageArtifact(project);
      report(1, t('完成', 'Done'));
      return result;
    });
    download(artifact.fileName, artifact.mimeType, new Uint8Array(artifact.binary));
    setStatus(t(`已导出 ${artifact.fileName}。`, `Exported ${artifact.fileName}.`));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') setStatus(t('导出已取消。', 'Export cancelled.'));
    else setStatus(error instanceof Error ? error.message : String(error));
  }
}

function activateProject(next: Native3dProject, markSaved: boolean): void {
  releaseRuntime();
  project = parseNative3dProject(next);
  selectedNodeId = project.nodes.find(node => node.components.some(component => component.kind !== 'camera3d'))?.id ?? project.nodes[0]?.id ?? null;
  undoStack.length = 0; redoStack.length = 0; currentTime = 0; playing = false;
  if (markSaved) savedSnapshot = JSON.stringify(project);
  render(); void refreshPreview();
}

function releaseRuntime(): void {
  viewport?.destroy(); viewport = null;
  runtimeAction = null;
  runtime?.destroy(); runtime = null;
}

function dispose(): void {
  if (previewTimer !== null) clearTimeout(previewTimer);
  cancelAnimationFrame(animationFrame);
  releaseRuntime();
  if (deviceErrorListener && engine) engine.device.removeEventListener('uncapturederror', deviceErrorListener);
  deviceErrorListener = null;
  engine?.stop(); engine?.destroy(); engine = null; scene = null;
  void tasks.close();
}

function templateProject(id: DesignerTemplateId): Native3dProject {
  const project = createDesignerTemplateProject(id);
  if (!('mode' in project) || project.mode !== '3d') throw new Error(`Template ${id} is not native 3D.`);
  return project;
}

function initialProject(): Native3dProject {
  try {
    const source = sessionStorage.getItem('haiyue.animation-editor:open-native3d@1');
    if (source) {
      sessionStorage.removeItem('haiyue.animation-editor:open-native3d@1');
      return parseNative3dProject(source);
    }
  } catch { /* fall back to a template when session storage is unavailable */ }
  return templateProject(templateFromUrl());
}

function templateFromUrl(): Extract<DesignerTemplateId, 'native3d-camera-object' | 'gltf-character'> {
  const value = new URLSearchParams(location.search).get('template');
  return value === 'gltf-character' ? value : 'native3d-camera-object';
}

function confirmReplace(): boolean { return !isDirty() || confirm(t('当前工程有未保存修改，继续会丢失这些修改。', 'The current project has unsaved changes; continuing will discard them.')); }
function isDirty(): boolean { return JSON.stringify(project) !== savedSnapshot; }
function setStatus(value: string): void { status.textContent = value; }
function t(zh: string, en: string): string { return locale === 'zh-CN' ? zh : en; }
function readLocale(): AnimationEditorLocale {
  try { return normalizeAnimationEditorLocale(localStorage.getItem(ANIMATION_EDITOR_LOCALE_STORAGE_KEY)) ?? 'zh-CN'; }
  catch { return 'zh-CN'; }
}
function download(fileName: string, mimeType: string, bytes: Uint8Array): void {
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
function inputField(label: string, value: string, onChange: (value: string) => void): HTMLElement {
  const field = document.createElement('label'); field.className = 'field'; field.append(text('span', label));
  const input = document.createElement('input'); input.value = value; input.addEventListener('change', () => onChange(input.value)); field.append(input); return field;
}
function readonlyField(label: string, value: string): HTMLElement { const field = document.createElement('div'); field.className = 'field'; field.append(text('span', label), text('strong', value)); return field; }
function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); node.textContent = value; return node; }
function uniqueId(base: string, ids: ReadonlySet<string>): string { if (!ids.has(base)) return base; let index = 2; while (ids.has(`${base}-${index}`)) index++; return `${base}-${index}`; }
function q<T extends Element>(selector: string): T { const value = document.querySelector(selector); if (!value) throw new Error(`Missing ${selector}`); return value as T; }
type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
