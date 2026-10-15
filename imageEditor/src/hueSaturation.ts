import type { HueSaturationAdjustment } from 'ag-psd';
import type { Bitmap } from './document.js';
import type { HueSaturation } from './layerFeatures.js';
const names=['reds','yellows','greens','cyans','blues','magentas'] as const;
const defaults=names.map((_,i)=>({a:(315+i*60)%360,b:(345+i*60)%360,c:(15+i*60)%360,d:(45+i*60)%360,hue:0,saturation:0,lightness:0}));
/** ag-psd exposes the first 14 bytes as a channel. Adobe hue2 uses a flag,
 * padding and colorization H/S/L in the first eight bytes, then master H/S/L. */
export function readHueSaturation(a:HueSaturationAdjustment):HueSaturation {
 const m=a.master??{a:0,b:0,c:0,d:0,hue:0,saturation:0,lightness:0},colorize=!!(m.a&0xff00);
 return {colorize,hue:colorize?m.b:m.hue,saturation:colorize?m.c:m.saturation,lightness:colorize?m.d:m.lightness,ranges:names.map((k,i)=>({...a[k]??defaults[i]!}))};
}
export function writeHueSaturation(s:HueSaturation):HueSaturationAdjustment {
 return {type:'hue/saturation',master:{a:s.colorize?256:0,b:s.colorize?s.hue:0,c:s.colorize?s.saturation:0,d:s.colorize?s.lightness:0,hue:s.colorize?0:s.hue,saturation:s.colorize?0:s.saturation,lightness:s.colorize?0:s.lightness},...Object.fromEntries(names.map((k,i)=>[k,s.ranges?.[i]??defaults[i]!]))};
}
export function validateHueSaturation(s:HueSaturation|undefined){
 const valid=(v:{hue:number;saturation:number;lightness:number})=>[v.hue,v.saturation,v.lightness].every(Number.isFinite)&&Math.abs(v.hue)<=180&&Math.abs(v.saturation)<=100&&Math.abs(v.lightness)<=100;
 if(!s||typeof s.colorize!=='boolean'||!valid(s)||s.colorize&&s.saturation<0||s.ranges!==undefined&&(!Array.isArray(s.ranges)||s.ranges.length!==6||s.ranges.some(r=>!valid(r)||![r.a,r.b,r.c,r.d].every(v=>Number.isFinite(v)&&v>=0&&v<=360))))throw Error('色相／饱和度参数无效。');
}
const clamp=(v:number)=>Math.max(0,Math.min(1,v)),wrap=(v:number)=>(v%360+360)%360;
function weight(h:number,r:{a:number;b:number;c:number;d:number}){const b=wrap(r.b-r.a),c=wrap(r.c-r.a),d=wrap(r.d-r.a),v=wrap(h-r.a);return v>d?0:v<b?(b?v/b:1):v<=c?1:d===c?0:(d-v)/(d-c);}
export function hueSaturationBitmap(source:Bitmap,s:HueSaturation):Bitmap {
 const data=source.data.slice(),ranges=s.ranges?.filter(r=>r.hue||r.saturation||r.lightness)??[];
 for(let i=0;i<data.length;i+=4){const r=clamp(data[i]!/255),g=clamp(data[i+1]!/255),b=clamp(data[i+2]!/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;let l=(max+min)/2,sat=delta===0?0:delta/(1-Math.abs(2*l-1)),h=delta===0?0:wrap(60*(max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4));
  let hue=s.hue,saturation=s.saturation,lightness=s.lightness;
  if(s.colorize){h=wrap(hue);sat=saturation/100;}else{for(const range of ranges){const w=weight(h,range);hue+=range.hue*w;saturation+=range.saturation*w;lightness+=range.lightness*w;}h=wrap(h+hue);sat=delta===0?0:saturation<0?sat*(1+saturation/100):sat+(1-sat)*saturation/100;}
  l=clamp(lightness<0?l*(1+lightness/100):l+(1-l)*lightness/100);sat=clamp(sat);const c=(1-Math.abs(2*l-1))*sat,x=c*(1-Math.abs(h/60%2-1)),m=l-c/2,v=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];for(let k=0;k<3;k++)data[i+k]=(v[k]!+m)*255;
 }return {...source,data};
}
