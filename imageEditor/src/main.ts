import { LayerCompsPanel } from './layerCompsPanel.js';
import { textDiagnosticMessage } from './textDiagnostics.js';
import { spillState, serializeDiskProject, deserializeDiskProject } from './diskImage.js';
import { withDiskPages } from './diskPager.js';
import { hasDiskPixels } from './pagedPixels.js';
import { HeaderMenus } from './headerMenus.js';
import { initializeEditorUI } from './editorUI.js';
import { isControlFocused } from './uiFocus.js';
import { iccDocumentInfo,applyIccPolicy,builtinIcc,type IccPreset } from './iccWorkflow.js';
import { CmykPanel } from './cmykPanel.js';
import { ColorPanel } from './colorPanel.js';
import { initializeIcc } from './iccEngine.js';
import { SmartSourcePanel } from './smartSourcePanel.js';
import { ProductivityPanel } from './productivityPanel.js';
import { LiveEffectsPanel } from './liveEffectsPanel.js';
import { HistogramPanel } from './histogramPanel.js';
import type { Resampling } from './resampling.js';
import { ProfessionalPanel } from './professionalPanel.js';
import { PathEditor } from './pathEditor.js';
import { NonDestructivePanel } from './nonDestructivePanel.js';
import { alignLayers, mergeLayers, type Alignment } from './dailyEditing.js';
import { psdExportWarnings, psdMetadataWarnings } from './psdExportPolicy.js';
import { AdvancedPanel } from './advancedPanel.js';
import { FilterPanel } from './filterPanel.js';
import { PsdJobs } from './psdJobs.js';
import type { PsdImportResult } from './psdAdapter.js';
import { parentOffset } from './pixelTools.js';
import { EditingTools } from './editingTools.js';
import type {} from '@haiyue/editor-app-kit';
import { allLayers, ImageDocument, layerLocked, makeLayer, type ImageLayer } from './document.js';
import { ImageWorkspace } from './workspace.js';
import { CanvasView, bitmapCanvas, bitmapThumbnail, paintThumbnail } from './canvasView.js';
import { createDemo, decodeImage, imageDocument, rasterForDocument } from './imageImport.js';
import { deserializeProject, MAX_PROJECT_BYTES, serializeProject } from './projectFile.js';
import { IndexedDbRecovery, RecoveryQueue } from './recovery.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const icon = (name: string) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg; };
const button = (title: string, symbol: string, action: () => void) => { const el = document.createElement('button'); el.title = title; el.setAttribute('aria-label', title); el.append(icon(symbol)); el.addEventListener('click', event => { event.stopPropagation(); action(); }); return el; };
const workspace = new ImageWorkspace();
Object.defineProperty(globalThis, 'haiyueEditor', { value: workspace.api, configurable: true });
workspace.platform.rpc.connect(window.haiyueEditorIPC);
const store = new IndexedDbRecovery(), recovery = new RecoveryQueue(store);
const lifecycle = new AbortController(), options = { signal: lifecycle.signal };
initializeEditorUI(lifecycle.signal);
let zoom = 1, renderPending = false, ready = false, disposed = false, importing = false;
let recoveryEnabled = true, recoveryTimer: ReturnType<typeof setTimeout> | undefined, recoveryGeneration = 0;
let releaseLease: (() => void) | undefined;
let pendingClose: ImageDocument | undefined;
let sessionSignature = '';
const view = new CanvasView($('viewport'), $('artboard'), $('image-canvas'), value => { zoom = value; $('zoom-label').textContent = `${Math.round(value * 100)}%`; });

$('viewport').addEventListener('image-painted',()=>{const doc=workspace.active;if(!doc)return;const canvas=$<HTMLCanvasElement>('navigator-canvas'),ctx=canvas.getContext('2d')!,ratio=Math.min(220/doc.state.width,112/doc.state.height);ctx.clearRect(0,0,240,130);ctx.drawImage(view.displayCanvas,(240-doc.state.width*ratio)/2,(130-doc.state.height*ratio)/2,doc.state.width*ratio,doc.state.height*ratio);});
$('viewport').addEventListener('image-render-error',event=>notice((event as CustomEvent).detail,true));
const psdJobs = new PsdJobs((busy, label) => { $('psd-progress').hidden = !busy; $('psd-progress-label').textContent = label; });
let choosePsd: ((state: import('./document.js').ImageState | null) => void) | undefined;
let pendingPsd: PsdImportResult | undefined;
const editing = new EditingTools(() => workspace.active, view, notice);
const layerCompsPanel=new LayerCompsPanel(()=>workspace.active,notice);
const paths=new PathEditor(()=>workspace.active,view,editing,notice);
const professional=new ProfessionalPanel(workspace,notice);
const colorPanel=new ColorPanel(workspace,notice);
const cmykPanel=new CmykPanel(()=>workspace.active,()=>{editing.setMaskEditing(false);editing.fill();},notice);
const advanced = new AdvancedPanel(() => workspace.active, editing);
const nonDestructive = new NonDestructivePanel(() => workspace.active, view, notice);
const smartSourcePanel = new SmartSourcePanel(workspace,notice);

