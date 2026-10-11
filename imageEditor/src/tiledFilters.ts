import type { TaskReport } from './workerTask.js';
import type { CompositeRect } from './compositor.js';
import { effectiveLocks } from './layerLocks.js';
import type { ImageState, ImageLayer } from './document.js';
import { editablePixel, parentOffset } from './pixelTools.js';
import { bitmapRegionAsync } from './diskCompositor.js';
import { pagedBitmap } from './pagedPixels.js';
import { pixelBytesView, depthOf, withPixels } from './pixelFormat.js';
import { applyFilteredLayer, filterBitmap, validateFilterSettings, type FilterSettings } from './filters.js';
import { filterInputRect, cropFiltered } from './regionalFilters.js';
import { diskPager, type DiskBlob } from './diskPager.js';
import { synchronizeCmyk } from './cmyk.js';
import { deflate } from 'pako';
import { tiledAlphaSources } from './tiledProvenance.js';

/** Read a halo from the immutable source; blend selection/alpha only after filtering. */
export async function tiledFilter(state:ImageState,id:string,settings:FilterSettings,signal?:AbortSignal,report?:TaskReport):Promise<ImageLayer>{
 validateFilterSettings(settings);const layer=editablePixel(state,id),b=layer.bitmap;if(!b)throw Error('请选择含像素的图层。');
 const offset=parentOffset(state.layers,id)!,tiles:DiskBlob[]=[],inks:DiskBlob[]=[];
 for(let y=0;y<b.height;y+=256)for(let x=0;x<b.width;x+=256){
  signal?.throwIfAborted();const rect={x,y,width:Math.min(256,b.width-x),height:Math.min(256,b.height-y)},out=(await filterRegion(state,id,settings,rect,signal)).filtered;
  tiles.push(await diskPager.write(deflate(pixelBytesView(out)),signal));if(out.cmyk)inks.push(await diskPager.write(deflate(pixelBytesView(withPixels(out.width,out.height,out.cmyk,16))),signal));
  report?.({current:tiles.length,total:Math.ceil(b.width/256)*Math.ceil(b.height/256),message:'正在应用滤镜并存储像素'});
  await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 signal?.throwIfAborted();const bitmap=pagedBitmap(b.width,b.height,{kind:'disk',tiles,...(inks.length?{inks}:{})},depthOf(b));tiledAlphaSources.set(bitmap,new WeakRef(b));return {...layer,bitmap};
}

/** Exact source pixels plus the filter halo; no disk writes, compositing or document-sized allocation. */
export async function filterRegion(state:ImageState,id:string,settings:FilterSettings,rect:CompositeRect,signal?:AbortSignal){
 validateFilterSettings(settings);const layer=editablePixel(state,id),b=layer.bitmap!;
 if(![rect.x,rect.y,rect.width,rect.height].every(Number.isInteger)||rect.x<0||rect.y<0||rect.width<1||rect.height<1||rect.x+rect.width>b.width||rect.y+rect.height>b.height||rect.width>512||rect.height>512)throw Error('滤镜预览区域无效。');
 const offset=parentOffset(state.layers,id)!,input=filterInputRect(b.width,b.height,settings,rect),source=await bitmapRegionAsync(b,input,signal),original=cropFiltered(source,input,rect),filtered=cropFiltered(filterBitmap(source,settings),input,rect);
 const local:ImageState={...state,layers:[{...layer,children:[],locks:effectiveLocks(state.layers,id),bitmap:original,x:layer.x+offset.x+rect.x,y:layer.y+offset.y+rect.y}]};
 const edited=applyFilteredLayer(local,id,filtered),out=synchronizeCmyk({...local,layers:[edited]},local).layers[0]!.bitmap!;
 if(depthOf(out)===16)for(let i=0;i<out.data.length;i++)out.data[i]=Math.min(255,Math.max(0,out.data[i]!));
 signal?.throwIfAborted();return {original,filtered:out};
}
