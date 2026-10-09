import type { Bitmap, ImageLayer } from './document.js';
import { filterBitmap, validateFilterSettings, type FilterSettings } from './filters.js';
import { BLEND_MODES, maskWeight, type BlendMode } from './layerFeatures.js';
export type SplitRange=readonly [number,number,number,number];
export interface BlendIf { enabled:boolean; channel:'gray'|'red'|'green'|'blue'; source:SplitRange; underlying:SplitRange }
export interface SmartFilter { id:string; enabled:boolean; settings:FilterSettings; opacity:number; blend:BlendMode }
export function validateBlendIf(b:BlendIf){if(!b||typeof b.enabled!=='boolean'||!['gray','red','green','blue'].includes(b.channel))throw new Error('Blend If 通道或开关无效。');for(const range of [b.source,b.underlying])if(!Array.isArray(range)||range.length!==4||range.some((n,i)=>!Number.isInteger(n)||n<0||n>255||i>0&&n<range[i-1]!))throw new Error('混合颜色带需要四个递增的 0–255 整数。');}
export function validateSmartFilters(filters:readonly SmartFilter[]){if(!Array.isArray(filters)||filters.length>16)throw new Error('智能滤镜最多 16 个。');const ids=new Set<string>();for(const f of filters){if(!f||typeof f.id!=='string'||!f.id.length||f.id.length>80||ids.has(f.id)||typeof f.enabled!=='boolean'||!Number.isFinite(f.opacity)||f.opacity<0||f.opacity>1||!Object.hasOwn(BLEND_MODES,f.blend))throw new Error('智能滤镜参数或 ID 无效。');ids.add(f.id);validateFilterSettings(f.settings);}}
export function blendChannel(back:number,source:number,mode:BlendMode):number {
 switch(mode){case 'multiply':return back*source;case 'screen':return back+source-back*source;case 'overlay':return back<=.5?2*back*source:1-2*(1-back)*(1-source);case 'hard-light':return source<=.5?2*back*source:1-2*(1-back)*(1-source);case 'darken':return Math.min(back,source);case 'lighten':return Math.max(back,source);case 'difference':return Math.abs(back-source);case 'exclusion':return back+source-2*back*source;default:return source;}
}
function rangeWeight(v:number,[a,b,c,d]:SplitRange){return (a===b?(v<a?0:1):Math.max(0,Math.min(1,(v-a)/(b-a))))*(c===d?(v>d?0:1):Math.max(0,Math.min(1,(d-v)/(d-c))));}
export function blendIfWeight(rule:BlendIf|undefined,source:ArrayLike<number>,si:number,back:ArrayLike<number>,bi:number):number {
 if(!rule?.enabled)return 1;const channel=(data:ArrayLike<number>,i:number)=>rule.channel==='gray'?.2126*data[i]!+.7152*data[i+1]!+.0722*data[i+2]!:data[i+(['red','green','blue'].indexOf(rule.channel))]!;
 const alpha=back[bi+3]!/255;return rangeWeight(channel(source,si),rule.source)*(1-alpha+alpha*rangeWeight(channel(back,bi),rule.underlying));
}
const cache=new WeakMap<Bitmap,{key:string;output:Bitmap}>();
export function primeFilterStack(source:Bitmap,filters:readonly SmartFilter[],output:Bitmap){cache.set(source,{key:JSON.stringify(filters),output});}
/** Index zero runs first. Opacity interpolates the input and blended filter result in associated RGBA. */
export function filterStackBitmap(source:Bitmap,filters:readonly SmartFilter[]):Bitmap {
 validateSmartFilters(filters);const key=JSON.stringify(filters),cached=cache.get(source);if(cached?.key===key)return cached.output;
 let out=source;
 for(const f of filters){if(!f.enabled||!f.opacity)continue;const processed=filterBitmap(out,f.settings),data=processed.data;
  for(let i=0;i<data.length;i+=4){const a=out.data[i+3]!/255,b=data[i+3]!/255,t=f.opacity,alpha=a*(1-t)+b*t;
   for(let c=0;c<3;c++){const original=out.data[i+c]!/255,result=data[i+c]!/255,mixed=(1-a)*result+a*blendChannel(original,result,f.blend);data[i+c]=alpha?255*(original*a*(1-t)+mixed*b*t)/alpha:out.data[i+c]!;}data[i+3]=alpha*255;
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
