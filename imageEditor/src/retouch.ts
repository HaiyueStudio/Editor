import { findLayer, type ImageState, type Bitmap } from './document.js';
import { parentOffset, type Point } from './pixelTools.js';
export type PixelSample=readonly [number,number,number,number];
/** Immutable sampling: overlapping clone strokes cannot feed their own pixels back. */
export function retouchSampler(state:ImageState,targetId:string,sourceId:string,offset:Point,kind:'clone'|'heal',radius=12):(x:number,y:number)=>PixelSample|undefined {
 const source=findLayer(state.layers,sourceId),target=findLayer(state.layers,targetId);
 if(!source?.bitmap||!target||!['clone','heal'].includes(kind)||![offset.x,offset.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=32768)||!Number.isInteger(radius)||radius<1||radius>32)throw new Error('修图源图层、偏移或修复半径无效。');
 const sp=parentOffset(state.layers,sourceId)!,tp=parentOffset(state.layers,targetId)!,sx=source.x+sp.x,sy=source.y+sp.y,tx=target.x+tp.x,ty=target.y+tp.y;
 const sample=(bitmap:Bitmap|undefined|null,x:number,y:number):PixelSample|undefined=>{x=Math.floor(x);y=Math.floor(y);if(!bitmap||x<0||y<0||x>=bitmap.width||y>=bitmap.height)return;const i=(y*bitmap.width+x)*4;return [bitmap.data[i]!,bitmap.data[i+1]!,bitmap.data[i+2]!,bitmap.data[i+3]!];};
 const means=new Map<string,readonly number[]>(),step=8;
 const mean=(bitmap:Bitmap|undefined|null,x:number,y:number)=>{let n=0;const sum=[0,0,0];for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const p=sample(bitmap,x+dx,y+dy);if(p){const a=p[3]/255;n+=a;for(let c=0;c<3;c++)sum[c]!+=p[c]!*a;}}return n?sum.map(v=>v/n):null;};
 const correction=(gx:number,gy:number)=>{const key=gx+':'+gy;let value=means.get(key);if(!value){const x=gx*step,y=gy*step,a=mean(source.bitmap,x+offset.x-sx,y+offset.y-sy),b=mean(target.bitmap,x-tx,y-ty);value=a&&b?b.map((v,c)=>v-a[c]!):[0,0,0];if(means.size>=4096)means.delete(means.keys().next().value!);means.set(key,value);}return value;};
 return (x,y)=>{const p=sample(source.bitmap,x+offset.x-sx,y+offset.y-sy);if(!p||!p[3]||kind==='clone')return p;
  const gx=Math.floor(x/step),gy=Math.floor(y/step),fx=x/step-gx,fy=y/step-gy,a=correction(gx,gy),b=correction(gx+1,gy),c=correction(gx,gy+1),d=correction(gx+1,gy+1);
  return [0,1,2].map(i=>Math.max(0,Math.min(255,p[i]!+(a[i]!*(1-fx)+b[i]!*fx)*(1-fy)+(c[i]!*(1-fx)+d[i]!*fx)*fy))).concat(p[3]) as unknown as PixelSample;
 };
}
