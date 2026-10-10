import { CmykStroke,fillCmyk } from './cmykEditing.js';
import { initializeIcc,profileInfo } from './iccEngine.js';
import { sampleHex,exportPixelResource, importPixelResource } from './pixelFormat.js';
import { validateSmartFilters, validateBlendIf, filterStackBitmap, primeFilterStack, type SmartFilter, type BlendIf } from './liveEffects.js';
import { FILTERS } from './filters.js';
import { BLEND_MODES } from './layerFeatures.js';
import { pixelJob } from './pixelJobs.js';
import type { Bitmap } from './document.js';
import { RESAMPLING } from './resampling.js';
import { convertSmart, replaceSmart } from './smartObject.js';
import type { LayerStyles } from './layerFeatures.js';
import type { EditorOperationContext, EditorDisposable, EditorJsonValue, EditorOperationSchema } from '@haiyue/editor-plugin-sdk';
import type { ImageWorkspace } from './workspace.js';
import { findLayer, layerLocked, checkSize, makeLayer, type ImageDocument } from './document.js';
import { alignLayers, copyPixels, pastePixels, sampleColor, sampleBitmap, gradientPixels, mergeLayers, moveLayers, type Alignment } from './dailyEditing.js';
import { transformedLayer, commitTransform, type TransformValues } from './freeTransform.js';
import { combineSelection, polygonSelection, colorSelection, modifySelection, type SelectionMode } from './selection.js';
import { PixelStroke, fillPixels, hexColor, type Point } from './pixelTools.js';
import { maskFromSelection, maskFromStroke, maskStrokeState } from './maskTools.js';
import { validateContent, type LayerContent } from './layerFeatures.js';

