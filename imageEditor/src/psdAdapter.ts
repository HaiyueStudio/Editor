import { exportLayerComps } from './layerComps.js';
import type { TextLayerDiagnostic } from './textDiagnostics.js';
import { readPsdLocks, writePsdLocks } from './layerLocks.js';
import { psdImportReport } from './psdImportReport.js';
import { hydrateArchive } from './diskPager.js';
import { importPagedPsd, layerIds, nativeContentKey, originalPsdLayers, retainedNativeFields } from './pagedPsd.js';
import { pagedBitmap, pixelStorageBytes } from './pagedPixels.js';
import { estimatePsdMemory, memoryMiB, type PsdMemoryEstimate } from './psdMemory.js';
import { readHighPsd, readPsdMetadata, writeHighPsd } from './highDepthPsd.js';
import { type BitDepth, withPixels } from './pixelFormat.js';
import { readBlendIf, writeBlendIf } from './psdLiveEffects.js';
import { normalizeExportedLevels } from './psdLevels.js';
import { nativeFields, readNativeContent, readStyles } from './psdNative.js';
import { type LayerContent, type LayerStyles } from './layerFeatures.js';
import { BLEND_MODES } from './layerFeatures.js';
import { compositeState } from './compositor.js';
import { psdExportWarnings, psdMetadataWarnings } from './psdExportPolicy.js';
import { readPsd, writePsdUint8Array, type Psd, type Layer, type PixelData } from 'ag-psd';
import { PsdAdmissionError, composite, editingDiagnostics, inspectHeader } from './psdPrototype.js';
import { checkSize, IMAGE_LIMITS, makeLayer, uid, validateState, type Bitmap, type ImageLayer, type ImageState } from './document.js';
import { preservePatternBlocks, validateCompositeBytes, rawCompositeData, additionalInfoKeys, concatBytes, DERIVED_RESOURCE_IDS, psdSections, resourceBlocks, type ResourceBlock } from './psdResources.js';

