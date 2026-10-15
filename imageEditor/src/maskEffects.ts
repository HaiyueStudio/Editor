import {maskSample,validateMaskSamples} from './diskMasks.js';
import { selectionWeight } from './selection.js';
import { validateRuns } from './selectionRuns.js';
import type { LayerMask } from './layerFeatures.js';
export function rawMaskWeight(mask:LayerMask,x:number,y:number):number {x-=mask.x;y-=mask.y;return (x<0||y<0||x>=mask.width||y>=mask.height?mask.defaultColor:(mask.samples?maskSample(mask,x,y):mask.coverage?255*selectionWeight(mask.coverage,x,y):mask.data[y*mask.width+x]!))/255;}
const cache=new WeakMap<Uint8Array|Float32Array,{sigma:number;defaultColor:number;w:number;h:number;data:Float32Array;radius:number}>();
/** Gaussian feather pads with the mask's explicit exterior value; raw coverage is never changed. */
export function effectiveMaskWeight(mask:LayerMask|undefined,x:number,y:number):number {
 if(!mask||mask.disabled)return 1;const sigma=mask.feather??0;let value:number;
 if((mask.coverage||mask.samples)&&sigma)return sparseFeather(mask,x,y);
 if(!sigma)value=rawMaskWeight(mask,x,y);
 else{let item=cache.get(mask.data);if(!item||item.sigma!==sigma||item.defaultColor!==mask.defaultColor||item.w!==mask.width||item.h!==mask.height){
  const r=Math.ceil(3*sigma),w=mask.width+2*r,h=mask.height+2*r,k=Float64Array.from({length:2*r+1},(_,i)=>Math.exp(-((i-r)**2)/(2*sigma*sigma))),sum=k.reduce((a,b)=>a+b);for(let i=0;i<k.length;i++)k[i]!/=sum;
  const tmp=new Float32Array(w*mask.height),data=new Float32Array(w*h);
  for(let yy=0;yy<mask.height;yy++)for(let xx=0;xx<w;xx++){let v=0;for(let dx=-r;dx<=r;dx++){const sx=xx-r+dx;v+=k[dx+r]!*(sx<0||sx>=mask.width?mask.defaultColor:mask.data[yy*mask.width+sx]!);}tmp[yy*w+xx]=v;}
  for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){let v=0;for(let dy=-r;dy<=r;dy++){const sy=yy-r+dy;v+=k[dy+r]!*(sy<0||sy>=mask.height?mask.defaultColor:tmp[sy*w+xx]!);}data[yy*w+xx]=v/255;}
  item={sigma,defaultColor:mask.defaultColor,w:mask.width,h:mask.height,data,radius:r};cache.set(mask.data,item);
 }const xx=x-mask.x+item.radius,yy=y-mask.y+item.radius,w=item.w+2*item.radius,h=item.h+2*item.radius;value=xx<0||yy<0||xx>=w||yy>=h?mask.defaultColor/255:item.data[yy*w+xx]!;}
 return 1-(mask.density??1)*(1-value);
}
export function validateMask(mask:LayerMask){if(mask?.vector){const v=mask.vector;if(!Array.isArray(v.paths)||v.paths.length>128||v.paths.reduce((n,p)=>n+p.knots.length,0)>8192||[v.invert,v.disable,v.notLink,v.fillStartsWithAllPixels].some(b=>b!==undefined&&typeof b!=='boolean')||v.paths.some(p=>!Array.isArray(p.knots)||p.knots.some(k=>k.points.length!==6||k.points.some(n=>!Number.isFinite(n)||Math.abs(n)>32768))))throw Error('矢量蒙版路径无效。');}if(!mask||![mask.width,mask.height].every(n=>Number.isInteger(n)&&n>=1&&n<=30000)||!mask.coverage&&!mask.samples&&mask.width*mask.height>16777216||!(mask.data instanceof Uint8Array||mask.data instanceof Float32Array)||(mask.coverage||mask.samples?mask.data.length!==0:mask.data.length!==mask.width*mask.height)||![mask.x,mask.y].every(n=>Number.isInteger(n)&&Math.abs(n)<=32768)||typeof mask.disabled!=='boolean'||!Number.isInteger(mask.defaultColor)||mask.defaultColor<0||mask.defaultColor>255||mask.density!==undefined&&(!Number.isFinite(mask.density)||mask.density<0||mask.density>1)||mask.feather!==undefined&&(!Number.isFinite(mask.feather)||mask.feather<0||mask.feather>64))throw new Error('蒙版像素、密度或羽化参数无效。');if(mask.samples){if(mask.coverage||mask.data.length)throw Error('蒙版存储冲突。');validateMaskSamples(mask);}if(mask.coverage){const c=mask.coverage;validateRuns(c);if(![c.x,c.y,c.width,c.height].every(Number.isInteger)||c.x<0||c.y<0||c.width<1||c.height<1||c.x+c.width>mask.width||c.y+c.height>mask.height||c.mask&&c.mask.length!==c.width*c.height)throw Error('稀疏蒙版范围无效。');}if(mask.data instanceof Float32Array&&mask.data.some(v=>!Number.isFinite(v)||v<0||v>255))throw Error('浮点蒙版数值无效。');}

const featherTiles=new WeakMap<LayerMask,Map<string,Float32Array>>();
function sparseFeather(mask:LayerMask,x:number,y:number):number {
 const size=64,tx=Math.floor(x/size)*size,ty=Math.floor(y/size)*size,key=`${tx}/${ty}`;let cache=featherTiles.get(mask);if(!cache){cache=new Map();featherTiles.set(mask,cache);}let data=cache.get(key);
 if(!data){const sigma=mask.feather!,r=Math.ceil(3*sigma),k=Float64Array.from({length:2*r+1},(_,i)=>Math.exp(-((i-r)**2)/(2*sigma*sigma))),sum=k.reduce((a,b)=>a+b);for(let i=0;i<k.length;i++)k[i]!/=sum;const tmp=new Float32Array(size*(size+2*r));
  for(let yy=0;yy<size+2*r;yy++)for(let xx=0;xx<size;xx++){let v=0;for(let dx=-r;dx<=r;dx++)v+=k[dx+r]!*rawMaskWeight(mask,tx+xx+dx,ty+yy-r);tmp[yy*size+xx]=v;}
  data=new Float32Array(size*size);for(let yy=0;yy<size;yy++)for(let xx=0;xx<size;xx++){let v=0;for(let dy=-r;dy<=r;dy++)v+=k[dy+r]!*tmp[(yy+r+dy)*size+xx]!;data[yy*size+xx]=v;}
  if(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(key,data);
 }return 1-(mask.density??1)*(1-data[(y-ty)*size+x-tx]!);
}

/** Bounded feather tiles for GPU mask uploads; avoids a full dense feather surface. */
export function regionalMaskWeight(mask:LayerMask,x:number,y:number){return mask.disabled?1:mask.feather?sparseFeather(mask,x,y):effectiveMaskWeight(mask,x,y);}
