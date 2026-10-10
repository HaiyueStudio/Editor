import { effectiveLocks } from './layerLocks.js';
import { archiveBytes, diskPager } from './diskPager.js';
import { storageInfo, spillState, serializeDiskProject, deserializeDiskProject } from './diskImage.js';
import { pagedState, pagedPixelStats, clearPagedPixelCache } from './pagedPixels.js';
import { applyIccPolicy,builtinIcc,ICC_PRESETS,iccDocumentInfo,type IccPreset } from './iccWorkflow.js';
import { initializeIcc } from './iccEngine.js';
import { embeddedProfile } from './colorManagement.js';
import { registerColorDomainOperations } from './cmykOperations.js';
import { registerIccOperations } from './iccOperations.js';
import { registerDepthOperations } from './depthOperations.js';
import { registerFoundationOperations } from './foundationOperations.js';
import { registerProductivityOperations } from './productivityOperations.js';
import { documentHistogram } from './histogram.js';
import { pixelJob } from './pixelJobs.js';
import { registerProfessionalOperations } from './professionalOperations.js';
import { registerDailyOperations } from './dailyOperations.js';
import type { EditorDisposable, EditorJsonValue, EditorOperationContext, EditorOperationSchema } from '@haiyue/editor-plugin-sdk';
import type { ImageWorkspace } from './workspace.js';
import { combineSelection, ellipseSelection, invertSelection, selectionCount, type SelectionMode } from './selection.js';
import { FILTERS, filterLayer, type FilterKind, type FilterSettings } from './filters.js';
import { BLEND_MODES } from './layerFeatures.js';
import { allLayers, makeLayer, ImageDocument, type ImageLayer } from './document.js';
import { deserializeProject, serializeProject } from './projectFile.js';

const empty = { type: 'object', properties: {} } as const;
const string = { type: 'string', minLength: 1, maxLength: 160 } as const;
type Params = { readonly [key: string]: EditorJsonValue };

