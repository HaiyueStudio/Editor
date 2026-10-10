import type { ImageLayer, ImageState } from './document.js';
import { embeddedProfile, parseRgbProfile, builtinProfile } from './colorManagement.js';
export const GPU_IMAGE_BUDGET=128*1024*1024;
export const GPU_BLEND_MODES=['normal','multiply','screen','overlay','darken','lighten','hard-light','difference','exclusion'] as const;
export interface GpuImageLayer {layer:ImageLayer;x:number;y:number}
/** Admit only semantics implemented by the GPU compositor. Everything else uses the reference compositor. */
export function gpuImageLayers(state:ImageState):GpuImageLayer[]|undefined {
 if((state.bitDepth??8)!==8||state.colorMode==='cmyk')return;
 const result:GpuImageLayer[]=[];
 const walk=(layers:readonly ImageLayer[],x=0,y=0):boolean=>layers.every(layer=>{
  if(layer.clipping)return false;
  if(!layer.visible||!layer.opacity)return true;
  if(layer.styles?.enabled||layer.smartFilters?.some(f=>f.enabled)||layer.blendIf?.enabled||layer.content?.type==='adjustment')return false;
  const px=x+layer.x,py=y+layer.y;
  if(layer.kind==='group')return !!layer.passThrough&&layer.opacity===1&&!layer.mask&&walk(layer.children,px,py);
  if(!layer.bitmap||!GPU_BLEND_MODES.includes(layer.blend)||!Number.isInteger(px)||!Number.isInteger(py))return false;
  if(px<state.width&&py<state.height&&px+layer.bitmap.width>0&&py+layer.bitmap.height>0)result.push({layer,x:px,y:py});return true;
 });
 return walk(state.layers)?result:undefined;
}
/** Matrix/TRC profile converted to a WGSL mat3 and three 256-entry decode tables.
 * LUT/proof/monitor workflows stay on LittleCMS, rather than approximating them with a 3D LUT. */
export function gpuDisplayProfile(state:ImageState):{matrix:Float32Array;curves:Float32Array}|undefined {
 if(state.icc)return;
 const bytes=embeddedProfile(state);
 if(!bytes)return {matrix:new Float32Array(12),curves:new Float32Array(0)};
 try {
  const p=parseRgbProfile(bytes),s=builtinProfile('srgb').matrix;
  const [a,b,c,d,e,f,g,h,i]=s as readonly number[],det=a!*(e!*i!-f!*h!)-b!*(d!*i!-f!*g!)+c!*(d!*h!-e!*g!);
  const inv=[e!*i!-f!*h!,c!*h!-b!*i!,b!*f!-c!*e!,f!*g!-d!*i!,a!*i!-c!*g!,c!*d!-a!*f!,d!*h!-e!*g!,b!*g!-a!*h!,a!*e!-b!*d!].map(n=>n/det);
  const matrix=new Float32Array(12);for(let row=0;row<3;row++)for(let col=0;col<3;col++)matrix[col*4+row]=[0,1,2].reduce((v,k)=>v+inv[row*3+k]!*p.matrix[k*3+col]!,0);
  const curves=new Float32Array(256*4);for(let n=0;n<256;n++)for(let ch=0;ch<3;ch++)curves[n*4+ch]=p.curves[ch]![n]!;
  return {matrix,curves};
 }catch{return;}
}
