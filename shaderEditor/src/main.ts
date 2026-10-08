import type {} from '@haiyue/editor-app-kit';
import type { GESelect, GECheckbox } from '@haiyue/ui';
import { initializeUI } from './ui.js';
import { ShaderWorkspace } from './workspace.js';
import { ShaderRuntime } from './runtime.js';
import type { BufferPreview } from './bufferPreviews.js';
import { CodeEditor, GlslEditor, WgslPreview } from './codeEditor.js';
import { GalleryStore, type GalleryItem } from './storage.js';
import { examples } from './examples.js';
import { createProject, passOf, parseProject, PASS_IDS, PASS_LABELS, LIMITS, CUBE_FACES, CUBE_FACE_LABELS, channelTypes, type PassId, type PreviewMode, type PreviewMesh, type ShaderProject } from './model.js';
import { BUILTIN_TEXTURES, builtinTexture, type BuiltinTextureId } from './builtinTextures.js';
import { TutorialPage } from './tutorialPage.js';
import { createCubeUploader } from './cubeUpload.js';
import { translateGlsl } from './glsl.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const disposeUI = initializeUI();
$<GESelect>('preview-scale').options = [{ value: '1', label: '100%' }, { value: '0.5', label: '50%' }, { value: '0.25', label: '25%' }];
$<GESelect>('mesh-select').options = [{ value: 'sphere', label: '球体' }, { value: 'box', label: '立方体' }, { value: 'torus', label: '圆环' }];
const workspace = new ShaderWorkspace(), store = new GalleryStore(), samples = examples();
const uploadCube = createCubeUploader(workspace, compile);
const tutorial = new TutorialPage(id => { setRoute('tutorial/' + id); $('tutorial-title').focus({ preventScroll: true }); $('tutorial-title').scrollIntoView({ block: 'start' }); }, project => { void run(() => open(project, true)); });
const thumbnails = new Map<string, string>();
const thumbnailFailures = new Set<string>();
let exampleThumbnailJob: Promise<void> | undefined;
let saved: GalleryItem[] = [], currentPass: PassId = 'image', opened = false, route = 'gallery', disposed = false;
let revision = 0, openedRevision = 0, openSequence = 0, autoTimer: ReturnType<typeof setTimeout> | undefined;
let runtimePromise: Promise<ShaderRuntime> | undefined, openPromise: Promise<void> = Promise.resolve();
let saveQueue: Promise<unknown> = Promise.resolve(), uploadIndex = 0, translation: string | null = null;
let controlSignature = '', compileSequence = 0;
let bufferPreviews: BufferPreview[] = [];
const editor = new CodeEditor($('code-editor'), (pass, code) => { void run(() => workspace.document.setCode(pass, code)); }, () => { void run(compile); });
const wgslPreview = new WgslPreview($('glsl-result'));
const glslEditor = new GlslEditor($('glsl-source'), () => {
  translation = null; $<HTMLButtonElement>('apply-glsl').disabled = true;
  wgslPreview.show(''); $('glsl-messages').textContent = '源码已修改，请重新翻译。';
  $('glsl-messages').classList.remove('error');
}, translateSource);

function translateSource() {
  const result = translateGlsl(glslEditor.value, { channelTypes: channelTypes(passOf(workspace.document.state as ShaderProject, currentPass).channels) }); translation = result.code; $<HTMLButtonElement>('apply-glsl').disabled = !translation;
  wgslPreview.show(result.code ?? '');
  $('glsl-messages').textContent = result.code ? result.warnings.join('\n') : result.diagnostics.map(d => `${d.line}:${d.column} ${d.message}`).join('\n');
  $('glsl-messages').classList.toggle('error', !result.code);
}