type Params = { readonly [key: string]: EditorJsonValue };
const string = { type: 'string', minLength: 1, maxLength: 160 } as const;
const color = { type: 'string', minLength: 7, maxLength: 7 } as const;
const coordinate = { type: 'integer', minimum: -32768, maximum: 32768 } as const;
const dimension = { type: 'integer', minimum: 1, maximum: 8192 } as const;
const opacity = { type: 'number', minimum: 0.01, maximum: 1 } as const;
const point = { type: 'object', properties: { x: coordinate, y: coordinate }, required: ['x', 'y'] } as const;
const points = { type: 'array', items: point, maxItems: 8192 } as const;
const ids = { type: 'array', items: string, maxItems: 128 } as const;
const mode = { type: 'string', enum: ['replace', 'add', 'subtract', 'intersect'] } as const;
const content: EditorOperationSchema = { type: 'object', properties: {
  type: { type: 'string', enum: ['text', 'shape', 'adjustment', 'path'] }, text: { type: 'string', minLength: 1, maxLength: 2000 }, size: { type: 'number', minimum: 6, maximum: 512 }, family: { type: 'string', enum: ['sans-serif', 'serif', 'monospace'] }, bold: { type: 'boolean' }, italic: { type: 'boolean' }, align: { type: 'string', enum: ['left', 'center', 'right'] }, color,
  shape: { type: 'string', enum: ['rectangle', 'ellipse', 'line'] }, width: dimension, height: dimension, radius: { type: 'number', minimum: 0, maximum: 4096 }, fill: {type:'json'}, stroke: color, strokeAlignment:{type:'string',enum:['center','inside']},strokeWidth: { type: 'number', minimum: 0, maximum: 512 },
  filter: { type: 'string', enum: ['brightness', 'contrast', 'saturation', 'hue', 'grayscale', 'invert', 'levels', 'curves'] }, amount: { type: 'integer', minimum: -180, maximum: 180 },
  levels: { type:'object', properties:{black:{type:'integer',minimum:0,maximum:253},white:{type:'integer',minimum:2,maximum:255},gamma:{type:'number',minimum:0.1,maximum:9.99},outputBlack:{type:'integer',minimum:0,maximum:255},outputWhite:{type:'integer',minimum:0,maximum:255}},required:['black','white','gamma','outputBlack','outputWhite'] },
  curves: {type:'array',maxItems:16,items:{type:'object',properties:{input:{type:'integer',minimum:0,maximum:255},output:{type:'integer',minimum:0,maximum:255}},required:['input','output']}},
  channels:{type:'object',properties:Object.fromEntries(['red','green','blue'].map(k=>[k,{type:'object',properties:{levels:{ type:'object', properties:{black:{type:'integer',minimum:0,maximum:253},white:{type:'integer',minimum:2,maximum:255},gamma:{type:'number',minimum:0.1,maximum:9.99},outputBlack:{type:'integer',minimum:0,maximum:255},outputWhite:{type:'integer',minimum:0,maximum:255}},required:['black','white','gamma','outputBlack','outputWhite'] },curves:{type:'array',maxItems:16,items:{type:'object',properties:{input:{type:'integer',minimum:0,maximum:255},output:{type:'integer',minimum:0,maximum:255}},required:['input','output']}}}}]))},
  layout:{type:'object',properties:{transform:{type:'array',maxItems:4,items:{type:'number',minimum:-100,maximum:100}},box:{type:'array',maxItems:4,items:{type:'number',minimum:-8192,maximum:8192}},...Object.fromEntries(['firstLineIndent','startIndent','endIndent','spaceBefore','spaceAfter'].map(k=>[k,{type:'number',minimum:-8192,maximum:8192} as EditorOperationSchema])),scaleX:{type:'number',minimum:0.001,maximum:100},scaleY:{type:'number',minimum:0.001,maximum:100},tracking:{type:'number',minimum:-10000,maximum:10000},x:{type:'number',minimum:-8192,maximum:8192},y:{type:'number',minimum:-8192,maximum:8192},leading:{type:'number',minimum:0,maximum:8192},width:{type:'integer',minimum:1,maximum:8192},height:{type:'integer',minimum:1,maximum:8192}},required:['x','y','leading','width','height']},fontName: {type:'string',maxLength:120},wrapWidth:{type:'integer',minimum:16,maximum:8192},runs:{type:'array',maxItems:128,items:{type:'object',properties:{start:{type:'integer',minimum:0,maximum:2000},end:{type:'integer',minimum:1,maximum:2000},size:{type:'number',minimum:6,maximum:512},family:{type:'string',enum:['sans-serif','serif','monospace']},fontName:{type:'string',maxLength:120},color,bold:{type:'boolean'},italic:{type:'boolean'},underline:{type:'boolean'}},required:['start','end']}},
  closed:{type:'boolean'},fillRule:{type:'string',enum:['nonzero','evenodd']},nodes:{type:'array',maxItems:256,items:{type:'object',properties:Object.fromEntries(['x','y','inX','inY','outX','outY'].map(k=>[k,{type:'number',minimum:-32768,maximum:32768}])),required:['x','y','inX','inY','outX','outY']}},
}, required: ['type'] };
export function registerDailyOperations(workspace: ImageWorkspace): EditorDisposable {
  const owned: EditorDisposable[] = [], platform = workspace.platform;
  function register(id: string, properties: Record<string, EditorOperationSchema>, required: string[], prepare: (p: Params, d: ImageDocument, context:EditorOperationContext) => (() => EditorJsonValue) | Promise<() => EditorJsonValue>, access: 'read' | 'write' = 'write') {
    owned.push(workspace.registerOperation({ ownerId: 'image.operations', descriptor: { id: `image.${id}`, version: 1, title: id, target: 'document', documentKinds: ['haiyue.image'], access, input: { type: 'object', properties, required }, output: { type: 'json' } },
      async prepare(p: Params, context) { const d = workspace.documents.find(d => d.identity.id === context.document?.id); if (!d) throw new Error('文档已关闭。'); return { d, apply: await prepare(p,d,context) }; },
      commit: ({ d, apply }) => access === 'write' ? d.runAtomic(apply) : apply(), rollback() {},
    }));
  }
  const done = (action: () => unknown) => () => { action(); return { applied: true }; };
  register('layer.clipping', {layerId:string,enabled:{type:'boolean'}}, ['layerId','enabled'], (p,d)=>done(()=>d.setClipping(p.layerId as string,p.enabled as boolean)));
  const effect={color,opacity:{type:'number',minimum:0,maximum:1}} as const;
  register('layer.styles',{layerId:string,remove:{type:'boolean'},styles:{type:'object',properties:{enabled:{type:'boolean'},innerGlow:{type:'object',properties:{...effect,size:{type:'number',minimum:0,maximum:64},choke:{type:'number',minimum:0,maximum:100},noise:{type:'number',minimum:0,maximum:1},range:{type:'number',minimum:0.0001,maximum:1},source:{type:'string',enum:['edge','center']},blend:{type:'string',enum:['normal','screen']}},required:['color','opacity','size','choke','noise','range','source','blend']},overlay:{type:'object',properties:effect,required:['color','opacity']},stroke:{type:'object',properties:{...effect,size:{type:'integer',minimum:1,maximum:64}},required:['color','opacity','size']},shadow:{type:'object',properties:{...effect,dx:{type:'number',minimum:-256,maximum:256},dy:{type:'number',minimum:-256,maximum:256},blur:{type:'integer',minimum:0,maximum:64}},required:['color','opacity','dx','dy','blur']}},required:['enabled']}},['layerId'],(p,d)=>{
    if(p.remove===true&&p.styles||p.remove!==true&&!p.styles)throw new Error('请提供样式，或指定 remove。');
    return done(()=>d.setStyles(p.layerId as string,p.remove===true?undefined:p.styles as unknown as LayerStyles));
  });
  register('smart.convert',{layerId:string},['layerId'],(p,d)=>done(()=>convertSmart(d,p.layerId as string)));
  register('smart.source',{layerId:string},['layerId'],(p,d)=>{const c=findLayer(d.state.layers,p.layerId as string)?.content;if(c?.type!=='smart')throw new Error('请选择智能对象。');const source=c.source;const out=exportPixelResource(source);return ()=>({...platform.resources.put(out.bytes),format:out.format,width:source.width,height:source.height,name:c.name});},'read');
  register('smart.replace',{layerId:string,resourceId:string,width:dimension,height:dimension,name:string},['layerId','resourceId','width','height','name'],(p,d)=>{
    const width=p.width as number,height=p.height as number;checkSize(width,height);const bytes=platform.resources.read(p.resourceId as string);if(bytes.length!==width*height*4)throw new Error('智能对象源 RGBA8 长度不匹配。');const source={width,height,data:new Uint8ClampedArray(bytes)};
    return done(()=>replaceSmart(d,p.layerId as string,source,p.name as string));
  });
  register('layers.select', { layerIds: ids }, ['layerIds'], (p, d) => done(() => d.selectMany(p.layerIds as string[])));
  register('layers.align', { layerIds: ids, alignment: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] }, relativeTo: { type: 'string', enum: ['selection', 'canvas'] } }, ['layerIds', 'alignment'], (p, d) => done(() => alignLayers(d, p.layerIds as string[], p.alignment as Alignment, p.relativeTo as 'selection' | 'canvas' | undefined)));
  register('layers.move', { layerIds: ids, dx: coordinate, dy: coordinate }, ['layerIds', 'dx', 'dy'], (p, d) => done(() => moveLayers(d, p.layerIds as string[], p.dx as number, p.dy as number)));
  register('layers.merge', { layerIds: ids }, ['layerIds'], (p, d) => () => ({ layerId: mergeLayers(d, p.layerIds as string[]) }));
  for (const action of ['delete', 'duplicate', 'rasterize', 'mask.apply'] as const) register(`layer.${action}`, { layerId: string }, ['layerId'], (p, d) => done(() => {
    d.select(p.layerId as string);
    if (action === 'delete') d.deleteSelected(); else if (action === 'duplicate') d.duplicateSelected(); else if (action === 'rasterize') d.rasterizeSelected(); else d.applySelectedMask();
  }));
  register('layer.reorder', { layerId: string, direction: { type: 'string', enum: ['up', 'down'] } }, ['layerId', 'direction'], (p, d) => done(() => { d.select(p.layerId as string); d.reorder(p.direction === 'up' ? 1 : -1); }));
  register('layer.transform', { layerId: string, width: dimension, height: dimension, angle: { type: 'number', minimum: -360, maximum: 360 }, dx: coordinate, dy: coordinate, flipX: { type: 'boolean' }, flipY: { type: 'boolean' },resampling:{type:'string',enum:Object.keys(RESAMPLING)} }, ['layerId', 'width', 'height'], (p, d) => {
    const layer = transformedLayer(d.state, p.layerId as string, { angle: 0, dx: 0, dy: 0, ...p } as unknown as TransformValues);
    return done(() => commitTransform(d, layer, 'API: transform'));
  });
  register('color.sample', { x: coordinate, y: coordinate, layerId: string }, ['x', 'y'], (p, d) => { const rgba = sampleColor(d.state, p.x as number, p.y as number, p.layerId as string | undefined); return () => ({ rgba, hex: sampleHex(rgba,d.state) }); }, 'read');
  register('pixels.copy', { layerId: string }, [], (p, d) => {
    const copy = copyPixels(d.state, p.layerId as string | undefined);
    const out=exportPixelResource(copy.bitmap);return () => ({ ...platform.resources.put(out.bytes), format:out.format, width: copy.bitmap.width, height: copy.bitmap.height, x: copy.x, y: copy.y });
  }, 'read');
  register('pixels.paste', { sourceProfileId:string,format:{type:'string',enum:['rgba8','rgba16le','rgba32fle','cmyka32fle']},resourceId: string, width: dimension, height: dimension, x: coordinate, y: coordinate, name: string }, ['resourceId', 'width', 'height'], async (p, d) => {
    const width = p.width as number, height = p.height as number; checkSize(width, height);
    const bytes = platform.resources.read(p.resourceId as string);
    if(p.format==='cmyka32fle'&&d.state.colorMode!=='cmyk')throw Error('原生油墨资源请粘贴到 CMYK 文档。');
    const profile=p.sourceProfileId?platform.resources.read(p.sourceProfileId as string):undefined;
    if(profile){if(p.format==='cmyka32fle')throw Error('原生 CMYK 粘贴保留油墨数值；sourceProfileId 仅用于 RGBA 资源。');await initializeIcc();if(profileInfo(profile).space!=='RGB')throw Error('RGBA 剪贴板需要 RGB 源 ICC。');}
    const copy = { bitmap: importPixelResource(bytes,width,height,(p.format??'rgba8') as string), x: (p.x ?? 0) as number, y: (p.y ?? 0) as number,...(profile?{profile}:{}) };
    return () => ({ layerId: pastePixels(d, copy, p.name as string | undefined) });
  });
  register('pixels.gradient', { layerId: string, start: point, end: point, from: color, to: color, kind: { type: 'string', enum: ['linear', 'radial'] }, opacity }, ['layerId', 'start', 'end', 'from', 'to', 'kind'], (p, d) => {
    const layer = gradientPixels(d.state, p.layerId as string, p.start as unknown as Point, p.end as unknown as Point, hexColor(p.from as string), hexColor(p.to as string), p.kind as 'linear' | 'radial', (p.opacity ?? 1) as number);
    return done(() => d.replaceLayerPixels(layer.id, layer, 'API: gradient'));
  });
  for (const action of ['fill', 'stroke'] as const) register(`pixels.${action}`, { layerId: string, color, opacity, erase: { type: 'boolean' }, target: { type: 'string', enum: ['pixels', 'mask', 'filterMask'] }, points:{type:'array',maxItems:8192,items:{type:'object',properties:{x:coordinate,y:coordinate,pressure:{type:'number',minimum:0,maximum:1}},required:['x','y']}}, hardness:{type:'number',minimum:0,maximum:1},pressure:{type:'string',enum:['none','size','opacity','both']},size: { type: 'number', minimum: 1, maximum: 512 } }, ['layerId', ...(action === 'stroke' ? ['points', 'size'] : [])], (p, d) => {
    const maskTarget=p.target==='filterMask'?'filter':'layer',isMask=p.target==='mask'||p.target==='filterMask';
    const id = p.layerId as string, original = findLayer(d.state.layers, id); if (!original) throw new Error('图层不存在。');
    const state = isMask ? maskStrokeState(d.state,id,maskTarget) : d.state, tone = p.erase && isMask ? [0, 0, 0] as const : hexColor((p.color ?? '#000000') as string), erase = p.erase === true && !isMask;
    let layer,damage:{x:number;y:number;width:number;height:number}|undefined;
    if(!isMask&&state.colorMode==='cmyk'&&erase){const settings={ink:[0,0,0,0],erase:true,opacity:(p.opacity??1) as number};if(action==='fill')layer=fillCmyk(state,id,settings);else{const path=p.points as unknown as Point[];if(!path.length)throw Error('笔画至少需要一个点。');const stroke=new CmykStroke(state,id,p.size as number,settings,{hardness:(p.hardness??1) as number,pressure:(p.pressure??'none') as 'none'});for(const point of path)stroke.point(point);layer=stroke.layer;}}
    else if (action === 'fill') layer = fillPixels(state, id, erase ? null : tone, (p.opacity ?? 1) as number);
    else { const path = p.points as unknown as Point[]; if (!path.length) throw new Error('笔画至少需要一个点。'); const stroke = new PixelStroke(state, id, p.size as number, (p.opacity ?? 1) as number, tone, erase,{hardness:(p.hardness??1) as number,pressure:(p.pressure??'none') as 'none'}); for (const point of path) stroke.point(point); layer = stroke.layer;damage=stroke.changedBounds; }
    return done(() => isMask ? d.setMask(id,maskFromStroke(original,layer,maskTarget),maskTarget) : d.replaceLayerPixels(id, layer, `API: ${action}`,d.revision,damage));
  });
  register('selection.all', {}, [], (_, d) => done(() => d.setSelection({ x: 0, y: 0, width: d.state.width, height: d.state.height })));
  register('selection.polygon', { points, mode }, ['points'], (p, d) => {
    const selected = polygonSelection(p.points as unknown as Point[], d.state.width, d.state.height);
    return done(() => d.setSelection(combineSelection(d.state.selection, selected, (p.mode ?? 'replace') as SelectionMode, d.state.width, d.state.height)));
  });
  register('selection.color', { color, tolerance: { type: 'number', minimum: 0, maximum: 255 }, seed: point, layerId: string, mode }, ['color', 'tolerance'], (p, d) => {
    const selected = colorSelection(sampleBitmap(d.state, p.layerId as string | undefined), hexColor(p.color as string), p.tolerance as number, p.seed as unknown as Point | undefined);
    return done(() => d.setSelection(combineSelection(d.state.selection, selected, (p.mode ?? 'replace') as SelectionMode, d.state.width, d.state.height)));
  });
  register('selection.wand', { x: coordinate, y: coordinate, tolerance: { type: 'number', minimum: 0, maximum: 255 }, contiguous: { type: 'boolean' }, layerId: string, mode }, ['x', 'y', 'tolerance'], (p, d) => {
    const x = p.x as number, y = p.y as number, source = sampleBitmap(d.state, p.layerId as string | undefined);
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) throw new Error('取样坐标超出画布。');
    const at = (y * source.width + x) * 4, rgba = Array.from(source.data.subarray(at, at + 4)) as [number, number, number, number];
    const selected = colorSelection(source, rgba, p.tolerance as number, p.contiguous === false ? undefined : { x, y });
    return done(() => d.setSelection(combineSelection(d.state.selection, selected, (p.mode ?? 'replace') as SelectionMode, d.state.width, d.state.height)));
  });
  register('selection.modify', { kind: { type: 'string', enum: ['feather', 'expand', 'contract'] }, radius: { type: 'integer', minimum: 1, maximum: 64 } }, ['kind', 'radius'], (p, d) => {
    if (!d.state.selection) throw new Error('请先创建选区。'); const selection = modifySelection(d.state.selection, d.state.width, d.state.height, p.kind as 'feather' | 'expand' | 'contract', p.radius as number);
    return done(() => d.setSelection(selection));
  });
  for (const action of ['create', 'update'] as const) register(`content.${action}`, { layerId: string, name: string, content, x: coordinate, y: coordinate }, ['content', ...(action === 'update' ? ['layerId'] : ['name'])], async (p, d) => {
    const value = p.content as unknown as LayerContent; validateContent(value);
    const bitmap = value.type === 'adjustment' ? null : value.type === 'smart' ? (()=>{throw new Error('请使用智能对象命令。');})() : (await import('./contentRaster.js')).rasterContent(value);
    const layer = { ...makeLayer((p.name ?? '内容图层') as string, bitmap), kind: value.type === 'adjustment' ? 'adjustment' as const : 'pixel' as const, content: value, x: (p.x ?? 0) as number, y: (p.y ?? 0) as number };
    return () => { if (action === 'create') d.addLayer(layer, false); else d.setContent(p.layerId as string, value, bitmap); return { layerId: action === 'create' ? layer.id : p.layerId! }; };
  });
  register('mask.update', { layerId: string,target:{type:'string',enum:['layer','filter']}, action: { type: 'string', enum: ['fromSelection', 'invert', 'enable', 'disable', 'remove'] } }, ['layerId', 'action'], (p, d) => {
    const id = p.layerId as string, layer = findLayer(d.state.layers, id); if (!layer) throw new Error('图层不存在。');
    const target=p.target==='filter'?'filter':'layer';let mask=target==='filter'?layer.filterMask:layer.mask;
    if (p.action === 'fromSelection') mask = maskFromSelection(d.state, id);
    else if (p.action === 'remove') mask = undefined;
    else { if (!mask) throw new Error('图层没有蒙版。'); mask = p.action === 'invert' ? { ...mask, data: mask.data.map(v => 255 - v), defaultColor: 255 - mask.defaultColor } : { ...mask, disabled: p.action === 'disable' }; }
    return done(() => d.setMask(id,mask,target));
  });
  const target={type:'string',enum:['layer','filter']} as const;
  register('mask.settings',{layerId:string,target,density:{type:'number',minimum:0,maximum:1},feather:{type:'number',minimum:0,maximum:64},disabled:{type:'boolean'}},['layerId'],(p,d)=>{
    const layer=findLayer(d.state.layers,p.layerId as string),where=p.target==='filter'?'filter':'layer',mask=where==='filter'?layer?.filterMask:layer?.mask;if(!mask)throw new Error('请先添加蒙版。');
    return done(()=>d.setMask(p.layerId as string,{...mask,...(p.density!==undefined?{density:p.density as number}:{}),...(p.feather!==undefined?{feather:p.feather as number}:{}),...(p.disabled!==undefined?{disabled:p.disabled as boolean}:{})},where));
  });
  const range={type:'array',maxItems:4,items:{type:'integer',minimum:0,maximum:255}} as const;
  register('layer.blend-if',{layerId:string,remove:{type:'boolean'},rule:{type:'object',properties:{enabled:{type:'boolean'},channel:{type:'string',enum:['gray','red','green','blue']},source:range,underlying:range},required:['enabled','channel','source','underlying']}},['layerId'],(p,d)=>{
    if(p.remove===true?!!p.rule:!p.rule)throw new Error('请提供 rule，或指定 remove。');const rule=p.rule as unknown as BlendIf;if(p.remove!==true)validateBlendIf(rule);return done(()=>d.setLiveEffects(p.layerId as string,{blendIf:p.remove===true?null:rule}));
  });
  register('smart.filters',{layerId:string,filters:{type:'array',maxItems:16,items:{type:'object',properties:{id:string,enabled:{type:'boolean'},opacity:{type:'number',minimum:0,maximum:1},blend:{type:'string',enum:Object.keys(BLEND_MODES)},settings:{type:'object',properties:{kind:{type:'string',enum:Object.keys(FILTERS)},amount:{type:'number'},radius:{type:'number',minimum:.1,maximum:32},threshold:{type:'integer',minimum:0,maximum:255}},required:['kind','amount']}},required:['id','enabled','opacity','blend','settings']}}},['layerId','filters'],async(p,d,context)=>{
    const layer=findLayer(d.state.layers,p.layerId as string),filters=p.filters as unknown as SmartFilter[];if(layer?.content?.type!=='smart'||!layer.bitmap)throw new Error('请选择智能对象。');if(layerLocked(d.state.layers,layer.id))throw new Error('图层已锁定。');validateSmartFilters(filters);
    const output=typeof Worker==='undefined'?filterStackBitmap(layer.bitmap,filters):await pixelJob<Bitmap>({kind:'stack',bitmap:layer.bitmap,filters},context.signal);
    return done(()=>{primeFilterStack(layer.bitmap!,filters,output);d.setLiveEffects(layer.id,{smartFilters:filters});});
  });
  register('layer.import', { resourceId: string, name: string, x: coordinate, y: coordinate }, ['resourceId', 'name'], async (p, d) => {
    const bytes = platform.resources.read(p.resourceId as string), bitmap = await (await import('./imageImport.js')).decodeImage(new File([bytes.slice().buffer], p.name as string));
    const converted=(await import('./imageImport.js')).rasterForDocument(bitmap,d.state);
    const layer = { ...makeLayer(p.name as string, converted), x: (p.x ?? 0) as number, y: (p.y ?? 0) as number };
    return () => { d.addLayer(layer, false); return { layerId: layer.id }; };
  });
  return { async dispose() { await Promise.all(owned.map(item => item.dispose())); } };
}
