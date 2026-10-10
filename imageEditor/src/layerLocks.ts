import type { Layer } from 'ag-psd';
import type { ImageLayer, ImageState } from './document.js';
import { bitmapRegion } from './pagedPixels.js';

export interface LayerLocks { readonly transparency?:boolean; readonly pixels?:boolean; readonly position?:boolean; readonly artboards?:boolean }
export type LockAction = 'all' | 'pixels' | 'position' | 'transparency' | 'any';
export function validateLocks(value:unknown): asserts value is LayerLocks {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([key,v])=>!['transparency','pixels','position','artboards'].includes(key)||typeof v!=='boolean'))throw Error('图层分项锁定无效。');
}
export function effectiveLocks(layers:readonly ImageLayer[],id:string,inherited:LayerLocks & {all?:boolean}={}):LayerLocks & {all?:boolean} {
 for(const l of layers){const locks={all:!!inherited.all||l.locked,transparency:!!inherited.transparency||!!l.locks?.transparency,pixels:!!inherited.pixels||!!l.locks?.pixels,position:!!inherited.position||!!l.locks?.position,artboards:!!inherited.artboards||!!l.locks?.artboards};if(l.id===id)return locks;const found=effectiveLocks(l.children,id,locks);if(Object.keys(found).length)return found;}return {};
}
export function isLayerLocked(layers:readonly ImageLayer[],id:string,action:LockAction='all'):boolean {
 const p=effectiveLocks(layers,id);return !!p.all||(action==='any'?Object.values(p).some(Boolean):action==='all'?false:!!p[action]);
}
export function readPsdLocks(l:Layer):Pick<ImageLayer,'locked'|'locks'> {
 const p=l.protected,transparency=!!l.transparencyProtected||!!p?.transparency,pixels=!!p?.composite,position=!!p?.position,artboards=!!p?.artboards;
 // PSD represents Lock All with all three protection bits; the header flag alone is alpha lock.
 const locked=transparency&&pixels&&position;
 return {locked,...(!locked&&(transparency||pixels||position||artboards)?{locks:{transparency,pixels,position,...(artboards?{artboards}:{})}}:artboards?{locks:{artboards}}:{})};
}
export function writePsdLocks(l:ImageLayer):Pick<Layer,'protected'|'transparencyProtected'> {
 const p=l.locks,transparency=l.locked||!!p?.transparency,composite=l.locked||!!p?.pixels,position=l.locked||!!p?.position;
 return {transparencyProtected:transparency,...(transparency||composite||position||p?.artboards?{protected:{transparency,composite,position,...(p?.artboards?{artboards:true}:{})}}:{})};
}
/** Restore alpha in the original local bounds; padded painting buffers cannot enlarge an alpha-locked layer. */
export function preserveLayerAlpha(old:ImageLayer,next:ImageLayer):ImageLayer {
 if(!old.bitmap||!next.bitmap)return {...next,x:old.x,y:old.y,bitmap:old.bitmap};
 const a=old.bitmap,b=next.bitmap,source=bitmapRegion(a,0,0,a.width,a.height),data=source.data.slice(),ink=a.cmyk?.slice(),pixels=b.data,inks=b.cmyk;
 for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){
  const i=(y*a.width+x)*4,bx=x+old.x-next.x,by=y+old.y-next.y;
  if(!data[i+3]||bx<0||by<0||bx>=b.width||by>=b.height)continue;
  const j=(by*b.width+bx)*4;for(let c=0;c<3;c++)data[i+c]=pixels[j+c]!;
  if(ink&&inks)for(let c=0;c<4;c++)ink[i+c]=inks[j+c]!;
 }
 return {...next,x:old.x,y:old.y,bitmap:{width:a.width,height:a.height,data,...(a.depth?{depth:a.depth}:{}),...(ink?{cmyk:ink}:{})}};
}
/** Enforced for every document commit, including bulk/API commits and descendants of locked groups. */
export function protectLayerChanges(before:ImageState,layers:readonly ImageLayer[],mode:'edit'|'pixels'|'transform'='edit'):readonly ImageLayer[] {
 const old=new Map<string,ImageLayer>(),next=new Map<string,ImageLayer>(),positions=new Map<string,{x:number;y:number}>();
 const collect=(ls:readonly ImageLayer[],map:Map<string,ImageLayer>,x=0,y=0)=>{for(const l of ls){map.set(l.id,l);if(map===old)positions.set(l.id,{x:x+l.x,y:y+l.y});collect(l.children,map,x+l.x,y+l.y);}};collect(before.layers,old);collect(layers,next);
 for(const [id]of old)if(!next.has(id)&&isLayerLocked(before.layers,id,'any'))throw Error('删除或合并前请解除图层锁定。');
 const visit=(ls:readonly ImageLayer[],x=0,y=0):ImageLayer[]=>ls.map(l=>{
  const prev=old.get(l.id),locks=prev&&effectiveLocks(before.layers,l.id);let result=l;
  if(prev&&locks&&Object.values(locks).some(Boolean)){const contentChanged=prev.content!==l.content&&(prev.content?.type==='smart'&&l.content?.type==='smart'?prev.content.source!==l.content.source||prev.content.sourcePsd!==l.content.sourcePsd||JSON.stringify(prev.content.transform)!==JSON.stringify(l.content.transform):JSON.stringify(prev.content)!==JSON.stringify(l.content)),bitmapChanged=prev.bitmap!==l.bitmap;
   const geometry=mode==='transform'&&(bitmapChanged||contentChanged)||x+l.x!==positions.get(l.id)!.x||y+l.y!==positions.get(l.id)!.y;
   // Painting may pad/rebase a bitmap without moving its existing pixels. Position lock allows that.
   const padding=mode==='pixels'&&bitmapChanged&&!contentChanged&&!!prev.bitmap&&!!l.bitmap&&l.x<=prev.x&&l.y<=prev.y&&l.x+l.bitmap.width>=prev.x+prev.bitmap.width&&l.y+l.bitmap.height>=prev.y+prev.bitmap.height;
   if((locks.position||locks.all)&&geometry&&(!padding||x!==positions.get(l.id)!.x-prev.x||y!==positions.get(l.id)!.y-prev.y))throw Error('图层位置已锁定。');
   if((locks.all||mode!=='transform'&&locks.pixels)&&(bitmapChanged||contentChanged))throw Error('图层像素已锁定。');
   if(mode!=='transform'&&locks.transparency){if(contentChanged)throw Error('编辑原生内容前请解除透明像素锁定。');if(bitmapChanged)result=preserveLayerAlpha(prev,l);}
  }
  return {...result,children:visit(result.children,x+result.x,y+result.y)};
 });return visit(layers);
}
