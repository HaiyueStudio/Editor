import type { Bitmap } from './document.js';
import { depthOf,pixelArray,withPixels } from './pixelFormat.js';
/** Approximate, display-only samples. Never feed these into editing or exact tile caches. */
const entries=new WeakMap<object,{levels:Bitmap[];token:object}>(),lru=new Map<object,{key:WeakRef<object>;bytes:number}>();let used=0;
const BUDGET=8*1024*1024,keyOf=(b:Bitmap):object=>b.pages??b;
export function rememberRasterPreview(source:Bitmap,levels:Bitmap[]){
 const key=keyOf(source),old=entries.get(key);if(old){used-=lru.get(old.token)?.bytes??0;lru.delete(old.token);}
 const bytes=levels.reduce((n,b)=>n+b.data.byteLength+(b.cmyk?.byteLength??0),0);if(bytes>BUDGET)return;
 const token={};entries.set(key,{levels,token});lru.set(token,{key:new WeakRef(key),bytes});used+=bytes;
 while(used>BUDGET){const [t,e]=lru.entries().next().value!;const k=e.key.deref();if(k)entries.delete(k);used-=e.bytes;lru.delete(t);}
}
export function rasterPreview(source:Bitmap,edge=512){const entry=entries.get(keyOf(source));if(!entry)return;const e=lru.get(entry.token);if(e){lru.delete(entry.token);lru.set(entry.token,e);}return [...entry.levels].reverse().find(b=>Math.max(b.width,b.height)>=edge)??entry.levels[0];}
export function previewLevels(source:Bitmap){return entries.get(keyOf(source))?.levels;}
export function rasterPreviewStats(){return {bytes:used,budget:BUDGET,entries:lru.size};}
export function makePreviewLevels(base:Bitmap){
 const levels=[base];let b=base;while(Math.max(b.width,b.height)>64){const width=Math.ceil(b.width/2),height=Math.ceil(b.height/2),data=new Float32Array(width*height*4),ink=b.cmyk?new Float32Array(data.length):undefined;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;let alpha=0,n=0;for(let yy=y*2;yy<Math.min(b.height,y*2+2);yy++)for(let xx=x*2;xx<Math.min(b.width,x*2+2);xx++){const j=(yy*b.width+xx)*4,a=b.data[j+3]!;alpha+=a;n++;for(let c=0;c<3;c++)data[i+c]=data[i+c]!+b.data[j+c]!*a;if(ink)for(let c=0;c<4;c++)ink[i+c]=ink[i+c]!+b.cmyk![j+c]!*a;}for(let c=0;c<3;c++)data[i+c]=alpha?data[i+c]!/alpha:0;if(ink)for(let c=0;c<4;c++)ink[i+c]=alpha?ink[i+c]!/alpha:0;data[i+3]=alpha/n;}
  // Accumulate in float to avoid saturating an 8-bit intermediate.
  b=withPixels(width,height,depthOf(b)===8?new Uint8ClampedArray(data):data,depthOf(b));if(ink)b={...b,cmyk:ink};levels.push(b);
 }return levels;
}
export class RasterPreviewBuilder {
 private bitmap?:Bitmap;
 constructor(private width:number,private height:number){ }
 add(x:number,y:number,b:Bitmap){
  if(Math.max(this.width,this.height)<=512)return;
  if(!this.bitmap){const scale=(b.cmyk?256:512)/Math.max(this.width,this.height),w=Math.max(1,Math.round(this.width*scale)),h=Math.max(1,Math.round(this.height*scale));this.bitmap=withPixels(w,h,pixelArray(w*h*4,depthOf(b)),depthOf(b));if(b.cmyk)this.bitmap={...this.bitmap,cmyk:new Float32Array(w*h*4)};}
  const out=this.bitmap;for(let yy=Math.max(0,Math.ceil(y*out.height/this.height-.5));yy<out.height;yy++){const sy=Math.floor((yy+.5)*this.height/out.height);if(sy>=y+b.height)break;if(sy<y)continue;
   for(let xx=Math.max(0,Math.ceil(x*out.width/this.width-.5));xx<out.width;xx++){const sx=Math.floor((xx+.5)*this.width/out.width);if(sx>=x+b.width)break;if(sx<x)continue;const i=(yy*out.width+xx)*4,j=((sy-y)*b.width+sx-x)*4;out.data.set(b.data.subarray(j,j+4),i);if(out.cmyk&&b.cmyk)out.cmyk.set(b.cmyk.subarray(j,j+4),i);}
  }
 }
 finish(source:Bitmap){if(this.bitmap)rememberRasterPreview(source,makePreviewLevels(this.bitmap));return source;}
}
export interface RasterPreviewEntry {source:Bitmap;levels:Bitmap[]}
/** Enumerate descriptors only: reading a lazy .data getter would decode the entire document. */
export function collectRasterPreviews(value:unknown):RasterPreviewEntry[]{const found:RasterPreviewEntry[]=[],seen=new Set<object>();const visit=(v:unknown)=>{if(!v||typeof v!=='object'||ArrayBuffer.isView(v)||v instanceof ArrayBuffer||seen.has(v))return;seen.add(v);const b=v as Bitmap;if(typeof b.width==='number'&&typeof b.height==='number'&&(b.pages||Object.getOwnPropertyDescriptor(v,'data')?.value)){const levels=previewLevels(b);if(levels)found.push({source:b,levels});if(b.pages)return;}for(const d of Object.values(Object.getOwnPropertyDescriptors(v)))if('value'in d)visit(d.value);};visit(value);return found;}
export function adoptRasterPreviews(list:RasterPreviewEntry[]|undefined){for(const e of list??[])rememberRasterPreview(e.source,e.levels);}