export function registerImageOperations(workspace: ImageWorkspace): EditorDisposable {
  const platform = workspace.platform, owned: EditorDisposable[] = [];
  const doc = (context: EditorOperationContext) => {
    const found = workspace.documents.find(item => item.identity.id === context.document?.id);
    if (!found) throw new Error('Image document is unavailable.');
    return found;
  };
  function register<T>(id: string, input: EditorOperationSchema, access: 'read' | 'write',
    prepare: (params: Params, context: EditorOperationContext) => T | Promise<T>, commit: (value: T) => EditorJsonValue) {
    owned.push(workspace.registerOperation({ ownerId: 'image.operations',
      descriptor: { id: `image.${id}`, version: 1, title: id, target: 'document', documentKinds: ['haiyue.image'], access, input, output: { type: 'json' } },
      prepare, commit,
      // Document commits use runAtomic and return bounded, fixed JSON; all failures restore there.
      rollback() {},
    }));
  }
  owned.push(workspace.registerOperation({ ownerId: 'image.operations',
    descriptor: { id: 'image.document.open', version: 1, title: 'Open image project or PSD', target: 'workspace', access: 'write',
      input: { type: 'object', properties: { colorPolicy:{type:'string',enum:['preserve','assign','convert']},profileId:string,preset:{type:'string',enum:[...ICC_PRESETS]},resourceId: string, name: string, format: { type: 'string', enum: ['project', 'psd', 'png', 'jpeg'] } }, required: ['resourceId', 'name', 'format'] }, output: { type: 'json' } },
    async prepare(params: Params,context) {
      const bytes = platform.resources.read(params.resourceId as string);
      let state,spill=false;
      let warnings: string[] = [];let textDiagnostics:EditorJsonValue[]=[];
      if (params.format === 'psd') {
        const { importPsd } = await import('./psdAdapter.js');
        const {checkImportTextFonts}=await import('./textFonts.js');
        const result = await checkImportTextFonts(importPsd(bytes, params.name as string));
        if (!result.layered || result.blockers.length) throw new Error(result.blockers.join(' ') || 'PSD cannot be opened losslessly.');
        state = result.layered; warnings = result.warnings;textDiagnostics=JSON.parse(JSON.stringify(result.textDiagnostics));spill=result.memory.paged===true;
      } else if (params.format === 'png' || params.format === 'jpeg') {
        const { decodeImage, imageDocument } = await import('./imageImport.js');
        const imported = imageDocument(params.name as string, await decodeImage(new File([bytes.slice().buffer], params.name as string))); state = imported.state; imported.dispose();
      } else state = await deserializeDiskProject(new TextDecoder('utf-8', { fatal: true }).decode(bytes), true,context.signal);
      if(params.profileId&&params.preset)throw Error('profileId 与 preset 只能选一个。');
      const target=params.profileId?platform.resources.read(params.profileId as string):params.preset?builtinIcc(params.preset as IccPreset):undefined;
      if(target||embeddedProfile(state))await initializeIcc();context.signal.throwIfAborted();
      state=await applyIccPolicy(state,(params.colorPolicy??'preserve') as 'preserve'|'assign'|'convert',target,undefined,context.signal);
      if(!embeddedProfile(state))warnings.push(state.colorMode==='cmyk'?'未指定 CMYK ICC；预览为近似，RGB 工具编辑前需指定配置。':`未嵌入 ICC；按 ${state.bitDepth===32?'线性 sRGB':'sRGB'} 解释像素。`);
      if(spill&&typeof indexedDB!=='undefined')await spillState(state,context.signal);
      return { document: new ImageDocument(state, true), warnings,textDiagnostics, previousActiveId: null as string | null };
    },
    commit(prepared) {
      prepared.previousActiveId = workspace.active?.identity.id ?? null;
      workspace.add(prepared.document);
      return { documentId: prepared.document.identity.id, revision: prepared.document.revision, warnings: prepared.warnings,textDiagnostics:prepared.textDiagnostics };
    },
    async rollback(prepared) {
      if (!prepared) return;
      const { document, previousActiveId } = prepared;
      if (workspace.documents.includes(document)) {
        try { await workspace.close(document.identity.id); }
        finally { if (previousActiveId && workspace.documents.some(item => item.identity.id === previousActiveId)) workspace.activate(previousActiveId); }
      } else document.dispose();
    },
  }));
  owned.push(workspace.registerOperation({ ownerId: 'image.operations',
    descriptor: { id: 'image.document.create', version: 1, title: 'New image document', target: 'workspace', access: 'write', input: { type: 'object', properties: { name: string, width: { type: 'integer', minimum: 1, maximum: 8192 }, height: { type: 'integer', minimum: 1, maximum: 8192 }, white: { type: 'boolean' },bitDepth:{type:'integer',minimum:8,maximum:32} }, required: ['name', 'width', 'height'] }, output: { type: 'json' } },
    prepare(p: Params) { const document=ImageDocument.create(p.name as string,p.width as number,p.height as number,p.white===true);if(p.bitDepth)document.setDepth(p.bitDepth as 8|16|32);return { document, previousActiveId: workspace.active?.identity.id }; },
    commit(p) { workspace.add(p.document); return { documentId: p.document.identity.id, revision: p.document.revision }; },
    async rollback(p) { if (!p) return; if (workspace.documents.includes(p.document)) { try { await workspace.close(p.document.identity.id); } finally { if (p.previousActiveId && workspace.documents.some(d => d.identity.id === p.previousActiveId)) workspace.activate(p.previousActiveId); } } else p.document.dispose(); },
  }));
  register('document.query', empty, 'read', (_, context) => doc(context), document => ({
    name: document.state.name, width: document.state.width, height: document.state.height, dirty: document.dirty,
    selectedId: document.state.selectedId, selectedIds: [...document.selectedIds], canUndo: document.history.canUndo, canRedo: document.history.canRedo,
    selection: document.state.selection ? { x: document.state.selection.x, y: document.state.selection.y, width: document.state.selection.width, height: document.state.selection.height, pixels: selectionCount(document.state.selection) } : null,
    channels:(document.state.channels??[]).map(c=>({id:c.id,name:c.name,width:document.state.width,height:document.state.height})),layout:document.state.layout?JSON.parse(JSON.stringify(document.state.layout)):null,actions:JSON.parse(JSON.stringify(document.state.actions??[])),
    storage:{...storageInfo(document.state),sourcePsdBytes:archiveBytes(document.state),cache:pagedPixelStats()},colorProfile:iccDocumentInfo(document.state),icc:document.state.icc?{intent:document.state.icc.intent,bpc:document.state.icc.bpc,proofIntent:document.state.icc.proofIntent,gamutWarning:document.state.icc.gamutWarning,proofEnabled:iccDocumentInfo(document.state).proofEnabled,customMonitor:!!document.state.icc.monitorProfile}:null,colorMode:document.state.colorMode??'rgb',bitDepth:document.state.bitDepth??8,display:{exposure:document.state.display?.exposure??0,operator:document.state.display?.operator??'clip',output:document.state.display?.output??'sdr'}, layers: allLayers(document.state.layers).map(layer => ({ id: layer.id, name: layer.name, opacity: layer.opacity, visible: layer.visible, locked: layer.locked, locks: {...layer.locks}, effectiveLocks: {...effectiveLocks(document.state.layers,layer.id)}, parentId: allLayers(document.state.layers).find(parent => parent.children.some(child => child.id === layer.id))?.id ?? null, width: layer.bitmap?.width ?? null, height: layer.bitmap?.height ?? null, clipping: layer.clipping ?? false,smartFilters:layer.smartFilters?JSON.parse(JSON.stringify(layer.smartFilters)):null,blendIf:layer.blendIf?JSON.parse(JSON.stringify(layer.blendIf)):null,filterMask:layer.filterMask?{width:layer.filterMask.width,height:layer.filterMask.height,x:layer.filterMask.x,y:layer.filterMask.y,disabled:layer.filterMask.disabled,defaultColor:layer.filterMask.defaultColor,density:layer.filterMask.density??1,feather:layer.filterMask.feather??0}:null, styles: layer.styles ? JSON.parse(JSON.stringify(layer.styles)) : null, content: layer.content?.type==='smart' ? {type:'smart',name:layer.content.name,sourceId:layer.content.sourceId,sourceWidth:layer.content.source.width,sourceHeight:layer.content.source.height,multilayer:Boolean(layer.content.sourcePsd),sourceBytes:layer.content.sourcePsd?.byteLength??0,transform:{...layer.content.transform}} : layer.content ? JSON.parse(JSON.stringify(layer.content)) : null, mask: layer.mask ? { width: layer.mask.width, height: layer.mask.height, x: layer.mask.x, y: layer.mask.y, disabled: layer.mask.disabled, defaultColor: layer.mask.defaultColor,density:layer.mask.density??1,feather:layer.mask.feather??0 } : null, kind: layer.kind, x: layer.x, y: layer.y, passThrough:layer.passThrough??false,blend: layer.blend })),
  }));
  register('layer.opacity', { type: 'object', properties: { layerId: string, opacity: { type: 'number', minimum: 0, maximum: 1 } }, required: ['layerId', 'opacity'] }, 'write',
    (params, context) => ({ document: doc(context), layerId: params.layerId as string, opacity: params.opacity as number }),
    ({ document, layerId, opacity }) => document.runAtomic(() => { const revision = document.revision; document.updateLayer(layerId, { opacity }); return { applied: document.revision !== revision }; }));
  register('storage.trim',empty,'write',()=>null,()=>{diskPager.clear();clearPagedPixelCache();return {...diskPager.stats()};});
  register('storage.spill',empty,'write',async(_,context)=>{const d=doc(context);return await spillState(d.state,context.signal);},stats=>({...stats}));
  register('history.undo', empty, 'write', (_, context) => doc(context), document => document.runAtomic(() => ({ applied: document.history.undo() })));
  register('history.redo', empty, 'write', (_, context) => doc(context), document => document.runAtomic(() => ({ applied: document.history.redo() })));
  register('document.rename', { type: 'object', properties: { name: string }, required: ['name'] }, 'write',
    (params, context) => ({ document: doc(context), name: params.name as string }),
    ({ document, name }) => document.runAtomic(() => { document.rename(name); return { applied: true }; }));
  register('layer.create', { type: 'object', properties: { name: string, kind: { type: 'string', enum: ['pixel', 'group'] } }, required: ['name', 'kind'] }, 'write',
    (params, context) => ({ document: doc(context), layer: makeLayer(params.name as string, null, params.kind as 'pixel' | 'group') }),
    ({ document, layer }) => document.runAtomic(() => { document.addLayer(layer, false); return { layerId: layer.id }; }));
  register('layer.update', { type: 'object', properties: { layerId: string, patch: { type: 'object', properties: {
    passThrough:{type:'boolean'},name: string, visible: { type: 'boolean' }, locked: { type: 'boolean' }, locks: {type:'object',properties:{transparency:{type:'boolean'},pixels:{type:'boolean'},position:{type:'boolean'},artboards:{type:'boolean'}}}, opacity: { type: 'number', minimum: 0, maximum: 1 },
    blend: { type: 'string', enum: Object.keys(BLEND_MODES) }, x: { type: 'integer', minimum: -32768, maximum: 32768 }, y: { type: 'integer', minimum: -32768, maximum: 32768 },
  } } }, required: ['layerId', 'patch'] }, 'write',
    (params, context) => ({ document: doc(context), id: params.layerId as string, patch: params.patch as Partial<ImageLayer> }),
    ({ document, id, patch }) => document.runAtomic(() => { const revision = document.revision; document.updateLayer(id, patch); return { applied: revision !== document.revision }; }));
  register('histogram.query',{type:'object',properties:{layerId:string,selection:{type:'boolean'}}},'read',async(p,c)=>{const state=doc(c).state;return typeof Worker==='undefined'?documentHistogram(state,p.layerId as string|undefined,p.selection===true):await pixelJob<ReturnType<typeof documentHistogram>>({kind:'histogram',state,id:p.layerId,selectionOnly:p.selection===true},c.signal);},h=>({...h}));
  register('filters.query', empty, 'read', () => null, () => Object.entries(FILTERS).map(([kind, settings]) => ({ kind, ...settings })));
  register('filter.apply', { type: 'object', properties: { layerId: string, kind: { type: 'string', enum: Object.keys(FILTERS) }, amount: { type: 'number' },radius:{type:'number',minimum:0.1,maximum:32},threshold:{type:'integer',minimum:0,maximum:255} }, required: ['layerId', 'kind', 'amount'] }, 'write',
    async (params, context) => { const document = doc(context), id = params.layerId as string,settings={kind:params.kind,amount:params.amount,...(params.radius!==undefined?{radius:params.radius}:{}),...(params.threshold!==undefined?{threshold:params.threshold}:{})} as unknown as FilterSettings;
      return { document, id, layer: typeof Worker==='undefined'?filterLayer(document.state,id,settings):await pixelJob<ImageLayer>({kind:'filter',state:document.state,id,settings},context.signal) }; },
    ({ document, id, layer }) => document.runAtomic(() => { document.replaceLayerPixels(id, layer, 'API: filter'); return { applied: true }; }));
  const position = { type: 'integer', minimum: 0, maximum: 8191 } as const, dimension = { type: 'integer', minimum: 1, maximum: 8192 } as const;
  register('selection.set', { type: 'object', properties: { shape: { type: 'string', enum: ['rectangle', 'ellipse'] }, x: position, y: position, width: dimension, height: dimension, mode: { type: 'string', enum: ['replace', 'add', 'subtract', 'intersect'] } }, required: ['shape', 'x', 'y', 'width', 'height'] }, 'write',
    (params, context) => { const document = doc(context), rect = { x: params.x as number, y: params.y as number, width: params.width as number, height: params.height as number };
      if (rect.x + rect.width > document.state.width || rect.y + rect.height > document.state.height) throw new Error('Selection is outside the canvas.');
      return { document, selection: combineSelection(document.state.selection, params.shape === 'ellipse' ? ellipseSelection(rect) : rect, (params.mode ?? 'replace') as SelectionMode, document.state.width, document.state.height) }; },
    ({ document, selection }) => document.runAtomic(() => { document.setSelection(selection); return { applied: true }; }));
  register('selection.invert', empty, 'write', (_, context) => { const document = doc(context); return { document, selection: invertSelection(document.state.selection, document.state.width, document.state.height) }; },
    ({ document, selection }) => document.runAtomic(() => { document.setSelection(selection); return { applied: true }; }));
  register('selection.clear', empty, 'write', (_, context) => doc(context), document => document.runAtomic(() => { document.setSelection(null); return { applied: true }; }));
  register('document.crop', empty, 'write', (_, context) => doc(context), document => document.runAtomic(() => { document.cropToSelection(); return { applied: true }; }));
  register('document.export', { type: 'object', properties: { embedProfile:{type:'boolean'},format: { type: 'string', enum: ['project', 'psd', 'png', 'jpeg'] }, allowRasterize: { type: 'boolean' }, quality: { type: 'number', minimum: 0.1, maximum: 1 } }, required: ['format'] }, 'read',
    async (params, context) => {
      if(params.format==='project'&&params.embedProfile===false)throw Error('工程始终保留 ICC；请对 PSD／PNG／JPEG 设置嵌入选项。');
      const snapshot = structuredClone(doc(context).state);
      const bytes = params.format === 'psd'
        ? (await import('./psdAdapter.js')).exportPsd(snapshot, params.allowRasterize === true,params.embedProfile!==false).bytes
        : params.format === 'png' || params.format === 'jpeg' ? await (await import('./rasterExport.js')).exportRaster(snapshot, params.format, (params.quality ?? 0.92) as number,params.embedProfile!==false) : new TextEncoder().encode(await serializeDiskProject(snapshot,context.signal));
      return { bytes, format: params.format as string };
    }, ({ bytes, format }) => ({ ...platform.resources.put(bytes), format }));
  owned.push(registerColorDomainOperations(workspace),registerIccOperations(workspace), registerDepthOperations(workspace),registerFoundationOperations(workspace), registerDailyOperations(workspace), registerProfessionalOperations(workspace), registerProductivityOperations(workspace));
  return { async dispose() { await Promise.all(owned.map(item => item.dispose())); } };
}
