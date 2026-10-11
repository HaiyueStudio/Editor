import {runSelection,selectionRow} from './selectionRuns.js';
import {findLayer,type Bitmap,type ImageState,type ImageLayer} from './document.js';
import {editablePixel,parentOffset,type Rect,type Point} from './pixelTools.js';
import {editTiledLayer,intersect,sampleRegion} from './tiledEditing.js';
import {bitmapRegionAsync} from './diskCompositor.js';
import {withPixels} from './pixelFormat.js';
import {applyFilteredLayer} from './filters.js';
import {selectionWeight,maskSelection,type Selection} from './selection.js';
import {refineSelection,type RefineSettings} from './refineSelection.js';
function filtered(s:ImageState,id:string,b:Bitmap){const l=applyFilteredLayer(s,id,b);if(b.depth===16)for(let i=0;i<l.bitmap!.data.length;i++)l.bitmap!.data[i]=Math.max(0,Math.min(255,l.bitmap!.data[i]!));return l;}
const pause=()=>new Promise<void>(r=>setTimeout(r,0));
export function rgbTarget(s:ImageState,id:string){const l=editablePixel(s,id);if(!l.bitmap)throw Error('请选择含像素的图层。');if(s.colorMode==='cmyk')throw Error('此修图工具需要 RGB 文档；请先转换颜色模式。');return l;}
function finite(v:number,a:number,b:number){if(!Number.isFinite(v)||v<a||v>b)throw Error('修图参数超出范围。');}
function selected(s:ImageState,max=262144):Rect {if(!s.selection)throw Error('请先创建选区。');const r=intersect(s.selection,{x:0,y:0,width:s.width,height:s.height});if(!r||r.width*r.height>max)throw Error('选区为空或超过本工具的区域预算。');return r;}
function expand(r:Rect,n:number,s:ImageState):Rect {return intersect({x:r.x-n,y:r.y-n,width:r.width+n*2,height:r.height+n*2},{x:0,y:0,width:s.width,height:s.height})!;}
/** Copy only the changed region into COW pages; coverage/alpha locks are applied once. */
async function replaceRegion(s:ImageState,id:string,r:Rect,result:Bitmap,signal?:AbortSignal){return editTiledLayer(s,id,r,local=>{const l=local.layers[0]!,b=l.bitmap!,data=b.data.slice();for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){const gx=l.x+x-r.x,gy=l.y+y-r.y;if(gx>=0&&gy>=0&&gx<r.width&&gy<r.height)data.set(result.data.subarray((gy*r.width+gx)*4,(gy*r.width+gx)*4+4),(y*b.width+x)*4);}return filtered(local,id,withPixels(b.width,b.height,data,b));},signal);}
/** Seamless patch: immutable source gradients, target boundary, iterative Poisson solve. */
export async function patchRegion(s:ImageState,id:string,offset:Point,blend:number,signal?:AbortSignal):Promise<ImageLayer>{
 rgbTarget(s,id);finite(offset.x,-30000,30000);finite(offset.y,-30000,30000);finite(blend,0,1);if(!Number.isInteger(offset.x)||!Number.isInteger(offset.y))throw Error('修补偏移须为整数。');const r=expand(selected(s),1,s),sr={...r,x:r.x+offset.x,y:r.y+offset.y};if(sr.x<0||sr.y<0||sr.x+sr.width>s.width||sr.y+sr.height>s.height)throw Error('取样范围超出画布。');
 const target=await sampleRegion(s,r,id,signal),source=await sampleRegion(s,sr,id,signal),data=Float32Array.from(source.data),w=r.width,h=r.height,inside=(p:number)=>selectionWeight(s.selection,r.x+p%w,r.y+Math.floor(p/w))>0;
 for(let iter=0;iter<48;iter++){signal?.throwIfAborted();for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const p=y*w+x;if(!inside(p))continue;const ns=[p-1,p+1,p-w,p+w];for(let c=0;c<3;c++){let sum=0;for(const q of ns)sum+=(inside(q)?data[q*4+c]!:target.data[q*4+c]!)+source.data[p*4+c]!-source.data[q*4+c]!;data[p*4+c]=sum/4;}}if(iter%8===0)await pause();}
 const out=source.data.slice();for(let i=0;i<out.length;i+=4){for(let c=0;c<3;c++)out[i+c]=(1-blend)*source.data[i+c]!+blend*data[i+c]!;out[i+3]=target.data[i+3]!;}return replaceRegion(s,id,r,withPixels(w,h,out,source),signal);
}
/** Deterministic exemplar synthesis. Unknown pixels are filled from known boundary inward. */
export async function contentAware(s:ImageState,id:string,search:number,signal?:AbortSignal):Promise<ImageLayer>{
 rgbTarget(s,id);finite(search,4,128);if(!Number.isInteger(search))throw Error('搜索半径须为整数。');const r=expand(selected(s,65536),search,s),b=await sampleRegion(s,r,id,signal),w=r.width,h=r.height,known=new Uint8Array(w*h),original=new Uint8Array(w*h),queue:number[]=[],candidates:number[]=[],data=b.data.slice(),queued=new Uint8Array(w*h);
 const adjacent=(p:number)=>[...(p%w?[p-1]:[]),...(p%w<w-1?[p+1]:[]),...(p>=w?[p-w]:[]),...(p+w<w*h?[p+w]:[])];
 for(let p=0;p<known.length;p++){known[p]=original[p]=selectionWeight(s.selection,r.x+p%w,r.y+Math.floor(p/w))===0&&b.data[p*4+3]!>0?1:0;if(known[p])candidates.push(p);}
 if(!candidates.length)throw Error('选区周围没有可用于内容感知的可见像素。');
 for(let p=0;p<known.length;p++)if(!known[p]&&selectionWeight(s.selection,r.x+p%w,r.y+Math.floor(p/w))>0&&adjacent(p).some(q=>known[q])){queue.push(p);queued[p]=1;}
 const offsets=new Int32Array(w*h);let seed=123456789;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
 for(let at=0;at<queue.length;at++){if(at%256===0){signal?.throwIfAborted();await pause();}const p=queue[at]!,x=p%w,y=Math.floor(p/w);let best=-1,score=Infinity;
  const test=(q:number)=>{if(q<0||q>=original.length||!original[q]||Math.abs(q%w-x)>search||Math.abs(Math.floor(q/w)-y)>search)return;let sum=0,n=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const px=x+dx,py=y+dy,qx=q%w+dx,qy=Math.floor(q/w)+dy;if(px<0||py<0||px>=w||py>=h||qx<0||qy<0||qx>=w||qy>=h)continue;const a=py*w+px,c=qy*w+qx;if(!known[a]||!original[c])continue;for(let ch=0;ch<3;ch++)sum+=(data[a*4+ch]!-b.data[c*4+ch]!)**2;n+=3;}const error=n?sum/n:Infinity;if(error<score){score=error;best=q;}};
  for(const q of adjacent(p))if(known[q]){test(q);test(p+offsets[q]!);}for(let k=0;k<48;k++)test(candidates[Math.floor(random()*candidates.length)]!);
  if(best<0){let distance=Infinity;for(const q of candidates){const dx=q%w-x,dy=Math.floor(q/w)-y,dd=dx*dx+dy*dy;if(Math.abs(dx)<=search&&Math.abs(dy)<=search&&dd<distance){best=q;distance=dd;}}}if(best<0)throw Error('搜索范围内没有足够样本，请扩大搜索半径或缩小选区。');
  data.set(b.data.subarray(best*4,best*4+4),p*4);offsets[p]=best-p;known[p]=1;for(const q of adjacent(p))if(!known[q]&&!queued[q]&&selectionWeight(s.selection,r.x+q%w,r.y+Math.floor(q/w))>0){queue.push(q);queued[q]=1;}
 }
 if(!queue.length)throw Error('选区为空或没有可修复边界。');return replaceRegion(s,id,r,withPixels(w,h,data,b),signal);
}
export async function denoise(s:ImageState,id:string,radius:number,strength:number,signal?:AbortSignal){
 rgbTarget(s,id);finite(radius,1,5);finite(strength,1,100);if(!Number.isInteger(radius))throw Error('降噪半径须为整数。');const bounds=s.selection??{x:0,y:0,width:s.width,height:s.height};
 return editTiledLayer(s,id,bounds,async local=>{const l=local.layers[0]!,b=l.bitmap!,r=expand({x:l.x,y:l.y,width:b.width,height:b.height},radius,s),source=await sampleRegion(s,r,id,signal),data=b.data.slice(),sigma=strength*2.55;
 for(let y=0;y<b.height;y++){signal?.throwIfAborted();for(let x=0;x<b.width;x++){const gx=l.x+x-r.x,gy=l.y+y-r.y,i=(y*b.width+x)*4,center=(gy*r.width+gx)*4,sums=[0,0,0],v=source.data;let weight=0;
 for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const xx=gx+dx,yy=gy+dy;if(xx<0||yy<0||xx>=r.width||yy>=r.height)continue;const j=(yy*r.width+xx)*4,delta=[0,1,2].reduce((n,c)=>n+(v[j+c]!-v[center+c]!)**2,0)/3,a=Math.exp(-(dx*dx+dy*dy)/(2*radius*radius)-delta/(2*sigma*sigma))*v[j+3]!/255;weight+=a;for(let c=0;c<3;c++)sums[c]!+=v[j+c]!*a;}if(weight)for(let c=0;c<3;c++)data[i+c]=sums[c]!/weight;}
 if(y%32===0)await pause();}return filtered(local,id,withPixels(b.width,b.height,data,b));},signal);
}
export interface LiquifyDab extends Point {dx:number;dy:number;radius:number;strength:number;mode:'push'|'pinch'|'bloat'|'twirl'}
export interface LensSettings {k1:number;k2:number;scale:number;vignette:number;centerX:number;centerY:number}
export async function remapRetouch(s:ImageState,id:string,settings:LensSettings|readonly LiquifyDab[],signal?:AbortSignal){
 const l=rgbTarget(s,id),b=l.bitmap!,po=parentOffset(s.layers,id)!,ox=l.x+po.x,oy=l.y+po.y,dabs=Array.isArray(settings)?settings as readonly LiquifyDab[]:undefined,lens=dabs?undefined:settings as LensSettings;
 let bounds:Rect={x:ox,y:oy,width:b.width,height:b.height};
 if(dabs){if(!dabs.length||dabs.length>256)throw Error('液化需要 1–256 个笔触点。');for(const d of dabs){finite(d.x,-30000,30000);finite(d.y,-30000,30000);finite(d.dx,-512,512);finite(d.dy,-512,512);finite(d.radius,1,512);finite(d.strength,0,1);if(!['push','pinch','bloat','twirl'].includes(d.mode))throw Error('液化模式无效。');}const x=Math.floor(Math.min(...dabs.map(d=>d.x-d.radius))),y=Math.floor(Math.min(...dabs.map(d=>d.y-d.radius)));bounds={x,y,width:Math.ceil(Math.max(...dabs.map(d=>d.x+d.radius)))-x,height:Math.ceil(Math.max(...dabs.map(d=>d.y+d.radius)))-y};}
 else{finite(lens!.k1,-1,1);finite(lens!.k2,-1,1);finite(lens!.scale,.25,4);finite(lens!.vignette,-1,1);finite(lens!.centerX,0,1);finite(lens!.centerY,0,1);}
 const map=(x:number,y:number):[number,number,number]=>{if(lens){const cx=ox+(b.width-1)*lens.centerX,cy=oy+(b.height-1)*lens.centerY,n=Math.max(b.width,b.height)/2,u=(x-cx)/n,v=(y-cy)/n,r2=u*u+v*v,f=(1+lens.k1*r2+lens.k2*r2*r2)/lens.scale;return [cx+u*n*f,cy+v*n*f,Math.max(0,1+lens.vignette*r2)];}for(let i=dabs!.length-1;i>=0;i--){const d=dabs![i]!,dx=x-d.x,dy=y-d.y,r=Math.hypot(dx,dy)/d.radius;if(r>=1)continue;const f=(1-r*r)**2*d.strength;if(d.mode==='push'){x-=d.dx*f;y-=d.dy*f;}else if(d.mode==='twirl'){const a=-f*Math.PI/2;x=d.x+dx*Math.cos(a)-dy*Math.sin(a);y=d.y+dx*Math.sin(a)+dy*Math.cos(a);}else{const z=1+(d.mode==='pinch'?1:-1)*f*.5;x=d.x+dx*z;y=d.y+dy*z;}}return [x,y,1];};
 return editTiledLayer(s,id,bounds,async local=>{const target=local.layers[0]!,tb=target.bitmap!,data=tb.data.slice(),coords:ReturnType<typeof map>[]=[],keys=new Set<string>(),pages=new Map<string,Bitmap>();
 const key=(x:number,y:number)=>Math.floor(x/256)+','+Math.floor(y/256);
 for(let y=0;y<tb.height;y++)for(let x=0;x<tb.width;x++){const [gx,gy,gain]=map(target.x+x,target.y+y),sx=gx-ox,sy=gy-oy;coords.push([sx,sy,gain]);for(const yy of [Math.floor(sy),Math.floor(sy)+1])for(const xx of [Math.floor(sx),Math.floor(sx)+1])if(xx>=0&&yy>=0&&xx<b.width&&yy<b.height)keys.add(key(xx,yy));}
 if(keys.size>64)throw Error('变形取样超过分块工作集，请减小强度或分次应用。');for(const k of keys){signal?.throwIfAborted();const [px,py]=k.split(',').map(Number),x=px!*256,y=py!*256;pages.set(k,await bitmapRegionAsync(b,{x,y,width:Math.min(256,b.width-x),height:Math.min(256,b.height-y)},signal));}
 for(let p=0;p<coords.length;p++){const [x,y,gain]=coords[p]!,xx=Math.floor(x),yy=Math.floor(y),fx=x-xx,fy=y-yy,sum=[0,0,0,0];for(const [dx,dy,weight] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){const sx=xx+dx!,sy=yy+dy!;if(sx<0||sy<0||sx>=b.width||sy>=b.height)continue;const tile=pages.get(key(sx,sy))!,j=((sy%256)*tile.width+sx%256)*4,a=tile.data[j+3]!*weight!;sum[3]!+=a;for(let c=0;c<3;c++)sum[c]!+=tile.data[j+c]!*a;}for(let c=0;c<3;c++)data[p*4+c]=sum[3]?sum[c]!/sum[3]!*gain:0;data[p*4+3]=sum[3]!;}
 await pause();return filtered(local,id,withPixels(tb.width,tb.height,data,tb));},signal);
}
/** Guide a bounded selection, preserving document coordinates and allowing a local edge brush. */
export async function fineSelection(s:ImageState,id:string,settings:RefineSettings,region:Rect|undefined,signal?:AbortSignal):Promise<Selection>{
 const layer=findLayer(s.layers,id);if(!layer?.bitmap||layer.kind!=='pixel')throw Error('请选择含像素缓存的图层。');if(!s.selection)throw Error('请先创建选区。');if(region&&(!intersect(region,{x:0,y:0,width:s.width,height:s.height})||region.width<1||region.height<1))throw Error('细化区域无效。');const r=expand(region??selected(s,1048576),settings.radius*2+Math.abs(settings.shift),s);if(r.width*r.height>2097152)throw Error('细化区域超过 200 万像素，请使用局部边缘画笔。');const b=await sampleRegion(s,r,id,signal),mask=new Uint8Array(r.width*r.height);for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)mask[y*r.width+x]=Math.round(selectionWeight(s.selection,r.x+x,r.y+y)*255);const refined=refineSelection(b,maskSelection(mask,r.width,r.height),settings);signal?.throwIfAborted();const next={...refined,x:refined.x+r.x,y:refined.y+r.y};if(!region)return next;return runSelection(s.width,s.height,y=>y<region.y||y>=region.y+region.height?selectionRow(s.selection,y):[...selectionRow(s.selection,y,0,region.x),...selectionRow(next,y,region.x,region.x+region.width),...selectionRow(s.selection,y,region.x+region.width,s.width)]);
}
export async function decontaminate(s:ImageState,id:string,radius:number,amount:number,signal?:AbortSignal){rgbTarget(s,id);finite(radius,1,16);finite(amount,0,1);const r=expand(selected(s),radius,s),b=await sampleRegion(s,r,id,signal),data=b.data.slice();for(let y=0;y<r.height;y++){signal?.throwIfAborted();for(let x=0;x<r.width;x++){const a=selectionWeight(s.selection,r.x+x,r.y+y);if(a<=0||a>=1)continue;let best=-1,dist=Infinity;for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const xx=x+dx,yy=y+dy,dd=dx*dx+dy*dy;if(xx>=0&&yy>=0&&xx<r.width&&yy<r.height&&dd<dist&&selectionWeight(s.selection,r.x+xx,r.y+yy)>=.95&&b.data[(yy*r.width+xx)*4+3]!>0){best=(yy*r.width+xx)*4;dist=dd;}}if(best>=0)for(let c=0;c<3;c++){const i=(y*r.width+x)*4+c;data[i]=b.data[i]!+(b.data[best+c]!-b.data[i]!)*amount;}}if(y%16===0)await pause();}return replaceRegion(s,id,r,withPixels(r.width,r.height,data,b),signal);}
