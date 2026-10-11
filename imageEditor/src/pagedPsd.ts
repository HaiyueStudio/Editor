import {readSmartPlacement,readSmartLink} from './psdSmartPlacement.js';
import {readSmartFilters,nativeFilterPlacement} from './psdSmartFilters.js';
import {smartBitmap} from './smartObject.js';
import {readAdvancedBlend} from './advancedBlend.js';
import { runSelection } from './selectionRuns.js';
import { bitmapRegion } from './pagedPixels.js';
import { needsTiledView } from './imageLimits.js';
import { pagedMergedPsd } from './largeImageImport.js';
import { readPdfSmart } from './pdfSmart.js';
import { importLayerComps } from './layerComps.js';
import { readPsdLocks, writePsdLocks } from './layerLocks.js';
import { readEditableText } from './psdText.js';
import { readSmartSource } from './smartSource.js';
import { validateQuad } from './projective.js';
import { hydrateArchive, diskPager } from './diskPager.js';
import { readPsd, type Psd, type Layer, type LayerTextData } from 'ag-psd';
import { readPsdMetadata } from './highDepthPsd.js';
import { pagedBitmap, pngBitmap, packBitmap, pixelStorageBytes } from './pagedPixels.js';
import { readNativeContent, readStyles } from './psdNative.js';
import { readBlendIf } from './psdLiveEffects.js';
import { makeLayer, uid, validateState, type ImageState, type ImageLayer } from './document.js';
import { validateContent, type LayerContent, type LayerStyles, type LayerMask, BLEND_MODES } from './layerFeatures.js';
import { additionalInfoKeys } from './psdResources.js';

export const nativeContentKey=(content:LayerContent|undefined)=>JSON.stringify(content,(key,value)=>key==='source'?{width:value.width,height:value.height,originalPng:value.pages?.kind==='png-rgba8'||value.pages?.kind==='disk'&&!!value.pages.pngSource}:key==='sourcePsd'||key==='data'&&value instanceof Uint8Array?value?.byteLength:value)??'';

const styles=readStyles;
function smart(l:Layer,p:Psd,bitmap:ImageLayer['bitmap']):LayerContent {
 const placed=l.placedLayer!,file=p.linkedFiles?.find(f=>f.id===placed.id&&f.data),q=placed.transform;
 if(placed.type==='vector')return readPdfSmart(l,p,bitmap);
 if(!file?.data||!['png','8bps','8bpb'].includes(file.type?.trim().toLowerCase()??'')||placed.type!=='raster'||q.length!==8)throw Error('此智能对象尚不支持按需源编辑。');
 readSmartFilters(placed.filter);
 const source=['8BPS','8BPB'].includes(file.type??'')?packBitmap(readSmartSource(file.data,file.name).bitmap):pngBitmap(file.data);
 return {type:'smart',sourceId:placed.id,name:file.name.slice(0,160),source,...readSmartLink(p,placed.id),...(['8BPS','8BPB'].includes(file.type??'')?{sourcePsd:file.data}:{}),transform:readSmartPlacement(l,source.width,source.height)};
}