function notice(message: string, error = false) { $('notice-text').textContent = message; $('notice').hidden = false; $('notice').classList.toggle('error', error); }
async function run(action: () => unknown | Promise<unknown>,scope:unknown=workspace.active?.selected) { try { await withDiskPages(scope,action); } catch (error) { notice(error instanceof Error ? error.message : String(error), true); } }
function recoveryStatus(message: string, error = false) { $('recovery-status').textContent = message; $('recovery-status').title = message; $('recovery-status').classList.toggle('error', error); $('recovery-retry').hidden = !error || !recoveryEnabled; }
async function flushRecovery() {
  if (recoveryTimer) clearTimeout(recoveryTimer); recoveryTimer = undefined;
  if (!ready || !recoveryEnabled || disposed) return;
  const generation = ++recoveryGeneration;
  try {
    const session = workspace.session();if(session.version===2)for(const item of session.documents)if(hasDiskPixels(item.state))await spillState(item.state);await recovery.write(session);
    if (generation === recoveryGeneration && !disposed) recoveryStatus(workspace.documents.length ? '恢复副本已存到此浏览器' : '本地恢复已就绪');
  } catch (error) {
    recoveryStatus('自动恢复保存失败，请下载工程副本', true);
    throw error;
  }
}
function changed() {
  if (disposed) return;
  if (!renderPending) { renderPending = true; queueMicrotask(() => { renderPending = false; if (!disposed) void run(render,[]); }); }
  const signature = JSON.stringify([workspace.active?.identity.id, ...workspace.documents.map(doc => [doc.identity.id, doc.revision, doc.savedRevision, doc.state.selectedId, doc.selectedIds])]);
  if (signature === sessionSignature) return; sessionSignature = signature;
  if (ready && recoveryEnabled) {
    recoveryStatus('正在保存恢复副本…');
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => { void run(flushRecovery); }, 350);
  }
  window.haiyueEditorHost?.updateDocumentState({ dirty: workspace.dirty, name: workspace.documents.filter(doc => doc.dirty).map(doc => doc.identity.name).join('、'), locale: 'zh-CN' });
}
function property(id: string, value: string, disabled: boolean) {
  const input = $<HTMLInputElement | HTMLSelectElement>(id);
  if (document.activeElement !== input) input.value = value; input.disabled = disabled;
}
function render() {
  const doc = workspace.active, selected = doc?.selected;
  $('welcome').hidden = Boolean(doc);
  for (const element of document.querySelectorAll<HTMLButtonElement>('[data-needs-document]')) element.toggleAttribute('disabled', !doc);
  for (const element of document.querySelectorAll<HTMLButtonElement>('[data-needs-layer]')) element.toggleAttribute('disabled', !selected || Boolean(doc && layerLocked(doc.state.layers, selected.id)));
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-action=undo]')) el.toggleAttribute('disabled', !doc?.history.canUndo);
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-action=redo]')) el.toggleAttribute('disabled', !doc?.history.canRedo);
  const tabs = $('document-tabs'); tabs.replaceChildren();
  for (const item of workspace.documents) {
    const wrapper = document.createElement('div'); wrapper.className = 'document-tab' + (item === doc ? ' active' : ''); wrapper.dataset.documentId = item.identity.id;
    const select = document.createElement('button'); select.textContent = item.identity.name + (item.dirty ? ' •' : ''); select.title = item.identity.name;
    select.setAttribute('role', 'tab'); select.setAttribute('aria-selected', String(item === doc)); select.tabIndex = item === doc ? 0 : -1;
    select.onclick = () => workspace.activate(item.identity.id);
    select.onkeydown = event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); const docs = workspace.documents, next = docs[(docs.indexOf(item) + (event.key === 'ArrowRight' ? 1 : docs.length - 1)) % docs.length]!;
      workspace.activate(next.identity.id); queueMicrotask(() => $('document-tabs').querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus());
    };
    const close = button(`关闭 ${item.identity.name}`, 'close', () => requestClose(item)); close.className = 'tab-close'; wrapper.append(select, close); tabs.append(wrapper);
  }
  const list = $('layer-list'); list.replaceChildren();
  const drawRows = (layers: readonly ImageLayer[], depth: number) => {
    for (const layer of [...layers].reverse()) {
      const row = document.createElement('div'); row.className = 'layer-row' + (doc?.selectedIds.includes(layer.id) ? ' selected' : '') + (!layer.visible ? ' invisible' : '');
      row.dataset.layerId = layer.id; row.style.paddingLeft = `${depth * 12}px`; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(depth + 1)); row.setAttribute('aria-selected', String(doc?.selectedIds.includes(layer.id) ?? false));
      row.tabIndex = layer.id === doc?.state.selectedId ? 0 : -1;
      row.onclick = event => {
        if (!doc) return;
        if (event.shiftKey && doc.state.selectedId) {
          const ids = [...list.querySelectorAll<HTMLElement>('[data-layer-id]')].map(row => row.dataset.layerId!);
          const a = ids.indexOf(doc.state.selectedId), b = ids.indexOf(layer.id); doc.selectMany(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
        } else if (event.metaKey || event.ctrlKey) doc.selectMany(doc.selectedIds.includes(layer.id) ? doc.selectedIds.filter(id => id !== layer.id) : [...doc.selectedIds, layer.id]);
        else doc.select(layer.id);
      };
      row.onkeydown = event => {
        if (event.target !== row) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); doc?.select(layer.id); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); const rows = [...list.querySelectorAll<HTMLElement>('[role=treeitem]')], next = rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
          if (next) { doc?.select(next.dataset.layerId!); queueMicrotask(() => Array.from(list.querySelectorAll<HTMLElement>('[data-layer-id]')).find(row => row.dataset.layerId === next.dataset.layerId)?.focus()); }
        }
      };
      const eye = button(`${layer.visible ? '隐藏' : '显示'} ${layer.name}`, 'eye', () => { void run(() => doc?.updateLayer(layer.id, { visible: !layer.visible })); }); eye.className = 'layer-eye' + (layer.visible ? '' : ' off'); eye.setAttribute('aria-pressed', String(layer.visible));
      const thumb = document.createElement('span'); thumb.className = 'layer-thumb';
      if (layer.kind === 'group') thumb.append(icon('folder'));
      else if (layer.bitmap) {
        const canvas = document.createElement('canvas'); canvas.width = 62; canvas.height = 62; const ratio = Math.min(62 / layer.bitmap.width, 62 / layer.bitmap.height);
        canvas.dataset.thumbnail='loading';void paintThumbnail(canvas,layer.bitmap).then(()=>{canvas.dataset.thumbnail='ready';}).catch(error=>{canvas.dataset.thumbnail='error';canvas.title=String(error);});thumb.append(canvas);
      }
      const title = document.createElement('span'); title.className = 'layer-title'; title.textContent = (layer.clipping?'↳ ':'') + layer.name + (layer.content?.type==='smart'?' ◈':'') + (layer.styles?.enabled?' · fx':''); title.title = layer.name;
      const partial=Object.values(layer.locks??{}).some(Boolean);
      const lock = button(`${layer.locked ? '解锁' : '锁定'} ${layer.name}`, 'lock', () => { void run(() => doc?.updateLayer(layer.id, { locked: !layer.locked })); }); lock.className = 'layer-lock' + (layer.locked ? ' locked' : ''); lock.setAttribute('aria-pressed', String(layer.locked));if(partial){lock.classList.add('partial');lock.title='部分锁定：'+[layer.locks?.transparency?'透明像素':'',layer.locks?.pixels?'像素编辑':'',layer.locks?.position?'位置':'',layer.locks?.artboards?'画板自动嵌套':''].filter(Boolean).join('、')+'；在图层面板调整';}
      row.append(eye, thumb, title, lock); list.append(row); drawRows(layer.children, depth + 1);
    }
  };
  if (doc) drawRows(doc.state.layers, 0);
  if (!list.childElementCount) { const empty = document.createElement('p'); empty.className = 'empty-layers'; empty.textContent = doc ? '还没有图层。点击 + 新建，或导入一张图片。' : '打开文档后，在这里管理图层。'; list.append(empty); }
  const locked = !selected || Boolean(doc && layerLocked(doc.state.layers, selected.id));
  property('layer-name', selected?.name ?? '', locked); property('opacity', String(Math.round((selected?.opacity ?? 1) * 100)), locked);
  property('blend-mode', selected?.blend ?? 'normal', locked);
  const positionLocked=!selected||!!doc&&layerLocked(doc.state.layers,selected.id,'position');
  for(const key of ['all','transparency','pixels','position'] as const){const input=$<HTMLInputElement>('lock-'+key);input.checked=key==='all'?!!selected?.locked:!!selected?.locks?.[key];input.disabled=!selected||key!=='all'&&!!selected.locked;}
  property('layer-x', String(selected?.x ?? 0), positionLocked || selected?.kind === 'group'); property('layer-y', String(selected?.y ?? 0), positionLocked || selected?.kind === 'group');
  $('layer-kind').textContent = selected ? selected.kind === 'group' ? '图层组' : selected.content?.type==='smart'?'智能对象':selected.content?.type==='text'?'可编辑文字':selected.content?.type==='shape'?'可编辑形状':selected.kind==='adjustment'?'调整图层':'像素图层' : '—';
  $('layer-size').textContent = selected?.bitmap ? `${selected.bitmap.width} × ${selected.bitmap.height} px` : selected?.kind === 'group' ? `${selected.children.length} 个子图层` : '透明图层';
  $('layer-count').textContent = `${doc ? allLayers(doc.state.layers).length : 0} 个图层 · 已选 ${doc?.selectedIds.length ?? 0}`;
  $('document-info').textContent = doc ? `${doc.state.width} × ${doc.state.height} px   /   ${(doc.state.colorMode??'rgb').toUpperCase()} · ${doc.state.bitDepth??8} 位 · ${iccDocumentInfo(doc.state).working?.name??(doc.state.colorMode==='cmyk'?'未标记 ICC · 近似预览':'未标记 ICC')}${doc.state.bitDepth===32?' 线性 HDR':''}${doc.dirty ? '   /   工程副本未保存' : ''}` : '准备就绪';
  $('navigator-size').textContent = doc ? `${doc.state.width} × ${doc.state.height}` : '—'; $('navigator-empty').hidden = Boolean(doc);
  view.setDocument(doc?.state); productivity.sync(); cmykPanel.sync(); colorPanel.sync(); editing.sync(); headerMenus.update(Boolean(doc), Boolean(doc?.state.selection)); advanced.sync(); nonDestructive.sync(); paths.sync(); layerCompsPanel.sync();
  const navigator = $<HTMLCanvasElement>('navigator-canvas'), ctx = navigator.getContext('2d')!; ctx.clearRect(0, 0, 240, 130);
  if (doc) { const ratio = Math.min(220 / doc.state.width, 112 / doc.state.height); ctx.drawImage(view.displayCanvas, (240 - doc.state.width * ratio) / 2, (130 - doc.state.height * ratio) / 2, doc.state.width * ratio, doc.state.height * ratio); }
}

