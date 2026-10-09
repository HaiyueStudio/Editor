import { gaussianBlur, unsharpMask } from './qualityFilters.js';
import { type Bitmap, type ImageLayer, type ImageState } from './document.js';
import { editablePixel, parentOffset } from './pixelTools.js';
import { selectionWeight } from './selection.js';
export const FILTERS = {
  brightness:{name:'亮度',min:-100,max:100,value:15,unit:'%'},
  contrast:{name:'对比度',min:-100,max:100,value:20,unit:'%'},
  saturation:{name:'饱和度',min:-100,max:100,value:20,unit:'%'},
  hue:{name:'色相旋转',min:-180,max:180,value:30,unit:'°'},
  grayscale:{name:'黑白',min:0,max:100,value:100,unit:'%'},
  sepia:{name:'复古棕褐',min:0,max:100,value:100,unit:'%'},
  invert:{name:'反相',min:0,max:100,value:100,unit:'%'},
  threshold:{name:'阈值',min:0,max:255,value:128,unit:''},
  posterize:{name:'色调分离',min:2,max:32,value:6,unit:'级'},
  blur:{name:'柔化模糊',min:1,max:32,value:4,unit:'px'},
  gaussian:{name:'高斯模糊',min:0.1,max:32,value:2,unit:'σ px',step:0.1},
  usm:{name:'USM 锐化',min:0,max:500,value:100,unit:'%',parameters:{radius:{min:0.1,max:32,value:2,unit:'σ px'},threshold:{min:0,max:255,value:0,unit:'色阶'}}},
  sharpen:{name:'锐化',min:0,max:100,value:40,unit:'%'},
  emboss:{name:'浮雕',min:0,max:100,value:100,unit:'%'},
  pixelate:{name:'马赛克',min:2,max:64,value:8,unit:'px'},
} as const;
export type FilterKind = keyof typeof FILTERS;
export interface FilterSettings { kind:FilterKind; amount:number; radius?:number; threshold?:number }
/** Sliding box blur on associated RGBA avoids dark/colored halos from hidden RGB. */
function blur(source:Bitmap,radius:number):Uint8ClampedArray {
  const {width:w,height:h,data}=source,n=w*h,out=new Uint8ClampedArray(data.length),a=new Float32Array(n),b=new Float32Array(n);
  for(const channel of [3,0,1,2]) {
    for(let i=0;i<n;i++)a[i]=channel===3?data[i*4+3]!:data[i*4+channel]!*data[i*4+3]!/255;
    for(let y=0;y<h;y++){let sum=0;for(let x=-radius;x<=radius;x++)sum+=a[y*w+Math.max(0,Math.min(w-1,x))]!;
      for(let x=0;x<w;x++){b[y*w+x]=sum/(radius*2+1);sum+=a[y*w+Math.min(w-1,x+radius+1)]!-a[y*w+Math.max(0,x-radius)]!;}}
    for(let x=0;x<w;x++){let sum=0;for(let y=-radius;y<=radius;y++)sum+=b[Math.max(0,Math.min(h-1,y))*w+x]!;
      for(let y=0;y<h;y++){const i=y*w+x,value=sum/(radius*2+1);a[i]=value;sum+=b[Math.min(h-1,y+radius+1)*w+x]!-b[Math.max(0,y-radius)*w+x]!;}}
    for(let i=0;i<n;i++)out[i*4+channel]=channel===3?a[i]!:out[i*4+3]?a[i]!*255/out[i*4+3]!:data[i*4+channel]!;
  }return out;
}
export function validateFilterSettings(settings:FilterSettings) {
 const {kind,amount,radius,threshold}=settings,config=FILTERS[kind];
 if(!Object.hasOwn(FILTERS,kind)||!config||!Number.isFinite(amount)||(kind!=='gaussian'&&!Number.isInteger(amount))||amount<config.min||amount>config.max)throw new Error('滤镜参数无效。');
 if(kind!=='usm'&&(radius!==undefined||threshold!==undefined))throw new Error('半径和阈值仅用于 USM 锐化。');
 if(radius!==undefined&&(!Number.isFinite(radius)||radius<.1||radius>32)||threshold!==undefined&&(!Number.isInteger(threshold)||threshold<0||threshold>255))throw new Error('USM 半径或阈值无效。');
}
export function filterBitmap(source:Bitmap,settings:FilterSettings):Bitmap {
  validateFilterSettings(settings);const {kind,amount}=settings;
  if(kind==='gaussian')return gaussianBlur(source,amount);
  if(kind==='usm')return unsharpMask(source,amount,settings.radius??2,settings.threshold??0);
  const {width:w,height:h,data}=source,out=kind==='blur'?blur(source,amount):data.slice();
  if(kind==='pixelate') {
    for(let y=0;y<h;y+=amount)for(let x=0;x<w;x+=amount){const sums=[0,0,0,0];let count=0;
      for(let by=y;by<Math.min(h,y+amount);by++)for(let bx=x;bx<Math.min(w,x+amount);bx++){const i=(by*w+bx)*4,a=data[i+3]!;count++;sums[3]!+=a;for(let c=0;c<3;c++)sums[c]!+=data[i+c]!*a;}
      for(let by=y;by<Math.min(h,y+amount);by++)for(let bx=x;bx<Math.min(w,x+amount);bx++){const i=(by*w+bx)*4;out[i+3]=sums[3]!/count;for(let c=0;c<3;c++)out[i+c]=sums[3]?sums[c]!/sums[3]!:data[i+c]!;}
    }
  }else if(kind!=='blur') {
    const angle=amount*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const i=(y*w+x)*4,r=data[i]!,g=data[i+1]!,b=data[i+2]!,lum=.2126*r+.7152*g+.0722*b;
      let color=[r,g,b];
      switch(kind){
        case 'brightness':color=color.map(v=>v+amount*2.55);break;
        case 'contrast':{const f=amount>=0?1+amount/25:1+amount/100;color=color.map(v=>(v-127.5)*f+127.5);break;}
        case 'saturation':color=color.map(v=>lum+(v-lum)*(1+amount/100));break;
        case 'grayscale':color=color.map(v=>v+(lum-v)*amount/100);break;
        case 'invert':color=color.map(v=>v+(255-2*v)*amount/100);break;
        case 'sepia':{const target=[.393*r+.769*g+.189*b,.349*r+.686*g+.168*b,.272*r+.534*g+.131*b];color=color.map((v,c)=>v+(Math.min(255,target[c]!)-v)*amount/100);break;}
        case 'threshold':color=[lum>=amount?255:0,lum>=amount?255:0,lum>=amount?255:0];break;
        case 'posterize':color=color.map(v=>Math.round(v/255*(amount-1))*255/(amount-1));break;
        case 'hue':color=[(.213+.787*cos-.213*sin)*r+(.715-.715*cos-.715*sin)*g+(.072-.072*cos+.928*sin)*b,(.213-.213*cos+.143*sin)*r+(.715+.285*cos+.140*sin)*g+(.072-.072*cos-.283*sin)*b,(.213-.213*cos-.787*sin)*r+(.715-.715*cos+.715*sin)*g+(.072+.928*cos+.072*sin)*b];break;
        case 'sharpen':case 'emboss':{
          const sample=(sx:number,sy:number,c:number)=>{const j=(Math.max(0,Math.min(h-1,sy))*w+Math.max(0,Math.min(w-1,sx)))*4;return data[j+c]!*data[j+3]!/255+data[i+c]!*(1-data[j+3]!/255);};
          color=color.map((v,c)=>kind==='sharpen'?v+(4*v-sample(x-1,y,c)-sample(x+1,y,c)-sample(x,y-1,c)-sample(x,y+1,c))*amount/100:v+(128+sample(x+1,y+1,c)-sample(x-1,y-1,c)-v)*amount/100);break;
        }
      }
      if(data[i+3])for(let c=0;c<3;c++)out[i+c]=color[c]!;
    }
  }
  return {width:w,height:h,data:out};
}
export function filterLayer(state:ImageState,id:string,settings:FilterSettings):ImageLayer {
  const layer=editablePixel(state,id);if(!layer.bitmap)throw new Error('请选择含像素的图层。');
  const filtered=filterBitmap(layer.bitmap,settings),offset=parentOffset(state.layers,id)!,source=layer.bitmap.data;
  for(let y=0;y<filtered.height;y++)for(let x=0;x<filtered.width;x++){
    const weight=selectionWeight(state.selection,x+layer.x+offset.x,y+layer.y+offset.y),i=(y*filtered.width+x)*4;
    if(weight===1)continue;
    if(weight===0){filtered.data.set(source.subarray(i,i+4),i);continue;}
    const a=source[i+3]!/255,b=filtered.data[i+3]!/255,alpha=a*(1-weight)+b*weight;
    for(let c=0;c<3;c++)filtered.data[i+c]=alpha?(source[i+c]!*a*(1-weight)+filtered.data[i+c]!*b*weight)/alpha:source[i+c]!;
    filtered.data[i+3]=alpha*255;
  }
  return {...layer,bitmap:filtered};
}
