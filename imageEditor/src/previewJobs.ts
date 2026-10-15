import { workerTask,stopWorker } from './workerTask.js';
import {bitmapRegion} from './pagedPixels.js';
import {previewState} from './previewCache.js';
import type {Bitmap,ImageState} from './document.js';
import type {CompositeRect} from './compositor.js';
import {bitmapRegionAsync,compositeRegionAsync} from './diskCompositor.js';
import {colorDisplay,linearSrgbProfile,transformBitmapIcc} from './iccEngine.js';
import {embeddedProfile} from './colorManagement.js';
/** An opaque-operation, full-canvas raster does not need a layer blend pass. */
export async function previewRegion(state:ImageState,rect:CompositeRect,signal?:AbortSignal){
 const l=state.layers.length===1?state.layers[0]:undefined,b=l?.bitmap;
 if(state.colorMode!=='cmyk'&&l?.kind==='pixel'&&l.visible&&l.opacity===1&&l.blend==='normal'&&l.x===0&&l.y===0&&b?.width===state.width&&b.height===state.height&&!l.mask&&!l.styles&&!l.smartFilters?.length&&!l.blendIf&&!l.clipping&&!l.advancedBlend&&l.fillOpacity===undefined&&l.content?.type!=='adjustment'){
  const out=await bitmapRegionAsync(b,rect,signal);for(let i=0;i<out.data.length;i+=4)if(!out.data[i+3])out.data.fill(0,i,i+3);return out;
 }
 return compositeRegionAsync(state,rect,signal);
}
export function displayRegion(raw:Bitmap,state:ImageState,hdr:boolean){
 if(!hdr)return colorDisplay(raw,state);
 const profile=embeddedProfile(state),b=profile?transformBitmapIcc(raw,profile,linearSrgbProfile(),{intent:state.icc?.intent??1,bpc:state.icc?.bpc??true}):raw,gain=2**(state.display?.exposure??0);
 for(let i=0;i<b.data.length;i++)if(i%4!==3)b.data[i]=b.data[i]!*gain;return b;
}
/** One snapshot per render job, one bounded result per request. No native buffers are detached. */
export class PreviewJobs {
 private block:{state:ImageState;hdr:boolean;rect:CompositeRect;bitmap:Bitmap}|undefined;
 private cancel:(()=>void)|undefined;private worker:Worker|undefined;private state:ImageState|undefined;private hdr=false;private failed=false;
 get backend(){return this.failed||typeof Worker==='undefined'?'reference':'worker';}
 private async request(value:unknown,signal?:AbortSignal):Promise<Bitmap>{
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);this.cancel=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{return await workerTask<Bitmap>(this.worker!,value,{signal:controller.signal,retain:true});}finally{signal?.removeEventListener('abort',abort);this.cancel=undefined;}
 }
 async read(state:ImageState,rect:CompositeRect,hdr:boolean,signal?:AbortSignal):Promise<Bitmap>{
  signal?.throwIfAborted();const only=state.layers.length===1?state.layers[0]:undefined;
  // A simple raster has no effect halo or multi-layer working set. Read a spatial
  // block once instead of a Worker round trip per leaf of the display pyramid.
  const size=hdr||state.bitDepth===32?512:1024,prefetch=only?.bitmap&&only.kind==='pixel'&&!only.content&&!only.mask&&!only.styles&&!only.smartFilters?.length&&!only.blendIf&&!only.clipping&&!only.advancedBlend&&rect.width<=256&&rect.height<=256&&Math.floor(rect.x/size)===Math.floor((rect.x+rect.width-1)/size)&&Math.floor(rect.y/size)===Math.floor((rect.y+rect.height-1)/size);
  let requested=rect;
  if(prefetch){const b=this.block;if(b?.state===state&&b.hdr===hdr&&rect.x>=b.rect.x&&rect.y>=b.rect.y&&rect.x+rect.width<=b.rect.x+b.rect.width&&rect.y+rect.height<=b.rect.y+b.rect.height)return bitmapRegion(b.bitmap,rect.x-b.rect.x,rect.y-b.rect.y,rect.width,rect.height);
   const x=Math.floor(rect.x/size)*size,y=Math.floor(rect.y/size)*size;requested={x,y,width:Math.min(size,state.width-x),height:Math.min(size,state.height-y)};
  }
  let result:Bitmap|undefined;
  if(this.backend==='worker')try{
   if(!this.worker||this.state!==state||this.hdr!==hdr){this.dispose();this.worker=new Worker(new URL('./psd-worker.js',import.meta.url),{type:'module'});await this.request({kind:'preview-init',state:previewState(state),hdr},signal);this.state=state;this.hdr=hdr;}
   result=await this.request({kind:'preview-read',rect:requested},signal);
  }catch(error){if(signal?.aborted||error instanceof DOMException&&error.name==='AbortError')throw error;this.failed=true;}
  result??=displayRegion(await previewRegion(state,requested,signal),state,hdr);
  if(prefetch){this.block={state,hdr,rect:requested,bitmap:result};return bitmapRegion(result,rect.x-requested.x,rect.y-requested.y,rect.width,rect.height);}return result;
 }

 // Release the Worker realm after the frame; its page lock must not keep GC busy indefinitely.
 dispose(){const cancel=this.cancel;this.cancel=undefined;cancel?.();if(this.worker)stopWorker(this.worker);this.worker=undefined;this.state=undefined;this.block=undefined;}
}