const downloadUrls = new Set<string>();
function download(content: Blob, name: string) {
  const url = URL.createObjectURL(content), link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); downloadUrls.add(url);
  setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 30_000);
}
async function save(doc = workspace.active) {
  if (!doc) return false;
  editing.cancel();
  const revision = doc.revision, source = await serializeDiskProject(doc.state);
  const blob = new Blob([source], { type: 'application/json' }), name = doc.identity.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.hyimage';
  const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }> }).showSaveFilePicker;
  if (picker) {
    try { const handle = await picker({ suggestedName: name, types: [{ description: '海月图像工程', accept: { 'application/json': ['.hyimage'] } }] });
      const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
    } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return false; throw error; }
  } else {
    download(blob, name);
    // Finish durable browser recovery before marking the download fallback as saved.
    await flushRecovery();
  }
  doc.markSaved(revision); notice(picker ? '工程副本已保存，可通过“打开”继续编辑。' : '工程副本已发起下载，可通过“打开”继续编辑。'); return true;
}
async function close(doc: ImageDocument) { view.forget(doc.identity.id); await workspace.close(doc.identity.id); await flushRecovery(); }
function requestClose(doc: ImageDocument) {
  if (!doc.dirty) { void run(() => close(doc)); return; }
  pendingClose = doc; $('close-message').textContent = `“${doc.identity.name}” 的改动尚未保存到工程文件。`; $<HTMLDialogElement>('close-dialog').showModal();
}
async function openFiles(files: readonly File[], asLayer: boolean) {
  if (importing) throw new Error('正在导入文件，请稍候。');
  const target = asLayer ? workspace.active : undefined;
  if (asLayer && !target) throw new Error('请先创建或打开一个文档。');
  importing = true;
  try {
    for (const file of files) {
      if (/\.(psd|psb)$/i.test(file.name)) {
        if (asLayer) throw new Error('PSD 请使用“打开”，以保留文档图层。');
        if (file.size > 128 * 1024 * 1024) throw new Error('PSD 文件超过 128 MiB 限制。');
        const result = await psdJobs.import(new Uint8Array(await file.arrayBuffer()), file.name, true);
        if (disposed) return;
        const preview = $<HTMLCanvasElement>('psd-import-preview'), context = preview.getContext('2d')!;
        context.clearRect(0,0,preview.width,preview.height); preview.hidden = !result.flattened;
        const bitmap = result.flattened?.layers[0]?.bitmap;
        if (bitmap) { const scale = Math.min(320 / bitmap.width,180 / bitmap.height); context.drawImage(bitmapCanvas(bitmap),(320-bitmap.width*scale)/2,(180-bitmap.height*scale)/2,bitmap.width*scale,bitmap.height*scale); }
        pendingPsd = result; const colorSource=result.layered??result.flattened;$('psd-color-summary').textContent=colorSource?(()=>{const info=iccDocumentInfo(colorSource);return info.working?`源 ICC：${info.working.name} · ${info.reason||'默认保留原配置'}`:info.colorMode==='cmyk'?'源文档未标记 CMYK 配置；预览为近似，转换前需先指定源配置。':'源文档未嵌入 ICC；默认保留未标记状态，转换时按 sRGB（32 位按线性 sRGB）解释。';})():'';$<HTMLSelectElement>('psd-color-policy').value='preserve';$<HTMLSelectElement>('psd-color-preset').value='srgb';$<HTMLInputElement>('psd-color-file').value=''; $('psd-source-name').textContent = result.sourceName;
        $('psd-import-summary').textContent = result.layered ? (result.warnings.length?`可以分层编辑，有 ${result.warnings.length} 项内容需留意。`:'可以分层编辑，未发现已知兼容问题。') : result.memory.compositeOnly ? (result.flattened ? '分层解码超出内存预算，可打开合并图副本。' : '分层解码超出内存预算，原件也没有可用的合并图。') : '包含未支持的特性，无法安全地分层编辑。';
        const textIssues=result.textDiagnostics.filter(d=>d.issues.length),textMessages=new Set(textIssues.map(textDiagnosticMessage)),otherWarnings=result.warnings.filter(w=>!textMessages.has(w));
        $('psd-import-details').textContent=[...(result.blockers.length?['无法分层编辑：',...result.blockers]:[]),...(otherWarnings.length?['编辑／导出时需留意：',...otherWarnings]:[])].join('\n');$('psd-import-details').hidden=!result.blockers.length&&!otherWarnings.length;
        const textDetails=$<HTMLDetailsElement>('psd-text-details');textDetails.hidden=!textIssues.length;textDetails.open=false;$('psd-text-summary').textContent=`文字检查：${result.textDiagnostics.length} 层，${textIssues.length} 层有具体限制（修改文字时生效）`;$('psd-text-issues').textContent=textIssues.map(textDiagnosticMessage).join('\n\n');$('psd-import-notes').textContent=result.notes.join('\n');
        $<HTMLButtonElement>('psd-import-layers').disabled = !result.layered;
        $<HTMLButtonElement>('psd-import-flat').disabled = !result.flattened;
        const choice = new Promise<import('./document.js').ImageState | null>(resolve => { choosePsd = resolve; });
        $<HTMLDialogElement>('psd-import-dialog').showModal();
        const state = await choice; if (disposed) return;
        if (!state) { notice('已取消 PSD 导入，当前文档未改变。'); return; }
        if(result.memory.paged)await spillState(state);workspace.add(new ImageDocument(state));
      } else if (/\.hyimage$/i.test(file.name)) {
        if (asLayer) throw new Error('工程文件请使用“打开”。');
        if (file.size > MAX_PROJECT_BYTES) throw new Error('工程文件过大。');
        const state = await deserializeDiskProject(await file.text(), true); if (disposed) return; workspace.add(new ImageDocument(state, true));
      } else {
        const bitmap = await decodeImage(file); if (disposed) return;
        const name = file.name.replace(/\.[^.]+$/, '').slice(0, 160) || '导入图片';
        if (target) {
          if (!workspace.documents.includes(target)) throw new Error('目标文档已关闭，已取消图片导入。');
          const selected = target.selected, offset = selected ? parentOffset(target.state.layers, selected.id)! : { x: 0, y: 0 };
          if (selected?.kind === 'group') { offset.x += selected.x; offset.y += selected.y; }
          target.addLayer({ ...makeLayer(name, rasterForDocument(bitmap,target.state)), x: Math.round((target.state.width - bitmap.width) / 2) - offset.x, y: Math.round((target.state.height - bitmap.height) / 2) - offset.y });
        } else workspace.add(imageDocument(name, bitmap));
      }
    }
    notice(asLayer ? '图片已按原始尺寸导入为图层。' : `已打开 ${files.length} 个文件。`);
  } finally { importing = false; }
}
function newDialog() { $('new-error').textContent = ''; $<HTMLDialogElement>('new-dialog').showModal(); $<HTMLInputElement>('new-name').select(); }
function selectedChange(patch: Parameters<ImageDocument['updateLayer']>[1]) { const doc = workspace.active; if (doc?.selected) doc.updateLayer(doc.selected.id, patch); }
const productivity=new ProductivityPanel(workspace);
const histogram=new HistogramPanel(()=>workspace.active);
const liveEffects=new LiveEffectsPanel(()=>workspace.active,editing);
const filters = new FilterPanel(() => workspace.active, notice);
const actions: Record<string, () => unknown | Promise<unknown>> = {
  productivity:()=>{editing.cancel();productivity.open();},
  'refine-selection':()=>professional.open('refine'), 'color-management':()=>colorPanel.open(), batch:()=>professional.open('batch'), 'path-new':()=>paths.start(), 'path-apply':()=>paths.apply(), 'path-cancel':()=>paths.cancel(), 'path-closed':()=>paths.toggleClosed(),
  clipping: () => nonDestructive.clipping(), 'layer-styles': () => nonDestructive.openStyles(), 'smart-convert': () => nonDestructive.convert(), 'smart-replace': () => nonDestructive.chooseSource(),
  'copy-pixels': () => editing.copy(), 'paste-pixels': () => editing.paste(), 'free-transform': () => editing.startTransform(),
  'merge-layers': async () => { const doc = workspace.active; if (doc) await withDiskPages(doc.state,()=>mergeLayers(doc, doc.selectedIds)); },
  'align-layers': () => { const doc = workspace.active; if (doc) alignLayers(doc, doc.selectedIds, $<HTMLSelectElement>('align-kind').value as Alignment, $<HTMLSelectElement>('align-target').value as 'selection' | 'canvas'); },
  'retry-recovery': flushRecovery,
  'smart-filters':()=>liveEffects.open('filters'),'mask-properties':()=>liveEffects.open('mask'),'blend-if':()=>liveEffects.open('blend'),
  histogram:()=>histogram.open(),
  filters: () => filters.open(), 'invert-selection':()=>editing.invert(), 'select-color':()=>editing.selectColor(), feather:()=>editing.modify('feather'), 'expand-selection':()=>editing.modify('expand'), 'contract-selection':()=>editing.modify('contract'),
  'export-psd': () => { editing.cancel(); const warnings=workspace.active?[...psdExportWarnings(workspace.active.state),...psdMetadataWarnings(workspace.active.state)]:[]; $('psd-export-losses').textContent=warnings.join('\n');$('psd-export-consent-row').hidden=!warnings.length;$<HTMLInputElement>('psd-export-consent').checked=false;$<HTMLButtonElement>('psd-export-confirm').disabled=Boolean(warnings.length);$<HTMLDialogElement>('psd-export-dialog').showModal(); },
  'select-all': () => editing.selectAll(), deselect: () => editing.deselect(), fill: () => editing.fill(), clear: () => editing.fill(true), crop: () => withDiskPages(workspace.active?.state,()=>editing.crop()),
  transform: () => {
    editing.cancel(); const layer = workspace.active?.selected; if (!layer?.bitmap) throw new Error('请选择含像素的图层。');
    $<HTMLInputElement>('transform-width').value = String(layer.bitmap.width); $<HTMLInputElement>('transform-height').value = String(layer.bitmap.height);
    $<HTMLInputElement>('transform-angle').value = '0'; $<HTMLInputElement>('flip-x').checked = $<HTMLInputElement>('flip-y').checked = false;
    $<HTMLSelectElement>('transform-resampling').value=$<HTMLSelectElement>('resampling-method').value;
    $('transform-error').textContent = ''; $<HTMLDialogElement>('transform-dialog').showModal();
  },
  text: () => advanced.openText(), shape: () => advanced.openShape(), adjustment: () => advanced.openAdjustment(), 'edit-content': () => workspace.active?.selected?.content?.type==='path'?paths.start(true):advanced.editContent(), rasterize: () => workspace.active?.rasterizeSelected(),
  'mask-add': () => advanced.mask('add'), 'mask-invert': () => advanced.mask('invert'), 'mask-toggle': () => advanced.mask('toggle'), 'mask-apply': () => advanced.mask('apply'), 'mask-remove': () => advanced.mask('remove'), 'mask-paint': () => advanced.mask('paint'), 'mask-pixels': () => advanced.mask('pixels'),
  export: () => { editing.cancel(); $('export-error').textContent = ''; $<HTMLDialogElement>('export-dialog').showModal(); },
  new: newDialog, open: () => $<HTMLInputElement>('open-input').click(), import: () => $<HTMLInputElement>('import-input').click(),
  demo: () => workspace.add(createDemo()), save, undo: () => workspace.active?.history.undo(), redo: () => workspace.active?.history.redo(),
  fit: () => view.fit(), actual: () => view.zoom(1), 'zoom-in': () => view.zoom(zoom * 1.25), 'zoom-out': () => view.zoom(zoom / 1.25),
  'add-layer': () => workspace.active?.addLayer(makeLayer('新图层')), 'add-group': () => workspace.active?.addLayer(makeLayer('新图层组', null, 'group')),
  duplicate: () => workspace.active?.duplicateSelected(), delete: () => workspace.active?.deleteSelected(), 'delete-selection': () => workspace.active?.state.selection ? editing.fill(true) : workspace.active?.deleteSelected(), up: () => workspace.active?.reorder(1), down: () => workspace.active?.reorder(-1),
  'rename-document': () => { if (workspace.active) { $<HTMLInputElement>('document-name').value = workspace.active.identity.name; $<HTMLDialogElement>('rename-dialog').showModal(); } },
};
const headerMenus = new HeaderMenus(action => { editing.cancel(); void run(actions[action]!); }, lifecycle.signal);
document.addEventListener('click', event => {
  const action = (event.target as Element).closest<HTMLButtonElement>('[data-action]');
  if (action && !action.hasAttribute('disabled')) { editing.cancel(); void run(actions[action.dataset.action!.replace(/^menu-/,'')]!); }
  if ((event.target as Element).closest('[data-close-dialog]')) (event.target as Element).closest('dialog')?.close();
}, options);
for (const [id, submit] of [
  ['transform', () => editing.transform(Number($<HTMLInputElement>('transform-width').value), Number($<HTMLInputElement>('transform-height').value), Number($<HTMLInputElement>('transform-angle').value), $<HTMLInputElement>('flip-x').checked, $<HTMLInputElement>('flip-y').checked,$<HTMLSelectElement>('transform-resampling').value as Resampling)],
  ['text', () => advanced.submit('text')], ['shape', () => advanced.submit('shape')], ['adjustment', () => advanced.submit('adjustment')],
  ['export', async () => {
    const doc = workspace.active; if (!doc) return;
    const format = $<HTMLSelectElement>('export-format').value as 'png' | 'jpeg';
    const blob = await editing.export(format, Number($<HTMLInputElement>('export-quality').value) / 100,$<HTMLInputElement>('export-icc').checked);
    download(blob, doc.identity.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + (format === 'png' ? '.png' : '.jpg'));
    notice('图片已导出，图层仍保留在工程中。');
  }],
] as const) $(id + '-form').addEventListener('submit', event => {
  event.preventDefault(); void (async () => {
    try { await submit(); $<HTMLDialogElement>(id + '-dialog').close(); }
    catch (error) { $(id + '-error').textContent = error instanceof Error ? error.message : String(error); }
  })();
}, options);
$('psd-cancel').addEventListener('click', () => psdJobs.cancel(), options);
function finishPsdImport(mode: 'layered' | 'flattened' | null) {
  const resolve = choosePsd; choosePsd = undefined;
  const state = mode ? pendingPsd?.[mode] ?? null : null; pendingPsd = undefined;
  $<HTMLDialogElement>('psd-import-dialog').close(); resolve?.(state);
}
async function acceptPsdImport(mode:'layered'|'flattened'){
 const pending=pendingPsd,state=pending?.[mode];if(!state)return;const policy=$<HTMLSelectElement>('psd-color-policy').value as 'preserve'|'assign'|'convert',preset=$<HTMLSelectElement>('psd-color-preset').value;
 let profile:Uint8Array|undefined;if(policy!=='preserve'){if(preset==='file'){const file=$<HTMLInputElement>('psd-color-file').files?.[0];if(!file||file.size>4*1024*1024)throw Error('请选择 4 MiB 以内的目标 ICC。');profile=new Uint8Array(await file.arrayBuffer());}else profile=builtinIcc(preset as IccPreset);}
 const result=await applyIccPolicy(state,policy,profile);if(pendingPsd!==pending||disposed)return;pendingPsd={...pending!,[mode]:result};finishPsdImport(mode);
}
for (const [id, mode] of [['psd-import-layers','layered'],['psd-import-flat','flattened'],['psd-import-cancel',null]] as const)
  $(id).addEventListener('click', () => {if(mode===null)finishPsdImport(null);else void acceptPsdImport(mode).catch(error=>{$('psd-color-summary').textContent=error instanceof Error?error.message:String(error);});}, options);