function importedMask(l:Layer,pixels?:Pick<LayerMask,'data'|'coverage'|'precision'|'samples'>):LayerMask|undefined {
 const m=l.mask;if(!m){if(l.vectorMask&&!l.vectorFill)throw Error('独立矢量蒙版缺少像素缓存。');return;}
 if(l.realMask||m.fromVectorData&&!l.vectorMask)throw Error('蒙版缓存与原生描述不一致。');
 const channel=l.rawData?.channels.find(c=>c.id===-2),width=(m.right??0)-(m.left??0),height=(m.bottom??0)-(m.top??0);if(width*height&&!channel?.data)throw Error('蒙版缺少像素通道。');
 if(!width&&!height)return {width:1,height:1,x:0,y:0,data:new Uint8Array([m.defaultColor??0]),disabled:!!m.disabled,defaultColor:m.defaultColor??0,...(m.userMaskDensity!==undefined?{density:m.userMaskDensity}:{}),...(m.userMaskFeather!==undefined?{feather:m.userMaskFeather}:{})};
 const b=pixels?undefined:pagedBitmap(width,height,{kind:'psd-rgb8',channels:[{...channel!,id:0}]}),large=needsTiledView({width,height});let coverage:import('./selection.js').Selection|undefined;let data:Uint8Array|Float32Array;if(pixels){data=pixels.data;coverage=pixels.coverage;}else if(large){coverage=runSelection(width,height,y=>{const rgba=bitmapRegion(b!,0,y,width,1).data,row:number[]=[];let a=0,v=rgba[0]!;for(let x=1;x<=width;x++){const next=x<width?rgba[x*4]!:0;if(next!==v||x===width){if(v)row.push(a,x,v);a=x;v=next;}}return row;});data=new Uint8Array();}else{const rgba=b!.data;data=Uint8Array.from({length:width*height},(_,i)=>rgba[i*4]!);}
 // Legacy PlLd vector records store mask bounds in document space despite bit 0.
 const relative=m.positionRelativeToLayer&&!(l.placedLayer?.type==='vector'&&!l.placedLayer.width);
 const vector=m.fromVectorData?structuredClone(l.vectorMask):undefined;if(vector)for(const p of vector.paths)for(const k of p.knots)k.points=k.points.map((v,i)=>v-(i%2?(l.top??0):(l.left??0))) as typeof k.points;
 return {width,height,x:(m.left??0)-(relative?0:l.left??0),y:(m.top??0)-(relative?0:l.top??0),data,...(pixels?.samples?{samples:pixels.samples}:{}),...(pixels?.precision?{precision:pixels.precision}:{}),...(coverage?{coverage}:{}),disabled:!!m.disabled,defaultColor:m.defaultColor??0,...(vector?{vector}:{}),...(m.userMaskDensity!==undefined?{density:m.userMaskDensity}:{}),...(m.userMaskFeather!==undefined?{feather:m.userMaskFeather}:{})};
}