function notice(message: string, error = false) { $('notice').hidden = false; $('notice').classList.toggle('error', error); $('notice-text').textContent = message; }
async function run(action: () => unknown | Promise<unknown>) { try { return await action(); } catch (error) { notice(error instanceof Error ? error.message : String(error), true); return undefined; } }
function button(label: string, action: () => unknown | Promise<unknown>, className = '') { const b = document.createElement('button'); b.textContent = label; b.className = className; b.onclick = () => { void run(action); }; return b; }
function bind(id: string, action: () => unknown | Promise<unknown>) { $(id).addEventListener('click', () => { void run(action); }); }
function download(bytes: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function basename() { return workspace.document.state.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim() || 'shader'; }
function setRoute(next: string) {
  route = next.startsWith('tutorial') ? 'tutorial' : next;
  $('gallery').hidden = route !== 'gallery'; $('workspace').hidden = route !== 'editor'; $('tutorial').hidden = route !== 'tutorial';
  for (const page of ['gallery', 'editor', 'tutorial']) {
    $('nav-' + page).classList.toggle('active', route === page);
    if (route === page) $('nav-' + page).setAttribute('aria-current', 'page'); else $('nav-' + page).removeAttribute('aria-current');
  }
  if (route === 'tutorial') { tutorial.show(next.split('/')[1] ?? tutorial.currentId); next = 'tutorial/' + tutorial.currentId; }
  workspace.runtime?.setVisible(route === 'editor'); history.replaceState(null, '', `#${next}`);
  window.scrollTo(0, 0);
  if (next === 'gallery') { renderGallery(); void generateExampleThumbnails(); }
}
async function ensureRuntime() {
  if (!runtimePromise) runtimePromise = (async () => {
    const runtime = new ShaderRuntime($<HTMLCanvasElement>('shader-canvas'));
    runtime.onError = message => { $('gpu-message').textContent = message; $('gpu-overlay').hidden = false; $('gpu-overlay').classList.add('failed'); $('gpu-retry').hidden = false; };
    try { await runtime.initialize(); }
    catch (error) { runtime.onError?.(`无法启动 WebGPU：${error instanceof Error ? error.message : String(error)}。仍可编辑、导入和保存代码。请使用支持 WebGPU 的浏览器或检查硬件加速。`); throw error; }
    workspace.runtime = runtime; runtime.setBufferPreviews(workspace.document.state.id, bufferPreviews);
    runtime.onFrame = state => {
      $('time-label').textContent = `${state.time.toFixed(2)} s`;
      $('resolution-label').textContent = `${state.width} × ${state.height}`;
      $('play-pause').textContent = state.playing ? 'Ⅱ' : '▶'; $('play-pause').setAttribute('aria-label', state.playing ? '暂停' : '播放');
      $('gpu-overlay').hidden = true;
    };
    runtime.setVisible(route === 'editor'); return runtime;
  })();
  return runtimePromise;
}
async function compile() {
  const sequence = ++compileSequence;
  $('compile-state').textContent = '正在编译…'; $<HTMLButtonElement>('compile').disabled = true;
  try {
    await ensureRuntime(); const compiled = await workspace.compile();
    if (compiled && sequence === compileSequence) { controlSignature = ''; sync(); }
    if (!compiled && !workspace.diagnostics.length) $('compile-state').textContent = '代码已变化，请重新运行';
  } finally { if (sequence === compileSequence) $<HTMLButtonElement>('compile').disabled = false; }
}
function renderDiagnostics() {
  const diagnostics = workspace.diagnostics, list = $('diagnostics'); list.replaceChildren();
  $('diagnostics-count').textContent = `${diagnostics.filter(d => d.severity === 'error').length} 个错误 · ${diagnostics.filter(d => d.severity === 'warning').length} 个警告`;
  if (!diagnostics.length) { const p = document.createElement('p'); p.className = 'diagnostics-empty'; p.textContent = workspace.compiledRevision ? '✓ 编译成功 · Haiyue WebGPU' : '点击运行，查看你的 Shader。'; list.append(p); }
  for (const diagnostic of diagnostics) list.append(button(`${PASS_LABELS[diagnostic.pass]}:${diagnostic.line}:${diagnostic.column}  ${diagnostic.message}`, () => { selectPass(diagnostic.pass); editor.focusLine(diagnostic.line); }, `diagnostic ${diagnostic.severity}`));
  editor.diagnostics(diagnostics);
  $('compile-state').textContent = diagnostics.some(d => d.severity === 'error') ? '编译失败 · 保留上次预览' : workspace.compiledRevision === workspace.document.revision ? '● 已编译' : '● 代码已修改';
}
function selectPass(pass: PassId) { currentPass = pass; editor.show(pass, passOf(workspace.document.state as ShaderProject, pass).code); controlSignature = ''; sync(); renderDiagnostics(); }
function sync() {
  const p = workspace.document.state, pass = passOf(p as ShaderProject, currentPass);
  if (document.activeElement !== $('project-name')) $<HTMLInputElement>('project-name').value = p.name;
  if (editor.view.state.doc.toString() !== pass.code) editor.show(currentPass, pass.code);
  $<GESelect>('preview-scale').value = String(p.preview.scale);
  $<GESelect>('mesh-select').value = p.preview.mesh;
  $('mode-canvas').setAttribute('aria-pressed', String(p.preview.mode === 'canvas'));
  $('mode-scene').setAttribute('aria-pressed', String(p.preview.mode === 'scene'));
  $('scene-controls').hidden = p.preview.mode !== 'scene';
  const signature = JSON.stringify([currentPass, p.passes.map(item => [item.id, item.enabled, item.channels]), p.assets.map(a => [a.id, a.name])]);
  if (signature !== controlSignature) {
    controlSignature = signature; const tabs = $('pass-tabs'); tabs.replaceChildren();
    for (const id of ['image', ...PASS_IDS.filter(p => p !== 'image')] as PassId[]) {
      const b = button(PASS_LABELS[id], () => selectPass(id), passOf(p as ShaderProject, id).enabled ? 'enabled' : '');
      b.dataset.pass = id; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(id === currentPass)); tabs.append(b);
    }
    $('pass-enable-label').hidden = currentPass === 'image'; $<GECheckbox>('pass-enabled').checked = pass.enabled;
    $('channel-pass-label').textContent = PASS_LABELS[currentPass].toUpperCase(); renderChannels();
  }
  if (workspace.compiledRevision !== workspace.document.revision) $('compile-state').textContent = '● 代码已修改 · Ctrl / ⌘ + Enter 运行';
}
function renderChannels() {
  const p = workspace.document.state, pass = passOf(p as ShaderProject, currentPass), container = $('channels'); container.replaceChildren();
  bufferPreviews = [];
  pass.channels.forEach((channel, index) => {
    const card = document.createElement('div'); card.className = 'channel-card'; card.dataset.channel = String(index);
    const top = document.createElement('div'); top.className = 'channel-top'; const label = document.createElement('span'); label.textContent = `iChannel${index}`;
    const clear = button('×', async () => { workspace.setChannel(currentPass, index, { kind: 'none' }); await compile(); }); clear.setAttribute('aria-label', `清空 iChannel${index}`); top.append(label, clear);
    const body = document.createElement('div'); body.className = 'channel-body';
    if (channel.kind === 'image' || channel.kind === 'cubemap') {
      const asset = p.assets.find(a => a.id === channel.assetId)!;
      if (asset.kind === 'cubemap') {
        body.classList.add('cubemap-preview');
        for (const face of CUBE_FACES) {
          const tile = document.createElement('span'), img = new Image(), label = document.createElement('small');
          img.src = asset.faces[face]; img.alt = asset.name + ' ' + CUBE_FACE_LABELS[face]; label.textContent = CUBE_FACE_LABELS[face].split(' ')[0]!;
          tile.append(img, label); body.append(tile);
        }
      } else { const img = new Image(); img.src = asset.dataUrl; img.alt = asset.name; body.append(img); }
    }
    else if (channel.kind === 'builtin') {
      const asset = builtinTexture(channel.texture), img = new Image(); img.src = asset.url; img.alt = asset.name; body.append(img);
    }
    else if (channel.kind === 'keyboard') { body.textContent = '⌨'; body.title = '点击预览后按键 · 256 × 3'; }
    else if (channel.kind === 'video') { body.textContent = '▶'; body.title = p.assets.find(a => a.id === channel.assetId)?.name ?? '视频'; }
    else if (channel.kind === 'buffer') {
      const canvas = document.createElement('canvas'); canvas.className = 'buffer-preview'; canvas.width = 160; canvas.height = 90;
      canvas.dataset.buffer = channel.pass; canvas.dataset.previewState = 'waiting';
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${PASS_LABELS[channel.pass]} 渲染预览`);
      body.title = `${PASS_LABELS[channel.pass]} · 最新渲染画面`;
      const state = document.createElement('span'); state.className = 'buffer-preview-state'; state.textContent = '等待渲染';
      const badge = document.createElement('span'); badge.className = 'buffer-preview-badge'; badge.textContent = channel.pass.at(-1)!.toUpperCase();
      body.append(canvas, state, badge); bufferPreviews.push({ canvas, pass: channel.pass });
    }
    else body.textContent = '+';
    const select = document.createElement('ge-select') as GESelect; select.setAttribute('aria-label', `iChannel${index} 来源`);
    select.options = [{ value: 'none', label: '无纹理' }, { value: 'keyboard', label: '⌨ 键盘 · 256 × 3' },
      ...BUILTIN_TEXTURES.map(asset => ({ value: 'builtin:' + asset.id, label: '内置 · ' + asset.name })),
      ...PASS_IDS.filter(id => id !== 'image').map(id => ({ value: id, label: `${PASS_LABELS[id]}${id === currentPass ? ' ↺' : ''}` })),
      ...p.assets.map(asset => ({ value: `${asset.kind ?? 'image'}:${asset.id}`, label: `${asset.kind === 'cubemap' ? 'Cubemap · ' : asset.kind === 'video' ? '视频 · ' : ''}${asset.name}` }))];
    select.value = channel.kind === 'buffer' ? channel.pass : (channel.kind === 'image' || channel.kind === 'cubemap' || channel.kind === 'video') ? `${channel.kind}:${channel.assetId}` : channel.kind === 'builtin' ? 'builtin:' + channel.texture : channel.kind;
    select.addEventListener('value-change', () => { void run(async () => {
      const value = select.value; workspace.setChannel(currentPass, index, value === 'none' ? { kind: 'none' } : value === 'keyboard' ? { kind: 'keyboard' } : value.startsWith('builtin:') ? { kind: 'builtin', texture: value.slice(8) as BuiltinTextureId } : value.startsWith('video:') ? { kind: 'video', assetId: value.slice(6) } : value.startsWith('image:') ? { kind: 'image', assetId: value.slice(6) } : value.startsWith('cubemap:') ? { kind: 'cubemap', assetId: value.slice(8) } : { kind: 'buffer', pass: value as Exclude<PassId, 'image'> }); await compile();
    }); });
    const upload = button('↑ 上传图片', () => { uploadIndex = index; $<HTMLInputElement>('texture-input').click(); }, 'upload-channel');
    const cube = button('↑ 上传立方体贴图', () => uploadCube(currentPass, index), 'upload-cubemap');
    const video = button('↑ 上传视频', () => { uploadIndex = index; $<HTMLInputElement>('video-input').click(); }, 'upload-video');
    card.append(top, body, select, upload, video, cube); container.append(card);
  });
  workspace.runtime?.setBufferPreviews(p.id, bufferPreviews);
}
function hasUnsavedChanges() { return opened && workspace.document.dirty && workspace.document.revision !== openedRevision; }
function refreshSaveState() {
  $('save-state').textContent = hasUnsavedChanges() ? '有未保存的修改' : saved.some(item => item.project.id === workspace.document.state.id) && !workspace.document.dirty ? '已保存到此浏览器' : '尚未保存';
  window.haiyueEditorHost?.updateDocumentState({ dirty: hasUnsavedChanges(), name: workspace.document.state.name, locale: 'zh-CN' });
}
function changed() {
  sync();
  refreshSaveState();
  if (workspace.document.revision === revision) return;
  revision = workspace.document.revision;
  if (autoTimer) clearTimeout(autoTimer);
  if (opened && $<GECheckbox>('auto-run').checked) autoTimer = setTimeout(() => { void run(compile); }, 650);
}
async function save() {
  if (!opened) return;
  const project = workspace.document.serialize(), savedRevision = workspace.document.revision, owner = openSequence;
  const fallback = saved.find(item => item.project.id === project.id)?.thumbnail ?? '';
  // Capture the current Image target only for an explicit save. Copying begins
  // now, so a later edit or project switch cannot replace this snapshot's image.
  const runtime = workspace.runtime;
  const image = workspace.compiledRevision && runtime?.status().ready && runtime.status().frame > 0
    ? runtime.readImage().then(result => imageDataUrl(result)).catch(() => fallback) : Promise.resolve(fallback);
  const job = saveQueue.catch(() => {}).then(async () => { const thumbnail = await image; await store.save(project, thumbnail); return thumbnail; }); saveQueue = job;
  $('save-state').textContent = '正在保存…';
  try {
    const thumbnail = await job;
    saved = [{ project, thumbnail, savedAt: new Date().toISOString() }, ...saved.filter(item => item.project.id !== project.id)];
    if (opened && owner === openSequence && workspace.document.state.id === project.id) workspace.document.markSaved(savedRevision);
    if (route === 'gallery') renderGallery();
  } catch (error) { if (owner === openSequence) $('save-state').textContent = '保存失败 · 请导出备份'; throw new Error(`本地保存失败：${String(error)}。请导出工程以保留作品。`); }
}
async function open(project: ShaderProject, fork = false) {
  const next = structuredClone(project);
  if (fork) { next.id = crypto.randomUUID(); next.updatedAt = new Date().toISOString(); }
  workspace.open(next); await openPromise;
}
function card(project: ShaderProject, image: string, category: string, click: () => Promise<void>, index = '', placeholder = '暂无预览') {
  const article = document.createElement('article'); article.className = 'shader-card';
  const open = button('', click, 'card-open'); open.setAttribute('aria-label', `打开 ${project.name}`); open.dataset.project = project.id;
  const art = document.createElement('div'); art.className = 'card-art';
  if (image) { const img = new Image(); img.src = image; img.alt = `${project.name} Shader 预览`; art.append(img); }
  else { const state = document.createElement('span'); state.className = 'thumbnail-placeholder'; state.textContent = placeholder; art.append(state); }
  const badge = document.createElement('span'); badge.className = 'card-tag'; badge.textContent = category;
  const number = document.createElement('span'); number.className = 'card-index'; number.textContent = index; art.append(badge, number);
  const info = document.createElement('div'); info.className = 'card-info'; const title = document.createElement('h3'); title.textContent = project.name;
  const meta = document.createElement('p'); const type = document.createElement('span'); type.textContent = `${project.passes.filter(p => p.enabled).length} PASS · WGSL`;
  const arrow = document.createElement('span'); arrow.textContent = '打开 ↗'; meta.append(type, arrow); info.append(title, meta); open.append(art, info); article.append(open); return article;
}
function renderGallery() {
  const previewMessage = (id: string) => thumbnailFailures.has(id) ? '预览暂不可用' : '正在生成预览…';
  $('examples').replaceChildren(...samples.map(sample => card(sample.project, thumbnails.get(sample.id) ?? '', sample.category, () => open(sample.project, true), sample.label, previewMessage(sample.id))));
  $('examples').setAttribute('aria-busy', String(Boolean(exampleThumbnailJob)));
  $('retry-example-previews').hidden = !thumbnailFailures.size || Boolean(exampleThumbnailJob);
  const query = $<HTMLInputElement>('gallery-search').value.toLowerCase();
  const items = saved.filter(item => item.project.name.toLowerCase().includes(query)); $('project-count').textContent = String(saved.length);
  $('saved-projects').replaceChildren(...items.map(item => {
    const element = card(item.project, item.thumbnail, 'LOCAL PROJECT', () => open(item.project));
    const remove = button('', async () => {
      if (!confirm(`删除本地作品「${item.project.name}」？`)) return;
      if (workspace.document.state.id === item.project.id) { opened = false; if (autoTimer) clearTimeout(autoTimer); refreshSaveState(); }
      await saveQueue.catch(() => {}); await store.delete(item.project.id); saved = saved.filter(p => p.project.id !== item.project.id); renderGallery();
    }, 'card-delete');
    remove.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
    remove.setAttribute('aria-label', `删除 ${item.project.name}`); remove.title = `删除 ${item.project.name}`; element.append(remove); return element;
  }));
  $('empty-gallery').hidden = items.length !== 0;
  if (thumbnails.has('aurora')) { $<HTMLImageElement>('hero-thumbnail').src = thumbnails.get('aurora')!; $('hero-thumbnail').hidden = false; }
  $('hero-preview-state').hidden = thumbnails.has('aurora'); $('hero-preview-state').textContent = previewMessage('aurora');
}
function imageDataUrl(result: { width: number; height: number; pixels: Uint8Array }, maxWidth = 480) {
  const canvas = document.createElement('canvas'); canvas.width = result.width; canvas.height = result.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height), 0, 0);
  const output = document.createElement('canvas'); output.width = Math.min(maxWidth, result.width); output.height = Math.max(1, Math.round(output.width * result.height / result.width));
  output.getContext('2d')!.drawImage(canvas, 0, 0, output.width, output.height); return output.toDataURL('image/png');
}
function generateExampleThumbnails(): Promise<void> {
  // Gallery can first appear after loading #editor. Keep one batch across route
  // changes, retain successful previews, and retry only missing examples.
  if (exampleThumbnailJob) return exampleThumbnailJob;
  const missing = samples.filter(sample => !thumbnails.has(sample.id));
  if (disposed || !missing.length) return Promise.resolve();
  missing.forEach(sample => thumbnailFailures.delete(sample.id));
  exampleThumbnailJob = (async () => {
    let canvas: HTMLCanvasElement | undefined, runtime: ShaderRuntime | undefined;
    try {
      if (!navigator.gpu) throw new Error('WebGPU unavailable');
      canvas = document.createElement('canvas'); canvas.className = 'thumb-render'; document.body.append(canvas);
      runtime = new ShaderRuntime(canvas);
      await runtime.initialize(); runtime.setVisible(false); runtime.setPlaying(false);
      for (const sample of missing) {
        if (disposed) break;
        try {
          const prepared = await runtime.prepare(sample.project); runtime.commit(prepared);
          for (let frame = 0; frame < (sample.id === 'feedback' ? 80 : 1); frame++) runtime.step();
          thumbnails.set(sample.id, imageDataUrl(await runtime.readImage()));
        } catch { thumbnailFailures.add(sample.id); }
        if (!disposed && route === 'gallery') renderGallery();
      }
    } catch { missing.forEach(sample => { if (!thumbnails.has(sample.id)) thumbnailFailures.add(sample.id); }); }
    finally { await runtime?.dispose().catch(() => {}); canvas?.remove(); }
  })().finally(() => {
    exampleThumbnailJob = undefined;
    if (!disposed && route === 'gallery') renderGallery();
  });
  if (route === 'gallery') renderGallery();
  return exampleThumbnailJob;
}

async function start() {
  await workspace.start();
  Object.defineProperty(window, 'haiyueEditor', { value: workspace.api, configurable: true });
  workspace.platform.rpc.connect(window.haiyueEditorIPC);
  workspace.onCompiled = renderDiagnostics;
  workspace.onOpen = () => {
    opened = true; openedRevision = workspace.document.revision; ++openSequence;
    const stored = saved.find(item => item.project.id === workspace.document.state.id);
    if (stored && JSON.stringify(stored.project) === JSON.stringify(workspace.document.state)) workspace.document.markSaved();
    currentPass = 'image'; editor.reset(); editor.show(currentPass, passOf(workspace.document.state as ShaderProject, currentPass).code);
    controlSignature = ''; revision = 0; setRoute('editor'); changed();
    openPromise = (async () => { await run(compile); })();
  };
  workspace.document.subscribe(changed);
  Object.defineProperty(window, 'shaderEditor', { value: Object.freeze({
    open: (project: ShaderProject) => open(project), create: () => open(createProject()), compile,
    translateGlsl, getProject: () => workspace.document.serialize(), getStatus: () => workspace.runtime?.status() ?? null,
  }), configurable: true });
  bind('dismiss-notice', () => { $('notice').hidden = true; });
  bind('new-project', () => open(createProject())); bind('empty-new', () => open(createProject()));
  bind('hero-example', () => open(samples[0]!.project, true));
  bind('nav-tutorial', () => setRoute('tutorial/' + tutorial.currentId));
  window.addEventListener('hashchange', () => { void run(async () => {
    const hash = location.hash.slice(1);
    if (hash === 'tutorial' || hash.startsWith('tutorial/')) setRoute(hash);
    else if (hash === 'editor') { if (!opened) await open(createProject()); else setRoute('editor'); }
    else setRoute('gallery');
  }); });
  bind('nav-gallery', () => setRoute('gallery')); bind('back-gallery', () => setRoute('gallery'));
  bind('retry-example-previews', generateExampleThumbnails);
  document.querySelector<HTMLAnchorElement>('.brand')!.onclick = event => { event.preventDefault(); setRoute('gallery'); };
  bind('nav-editor', async () => { if (!opened) await open(createProject()); else { setRoute('editor'); await ensureRuntime(); } });
  bind('import-project', () => $<HTMLInputElement>('project-input').click());
  $<HTMLInputElement>('project-input').onchange = () => { void run(async () => {
    const input = $<HTMLInputElement>('project-input'), file = input.files?.[0]; input.value = ''; if (!file) return;
    if (file.size > LIMITS.projectBytes) throw new Error('工程不能超过 48 MB。');
    await open(parseProject(await file.text()), true);
  }); };
  bind('save-project', async () => { await save(); notice('作品已保存到此浏览器的 Gallery。'); });
  bind('export-project', () => download(JSON.stringify(workspace.document.serialize(), null, 2), `${basename()}.hyshader`, 'application/json'));
  $<HTMLInputElement>('project-name').onchange = () => { void run(() => workspace.document.change(p => { p.name = $<HTMLInputElement>('project-name').value.trim() || 'Untitled shader'; })); };
  $('gallery-search').addEventListener('input', renderGallery);
  bind('compile', compile);
  $('auto-run').addEventListener('checked-change', () => { if ($<GECheckbox>('auto-run').checked) void run(compile); else if (autoTimer) clearTimeout(autoTimer); });
  const mode = (mode: PreviewMode) => { workspace.preview(mode, $<GESelect>('mesh-select').value as PreviewMesh); };
  bind('mode-canvas', () => mode('canvas')); bind('mode-scene', () => mode('scene'));
  $('mesh-select').addEventListener('value-change', () => { void run(() => mode('scene')); });
  $('preview-scale').addEventListener('value-change', () => { void run(async () => { workspace.document.change(p => { p.preview.scale = Number($<GESelect>('preview-scale').value); }); await compile(); }); });
  $('pass-enabled').addEventListener('checked-change', () => { void run(async () => { workspace.setEnabled(currentPass, $<GECheckbox>('pass-enabled').checked); await compile(); }); });
  bind('play-pause', () => workspace.runtime?.setPlaying(!workspace.runtime.status().playing)); bind('reset-time', () => workspace.runtime?.reset()); bind('step-frame', () => workspace.runtime?.step());
  bind('reset-camera', () => workspace.runtime?.resetCamera());
  bind('fullscreen', () => document.fullscreenElement ? document.exitFullscreen() : $('viewport').requestFullscreen());
  bind('capture', async () => { const result = await (await ensureRuntime()).readImage(); const url = imageDataUrl(result, result.width); const a = document.createElement('a'); a.href = url; a.download = `${basename()}.png`; a.click(); });
  for (const kind of ['image', 'video'] as const) $<HTMLInputElement>(kind === 'video' ? 'video-input' : 'texture-input').onchange = () => { void run(async () => {
    const input = $<HTMLInputElement>(kind === 'video' ? 'video-input' : 'texture-input'), file = input.files?.[0]; input.value = ''; if (!file) return;
    if (kind === 'image' && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > LIMITS.imageBytes)) throw new Error('请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。');
    if (kind === 'video' && (!['video/mp4', 'video/webm'].includes(file.type) || file.size > LIMITS.videoBytes)) throw new Error('请选择不超过 24 MB 的 MP4 或 WebM 视频。');
    const pass = currentPass, index = uploadIndex;
    const resource = workspace.api.putResource(new Uint8Array(await file.arrayBuffer()));
    try {
      const response = await workspace.api.execute({ apiVersion: '1', requestId: crypto.randomUUID(), operation: kind === 'video' ? 'shader.video.upload' : 'shader.texture.upload', documentId: workspace.document.identity.id, expectedRevision: workspace.document.revision, params: { resourceId: resource.resourceId, name: file.name.slice(0, 160), mimeType: file.type } });
      if (response.status !== 'completed') throw new Error(response.error.message);
      workspace.setChannel(pass, index, { kind, assetId: (response.value as { assetId: string }).assetId }); await compile();
    } finally { workspace.api.releaseResource(resource.resourceId); }
  }); };
  bind('help-button', () => $<HTMLDialogElement>('help-dialog').showModal());
  bind('glsl-button', () => { $<HTMLDialogElement>('glsl-dialog').showModal(); glslEditor.focus(); });
  bind('translate-glsl', translateSource);
  bind('apply-glsl', async () => { if (!translation) return; workspace.document.setCode(currentPass, translation); editor.show(currentPass, translation); $<HTMLDialogElement>('glsl-dialog').close(); await compile(); });
  bind('gpu-retry', () => location.reload());
  window.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void run(save); } });
  window.addEventListener('beforeunload', event => { if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { disposed = true; if (autoTimer) clearTimeout(autoTimer); disposeUI(); tutorial.dispose(); wgslPreview.destroy(); glslEditor.destroy(); editor.destroy(); void workspace.dispose(); void store.close(); }, { once: true });
  window.haiyueEditorHost?.onSaveAndClose(async () => { try { await save(); return !workspace.document.dirty; } catch { return false; } });
  try { saved = await store.list(); } catch (error) { notice(`无法读取 Gallery：${String(error)}。原有数据保留，可导入工程继续创作。`, true); }
  const initialRoute = location.hash.slice(1); renderGallery(); $('app').setAttribute('aria-busy', 'false');
  if (initialRoute === 'editor') await open(saved[0]?.project ?? createProject());
  else if (initialRoute === 'tutorial' || initialRoute.startsWith('tutorial/')) setRoute(initialRoute);
  else setRoute('gallery');
}
void run(start);