$('psd-import-dialog').addEventListener('cancel', () => finishPsdImport(null), options);
$('psd-export-consent').addEventListener('change',()=>{$<HTMLButtonElement>('psd-export-confirm').disabled=!$<HTMLInputElement>('psd-export-consent').checked;},options);
$('psd-export-confirm').addEventListener('click', () => { void run(async () => {
  const doc = workspace.active; if (!doc) return;
  const state = doc.state; $<HTMLDialogElement>('psd-export-dialog').close();
  const result = await psdJobs.export(state,$<HTMLInputElement>('psd-export-consent').checked,$<HTMLInputElement>('psd-export-icc').checked); if (disposed) return;
  download(new Blob([new Uint8Array(result.bytes)], { type: 'image/vnd.adobe.photoshop' }), state.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.edited.psd');
  notice(doc.revision === state.revision ? 'PSD 兼容副本已导出，图层像素和合成透明度自检通过。' : '已导出开始时的文档快照；之后的改动尚未包含在此 PSD 副本中。');
}); }, options);
$('dismiss-notice').addEventListener('click', () => { $('notice').hidden = true; }, options);
$('new-form').addEventListener('submit', event => {
  event.preventDefault();
  try { workspace.add(ImageDocument.create($<HTMLInputElement>('new-name').value.trim(), Number($<HTMLInputElement>('new-width').value), Number($<HTMLInputElement>('new-height').value), $<HTMLSelectElement>('new-background').value === 'white')); $<HTMLDialogElement>('new-dialog').close(); }
  catch (error) { $('new-error').textContent = error instanceof Error ? error.message : String(error); }
}, options);
$('rename-form').addEventListener('submit', event => { event.preventDefault(); void run(() => { workspace.active?.rename($<HTMLInputElement>('document-name').value); $<HTMLDialogElement>('rename-dialog').close(); }); }, options);
for (const [id, action] of [['close-cancel', 'cancel'], ['close-discard', 'discard'], ['close-save', 'save']] as const) {
  $(id).addEventListener('click', () => { void run(async () => {
    const doc = pendingClose; if (!doc) return;
    if (action === 'save' && !await save(doc)) return;
    if (action !== 'cancel') await close(doc);
    $<HTMLDialogElement>('close-dialog').close(); pendingClose = undefined;
  }); }, options);
}
$('close-dialog').addEventListener('cancel', () => { pendingClose = undefined; }, options);
for (const [id, asLayer] of [['open-input', false], ['import-input', true]] as const) $<HTMLInputElement>(id).addEventListener('change', event => {
  const input = event.target as HTMLInputElement, files = [...input.files ?? []]; input.value = ''; if (files.length) void run(() => openFiles(files, asLayer));
}, options);
for (const [id, patch] of [ ['layer-name', (value: string) => ({ name: value.trim() })], ['opacity', (value: string) => ({ opacity: Number(value) / 100 })],
  ['blend-mode', (value: string) => ({ blend: value as ImageLayer['blend'] })], ['layer-x', (value: string) => ({ x: Number(value) })], ['layer-y', (value: string) => ({ y: Number(value) })] ] as const) {
  $(id).addEventListener('change', event => { void run(() => selectedChange(patch((event.target as HTMLInputElement).value)),[]).finally(changed); }, options);
}
for(const key of ['all','transparency','pixels','position'] as const){$('lock-'+key).addEventListener('change',event=>{const checked=(event.target as HTMLInputElement).checked;void run(()=>{const doc=workspace.active,layer=doc?.selected;if(layer)doc!.updateLayer(layer.id,key==='all'?{locked:checked}:{locks:{...layer.locks,[key]:checked}});},[]).finally(changed);},options);}
let dragDepth = 0;
window.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); }, options);
$('viewport').addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; } }, options);
$('viewport').addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } }, options);
window.addEventListener('drop', event => {
  if (!event.dataTransfer?.files.length) return; event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  void run(() => openFiles([...event.dataTransfer!.files], false));
}, options);
window.addEventListener('beforeunload', event => { if (recoveryTimer) void run(flushRecovery); if (workspace.dirty) { event.preventDefault(); event.returnValue = ''; } }, options);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void run(flushRecovery); }, options);