export interface PsdImportResult { layered: ImageState | null; flattened: ImageState | null; blockers: string[]; warnings: string[]; textDiagnostics:TextLayerDiagnostic[]; notes: string[]; sourceName: string; resourceIds: number[]; memory: PsdMemoryEstimate }
const allowedLayerKeys = new Set(['top','left','bottom','right','blendMode','opacity','clipping','transparencyProtected','hidden','blendingRanges','name','imageData','children','id','nameSource','version','sectionDivider','protected','layerColor','referencePoint','opened','timestamp','mask','linkGroup','linkGroupEnabled','text','vectorFill','vectorStroke','vectorMask','vectorOrigination','placedLayer','adjustment','effects','effectsOpen']);
const featureNames: Record<string,string> = { text:'可编辑文字', vectorFill:'矢量填充', vectorStroke:'矢量描边', vectorMask:'矢量蒙版', placedLayer:'智能对象', adjustment:'调整图层', effects:'图层效果', mask:'像素蒙版', realMask:'真实蒙版', clipping:'剪贴关系', 'blend-if':'混合颜色带', 'fill-opacity':'填充不透明度', 'blend-mode':'混合模式', 'pass-through-opacity':'穿透组不透明度' };
function pixels(image: PixelData) { const depth:BitDepth=image.data instanceof Float32Array?32:image.data instanceof Uint16Array?16:8; return {...withPixels(image.width,image.height,depth===8?new Uint8ClampedArray(image.data.buffer,image.data.byteOffset,image.data.byteLength):Float32Array.from(image.data,v=>depth===16?v/257:v*255),depth),...((image as unknown as Bitmap).cmyk?{cmyk:(image as unknown as Bitmap).cmyk!}:{})}; }
function checkedName(name: string | undefined, fallback: string) { return (name?.trim() || fallback).slice(0,160); }
export function importPsd(bytes: Uint8Array, fileName: string): PsdImportResult {
  let header: ReturnType<typeof inspectHeader>;
  try { header = inspectHeader(bytes,true,true); } catch (error) {
    const messages: Record<string,string> = { 'unsupported-version':'暂不支持 PSB；请使用 PSD 格式。', 'unsupported-depth':'支持 RGB 8、16、32 位 PSD。', 'unsupported-color-mode':'暂仅支持 RGB PSD，请先在原软件中转换颜色模式。', 'file-budget':'PSD 文件超过 128 MiB 限制。', 'invalid-signature':'文件不是有效 PSD。', 'truncated-header':'PSD 文件头截断。' };
    throw new Error(error instanceof PsdAdmissionError ? messages[error.code] ?? ('PSD 格式或尺寸无效：' + error.code) : String(error));
  }
  checkSize(header.width, header.height);
  if (header.channels > (header.mode===4?5:4)) throw new Error('暂不支持包含额外 Alpha/专色通道的 PSD。');
  if(header.depth===8&&header.mode!==4)validateCompositeBytes(bytes);
  const sections = psdSections(bytes), blocks = resourceBlocks(bytes.slice(sections.resources.data, sections.resources.end));
  const logs = new Set<string>(), options = { useImageData: true, useRawThumbnail: true, skipThumbnail: true, totalMemoryLimit: IMAGE_LIMITS.bytes,
    logMissingFeatures: true, log: (...args: unknown[]) => { logs.add(args.map(String).join(' ')); } };
  // Read geometry without expanding channels; over-budget layers never reach the decoder.
  const raw = readPsdMetadata(bytes, header.depth===8&&header.mode===3?options:undefined), memory = estimatePsdMemory(raw, bytes.byteLength, header.depth, header.mode===4);
  if (memory.compositePixelBytes > IMAGE_LIMITS.bytes) throw new Error(`PSD 合并图需要 ${memoryMiB(memory.compositePixelBytes)}，超过 ${memoryMiB(IMAGE_LIMITS.bytes)} 预算；请缩小画布或降低位深。`);
  const total = memory.estimatedDecodedBytes, compositeOnly = memory.compositeOnly;
  const infoKeys=additionalInfoKeys(bytes);
  // These native features already require the archive-backed path. Avoid decoding every
  // layer first only to discard those pixels when dense conversion cannot retain metadata.
  const prefersPaged=(ls:readonly Layer[]):boolean=>ls.some(l=>l.placedLayer?.type==='vector'||!!l.text?.textPath||!!l.usingAlignedRendering||l.blendMode==='pass through'||!!l.mask?.fromVectorData||prefersPaged(l.children??[]));
  if(header.depth===8&&header.mode===3&&(compositeOnly||!!raw.imageResources?.layerComps||prefersPaged(raw.children??[])||infoKeys.includes('hue2'))){
    let early:ImageState|undefined;
    const resources=concatBytes(blocks.filter(b=>!DERIVED_RESOURCE_IDS.has(b.id)).map(b=>b.bytes));
    try{early=importPagedPsd(bytes,fileName,resources,infoKeys);}catch{/* Keep the dense fallback and its detailed blockers for other encodings. */}
    if(early){
      let flattened:ImageState|null=null;
      if(raw.imageResources?.versionInfo?.hasRealMergedData!==false){const merged=readPsd(bytes,{...options,skipLayerImageData:true}).imageData;if(merged){flattened={id:uid(),name:early.name.slice(0,150)+' · 合并副本',width:early.width,height:early.height,layers:[makeLayer('PSD 合并图（已栅格化）',pixels(merged))],selectedId:null,revision:1,psdOrigin:{...early.psdOrigin!,flattened:true}};flattened={...flattened,selectedId:flattened.layers[0]!.id};validateState(flattened);}}
      memory.compositeOnly=false;memory.paged=true;const ids=blocks.map(b=>b.id);
      return {layered:early,flattened,blockers:[],...psdImportReport(raw,early,!!flattened,memory,ids,infoKeys),sourceName:fileName,resourceIds:ids,memory};
    }
  }
  const psd = compositeOnly&&raw.imageResources?.versionInfo?.hasRealMergedData===false ? raw : header.depth!==8||header.mode===4 ? readHighPsd(bytes,{metadata:raw,compositeOnly}) : readPsd(bytes,{...options,skipLayerImageData:compositeOnly});
  const blockers = compositeOnly
    ? [`PSD 分层解码预计需要 ${memoryMiB(total)}（图层 ${memoryMiB(memory.layerPixelBytes)}＋合并图 ${memoryMiB(memory.compositePixelBytes)}），超过 ${memoryMiB(IMAGE_LIMITS.bytes)} 预算。已跳过图层解码，仅尝试读取原件合并图；保留分层请先在源文件中精简图层。`]
    : editingDiagnostics(psd).filter(d=>!['mask','text','vectorFill','vectorStroke','vectorMask','placedLayer','adjustment','effects','clipping','blend-if'].includes(d.code)&&!(d.code==='blend-mode'&&Object.hasOwn(BLEND_MODES,d.detail.replaceAll(' ','-')))).map(d => `${d.path}：${featureNames[d.code] ?? d.code}${d.detail !== d.code ? ` (${d.detail})` : ''}`);
  const native=new Map<Layer,{content?:LayerContent;styles?:LayerStyles;blendIf?:NonNullable<ImageLayer['blendIf']>}>();
  let nativeBytes=total;
  const harmlessDefaults: Record<string, unknown> = { blendClippendElements: true, blendInteriorElements: false, knockout: false, fillOpacity: 1, transparencyShapesLayer: true };
  const visit = (layers: Layer[]) => { for (const layer of layers) {
    try {const blendIf=readBlendIf(layer),content=readNativeContent(layer,psd),styles=layer.effects?readStyles(layer.effects):undefined;if(content?.type==='smart'){nativeBytes+=content.source.data.byteLength+(content.sourcePsd?.byteLength??0);if(nativeBytes>IMAGE_LIMITS.bytes)throw new Error('智能对象源超过文档内存预算。');}native.set(layer,{...(blendIf?{blendIf}:{}),...(content?{content}:{}),...(styles?{styles}:{})});}catch(error){blockers.push(`${layer.name??'图层'}：${error instanceof Error?error.message:String(error)}`);}

    if(layer.mask){const mask=layer.mask;if(!mask.imageData||mask.fromVectorData||['vectorMaskDensity','vectorMaskFeather'].some(k=>(mask as unknown as Record<string,unknown>)[k]!==undefined))blockers.push(`${layer.name??'图层'}：不支持缺少像素、矢量派生或矢量参数蒙版`);}
    if (layer.children && layer.blendMode === 'pass through') blockers.push(`${layer.name ?? '图层组'}：穿透模式尚未支持`);
    let diagnostics:ReturnType<typeof editingDiagnostics>|undefined;
    for (const key of Object.keys(layer)) if (!allowedLayerKeys.has(key) && (layer as unknown as Record<string,unknown>)[key] !== harmlessDefaults[key] && !(diagnostics??=editingDiagnostics({ width:psd.width,height:psd.height,children:[layer] })).some(d=>d.code===key)) blockers.push(`${layer.name ?? '图层'}：未支持属性 ${key}`);
    if (layer.children) visit(layer.children);
  } }; if (!compositeOnly) visit(psd.children ?? []);
  if (logs.size) blockers.push(...[...logs].map(log => '解析器报告：' + log));
  for (const key of ['artboards','globalLayerMaskInfo','animations','timeline']) if ((psd as unknown as Record<string,unknown>)[key]) blockers.push('文档包含未支持内容：' + key);
  const supportedKeys = new Set(['Lr16','Lr32','Mt16','Mt32','luni','lyid','lnsr','lspf','lclr','fxrp','clbl','infx','knko','lsct','lsdk','shmd','FMsk','LMsk','Patt','Pat2','Pat3','TySh','vmsk','vsms','vscg','vstk','SoCo','vogk','hue2','levl','curv','nvrt','CgEd','SoLd','SoLE','PlLd','lnk2','lnkD','lfx2','lmfx','lrFX']);
  for (const key of infoKeys) if (!supportedKeys.has(key)) blockers.push('未支持的 PSD 附加信息块：' + key);
  if(!compositeOnly&&psd.linkedFiles?.some(file=>![...native.values()].some(n=>n.content?.type==='smart'&&n.content.sourceId===file.id)))blockers.push('包含未支持或未引用的嵌入／外链资源。');
  const ids = blocks.map(b=>b.id);
  const name = checkedName(fileName.replace(/\.psd$/i,''),'PSD 文档');
  const origin = { sourceName: checkedName(fileName,'PSD'), resources: concatBytes(blocks.filter(b=>!DERIVED_RESOURCE_IDS.has(b.id)).map(b=>b.bytes)), flattened: false };
  // Display metadata and presets also occur in dense 16/32-bit files. Keep their
  // native descriptors independently of pixel storage; never force them through RGB8 paging.
  const nativeIds=layerIds(psd), retainArchive=!!psd.userMask||infoKeys.some(k=>['Patt','Pat2','Pat3'].includes(k))||[...nativeIds.keys()].some(l=>l.effectsOpen!==undefined);
  const archive=retainArchive?new Uint8Array(bytes):undefined;
  const state = (layers: ImageLayer[], flattened = false): ImageState => ({ id:uid(),name:flattened?name.slice(0,150)+' · 合并副本':name,width:psd.width,height:psd.height,...(header.mode===4?{colorMode:'cmyk' as const}:{}),...(header.depth!==8?{bitDepth:header.depth as BitDepth}:{}),layers,selectedId:layers.at(-1)?.id??null,revision:1,psdOrigin:{...origin,flattened},...(!flattened&&archive?{psdArchive:archive}:{}) });
  const convert = (layer: Layer): ImageLayer => ({ ...makeLayer(checkedName(layer.name,'未命名图层'),layer.imageData&&!layer.children?pixels(layer.imageData):null,layer.children?'group':'pixel'),
    ...native.get(layer),...(archive?{nativePsd:{id:nativeIds.get(layer)!,contentKey:nativeContentKey(native.get(layer)?.content),stylesKey:JSON.stringify(native.get(layer)?.styles)??''}}:{}),kind:native.get(layer)?.content?.type==='adjustment'?'adjustment':layer.children?'group':'pixel',...(layer.clipping?{clipping:true}:{}),
    x:layer.children?0:layer.left??0,y:layer.children?0:layer.top??0,visible:!layer.hidden,...readPsdLocks(layer),opacity:layer.opacity??1,
    blend:(layer.blendMode??'normal').replaceAll(' ','-') as ImageLayer['blend'],...(layer.mask?.imageData?{mask:{width:layer.mask.imageData.width,height:layer.mask.imageData.height,x:(layer.mask.left??0)-(layer.mask.positionRelativeToLayer?0:layer.children?0:layer.left??0),y:(layer.mask.top??0)-(layer.mask.positionRelativeToLayer?0:layer.children?0:layer.top??0),...(header.depth!==8?{precision:'float32' as const}:{}),data:maskSamples(layer.mask.imageData,header.depth),...(layer.mask.userMaskDensity!==undefined?{density:layer.mask.userMaskDensity}:{}),...(layer.mask.userMaskFeather!==undefined?{feather:layer.mask.userMaskFeather}:{}),disabled:Boolean(layer.mask.disabled),defaultColor:layer.mask.defaultColor??0}}:{}),children:(layer.children??[]).map(convert) });
  let layered: ImageState | null = null, flattened: ImageState | null = null;
  if (!blockers.length) {
    layered = state(psd.children?.length ? psd.children.map(convert) : psd.imageData ? [makeLayer('背景',pixels(psd.imageData))] : []);
    try { validateState(layered); } catch(error) { blockers.push(String(error)); layered=null; }
  }
  if (psd.imageData && psd.imageResources?.versionInfo?.hasRealMergedData !== false) {
    flattened=state([makeLayer('PSD 合并图（已栅格化）',pixels(psd.imageData))],true); validateState(flattened);
  }
  if((compositeOnly||blockers.length)&&header.depth===8&&header.mode===3){try{layered=importPagedPsd(bytes,fileName,origin.resources,infoKeys);blockers.length=0;memory.compositeOnly=false;memory.paged=true;}catch(error){blockers.push('分块分层导入：'+(error instanceof Error?error.message:String(error)));}}
  const {warnings,notes,textDiagnostics}=psdImportReport(psd,layered,!!flattened,memory,ids,infoKeys);
  return { layered,flattened,blockers:[...new Set(blockers)],warnings,notes,textDiagnostics,sourceName:fileName,resourceIds:ids,memory };
}
function asPsd(state: ImageState): Psd {
  const archived=originalPsdLayers(state),linkedFiles:NonNullable<Psd['linkedFiles']>=[...(archived?.psd.linkedFiles??[])];
  const usedIds=new Set<number>();let nextId=Math.max(0,...(archived?[...archived.layers.keys()]:[]))+1;
  const fields=(layer:ImageLayer,x:number,y:number):Partial<Layer>=>{const original=archived?.layers.get(layer.nativePsd?.id??-1),kept=retainedNativeFields(layer,x,y,original,archived?.psd.linkedFiles),{content,...plain}=layer;const {rawData,children,imageData,text,placedLayer,effects,vectorMask,vectorFill,vectorStroke,adjustment,name,hidden,opacity,blendMode,left,top,right,bottom,protected:protection,transparencyProtected,clipping,blendingRanges,mask,...metadata}=original??{};if(archived||state.layerComps){let id=original?.id;if(id===undefined||usedIds.has(id))id=nextId++;usedIds.add(id);kept.id=id;}if(original?.vectorOrigination&&(!kept.vectorFill||x!==(original.left??0)||y!==(original.top??0)))delete metadata.vectorOrigination;return {...metadata,...nativeFields(kept.text||kept.placedLayer||kept.vectorFill?plain:layer,x,y,linkedFiles),...kept,...(layer.passThrough?{blendMode:'pass through' as const}:{})};};
  const convert = (layers: readonly ImageLayer[], x=0,y=0): Layer[] => layers.map(layer=>({name:layer.name,hidden:!layer.visible,opacity:Math.round(layer.opacity*255)/255,blendMode:layer.blend.replaceAll('-',' ') as Layer['blendMode'] & {},...fields(layer,x+layer.x,y+layer.y),...writeBlendIf(layer.blendIf),
    ...(layer.mask?{mask:{left:x+layer.x+layer.mask.x,top:y+layer.y+layer.mask.y,defaultColor:layer.mask.defaultColor,...(layer.mask.density!==undefined?{userMaskDensity:layer.mask.density}:{}),...(layer.mask.feather!==undefined?{userMaskFeather:layer.mask.feather}:{}),disabled:layer.mask.disabled,positionRelativeToLayer:false,...(layer.mask.vector?{fromVectorData:true}:{}),imageData:{width:layer.mask.width,height:layer.mask.height,data:maskRgba(layer.mask.data)}}}:{}),
    ...writePsdLocks(layer),
    ...(layer.kind==='group'?{children:convert(layer.children,x+layer.x,y+layer.y)}:{left:x+layer.x,top:y+layer.y,...(layer.bitmap?{imageData:layer.bitmap}:{})})}));
  const children=convert(state.layers),layerComps=exportLayerComps(state,children);
  const textRecords=(layers:Layer[]):unknown[]=>layers.flatMap(l=>[...(l.text?[{id:l.id,text:l.text}]:[]),...textRecords(l.children??[])]);
  const textChanged=archived&&JSON.stringify(textRecords(archived.psd.children??[]))!==JSON.stringify(textRecords(children));
  const result:Psd={ ...archived?.psd,name:state.name,width:state.width,height:state.height,children,...(linkedFiles.length?{linkedFiles}:{}),imageResources:{...(layerComps?{layerComps}:{}),versionInfo:{hasRealMergedData:true,writerName:'Haiyue Image Editor',readerName:'Haiyue Image Editor',fileVersion:1}} };
  if(textChanged)delete result.engineData;return result;
}
function sized(bytes: Uint8Array) { const prefix=new Uint8Array(4);new DataView(prefix.buffer).setUint32(0,bytes.length);return concatBytes([prefix,bytes]); }
export interface PsdExportResult { bytes: Uint8Array; maxStraightError: number; maxPremultipliedError: number; preservedResourceIds: number[] }
export function exportPsd(state: ImageState, allowRasterize = false,embedProfile=true): PsdExportResult {
  validateState(state);
  if(psdMetadataWarnings(state).length&&!allowRasterize)throw new Error('需要确认省略工程生产数据：'+psdMetadataWarnings(state).join(' '));
  if(psdExportWarnings(state).length&&!allowRasterize)throw new Error('此导出需要确认栅格化或合并：'+psdExportWarnings(state).join(' '));
  if(psdExportWarnings(state).length){const layer=makeLayer('调整合并副本',compositeState(state));state={...state,layers:[layer],selectedId:layer.id,selectedIds:[layer.id]};}
  const quantize=(layers:readonly ImageLayer[]):ImageLayer[]=>layers.map(l=>({...l,opacity:Math.round(l.opacity*255)/255,...(l.mask?.density!==undefined?{mask:{...l.mask,density:Math.round(l.mask.density*255)/255}}:{}),children:quantize(l.children)}));
  state=hydrateArchive({...state,layers:quantize(state.layers)});
  const psd = asPsd(state); if (!psd.children?.length) psd.children=[{name:'空白画布',hidden:false,opacity:1,blendMode:'normal'}]; const image = compositeState(state); psd.imageData=image;
  // ZIP for layer channels; replace the codec's undersized RLE composite buffer with PSD raw planar data.
  const depth=state.bitDepth??8;
  const cmyk=state.colorMode==='cmyk';
  const encoded = cmyk?writeHighPsd(psd,depth,true):depth===8?normalizeExportedLevels(writePsdUint8Array(psd,{noBackground:true,compress:!state.psdArchive,invalidateTextLayers:!!state.psdArchive&&!psd.engineData})):writeHighPsd(psd,depth), sections=psdSections(encoded);
  const source = resourceBlocks(state.psdOrigin?.resources??new Uint8Array()), generated=resourceBlocks(encoded.slice(sections.resources.data,sections.resources.end));
  const preserved = source.filter(b=>!DERIVED_RESOURCE_IDS.has(b.id)&&(embedProfile||b.id!==1039));
  const resources = concatBytes([...preserved,...generated.filter(g=>(embedProfile||g.id!==1039)&&!preserved.some(s=>s.id===g.id))].map(b=>b.bytes));
  const raw=depth===8&&!cmyk?rawCompositeData(encoded,image):encoded.subarray(sections.composite);
  let bytes:Uint8Array=concatBytes([encoded.slice(0,sections.resources.start),sized(resources),encoded.slice(sections.layers.start,sections.layers.end),raw]);
  if(state.psdArchive)bytes=preservePatternBlocks(bytes,state.psdArchive);
  if(bytes.length>128*1024*1024)throw new Error('导出 PSD 超过 128 MiB 限制。');
  const pagedExport=!!state.psdArchive&&depth===8&&!cmyk;
  const reopened=pagedExport?readPsdMetadata(bytes):depth===8&&!cmyk?readPsd(bytes,{useImageData:true,skipThumbnail:true,totalMemoryLimit:IMAGE_LIMITS.bytes*2}):readHighPsd(bytes);
  if(pagedExport){const visit=(layers:Layer[])=>{for(const l of layers){const w=(l.right??0)-(l.left??0),h=(l.bottom??0)-(l.top??0);if(!l.children&&w&&h&&l.rawData)l.imageData=pagedBitmap(w,h,{kind:'psd-rgb8',channels:l.rawData.channels.filter(c=>c.id>=-1)});if(l.mask&&l.rawData){const m=l.mask,ch=l.rawData.channels.find(c=>c.id===-2);if(ch?.data)m.imageData=pagedBitmap((m.right??0)-(m.left??0),(m.bottom??0)-(m.top??0),{kind:'psd-rgb8',channels:[0,1,2].map(id=>({...ch,id}))});}visit(l.children??[]);}};visit(reopened.children??[]);reopened.imageData=readPsd(bytes,{useImageData:true,skipThumbnail:true,skipLayerImageData:true,totalMemoryLimit:IMAGE_LIMITS.bytes}).imageData!;}

  if(JSON.stringify(psd.userMask)!==JSON.stringify(reopened.userMask))throw Error('PSD 导出自检：蒙版显示设置改变。');
  const sample=(n:number)=>depth===16?n/257:depth===32?n*255:n;
  const differs=(a:number,b:number)=>Math.abs(a-sample(b))>(depth===8?0:depth===16?1/257:Math.max(0.0001,Math.abs(a)*2e-7));
  const compare=(before:Layer[],after:Layer[])=>{
    if(before.length!==after.length)throw new Error('PSD 导出自检：图层数量改变。');
    for(let i=0;i<before.length;i++){
      const a=before[i]!,b=after[i]!;
      if(JSON.stringify(readPsdLocks(a))!==JSON.stringify(readPsdLocks(b)))throw Error('PSD 导出自检：图层锁定改变。');
      if(Boolean(a.clipping)!==Boolean(b.clipping)||Boolean(a.text)!==Boolean(b.text)||Boolean(a.vectorMask)!==Boolean(b.vectorMask)||Boolean(a.adjustment)!==Boolean(b.adjustment)||Boolean(a.placedLayer)!==Boolean(b.placedLayer)||Boolean(a.effects)!==Boolean(b.effects))throw new Error('PSD 导出自检：原生图层语义丢失。');
      if((state.psdArchive||a.placedLayer?.type==='vector')&&(a.text||a.placedLayer)){if(a.text?.text!==b.text?.text||a.placedLayer?.id!==b.placedLayer?.id)throw Error('PSD 原生内容自检失败。');if(a.placedLayer){if(a.placedLayer.type!==b.placedLayer?.type||a.placedLayer.transform.some((v,j)=>Math.abs(v-b.placedLayer!.transform[j]!)>1e-6)||a.placedLayer.nonAffineTransform?.some((v,j)=>Math.abs(v-(b.placedLayer?.nonAffineTransform?.[j]??NaN))>1e-6))throw Error('PSD 智能对象变换自检失败。');const old=psd.linkedFiles?.find(f=>f.id===a.placedLayer!.id),next=reopened.linkedFiles?.find(f=>f.id===b.placedLayer!.id);if(!old?.data||!next?.data||old.data.length!==next.data.length||old.data.some((v,j)=>v!==next.data![j]))throw Error('PSD 嵌入资源自检失败。');}}
      else if(a.text||a.vectorMask||a.adjustment||a.placedLayer){const expected=readNativeContent(a,psd),actual=readNativeContent(b,reopened);if(expected?.type==='smart'&&actual?.type==='smart'){if(expected.source.data.length!==actual.source.data.length||expected.source.data.some((v,j)=>v!==actual.source.data[j]))throw new Error('PSD 导出自检：智能对象源像素改变。');if(expected.sourcePsd?.length!==actual.sourcePsd?.length||expected.sourcePsd?.some((v,j)=>v!==actual.sourcePsd![j]))throw new Error('PSD 导出自检：多层智能源改变。');const summary=(c:typeof expected)=>({...c,sourcePsd:c.sourcePsd?.length,source:{width:c.source.width,height:c.source.height}});if(JSON.stringify(summary(expected))!==JSON.stringify(summary(actual)))throw new Error('PSD 导出自检：智能对象参数改变。');}else if(expected?.type==='path'&&actual?.type==='path'){const summary=(p:typeof expected)=>{const {nodes,contours,...rest}=p;return {...rest,...(contours?{contours:contours.map(({nodes,...c})=>c)}:{})};},a=[expected,...(expected.contours??[])].flatMap(p=>p.nodes),b=[actual,...(actual.contours??[])].flatMap(p=>p.nodes),tolerance=Math.max(psd.width,psd.height)/16777216+1e-7;if(JSON.stringify(summary(expected))!==JSON.stringify(summary(actual))||a.length!==b.length||a.some((n,i)=>Object.keys(n).some(k=>Math.abs(n[k as keyof typeof n]-b[i]![k as keyof typeof n])>tolerance)))throw new Error('PSD 导出自检：路径参数改变。');}else if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('PSD 导出自检：原生内容参数改变。');}
      if(JSON.stringify(readBlendIf(a))!==JSON.stringify(readBlendIf(b)))throw new Error('PSD 导出自检：Blend If 参数改变。');
      if(a.effects&&!state.psdArchive&&JSON.stringify(readStyles(a.effects))!==JSON.stringify(readStyles(b.effects!)))throw new Error('PSD 导出自检：图层样式参数改变。');
      if(Boolean(a.effectsOpen)!==Boolean(b.effectsOpen))throw Error('PSD 导出自检：效果面板状态改变。');
      if(a.name!==b.name||a.hidden!==b.hidden||Math.abs((a.opacity??1)-(b.opacity??1))>1e-8||a.blendMode!==b.blendMode)throw new Error('PSD 导出自检：图层属性改变。');
      if(a.mask){const m=a.mask,n=b.mask;if(!n?.imageData||!m.imageData||m.left!==n.left||m.top!==n.top||m.defaultColor!==n.defaultColor||Boolean(m.disabled)!==Boolean(n.disabled)||(m.userMaskDensity??1)!==(n.userMaskDensity??1)||(m.userMaskFeather??0)!==(n.userMaskFeather??0)||m.imageData.width!==n.imageData.width||m.imageData.height!==n.imageData.height||m.imageData.data.some((v,j)=>j%4!==3&&differs(v,n.imageData!.data[j]!)))throw new Error('PSD 导出自检：蒙版像素或属性改变。');}
      if(a.children)compare(a.children,b.children??[]);
      else if(a.imageData){
        const one=a.imageData,two=b.imageData,oneData=one.data,twoData=two?.data;
        if(cmyk){const ink=(one as unknown as Bitmap).cmyk,other=(two as unknown as Bitmap)?.cmyk;if(!ink||!other||ink.length!==other.length||ink.some((v,j)=>Math.abs(v-other[j]!)>100/(depth===8?255:65535)+1e-5))throw Error('PSD 导出自检：CMYK 分色改变。');}
        if(a.left!==b.left||a.top!==b.top||!two||one.width!==two.width||one.height!==two.height||oneData.length!==twoData!.length||(!cmyk&&oneData.some((v,j)=>differs(v,twoData![j]!))))throw new Error('PSD 导出自检：图层像素或坐标改变。');
      }
    }
  };compare(psd.children??[],reopened.children??[]);
  let maxStraightError=0,maxPremultipliedError=0;
  if(!reopened.imageData)throw new Error('PSD 导出自检：缺少合成图。');
  for(let i=0;i<image.data.length;i+=4){
    const alpha=image.data[i+3]!;if(differs(alpha,reopened.imageData.data[i+3]!))throw new Error('PSD 导出自检：合成透明度改变。');
    for(let c=0;c<(cmyk?0:3);c++){const delta=Math.abs(image.data[i+c]!-sample(reopened.imageData.data[i+c]!));maxStraightError=Math.max(maxStraightError,delta);maxPremultipliedError=Math.max(maxPremultipliedError,delta*alpha/255);}
  }
  if(maxPremultipliedError>1)throw new Error('PSD 导出自检：透明边缘误差超出 1/255。');
  return {bytes,maxStraightError,maxPremultipliedError,preservedResourceIds:preserved.map(b=>b.id)};
}

function maskSamples(image:PixelData,depth:number){const values=Array.from({length:image.width*image.height},(_,i)=>image.data[i*4]!/(depth===16?257:depth===32?1/255:1));return depth===8?Uint8Array.from(values):Float32Array.from(values);}
function maskRgba(data:Uint8Array|Float32Array){const values=Array.from({length:data.length*4},(_,i)=>i%4===3?255:data[Math.floor(i/4)]!);return data instanceof Float32Array?Float32Array.from(values):Uint8ClampedArray.from(values);}
