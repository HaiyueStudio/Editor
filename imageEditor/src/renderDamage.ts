import type {Bitmap,ImageLayer,ImageState} from './document.js';
import {compositeDamage,type CompositeRect} from './compositor.js';
const visualKeys=['id','kind','x','y','visible','opacity','blend','mask','clipping','styles','smartFilters','filterMask','blendIf','content'] as const;
// History freezes metadata into fresh objects. Compare their values, while treating pixel/mask buffers as immutable identities.
function sameMetadata(a:unknown,b:unknown):boolean {
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||ArrayBuffer.isView(a)||ArrayBuffer.isView(b))return false;
 const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>,keys=Object.keys(aa);
 return keys.length===Object.keys(bb).length&&keys.every(k=>Object.hasOwn(bb,k)&&sameMetadata(aa[k],bb[k]));
}
/** Compare immutable committed buffers, including reconstructed undo frames. Undefined requests a full repaint. */
export function documentDamage(before:ImageState,after:ImageState):CompositeRect|undefined {
 if(before.id!==after.id||before.width!==after.width||before.height!==after.height||before.bitDepth!==after.bitDepth||before.colorMode!==after.colorMode||!sameMetadata(before.display,after.display)||!sameMetadata(before.icc,after.icc)||before.psdOrigin!==after.psdOrigin)return;
 let damage:CompositeRect={x:0,y:0,width:0,height:0};
 const union=(r:CompositeRect)=>{if(!r.width||!r.height)return;if(!damage.width){damage=r;return;}const x=Math.min(damage.x,r.x),y=Math.min(damage.y,r.y);damage={x,y,width:Math.max(damage.x+damage.width,r.x+r.width)-x,height:Math.max(damage.y+damage.height,r.y+r.height)-y};};
 const walk=(a:readonly ImageLayer[],b:readonly ImageLayer[]):boolean=>{
  if(a.length!==b.length)return false;
  for(let i=0;i<a.length;i++){
   const old=a[i]!,next=b[i]!;if(old===next)continue;
   if(visualKeys.some(k=>!sameMetadata(old[k],next[k]))||!walk(old.children,next.children))return false;
   if(old.bitmap===next.bitmap)continue;
   if(!old.bitmap||!next.bitmap)return false;
   const r=bitmapDamage(old.bitmap,next.bitmap);if(!r)return false;if(!r.width)continue;
   const region=compositeDamage(after,next.id,r);if(!region)return false;union(region);
  }return true;
 };
 return walk(before.layers,after.layers)?damage:undefined;
}
function bitmapDamage(a:Bitmap,b:Bitmap):CompositeRect|undefined {
 if(a.width!==b.width||a.height!==b.height||a.depth!==b.depth||!!a.cmyk!==!!b.cmyk)return;
 const width=a.width;let left=width,right=0,top=a.height,bottom=0;
 const packed=a.data instanceof Uint8ClampedArray&&b.data instanceof Uint8ClampedArray&&a.data.byteOffset%4===0&&b.data.byteOffset%4===0,
 aa=packed?new Uint32Array(a.data.buffer,a.data.byteOffset,a.width*a.height):undefined,bb=packed?new Uint32Array(b.data.buffer,b.data.byteOffset,b.width*b.height):undefined;
 for(let p=0,i=0;p<width*a.height;p++,i+=4){
  if((aa?aa[p]===bb![p]:a.data[i]===b.data[i]&&a.data[i+1]===b.data[i+1]&&a.data[i+2]===b.data[i+2]&&a.data[i+3]===b.data[i+3])&&(!a.cmyk||a.cmyk[i]===b.cmyk![i]&&a.cmyk[i+1]===b.cmyk![i+1]&&a.cmyk[i+2]===b.cmyk![i+2]&&a.cmyk[i+3]===b.cmyk![i+3]))continue;
  const x=p%width,y=Math.floor(p/width);left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=y+1;
  // Broad edits are better served by the normal full renderer; do not scan the remaining buffer.
  if((right-left)*(bottom-top)>width*a.height/2)return;
 }
 return right>left?{x:left,y:top,width:right-left,height:bottom-top}:{x:0,y:0,width:0,height:0};
}