async function acquireRecoveryLease() {
  if (!navigator.locks) { recoveryEnabled = false; recoveryStatus('此浏览器无法锁定恢复会话，请保存工程副本', true); return; }
  await new Promise<void>((resolve, reject) => {
    void navigator.locks.request('haiyue.image-editor.recovery', { ifAvailable: true }, async lock => {
      if (!lock) { recoveryEnabled = false; recoveryStatus('另一窗口正在保存恢复副本，本窗口请保存工程文件', true); resolve(); return; }
      await new Promise<void>(release => { releaseLease = release; resolve(); });
    }).catch(reject);
  });
}
async function start() {
  await initializeIcc(); await workspace.start(); await acquireRecoveryLease();
  try { const count = workspace.restore(await store.load()); if (recoveryEnabled) recoveryStatus(count ? `已恢复 ${count} 个文档` : '本地恢复已就绪'); }
  catch (error) { recoveryEnabled = false; recoveryStatus('自动恢复不可用，请保存工程副本', true); notice('未覆盖原恢复数据：' + (error instanceof Error ? error.message : String(error)), true); }
  const canShortcut = () => !editing.busy && !paths.busy && !document.querySelector('dialog[open]') && !isControlFocused();
  for (const [chord, action] of [['Mod+Shift+I', 'invert-selection'], ['Mod+A', 'select-all'], ['Mod+D', 'deselect'], ['Mod+N', 'new'], ['Mod+O', 'open'], ['Mod+S', 'save'], ['Mod+Z', 'undo'], ['Mod+Shift+Z', 'redo'], ['Mod+Y', 'redo'], ['Mod+0', 'fit'], ['Mod+1', 'actual'], ['Delete', 'delete-selection'], ['Backspace', 'delete-selection']] as const)
    workspace.shell.shortcuts.register({ id: `image.${chord}`, ownerId: 'image.core', chord, when: canShortcut, handler: () => run(actions[action]!) });
  workspace.shell.shortcuts.attach(window);
  const releaseClose = window.haiyueEditorHost?.onSaveAndClose(async () => {
    try { for (const doc of workspace.documents.filter(doc => doc.dirty)) if (!await save(doc)) return false; await flushRecovery(); return !workspace.dirty; }
    catch (error) { notice(String(error), true); return false; }
  });
  workspace.subscribe(changed); ready = true; $('app').setAttribute('aria-busy', 'false'); changed();
  window.addEventListener('pagehide', event => { if (!event.persisted) { disposed = true; ready = false; for (const url of downloadUrls) URL.revokeObjectURL(url); downloadUrls.clear(); clearTimeout(recoveryTimer); psdJobs.cancel(); finishPsdImport(null); lifecycle.abort(); filters.dispose(); productivity.dispose(); liveEffects.dispose(); histogram.dispose(); advanced.dispose(); nonDestructive.dispose(); smartSourcePanel.dispose(); paths.dispose(); professional.dispose();colorPanel.dispose(); cmykPanel.dispose(); editing.dispose(); view.dispose(); releaseClose?.(); void recovery.dispose().finally(() => releaseLease?.()); void workspace.dispose(); } }, { once: true });
}
void start().catch(error => { $('app').setAttribute('aria-busy', 'false'); notice('启动失败：' + String(error), true); });
