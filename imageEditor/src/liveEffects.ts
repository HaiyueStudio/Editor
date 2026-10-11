import { bitmapRegion } from './pagedPixels.js';
import { filterInputRect, cropFiltered } from './regionalFilters.js';
import type { CompositeRect } from './compositor.js';
import type { Bitmap, ImageLayer } from './document.js';
import { filterBitmap, validateFilterSettings, type FilterSettings } from './filters.js';
import { BLEND_MODES, maskWeight, type BlendMode } from './layerFeatures.js';
export type SplitRange=readonly [number,number,number,number];
export interface BlendIf { enabled:boolean; channel:'gray'|'red'|'green'|'blue'; source:SplitRange; underlying:SplitRange }
export interface SmartFilter { id:string; enabled:boolean; settings:FilterSettings; opacity:number; blend:BlendMode }
export function validateBlendIf(b:BlendIf){if(!b||typeof b.enabled!=='boolean'||!['gray','red','green','blue'].includes(b.channel))throw new Error('Blend If 通道或开关无效。');for(const range of [b.source,b.underlying])if(!Array.isArray(range)||range.length!==4||range.some((n,i)=>!Number.isInteger(n)||n<0||n>255||i>0&&n<range[i-1]!))throw new Error('混合颜色带需要四个递增的 0–255 整数。');}
export function validateSmartFilters(filters:readonly SmartFilter[]){if(!Array.isArray(filters)||filters.length>16)throw new Error('智能滤镜最多 16 个。');const ids=new Set<string>();for(const f of filters){if(!f||typeof f.id!=='string'||!f.id.length||f.id.length>80||ids.has(f.id)||typeof f.enabled!=='boolean'||!Number.isFinite(f.opacity)||f.opacity<0||f.opacity>1||!Object.hasOwn(BLEND_MODES,f.blend))throw new Error('智能滤镜参数或 ID 无效。');ids.add(f.id);validateFilterSettings(f.settings);}}
export function blendChannel(back:number,source:number,mode:BlendMode):number {
 switch(mode){case 'soft-light':return source<=.5?back-(1-2*source)*back*(1-back):back+(2*source-1)*((back<=.25?((16*back-12)*back+4)*back:Math.sqrt(Math.max(0,back)))-back);case 'color-dodge':return back===0?0:source>=1?1:Math.min(1,back/(1-source));case 'color-burn':return back===1?1:source<=0?0:1-Math.min(1,(1-back)/source);case 'linear-dodge':return back+source;case 'linear-burn':return back+source-1;case 'linear-light':return back+2*source-1;case 'vivid-light':return source<=.5?blendChannel(back,source*2,'color-burn'):blendChannel(back,source*2-1,'color-dodge');case 'pin-light':return source<=.5?Math.min(back,source*2):Math.max(back,source*2-1);case 'hard-mix':return back+source>=1?1:0;case 'subtract':return back-source;case 'divide':return source===0?1:Math.min(1,back/source);case 'multiply':return back*source;case 'screen':return back+source-back*source;case 'overlay':return back<=.5?2*back*source:1-2*(1-back)*(1-source);case 'hard-light':return source<=.5?2*back*source:1-2*(1-back)*(1-source);case 'darken':return Math.min(back,source);case 'lighten':return Math.max(back,source);case 'difference':return Math.abs(back-source);case 'exclusion':return back+source-2*back*source;default:return source;}
}
/** PDF/W3C nonseparable blend functions, with luminosity preserved during gamut clipping. */
export function blendRgb(back:readonly number[],source:readonly number[],mode:BlendMode):number[] {
 const lum=(c:readonly number[])=>.3*c[0]!+.59*c[1]!+.11*c[2]!,sat=(c:readonly number[])=>Math.max(...c)-Math.min(...c);
 const setLum=(c:readonly number[],l:number)=>{const d=l-lum(c),v=c.map(n=>n+d),n=Math.min(...v),x=Math.max(...v);if(n<0)for(let i=0;i<3;i++)v[i]=l+(v[i]!-l)*l/(l-n);if(x>1)for(let i=0;i<3;i++)v[i]=l+(v[i]!-l)*(1-l)/(x-l);return v;};
 const setSat=(c:readonly number[],s:number)=>{const order=[0,1,2].sort((a,b)=>c[a]!-c[b]!),lo=order[0]!,mid=order[1]!,hi=order[2]!,v=[0,0,0];if(c[hi]!>c[lo]!){v[mid]=(c[mid]!-c[lo]!)*s/(c[hi]!-c[lo]!);v[hi]=s;}return v;};
 switch(mode){case 'hue':return setLum(setSat(source,sat(back)),lum(back));case 'saturation':return setLum(setSat(back,sat(source)),lum(back));case 'color':return setLum(source,lum(back));case 'luminosity':return setLum(back,lum(source));case 'darker-color':return [...(lum(source)<lum(back)?source:back)];case 'lighter-color':return [...(lum(source)>lum(back)?source:back)];default:return back.map((b,i)=>blendChannel(b,source[i]!,mode));}
}
export const nonseparableBlend=(mode:BlendMode)=>['hue','saturation','color','luminosity','darker-color','lighter-color'].includes(mode);
function rangeWeight(v:number,[a,b,c,d]:SplitRange){return (a===b?(v<a?0:1):Math.max(0,Math.min(1,(v-a)/(b-a))))*(c===d?(v>d?0:1):Math.max(0,Math.min(1,(d-v)/(d-c))));}
export function blendIfWeight(rule:BlendIf|undefined,source:ArrayLike<number>,si:number,back:ArrayLike<number>,bi:number):number {
 if(!rule?.enabled)return 1;const channel=(data:ArrayLike<number>,i:number)=>rule.channel==='gray'?.2126*data[i]!+.7152*data[i+1]!+.0722*data[i+2]!:data[i+(['red','green','blue'].indexOf(rule.channel))]!;
 const alpha=back[bi+3]!/255;return rangeWeight(channel(source,si),rule.source)*(1-alpha+alpha*rangeWeight(channel(back,bi),rule.underlying));
}
const cache=new WeakMap<Bitmap,{key:string;output:Bitmap}>();
export function invalidateFilterStack(source:Bitmap){cache.delete(source);}
export function primeFilterStack(source:Bitmap,filters:readonly SmartFilter[],output:Bitmap){cache.set(source,{key:JSON.stringify(filters),output});}
/** Index zero runs first. Opacity interpolates the input and blended filter result in associated RGBA. */
export function filterStackBitmap(source:Bitmap,filters:readonly SmartFilter[]):Bitmap {
 validateSmartFilters(filters);const key=JSON.stringify(filters),cached=cache.get(source);if(cached?.key===key)return cached.output;
 let out=source;
 for(const f of filters){if(!f.enabled||!f.opacity)continue;const processed=filterBitmap(out,f.settings),data=processed.data;
  for(let i=0;i<data.length;i+=4){const a=out.data[i+3]!/255,b=data[i+3]!/255,t=f.opacity,alpha=a*(1-t)+b*t;
   const blended=blendRgb([out.data[i]!/255,out.data[i+1]!/255,out.data[i+2]!/255],[data[i]!/255,data[i+1]!/255,data[i+2]!/255],f.blend);
   for(let c=0;c<3;c++){const original=out.data[i+c]!/255,result=data[i+c]!/255,mixed=(1-a)*result+a*((source.depth??8)===32?blended[c]!:Math.max(0,Math.min(1,blended[c]!)));data[i+c]=alpha?255*(original*a*(1-t)+mixed*b*t)/alpha:out.data[i+c]!;}data[i+3]=alpha*255;
  }out=processed;
 }
 primeFilterStack(source,filters,out);return out;
}
export function liveBitmap(layer:ImageLayer):Bitmap|null {
 const source=layer.bitmap;if(!source||!layer.smartFilters?.length)return source;
 const filtered=filterStackBitmap(source,layer.smartFilters),mask=layer.filterMask;if(!mask||mask.disabled||filtered===source)return filtered;
 const data=filtered.data.slice();for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){const i=(y*source.width+x)*4,t=maskWeight(mask,x,y),a=source.data[i+3]!/255,b=filtered.data[i+3]!/255,alpha=a*(1-t)+b*t;for(let c=0;c<3;c++)data[i+c]=alpha?(source.data[i+c]!*a*(1-t)+filtered.data[i+c]!*b*t)/alpha:source.data[i+c]!;data[i+3]=alpha*255;}return {...source,data};
}
export function secondBatchLayer(l:ImageLayer):boolean{return l.smartFilters!==undefined||l.filterMask!==undefined||l.blendIf!==undefined||l.mask?.density!==undefined||l.mask?.feather!==undefined;}

