import {abortable} from './renderWork.js';
import type { PreviewCache } from './previewCache.js';
import { pixelArray, pixelBytesView, pixelsFromBytes, withPixels, type BitDepth } from './pixelFormat.js';
import type { Bitmap } from './document.js';
import type { CompositeRect } from './compositor.js';
import { diskPager, type DiskBlob } from './diskPager.js';
import { deflate } from 'pako';
import { inflateBounded } from './pagedPixels.js';
export const DISPLAY_TILE=256, DISPLAY_CACHE_BYTES=8*1024*1024;
export interface TileAddress {level:number;x:number;y:number}
export interface ViewWindow {x:number;y:number;scale:number;width:number;height:number}
export function planView(width:number,height:number,view:ViewWindow,minimumLevel=0){
 const level=Math.max(minimumLevel,0,Math.floor(Math.log2(1/view.scale))),step=2**level,size=DISPLAY_TILE*step;
 const left=Math.max(0,Math.floor(view.x/size)),top=Math.max(0,Math.floor(view.y/size));
 const right=Math.min(Math.ceil(width/size),Math.ceil((view.x+view.width/view.scale)/size)),bottom=Math.min(Math.ceil(height/size),Math.ceil((view.y+view.height/view.scale)/size));
 const tiles:TileAddress[]=[];for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)tiles.push({level,x,y});return {level,tiles};
}
/** Display-only pyramid. Original samples stay in the document's native disk pages. */
export class DisplayPyramid {
 private disk=new Map<string,DiskBlob>();private cache=new Map<string,Bitmap>();private bytes=0;private persistentHits=0;
 readonly overviewLevel:number;
 constructor(readonly width:number,readonly height:number,private read:(rect:CompositeRect,signal?:AbortSignal)=>Promise<Bitmap>,private depth:BitDepth=8,private persistent?:PreviewCache){this.overviewLevel=Math.max(0,Math.ceil(Math.log2(Math.max(width,height)/DISPLAY_TILE)));}
 update(read:(rect:CompositeRect,signal?:AbortSignal)=>Promise<Bitmap>,damage:readonly CompositeRect[],persistent?:PreviewCache){this.read=read;this.persistent=persistent;const dirty=(key:string)=>{const [level,x,y]=key.split('/').map(Number) as [number,number,number],size=DISPLAY_TILE*2**level;return damage.some(r=>x*size<r.x+r.width&&y*size<r.y+r.height&&(x+1)*size>r.x&&(y+1)*size>r.y);};for(const key of this.disk.keys())if(dirty(key))this.disk.delete(key);for(const [key,b] of this.cache)if(dirty(key)){this.cache.delete(key);this.bytes-=b.data.byteLength;}}
 stats(){return {residentBytes:this.bytes,budget:DISPLAY_CACHE_BYTES,diskTiles:this.disk.size,persistentHits:this.persistentHits};}
 private remember(key:string,b:Bitmap){const old=this.cache.get(key);if(old)this.bytes-=old.data.byteLength;this.cache.set(key,b);this.bytes+=b.data.byteLength;while(this.bytes>DISPLAY_CACHE_BYTES){const [k,v]=this.cache.entries().next().value!;this.cache.delete(k);this.bytes-=v.data.byteLength;}return b;}
 async tile(level:number,x:number,y:number,signal?:AbortSignal):Promise<Bitmap>{
  signal?.throwIfAborted();const key=`${level}/${x}/${y}`,hit=this.cache.get(key);if(hit){this.cache.delete(key);this.cache.set(key,hit);return hit;}
  const step=2**level,w=Math.min(DISPLAY_TILE,Math.ceil(this.width/step)-x*DISPLAY_TILE),h=Math.min(DISPLAY_TILE,Math.ceil(this.height/step)-y*DISPLAY_TILE);
  if(w<1||h<1)throw Error('预览瓦片超出文档。');const saved=this.disk.get(key);
  if(saved)return this.remember(key,{width:w,height:h,depth:this.depth,data:pixelsFromBytes(inflateBounded(await diskPager.blob(saved,signal),w*h*4*(this.depth===8?1:4)),this.depth)});
  if(level>0&&this.persistent){const pending=this.persistent.read(key),bytes=await (signal?abortable(pending,signal):pending);signal?.throwIfAborted();if(bytes)try{const data=pixelsFromBytes(inflateBounded(bytes,w*h*4*(this.depth===8?1:4)),this.depth);this.persistentHits++;return this.remember(key,{width:w,height:h,depth:this.depth,data});}catch{/* Rebuild corrupt disposable previews from native pixels. */}}
  if(level===0)return this.remember(key,await this.read({x:x*DISPLAY_TILE,y:y*DISPLAY_TILE,width:w,height:h},signal));
  const data=pixelArray(w*h*4,this.depth);
  for(let cy=0;cy<2;cy++)for(let cx=0;cx<2;cx++){
   if((x*2+cx)*DISPLAY_TILE>=Math.ceil(this.width/(step/2))||(y*2+cy)*DISPLAY_TILE>=Math.ceil(this.height/(step/2)))continue;
   const child=await this.tile(level-1,x*2+cx,y*2+cy,signal);
   for(let yy=0;yy<child.height;yy+=2)for(let xx=0;xx<child.width;xx+=2){let a=0,r=0,g=0,b=0,n=0;
    for(let dy=0;dy<2&&yy+dy<child.height;dy++)for(let dx=0;dx<2&&xx+dx<child.width;dx++){const i=((yy+dy)*child.width+xx+dx)*4,alpha=child.data[i+3]!;a+=alpha;r+=child.data[i]!*alpha;g+=child.data[i+1]!*alpha;b+=child.data[i+2]!*alpha;n++;}
    const i=((cy*128+yy/2)*w+cx*128+xx/2)*4;data[i]=a?r/a:0;data[i+1]=a?g/a:0;data[i+2]=a?b/a:0;data[i+3]=a/n;
   }
  }
  signal?.throwIfAborted();const bytes=deflate(pixelBytesView(withPixels(w,h,data,this.depth)));const pending=this.persistent?.write(key,bytes)??Promise.resolve(false);if(!await (signal?abortable(pending,signal):pending))this.disk.set(key,await diskPager.write(bytes,signal));signal?.throwIfAborted();return this.remember(key,{width:w,height:h,depth:this.depth,data});
 }
 /** One-pixel neighbor gutter prevents bilinear seams, including transparent edges. */
 async bordered(a:TileAddress,signal?:AbortSignal):Promise<Bitmap>{
  const center=await this.tile(a.level,a.x,a.y,signal),w=center.width+2,h=center.height+2,data=pixelArray(w*h*4,this.depth),mw=Math.ceil(this.width/2**a.level),mh=Math.ceil(this.height/2**a.level),parts=new Map<string,Bitmap>();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const gx=Math.max(0,Math.min(mw-1,a.x*DISPLAY_TILE+x-1)),gy=Math.max(0,Math.min(mh-1,a.y*DISPLAY_TILE+y-1)),tx=Math.floor(gx/DISPLAY_TILE),ty=Math.floor(gy/DISPLAY_TILE),key=`${tx}/${ty}`;let b=parts.get(key);if(!b){b=await this.tile(a.level,tx,ty,signal);parts.set(key,b);}const i=((gy%DISPLAY_TILE)*b.width+gx%DISPLAY_TILE)*4,j=(y*w+x)*4;data.set(b.data.subarray(i,i+4),j);}
  return {width:w,height:h,depth:this.depth,data};
 }
}
