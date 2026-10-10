import type { Bitmap, ImageState } from './document.js';
import { sampleState } from './dailyEditing.js';
import { forEachCompositeTile } from './compositor.js';
import { selectionWeight, type Selection } from './selection.js';
const bins=()=>Array<number>(256).fill(0);
function accumulator(){return {red:bins(),green:bins(),blue:bins(),luminance:bins(),weight:0,pixels:0,sum:0,squares:0};}
function accumulate(out:ReturnType<typeof accumulator>,bitmap:Bitmap,selection:Selection|null|undefined,ox=0,oy=0){
 const bin=(n:number)=>Math.max(0,Math.min(255,Math.round(n)));
 for(let y=0;y<bitmap.height;y++)for(let x=0;x<bitmap.width;x++){
  const i=(y*bitmap.width+x)*4,w=bitmap.data[i+3]!/255*selectionWeight(selection,x+ox,y+oy);if(!w)continue;
  const r=bin(bitmap.data[i]!),g=bin(bitmap.data[i+1]!),b=bin(bitmap.data[i+2]!),l=Math.round(.2126*r+.7152*g+.0722*b);
  out.red[r]!+=w;out.green[g]!+=w;out.blue[b]!+=w;out.luminance[l]!+=w;out.weight+=w;out.pixels++;out.sum+=l*w;out.squares+=l*l*w;
 }
}
function finish(out:ReturnType<typeof accumulator>){
 const {sum,squares,...h}=out,mean=h.weight?sum/h.weight:0;let median=0,total=0;
 if(h.weight)for(let i=0;i<256;i++){total+=h.luminance[i]!;if(total>=h.weight/2){median=i;break;}}
 return {...h,mean,median,deviation:h.weight?Math.sqrt(Math.max(0,squares/h.weight-mean*mean)):0};
}
export function bitmapHistogram(bitmap:Bitmap,selection?:Selection|null){const out=accumulator();accumulate(out,bitmap,selection);return finish(out);}
export type Histogram = ReturnType<typeof bitmapHistogram>;
/** Exact bins from bounded composite tiles; no additional document-sized RGBA allocation. */
export function documentHistogram(state:ImageState,layerId?:string,selection=false):Histogram {
 const out=accumulator(),mask=selection?state.selection:null;
 forEachCompositeTile(sampleState(state,layerId),(b,r)=>accumulate(out,b,mask,r.x,r.y),256,mask??undefined);
 return finish(out);
}
/** Disk documents accumulate each tile and release its lease before the next one. */
export async function documentHistogramAsync(state:ImageState,layerId?:string,selection=false,signal?:AbortSignal):Promise<Histogram>{const {forEachCompositeTileAsync}=await import('./diskCompositor.js'),out=accumulator(),mask=selection?state.selection:null;await forEachCompositeTileAsync(sampleState(state,layerId),(b,r)=>accumulate(out,b,mask,r.x,r.y),signal,128,mask??undefined);return finish(out);}
