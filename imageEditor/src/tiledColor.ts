import { RasterPreviewBuilder } from './rasterPreviews.js';
import { tiledAlphaSources } from './tiledProvenance.js';
import { deflate } from 'pako';
import { allLayers, layerLocked, makeLayer, type Bitmap, type ImageLayer, type ImageState } from './document.js';
import { bitmapRegionAsync } from './diskCompositor.js';
import { diskPager, type DiskBlob } from './diskPager.js';
import { pagedBitmap } from './pagedPixels.js';
import { convertDepth, depthOf, pixelBytesView, validateBitmap, withPixels, type BitDepth } from './pixelFormat.js';
import { embeddedProfile, srgbProfileBytes } from './colorManagement.js';
import { initializeIcc, linearSrgbProfile, workingProfile, transformBitmapIcc } from './iccEngine.js';
import { withDocumentProfile } from './iccWorkflow.js';
import { convertDocumentCmyk, convertDocumentRgb, cmykBitmap } from './cmyk.js';

export async function mapNativeBitmap(source:Bitmap,convert:(b:Bitmap)=>Bitmap,signal?:AbortSignal):Promise<Bitmap>{
 const preview=new RasterPreviewBuilder(source.width,source.height),tiles:DiskBlob[]=[],inks:DiskBlob[]=[];let depth=depthOf(source),preservesAlpha=true;
 for(let y=0;y<source.height;y+=256)for(let x=0;x<source.width;x+=256){signal?.throwIfAborted();const r={x,y,width:Math.min(256,source.width-x),height:Math.min(256,source.height-y)},original=await bitmapRegionAsync(source,r,signal),b=convert(original);for(let i=3;i<b.data.length;i+=4)if(b.data[i]!==original.data[i])preservesAlpha=false;if(b.width!==r.width||b.height!==r.height)throw Error('颜色转换改变了像素尺寸。');validateBitmap(b);preview.add(x,y,b);depth=depthOf(b);tiles.push(await diskPager.write(deflate(pixelBytesView(b)),signal));if(b.cmyk)inks.push(await diskPager.write(deflate(pixelBytesView(withPixels(b.width,b.height,b.cmyk,16))),signal));await new Promise<void>(resolve=>setTimeout(resolve,0));}
 signal?.throwIfAborted();const result=pagedBitmap(source.width,source.height,{kind:'disk',tiles,...(inks.length?{inks}:{})},depth);if(preservesAlpha)tiledAlphaSources.set(result,new WeakRef(source));return preview.finish(result);
}
export async function mapNativeLayers(layers:readonly ImageLayer[],convert:(b:Bitmap)=>Bitmap,signal?:AbortSignal):Promise<ImageLayer[]>{const out:ImageLayer[]=[];for(const l of layers){const bitmap=l.bitmap?await mapNativeBitmap(l.bitmap,convert,signal):null,content=l.content?.type==='smart'?{...l.content,source:await mapNativeBitmap(l.content.source,convert,signal)}:l.content;out.push({...l,bitmap,...(content?{content}:{}),children:await mapNativeLayers(l.children,convert,signal)});}return out;}
export async function tiledDepth(state:ImageState,depth:BitDepth,allowLoss=false,signal?:AbortSignal){
 if(![8,16,32].includes(depth)||state.colorMode==='cmyk'&&depth===32)throw Error('文档位深无效。');if(depth<(state.bitDepth??8)&&!allowLoss)throw Error('降低位深需要 allowLoss 确认。');const layers=allLayers(state.layers);if(layers.some(l=>layerLocked(state.layers,l.id)))throw Error('请先解除图层锁定。');if(layers.some(l=>l.content?.type==='smart'&&(l.content.sourcePsd||l.content.sourcePdf)))throw Error('请先栅格化多层智能对象，再转换位深。');
 const crossing=(state.bitDepth===32)!==(depth===32),profile=embeddedProfile(state);if(crossing&&profile&&layers.some(l=>l.content||l.smartFilters?.length||l.styles?.enabled||l.blendIf?.enabled))throw Error('跨 HDR 配置转换前请栅格化参数化内容／效果。');await initializeIcc();
 const converted=await mapNativeLayers(state.layers,b=>convertDepth(crossing&&profile?transformBitmapIcc(b,workingProfile(state),state.bitDepth===32?linearSrgbProfile():srgbProfileBytes(),state.icc??{}):b,depth),signal),result={...state,bitDepth:depth,layers:converted};return crossing&&profile?withDocumentProfile(result,depth===32?linearSrgbProfile():srgbProfileBytes()):result;
}
export async function tiledMode(state:ImageState,mode:'rgb'|'cmyk',profile?:Uint8Array,signal?:AbortSignal){
 const one=(b:Bitmap)=>{const local={...state,width:b.width,height:b.height,layers:[makeLayer('颜色转换',b)]};return mode==='rgb'?convertDocumentRgb(local):convertDocumentCmyk(local,profile!);};
 if(allLayers(state.layers).some(l=>l.content||l.styles?.enabled||l.smartFilters?.length||l.blendIf?.enabled))throw Error('转换前请栅格化参数化内容／效果。');
 // Validate mode and profile even for an empty document.
 const metadata=mode==='rgb'?convertDocumentRgb({...state,layers:[]}):convertDocumentCmyk({...state,layers:[]},profile!);
 const layers=await mapNativeLayers(state.layers,b=>one(b).layers[0]!.bitmap!,signal);return {...metadata,layers};
}
export async function refreshTiledCmyk(state:ImageState,profile:Uint8Array|undefined,signal?:AbortSignal){return mapNativeLayers(state.layers,b=>cmykBitmap(b.width,b.height,b.cmyk!,Float32Array.from({length:b.width*b.height},(_,i)=>b.data[i*4+3]!),depthOf(b) as 8|16,profile),signal);}
