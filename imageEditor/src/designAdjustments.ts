import type { AdjustmentLayer } from 'ag-psd';
import type { AdjustmentContent } from './layerFeatures.js';
import type { Bitmap } from './document.js';
import { depthOf, withPixels } from './pixelFormat.js';
export const DESIGN_ADJUSTMENTS = {'exposure':'曝光度','vibrance':'自然饱和度','color-balance':'色彩平衡','channel-mixer':'通道混合器','black-white':'黑白（六色）','posterize':'色调分离','threshold':'阈值'} as const;
export type DesignAdjustment = keyof typeof DESIGN_ADJUSTMENTS;
export type AdjustmentParameters = Readonly<Record<string,number|boolean>>;
type Field={key:string;label:string;min:number;max:number;step:number;value:number|boolean};
export function adjustmentFields(kind:DesignAdjustment):Field[]{
 const f=(key:string,label:string,min:number,max:number,value:number|boolean,step=1)=>({key,label,min,max,step,value});
 switch(kind){
 case 'exposure':return [f('exposure','曝光（EV）',-20,20,0,.01),f('offset','位移',-1,1,0,.001),f('gamma','灰度系数',.1,9.99,1,.01)];
 case 'vibrance':return [f('vibrance','自然饱和度',-100,100,0),f('saturation','饱和度',-100,100,0)];
 case 'color-balance':return ['shadows','midtones','highlights'].flatMap((tone,i)=>['cyanRed','magentaGreen','yellowBlue'].map((axis,j)=>f(tone+'.'+axis,['阴影','中间调','高光'][i]+' · '+['青—红','洋红—绿','黄—蓝'][j],-100,100,0))).concat(f('preserveLuminosity','保持明度',0,1,true));
 case 'channel-mixer':return ['red','green','blue','gray'].flatMap((channel,i)=>['red','green','blue','constant'].map((axis,j)=>f(channel+'.'+axis,['红输出','绿输出','蓝输出','灰输出'][i]+' · '+['红','绿','蓝','常数'][j],-200,200,i===j?100:i===3?[40,40,20,0][j]!:0))).concat(f('monochrome','单色',0,1,false));
 case 'black-white':return ['reds','yellows','greens','cyans','blues','magentas'].map((key,i)=>f(key,['红色','黄色','绿色','青色','蓝色','洋红'][i]!,-200,300,[40,60,40,60,20,80][i]!));
 case 'posterize':return [f('levels','色阶数',2,255,4)];
 case 'threshold':return [f('level','阈值',1,255,128)];
 }
}
export function isDesignAdjustment(kind:string):kind is DesignAdjustment{return Object.hasOwn(DESIGN_ADJUSTMENTS,kind);}
export function defaultAdjustment(kind:DesignAdjustment):AdjustmentContent{return {type:'adjustment',filter:kind,amount:100,parameters:Object.fromEntries(adjustmentFields(kind).map(f=>[f.key,f.value]))};}
export function validateDesignAdjustment(c:AdjustmentContent){
 if(!isDesignAdjustment(c.filter)||c.amount!==100||!c.parameters||typeof c.parameters!=='object'||Array.isArray(c.parameters))throw Error('调整参数无效。');
 const fields=adjustmentFields(c.filter);if(Object.keys(c.parameters).length!==fields.length)throw Error('调整参数缺失或包含未知字段。');
 for(const f of fields){const v=c.parameters[f.key];if(typeof f.value==='boolean'?typeof v!=='boolean':typeof v!=='number'||!Number.isFinite(v)||v<f.min||v>f.max||f.step===1&&!Number.isInteger(v))throw Error('调整参数无效：'+f.label);}
}
const nativeNames={'exposure':'exposure','vibrance':'vibrance','color-balance':'color balance','channel-mixer':'channel mixer','black-white':'black & white','posterize':'posterize','threshold':'threshold'} as const;
export function writeDesignAdjustment(c:AdjustmentContent):AdjustmentLayer {
 validateDesignAdjustment(c);const result:Record<string,unknown>={type:nativeNames[c.filter as DesignAdjustment]};
 for(const [key,value] of Object.entries(c.parameters!)){const [a,b]=key.split('.');if(b)(result[a!]??={}) as object, (result[a!] as Record<string,unknown>)[b]=value;else result[a!]=value;}
 if(c.filter==='black-white')result.useTint=false;
 return result as unknown as AdjustmentLayer;
}
export function readDesignAdjustment(a:AdjustmentLayer):AdjustmentContent|undefined {
 const kind=(Object.keys(nativeNames) as DesignAdjustment[]).find(k=>nativeNames[k]===a.type);if(!kind)return;
 if(a.type==='black & white'&&a.useTint)throw Error('黑白调整的着色模式尚未支持。');
 const defaults=defaultAdjustment(kind),p={...defaults.parameters},raw=a as unknown as Record<string,unknown>;
 for(const f of adjustmentFields(kind)){const [k,s]=f.key.split('.'),v=s?(raw[k!] as Record<string,unknown>|undefined)?.[s]:raw[k!];if(v!==undefined)p[f.key]=v as number|boolean;}
 const c={...defaults,parameters:p};validateDesignAdjustment(c);return c;
}
/** Pointwise operations retain float HDR values; bounded tonal operations deliberately map to SDR. */
export function designAdjustmentBitmap(source:Bitmap,c:AdjustmentContent):Bitmap {
 validateDesignAdjustment(c);const p=c.parameters!,n=(k:string)=>p[k] as number,data=source.data.slice(),clamp=(v:number)=>Math.max(0,Math.min(255,v)),lum=(r:number,g:number,b:number)=>.3*r+.59*g+.11*b;
 for(let i=0;i<data.length;i+=4){const rgb=[data[i]!,data[i+1]!,data[i+2]!],l=lum(...rgb as [number,number,number]);let out=rgb;
 switch(c.filter){
 case 'exposure':out=rgb.map(v=>{const x=v/255*2**n('exposure')+n('offset');return Math.sign(x)*Math.abs(x)**(1/n('gamma'))*255;});break;
 case 'vibrance':{const hi=Math.max(...rgb),lo=Math.min(...rgb),sat=hi>0?(hi-lo)/hi:0,weight=(1+n('saturation')/100)*(1+n('vibrance')/100*(1-sat));out=rgb.map(v=>l+(v-l)*weight);break;}
 case 'color-balance':{const t=clamp(l)/255,weights=[(1-t)**2,2*t*(1-t),t*t];out=rgb.map((v,j)=>v+2.55*['shadows','midtones','highlights'].reduce((sum,tone,k)=>sum+n(tone+'.'+['cyanRed','magentaGreen','yellowBlue'][j])*weights[k]!,0));if(p.preserveLuminosity){const d=l-lum(...out as [number,number,number]);out=out.map(v=>v+d);}break;}
 case 'channel-mixer':out=['red','green','blue'].map(channel=>{const key=p.monochrome?'gray':channel;return rgb.reduce((sum,v,j)=>sum+v*n(key+'.'+['red','green','blue'][j])/100,2.55*n(key+'.constant'));});break;
 case 'black-white':{const [r,g,b]=rgb,lo=Math.min(...rgb),hi=Math.max(...rgb);let v=lo;if(hi!==lo){const h=hi===r?((g!-b!)/(hi-lo)+6)%6:hi===g?(b!-r!)/(hi-lo)+2:(r!-g!)/(hi-lo)+4,k=Math.floor(h),f=h-k,keys=['reds','yellows','greens','cyans','blues','magentas'];v+=(hi-lo)*(n(keys[k]!)*(1-f)+n(keys[(k+1)%6]!)*f)/100;}out=[v,v,v];break;}
 case 'posterize':out=rgb.map(v=>Math.round(clamp(v)/255*(n('levels')-1))*255/(n('levels')-1));break;
 case 'threshold':out=rgb.map(()=>l>=n('level')?255:0);break;
 }
 for(let ch=0;ch<3;ch++)data[i+ch]=depthOf(source)===32?out[ch]!:clamp(out[ch]!);
 }return withPixels(source.width,source.height,data,source);
}