export function layerIds(psd:Psd){const ids=new Map<Layer,number>(),used=new Set<number>();let ordinal=0;const walk=(layers:Layer[])=>{for(const l of layers){ordinal++;const id=l.id!==undefined&&!used.has(l.id)?l.id:-ordinal;used.add(id);ids.set(l,id);walk(l.children??[]);}};walk(psd.children??[]);return ids;}
export function importPagedPsd(bytes:Uint8Array,fileName:string,resources:Uint8Array,keys:readonly string[]=additionalInfoKeys(bytes),decoded?:{psd:Psd;bitmaps:Map<Layer,import('./document.js').Bitmap>;masks:Map<Layer,Pick<LayerMask,'data'|'coverage'|'precision'|'samples'>>;depth:8|16|32;cmyk:boolean}):ImageState {
 bytes=new Uint8Array(bytes);const p=decoded?.psd??readPsdMetadata(bytes);if(!decoded&&(p.bitsPerChannel!==8||p.colorMode!==3||p.channels!>4))throw Error('分块 PSD 当前需要 RGB 8 位。');
 const supported=new Set(['iOpa','tsly','Lr16','Lr32','Mt16','Mt32','sn2P','Anno','luni','lyid','lnsr','lspf','lclr','fxrp','clbl','infx','knko','lsct','lsdk','shmd','FMsk','lmgm','LMsk','TySh','SoLd','SoLE','PlLd','lnk2','lnkD','lnkE','lfx2','lmfx','lrFX','Txt2','cinf','Patt','Pat2','Pat3','vmsk','vsms','vogk','SoCo','vstk','vscg','lfxs','lyvr','expA','vibA','blnc','mixr','blwh','post','thrs','hue2','levl','curv','nvrt','CgEd']);
 const unknown=keys.filter(k=>!supported.has(k));if(unknown.length)throw Error('分块 PSD 尚不支持附加块：'+unknown.join('、'));
 if(p.artboards||p.globalLayerMaskInfo&&p.globalLayerMaskInfo.kind!==128||Object.hasOwn(p,'animations')||p.timeline)throw Error('分块 PSD 不支持画板／全局蒙版／动画。');
 const ids=layerIds(p);
 const allowed=new Set(['comps','usingAlignedRendering','top','left','bottom','right','blendMode','opacity','clipping','transparencyProtected','hidden','blendingRanges','name','rawData','imageData','children','id','nameSource','version','sectionDivider','protected','layerColor','referencePoint','opened','timestamp','mask','linkGroup','linkGroupEnabled','text','vectorFill','vectorStroke','vectorMask','vectorOrigination','placedLayer','adjustment','effects','effectsOpen','layerMaskAsGlobalMask','blendClippendElements','blendInteriorElements','knockout','fillOpacity','transparencyShapesLayer']);
 const convert=(l:Layer):ImageLayer=>{
  for(const key of Object.keys(l))if(!allowed.has(key))throw Error('分块 PSD 未支持属性：'+key);
  if(l.realMask)throw Error('双重栅格蒙版尚未支持。');
  const group=!!l.children,pass=l.blendMode==='pass through';if(pass&&!group||!pass&&!Object.hasOwn(BLEND_MODES,(l.blendMode??'normal').replaceAll(' ','-')))throw Error('分块 PSD 混合模式尚不支持。');
  const width=(l.right??0)-(l.left??0),height=(l.bottom??0)-(l.top??0),bitmap=decoded?.bitmaps.get(l)??(!group&&width&&height&&l.rawData?pagedBitmap(width,height,{kind:'psd-rgb8',channels:l.rawData.channels.filter(c=>c.id>=-1)}):null);
  const content=l.text?readEditableText(l.text,l):l.placedLayer?smart(l,p,bitmap):readNativeContent({...l,...(bitmap?{imageData:bitmap}: {})},p),effect=l.effects?styles(l.effects,p.imageResources?.globalAngle??30,p.imageResources?.globalAltitude??30):undefined,blendIf=readBlendIf(l);
  const filters=readSmartFilters(l.placedLayer?.filter);if(content?.type==='smart'&&!nativeFilterPlacement(content,filters))throw Error('空间智能滤镜与几何变换的运算顺序尚未支持。');
  return {...readAdvancedBlend(l),...makeLayer((l.name?.trim()||'未命名图层').slice(0,160),bitmap,group?'group':'pixel'),...(filters&&content?.type==='smart'?{smartFilters:filters,bitmap:packBitmap(smartBitmap(content))}:{}),kind:group?'group':content?.type==='adjustment'?'adjustment':'pixel',x:group?0:l.left??0,y:group?0:l.top??0,visible:!l.hidden,...readPsdLocks(l),opacity:l.opacity??1,blend:pass?'normal':(l.blendMode??'normal').replaceAll(' ','-') as ImageLayer['blend'],...(pass?{passThrough:true}:{}),...(content?{content}:{}),...(l.clipping?{clipping:true}:{}),...(l.mask?{mask:importedMask(l,decoded?.masks.get(l))!}:{}),...(effect?{styles:effect}:{}),...(blendIf?{blendIf}:{}),nativePsd:{id:ids.get(l)!,contentKey:nativeContentKey(content),stylesKey:JSON.stringify(effect)??''},children:(l.children??[]).map(convert)};
 };
 const layers=(p.children??[]).map(convert);if(!layers.length){if(p.imageResources?.versionInfo?.hasRealMergedData===false)throw Error('PSD 没有真实合并像素。');const merged=needsTiledView(p)?pagedMergedPsd(bytes):readPsd(bytes,{useImageData:true,skipLayerImageData:true,skipThumbnail:true,totalMemoryLimit:128*1024*1024}).imageData;if(!merged)throw Error('PSD 缺少图层和合并像素。');layers.push(makeLayer('背景','pages' in merged?merged as import('./document.js').Bitmap:packBitmap({...merged,data:new Uint8ClampedArray(merged.data)})));}const state:ImageState={id:uid(),name:fileName.replace(/\.ps[db]$/i,'').slice(0,160)||'PSD',width:p.width,height:p.height,...(decoded?{bitDepth:decoded.depth,colorMode:decoded.cmyk?'cmyk' as const:'rgb' as const}:{}),layers,selectedId:layers.at(-1)?.id??null,revision:1,psdOrigin:{sourceName:fileName.slice(0,160),resources,flattened:false},psdArchive:bytes};const comps=importLayerComps(p,layers,ids);if(comps)Object.assign(state,{layerComps:comps});validateState(state);return state;
}