/** Back-propagate support through the stack, cropping each stage to its requested region. */
export function liveBitmapRegion(layer:ImageLayer,rect:CompositeRect):Bitmap {
 const source=layer.bitmap!;const filters=layer.smartFilters??[];validateSmartFilters(filters);
 const stage=(n:number,r:CompositeRect):Bitmap=>{if(n<0)return bitmapRegion(source,r.x,r.y,r.width,r.height);const f=filters[n]!;if(!f.enabled||!f.opacity)return stage(n-1,r);
  const input=filterInputRect(source.width,source.height,f.settings,r),before=stage(n-1,input),after=filterStackBitmap(before,[f]);return cropFiltered(after,input,r);
 };
 const filtered=stage(filters.length-1,rect),mask=layer.filterMask;if(!mask||mask.disabled)return filtered;
 const original=bitmapRegion(source,rect.x,rect.y,rect.width,rect.height),data=filtered.data;
 for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++){const i=(y*rect.width+x)*4,t=maskWeight(mask,x+rect.x,y+rect.y),a=original.data[i+3]!/255,b=data[i+3]!/255,alpha=a*(1-t)+b*t;for(let c=0;c<3;c++)data[i+c]=alpha?(original.data[i+c]!*a*(1-t)+data[i+c]!*b*t)/alpha:original.data[i+c]!;data[i+3]=alpha*255;}return filtered;
}
