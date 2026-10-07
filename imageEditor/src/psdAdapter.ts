import { BLEND_MODES } from './layerFeatures.js';
import { compositeState } from './compositor.js';
import { psdExportWarnings } from './psdExportPolicy.js';
import { readPsd, writePsdUint8Array, type Psd, type Layer, type PixelData } from 'ag-psd';
import { PsdAdmissionError, composite, editingDiagnostics, inspectHeader } from './psdPrototype.js';
import { checkSize, IMAGE_LIMITS, makeLayer, uid, validateState, type ImageLayer, type ImageState } from './document.js';
import { validateCompositeBytes, additionalInfoKeys, concatBytes, DERIVED_RESOURCE_IDS, psdSections, resourceBlocks, type ResourceBlock } from './psdResources.js';

export interface PsdImportResult { layered: ImageState | null; flattened: ImageState | null; blockers: string[]; warnings: string[]; sourceName: string; resourceIds: number[] }
const allowedLayerKeys = new Set(['top','left','bottom','right','blendMode','opacity','clipping','transparencyProtected','hidden','blendingRanges','name','imageData','children','id','nameSource','version','sectionDivider','protected','layerColor','referencePoint','opened','timestamp','mask','linkGroup','linkGroupEnabled']);
const featureNames: Record<string,string> = { text:'可编辑文字', vectorFill:'矢量填充', vectorStroke:'矢量描边', vectorMask:'矢量蒙版', placedLayer:'智能对象', adjustment:'调整图层', effects:'图层效果', mask:'像素蒙版', realMask:'真实蒙版', clipping:'剪贴关系', 'blend-if':'混合颜色带', 'fill-opacity':'填充不透明度', 'blend-mode':'混合模式', 'pass-through-opacity':'穿透组不透明度' };
function pixels(image: PixelData) { return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) }; }
function checkedName(name: string | undefined, fallback: string) { return (name?.trim() || fallback).slice(0,160); }
export function importPsd(bytes: Uint8Array, fileName: string): PsdImportResult {
  let header: ReturnType<typeof inspectHeader>;
  try { header = inspectHeader(bytes); } catch (error) {
    const messages: Record<string,string> = { 'unsupported-version':'暂不支持 PSB；请使用 PSD 格式。', 'unsupported-depth':'暂仅支持 8 位 PSD，请先在原软件中转换位深。', 'unsupported-color-mode':'暂仅支持 RGB PSD，请先在原软件中转换颜色模式。', 'file-budget':'PSD 文件超过 128 MiB 限制。', 'invalid-signature':'文件不是有效 PSD。', 'truncated-header':'PSD 文件头截断。' };
    throw new Error(error instanceof PsdAdmissionError ? messages[error.code] ?? ('PSD 格式或尺寸无效：' + error.code) : String(error));
  }
  checkSize(header.width, header.height);
  if (header.channels > 4) throw new Error('暂不支持包含额外 Alpha/专色通道的 PSD。');
  validateCompositeBytes(bytes);
  const sections = psdSections(bytes), blocks = resourceBlocks(bytes.slice(sections.resources.data, sections.resources.end));
  const logs = new Set<string>(), options = { useImageData: true, useRawThumbnail: true, skipThumbnail: true, totalMemoryLimit: IMAGE_LIMITS.bytes,
    logMissingFeatures: true, log: (...args: unknown[]) => { logs.add(args.map(String).join(' ')); } };
  // Geometry admission precedes decompression, including layer/mask rectangles outside the canvas.
  const raw = readPsd(bytes, { ...options, useRawData: true }); let total = header.width * header.height * 4, count = 0;
  const admit = (layers: Layer[], depth: number) => {
    if (depth > IMAGE_LIMITS.depth) throw new Error('PSD 分组嵌套超过限制。');
    for (const layer of layers) {
      if (++count > IMAGE_LIMITS.layers) throw new Error('PSD 图层超过 128 个。');
      for (const area of [layer,layer.mask,layer.realMask]) if (area) {
        const w = (area.right ?? 0) - (area.left ?? 0), h = (area.bottom ?? 0) - (area.top ?? 0);
        if (w < 0 || h < 0) throw new Error('PSD 图层范围无效。');
        if (w && h) checkSize(w,h); total += w * h * 4;
        if (total > IMAGE_LIMITS.bytes) throw new Error('PSD 解码像素超过 128 MiB 预算。');
      }
      if (layer.children) admit(layer.children,depth+1);
    }
  }; admit(raw.children ?? [],0);
  const psd = readPsd(bytes, options), blockers = editingDiagnostics(psd).filter(d=>d.code!=='mask'&&!(d.code==='blend-mode'&&Object.hasOwn(BLEND_MODES,d.detail.replaceAll(' ','-')))).map(d => `${d.path}：${featureNames[d.code] ?? d.code}${d.detail !== d.code ? ` (${d.detail})` : ''}`);
  const harmlessDefaults: Record<string, unknown> = { blendClippendElements: true, blendInteriorElements: false, knockout: false, fillOpacity: 1, transparencyShapesLayer: true };
  const visit = (layers: Layer[]) => { for (const layer of layers) {
    if(layer.mask){const mask=layer.mask;if(!mask.imageData||mask.fromVectorData||['userMaskDensity','userMaskFeather','vectorMaskDensity','vectorMaskFeather'].some(k=>(mask as unknown as Record<string,unknown>)[k]!==undefined))blockers.push(`${layer.name??'图层'}：不支持缺少像素、矢量派生或密度／羽化参数蒙版`);}
    if (layer.children && layer.blendMode === 'pass through') blockers.push(`${layer.name ?? '图层组'}：穿透模式尚未支持`);
    for (const key of Object.keys(layer)) if (!allowedLayerKeys.has(key) && (layer as unknown as Record<string,unknown>)[key] !== harmlessDefaults[key] && !editingDiagnostics({ width:psd.width,height:psd.height,children:[layer] }).some(d=>d.code===key)) blockers.push(`${layer.name ?? '图层'}：未支持属性 ${key}`);
    if (layer.children) visit(layer.children);
  } }; visit(psd.children ?? []);
  if (logs.size) blockers.push(...[...logs].map(log => '解析器报告：' + log));
  for (const key of ['artboards','globalLayerMaskInfo','linkedFiles','animations','timeline']) if ((psd as unknown as Record<string,unknown>)[key]) blockers.push('文档包含未支持内容：' + key);
  const supportedKeys = new Set(['luni','lyid','lnsr','lspf','lclr','fxrp','clbl','infx','knko','lsct','lsdk','shmd','FMsk','Patt','Pat2','Pat3']);
  for (const key of additionalInfoKeys(bytes)) if (!supportedKeys.has(key)) blockers.push('未支持的 PSD 附加信息块：' + key);
  const warnings = ['PSD 导出为新的受限兼容副本，不会覆盖源文件。', '图层标签、链接关系及应用专用数据不保留；锁定属性统一映射为整层锁定。'];
  if (additionalInfoKeys(bytes).some(key=>['Patt','Pat2','Pat3'].includes(key))) warnings.push('源文件中的画笔图案预设不会写入编辑副本。');
  const ids = blocks.map(b=>b.id);
  if (ids.includes(1039)) warnings.push('原 ICC 资源会保留，但当前画布未进行 ICC 色彩转换，颜色可能与 Photoshop 不同。');
  if (ids.some(id=>DERIVED_RESOURCE_IDS.has(id))) warnings.push('旧缩略图、图层索引及相关派生资源将在导出时重建或移除。');
  if (blocks.some(b=>!DERIVED_RESOURCE_IDS.has(b.id))) warnings.push('其他图像资源按原始字节保留，其中尺寸、历史等元数据不会自动改写。');
  const name = checkedName(fileName.replace(/\.psd$/i,''),'PSD 文档');
  const origin = { sourceName: checkedName(fileName,'PSD'), resources: concatBytes(blocks.filter(b=>!DERIVED_RESOURCE_IDS.has(b.id)).map(b=>b.bytes)), flattened: false };
  const state = (layers: ImageLayer[], flattened = false): ImageState => ({ id:uid(),name:flattened?name.slice(0,150)+' · 合并副本':name,width:psd.width,height:psd.height,layers,selectedId:layers.at(-1)?.id??null,revision:1,psdOrigin:{...origin,flattened} });
  const convert = (layer: Layer): ImageLayer => ({ ...makeLayer(checkedName(layer.name,'未命名图层'),layer.imageData&&!layer.children?pixels(layer.imageData):null,layer.children?'group':'pixel'),
    x:layer.children?0:layer.left??0,y:layer.children?0:layer.top??0,visible:!layer.hidden,locked:Boolean(layer.transparencyProtected||Object.values(layer.protected??{}).some(Boolean)),opacity:layer.opacity??1,
    blend:(layer.blendMode??'normal').replaceAll(' ','-') as ImageLayer['blend'],...(layer.mask?.imageData?{mask:{width:layer.mask.imageData.width,height:layer.mask.imageData.height,x:(layer.mask.left??0)-(layer.mask.positionRelativeToLayer?0:layer.children?0:layer.left??0),y:(layer.mask.top??0)-(layer.mask.positionRelativeToLayer?0:layer.children?0:layer.top??0),data:Uint8Array.from({length:layer.mask.imageData.width*layer.mask.imageData.height},(_,i)=>layer.mask!.imageData!.data[i*4]!),disabled:Boolean(layer.mask.disabled),defaultColor:layer.mask.defaultColor??0}}:{}),children:(layer.children??[]).map(convert) });
  let layered: ImageState | null = null, flattened: ImageState | null = null;
  if (!blockers.length) {
    layered = state(psd.children?.length ? psd.children.map(convert) : psd.imageData ? [makeLayer('背景',pixels(psd.imageData))] : []);
    try { validateState(layered); } catch(error) { blockers.push(String(error)); layered=null; }
  }
  if (psd.imageData && psd.imageResources?.versionInfo?.hasRealMergedData !== false) {
    flattened=state([makeLayer('PSD 合并图（已栅格化）',pixels(psd.imageData))],true); validateState(flattened);
  }
  if (!flattened) warnings.push('原件没有可确认的合并预览，不能创建合并图副本。');
  return { layered,flattened,blockers:[...new Set(blockers)],warnings,sourceName:fileName,resourceIds:ids };
}
function asPsd(state: ImageState): Psd {
  const convert = (layers: readonly ImageLayer[], x=0,y=0): Layer[] => layers.map(layer=>({name:layer.name,hidden:!layer.visible,opacity:Math.round(layer.opacity*255)/255,blendMode:layer.blend.replaceAll('-',' ') as Layer['blendMode'] & {},
    ...(layer.mask?{mask:{left:x+layer.x+layer.mask.x,top:y+layer.y+layer.mask.y,defaultColor:layer.mask.defaultColor,disabled:layer.mask.disabled,positionRelativeToLayer:false,imageData:{width:layer.mask.width,height:layer.mask.height,data:Uint8ClampedArray.from({length:layer.mask.data.length*4},(_,i)=>i%4===3?255:layer.mask!.data[Math.floor(i/4)]!)}}}:{}),
    ...(layer.locked?{protected:{transparency:true,composite:true,position:true}}:{}),
    ...(layer.kind==='group'?{children:convert(layer.children,x+layer.x,y+layer.y)}:{left:x+layer.x,top:y+layer.y,...(layer.bitmap?{imageData:layer.bitmap}:{})})}));
  return { name:state.name,width:state.width,height:state.height,children:convert(state.layers),imageResources:{versionInfo:{hasRealMergedData:true,writerName:'Haiyue Image Editor',readerName:'Haiyue Image Editor',fileVersion:1}} };
}
function sized(bytes: Uint8Array) { const prefix=new Uint8Array(4);new DataView(prefix.buffer).setUint32(0,bytes.length);return concatBytes([prefix,bytes]); }
export interface PsdExportResult { bytes: Uint8Array; maxStraightError: number; maxPremultipliedError: number; preservedResourceIds: number[] }
export function exportPsd(state: ImageState, allowRasterize = false): PsdExportResult {
  validateState(state);
  if(psdExportWarnings(state).length&&!allowRasterize)throw new Error('此导出需要确认栅格化或合并：'+psdExportWarnings(state).join(' '));
  const hasAdjustment=(layers:readonly ImageLayer[]):boolean=>layers.some(l=>l.kind==='adjustment'||hasAdjustment(l.children));
  if(hasAdjustment(state.layers)){const layer=makeLayer('调整合并副本',compositeState(state));state={...state,layers:[layer],selectedId:layer.id};}
  const quantize=(layers:readonly ImageLayer[]):ImageLayer[]=>layers.map(l=>({...l,opacity:Math.round(l.opacity*255)/255,children:quantize(l.children)}));
  state={...state,layers:quantize(state.layers)};
  const psd = asPsd(state); if (!psd.children?.length) psd.children=[{name:'空白画布',hidden:false,opacity:1,blendMode:'normal'}]; const image = compositeState(state); psd.imageData=image;
  // ZIP for layer channels; replace the codec's undersized RLE composite buffer with PSD raw planar data.
  const encoded = writePsdUint8Array(psd,{noBackground:true,compress:true}), sections=psdSections(encoded);
  const source = resourceBlocks(state.psdOrigin?.resources??new Uint8Array()), generated=resourceBlocks(encoded.slice(sections.resources.data,sections.resources.end));
  const preserved = source.filter(b=>!DERIVED_RESOURCE_IDS.has(b.id));
  const resources = concatBytes([...preserved,...generated.filter(g=>!preserved.some(s=>s.id===g.id))].map(b=>b.bytes));
  const channels=new DataView(encoded.buffer,encoded.byteOffset,encoded.byteLength).getUint16(12), n=state.width*state.height, raw=new Uint8Array(2+n*channels);
  for(let c=0;c<channels;c++)for(let i=0;i<n;i++) {
    const a=image.data[i*4+3]!,value=image.data[i*4+c]!;
    raw[2+c*n+i]=c<3&&a>0&&a<255?Math.round(value*a/255+255-a):value;
  }
  const bytes=concatBytes([encoded.slice(0,sections.resources.start),sized(resources),encoded.slice(sections.layers.start,sections.layers.end),raw]);
  if(bytes.length>128*1024*1024)throw new Error('导出 PSD 超过 128 MiB 限制。');
  const reopened=readPsd(bytes,{useImageData:true,skipThumbnail:true,totalMemoryLimit:IMAGE_LIMITS.bytes*2});
  const compare=(before:Layer[],after:Layer[])=>{
    if(before.length!==after.length)throw new Error('PSD 导出自检：图层数量改变。');
    for(let i=0;i<before.length;i++){
      const a=before[i]!,b=after[i]!;
      if(a.name!==b.name||a.hidden!==b.hidden||Math.abs((a.opacity??1)-(b.opacity??1))>1e-8||a.blendMode!==b.blendMode)throw new Error('PSD 导出自检：图层属性改变。');
      if(a.mask){const m=a.mask,n=b.mask;if(!n?.imageData||!m.imageData||m.left!==n.left||m.top!==n.top||m.defaultColor!==n.defaultColor||Boolean(m.disabled)!==Boolean(n.disabled)||m.imageData.width!==n.imageData.width||m.imageData.height!==n.imageData.height||m.imageData.data.some((v,j)=>j%4!==3&&v!==n.imageData!.data[j]))throw new Error('PSD 导出自检：蒙版像素或属性改变。');}
      if(a.children)compare(a.children,b.children??[]);
      else if(a.imageData){
        const one=a.imageData,two=b.imageData;
        if(a.left!==b.left||a.top!==b.top||!two||one.width!==two.width||one.height!==two.height||one.data.length!==two.data.length||one.data.some((v,j)=>v!==two.data[j]))throw new Error('PSD 导出自检：图层像素或坐标改变。');
      }
    }
  };compare(psd.children??[],reopened.children??[]);
  let maxStraightError=0,maxPremultipliedError=0;
  if(!reopened.imageData)throw new Error('PSD 导出自检：缺少合成图。');
  for(let i=0;i<image.data.length;i+=4){
    const alpha=image.data[i+3]!;if(alpha!==reopened.imageData.data[i+3])throw new Error('PSD 导出自检：合成透明度改变。');
    for(let c=0;c<3;c++){const delta=Math.abs(image.data[i+c]!-reopened.imageData.data[i+c]!);maxStraightError=Math.max(maxStraightError,delta);maxPremultipliedError=Math.max(maxPremultipliedError,delta*alpha/255);}
  }
  if(maxPremultipliedError>1)throw new Error('PSD 导出自检：透明边缘误差超出 1/255。');
  return {bytes,maxStraightError,maxPremultipliedError,preservedResourceIds:preserved.map(b=>b.id)};
}