/** Native descriptors remain in the original archive; only changed content is regenerated. */
export function originalPsdLayers(state:ImageState){hydrateArchive(state);if(!state.psdArchive)return;const psd=readPsdMetadata(state.psdArchive),layers=new Map<number,Layer>(),ids=layerIds(psd);const visit=(ls:Layer[])=>{for(const l of ls){layers.set(ids.get(l)!,l);visit(l.children??[]);}};visit(psd.children??[]);return {psd,layers};}
export function retainedNativeFields(layer:ImageLayer,x:number,y:number,original:Layer|undefined,files:Psd['linkedFiles']=[]):Partial<Layer>{
 if(!original||!layer.nativePsd)return {};
 const result:Partial<Layer>=original.id===undefined?{}:{id:original.id};
 if(original.effects&&layer.nativePsd.stylesKey===(JSON.stringify(layer.styles)??''))result.effects=original.effects;
 if(layer.nativePsd.contentKey===nativeContentKey(layer.content)){
  if(original.adjustment)result.adjustment=structuredClone(original.adjustment);
  if(original.vectorFill&&layer.content&&(layer.content.type==='path'||layer.content.type==='shape')){result.vectorFill=structuredClone(original.vectorFill);if(original.vectorStroke)result.vectorStroke=structuredClone(original.vectorStroke);if(original.vectorMask){result.vectorMask=structuredClone(original.vectorMask);for(const p of result.vectorMask.paths)for(const k of p.knots)k.points=k.points.map((v,i)=>v+(i%2?y-(original.top??0):x-(original.left??0))) as typeof k.points;}}
  if(original.text){result.text=structuredClone(original.text);const matrix=result.text.transform;if(matrix){matrix[4]!+=x-(original.left??0);matrix[5]!+=y-(original.top??0);}}
  if(original.placedLayer){const file=files?.find(f=>f.id===original.placedLayer!.id),source=layer.content?.type==='smart'?layer.content.source.pages:undefined;const psd=layer.content?.type==='smart'?layer.content.sourcePsd:undefined;const png=(layer.content?.type==='smart'?layer.content.sourcePdf?.data:undefined)??psd??(source?.kind==='png-rgba8'?source.bytes:source?.kind==='disk'&&source.pngSource?diskPager.syncBlob(source.pngSource):undefined);if(!png||!file?.data||png.length!==file.data.length||png.some((v,i)=>v!==file.data![i]))return result;result.placedLayer=structuredClone(original.placedLayer);if(layer.content?.type==='smart'&&layer.content.sourcePdf){const b=layer.content.sourcePdf.bounds;result.placedLayer.width=b[2]!-b[0]!;result.placedLayer.height=b[3]!-b[1]!;}if(result.placedLayer.nonAffineTransform)result.placedLayer.nonAffineTransform=result.placedLayer.nonAffineTransform.map((v,i)=>v+(i%2?y-(original.top??0):x-(original.left??0)));result.placedLayer.transform=result.placedLayer.transform.map((v,i)=>v+(i%2?y-(original.top??0):x-(original.left??0)));}
 }
 return result;
}
