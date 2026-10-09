import { checkSize, type Bitmap } from './document.js';
import { validateResampling, type Resampling } from './resamplingTypes.js';
export { RESAMPLING, validateResampling, type Resampling } from './resamplingTypes.js';
function kernel(x:number,method:Resampling):number {
 x=Math.abs(x);if(method==='bilinear')return Math.max(0,1-x);
 if(method==='bicubic')return x<1?1.5*x*x*x-2.5*x*x+1:x<2?-.5*x*x*x+2.5*x*x-4*x+2:0;
 return x<1e-8?1:x<3?Math.sin(Math.PI*x)*Math.sin(Math.PI*x/3)/(Math.PI*Math.PI*x*x/3):0;
}
const support=(method:Resampling)=>method==='bilinear'?1:method==='bicubic'?2:3;
function weights(source:number,target:number,method:Resampling) {
 const scale=Math.max(1,source/target),radius=support(method)*scale;
 return Array.from({length:target},(_,i)=>{const center=(i+.5)*source/target-.5,start=Math.ceil(center-radius),end=Math.floor(center+radius),indices:number[]=[],values:number[]=[];let sum=0;
  for(let j=start;j<=end;j++){const value=kernel((j-center)/scale,method);if(!value)continue;indices.push(Math.max(0,Math.min(source-1,j)));values.push(value);sum+=value;}return {indices,values:values.map(v=>v/sum)};
 });
}
/** Separable, scale-aware low pass resampling in associated RGBA; one float plane at a time. */
export function resizeBitmap(source:Bitmap,width:number,height:number,method:Resampling='bicubic'):Bitmap {
 checkSize(width,height);validateResampling(method);
 if(width===source.width&&height===source.height)return {...source,data:source.data.slice()};
 const data=new Uint8ClampedArray(width*height*4);
 if(method==='nearest'){for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(Math.floor((y+.5)*source.height/height)*source.width+Math.floor((x+.5)*source.width/width))*4;data.set(source.data.subarray(i,i+4),(y*width+x)*4);}return {width,height,data};}
 const wx=weights(source.width,width,method),wy=weights(source.height,height,method);
 // Choose the smaller intermediate plane for extreme aspect-ratio changes.
 const horizontalFirst=width*source.height<=source.width*height,iw=horizontalFirst?width:source.width,ih=horizontalFirst?source.height:height;
 const tmp=new Float32Array(iw*ih),alpha=new Float32Array(width*height);
 for(const c of [3,0,1,2]){
  for(let y=0;y<ih;y++)for(let x=0;x<iw;x++){const w=horizontalFirst?wx[x]!:wy[y]!;let sum=0;for(let k=0;k<w.indices.length;k++){const i=(horizontalFirst?y*source.width+w.indices[k]!:w.indices[k]!*source.width+x)*4;sum+=w.values[k]!*(c===3?source.data[i+3]!:source.data[i+c]!*source.data[i+3]!/255);}tmp[y*iw+x]=sum;}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const w=horizontalFirst?wy[y]!:wx[x]!;let sum=0;for(let k=0;k<w.indices.length;k++)sum+=w.values[k]!*tmp[horizontalFirst?w.indices[k]!*iw+x:y*iw+w.indices[k]!]!;const p=y*width+x;if(c===3){alpha[p]=sum;data[p*4+3]=sum;}else data[p*4+c]=alpha[p]!>1e-6?sum*255/alpha[p]!:0;}
 }
 return {width,height,data};
}
/** Filtered rotation, transparent beyond the resized image; flips share the inverse mapping. */
export function rotateBitmap(source:Bitmap,angle:number,flipX:boolean,flipY:boolean,method:Resampling):Bitmap {
 const radians=angle*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians),sw=source.width,sh=source.height;
 const width=Math.ceil(Math.abs(sw*cos)+Math.abs(sh*sin)-1e-8),height=Math.ceil(Math.abs(sw*sin)+Math.abs(sh*cos)-1e-8);checkSize(width,height);
 const data=new Uint8ClampedArray(width*height*4),r=support(method);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const cx=x+.5-width/2,cy=y+.5-height/2;let sx=cx*cos+cy*sin+sw/2-.5,sy=-cx*sin+cy*cos+sh/2-.5;if(flipX)sx=sw-1-sx;if(flipY)sy=sh-1-sy;
  const at=(y*width+x)*4;
  if(Math.abs(sx-Math.round(sx))<1e-8&&Math.abs(sy-Math.round(sy))<1e-8){const xx=Math.round(sx),yy=Math.round(sy);if(xx>=0&&xx<sw&&yy>=0&&yy<sh){const i=(yy*sw+xx)*4;data.set(source.data.subarray(i,i+4),at);}continue;}
  let a=0,red=0,green=0,blue=0,sumX=0,sumY=0;for(let i=Math.ceil(sx-r);i<=Math.floor(sx+r);i++)sumX+=kernel(sx-i,method);for(let i=Math.ceil(sy-r);i<=Math.floor(sy+r);i++)sumY+=kernel(sy-i,method);
  for(let yy=Math.max(0,Math.ceil(sy-r));yy<=Math.min(sh-1,Math.floor(sy+r));yy++)for(let xx=Math.max(0,Math.ceil(sx-r));xx<=Math.min(sw-1,Math.floor(sx+r));xx++){const i=(yy*sw+xx)*4,w=kernel(sx-xx,method)*kernel(sy-yy,method)*source.data[i+3]!;a+=w;red+=source.data[i]!*w;green+=source.data[i+1]!*w;blue+=source.data[i+2]!*w;}
  if(a>1e-6){data[at]=red/a;data[at+1]=green/a;data[at+2]=blue/a;data[at+3]=a/(sumX*sumY);}
 }
 return {width,height,data};
}
