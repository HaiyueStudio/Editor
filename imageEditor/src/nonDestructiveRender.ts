import { hueSaturationBitmap } from './hueSaturation.js';
import { pixelColor, depthOf, pixelArray, withPixels, type PixelArray } from './pixelFormat.js';
import type { Bitmap } from './document.js';
import type { AdjustmentContent, LayerStyles } from './layerFeatures.js';
import { filterBitmap } from './filters.js';
export function adjustmentBitmap(source:Bitmap,content:AdjustmentContent):Bitmap {
 if(content.filter==='hue-saturation')return hueSaturationBitmap(source,content.hueSaturation!);
 if(content.filter!=='curves'&&content.filter!=='levels')return filterBitmap(source,{kind:content.filter,amount:content.amount});
 if(depthOf(source)!==8){const fn=continuousAdjustment(content),channels=['red','green','blue'].map(k=>{const v=content.channels?.[k as 'red'];return v?continuousAdjustment({...content,...v}):null;}),data=source.data.slice();for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++){const v=fn(data[i+c]!);data[i+c]=channels[c]?.(v)??v;}return {...source,data};}
 const lut=adjustmentLut(content),channels=['red','green','blue'].map(k=>{const v=content.channels?.[k as 'red'];return v?adjustmentLut({...content,...v}):null;});
 const data=source.data.slice();for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++){const v=lut[data[i+c]!]!;data[i+c]=channels[c]?.[v]??v;}return {...source,data};
}
function adjustmentLut(content:AdjustmentContent):Uint8ClampedArray {
 const lut=new Uint8ClampedArray(256);
 if(content.filter==='levels'){
  const l=content.levels!;for(let i=0;i<256;i++)lut[i]=l.outputBlack+Math.pow(Math.max(0,Math.min(1,(i-l.black)/(l.white-l.black))),1/l.gamma)*(l.outputWhite-l.outputBlack);
 }else{
  // Natural cubic spline, evaluated once per edit rather than once per pixel.
  const p=content.curves!,n=p.length,m=new Float64Array(n),u=new Float64Array(n);
  for(let i=1;i<n-1;i++){const span=p[i+1]!.input-p[i-1]!.input,s=(p[i]!.input-p[i-1]!.input)/span,q=s*m[i-1]!+2;m[i]=(s-1)/q;u[i]=(6*((p[i+1]!.output-p[i]!.output)/(p[i+1]!.input-p[i]!.input)-(p[i]!.output-p[i-1]!.output)/(p[i]!.input-p[i-1]!.input))/span-s*u[i-1]!)/q;}
  for(let i=n-2;i>=0;i--)m[i]=m[i]!*m[i+1]!+u[i]!;
  let j=0;for(let x=0;x<256;x++){while(j<n-2&&x>p[j+1]!.input)j++;const a=p[j]!,b=p[j+1]!,h=b.input-a.input,t=(b.input-x)/h,v=(x-a.input)/h;lut[x]=t*a.output+v*b.output+((t*t*t-t)*m[j]!+(v*v*v-v)*m[j+1]!)*h*h/6;}
 }
 return lut;
}
function rgb(color:string,source:Bitmap){return pixelColor([1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),depthOf(source));}
function spread(alpha:Float32Array,width:number,height:number,radius:number,maximum:boolean):Float32Array {
 if(!radius)return alpha.slice();
 if(!Number.isInteger(radius)){const lo=Math.floor(radius),t=radius-lo,a=spread(alpha,width,height,lo,maximum),b=spread(alpha,width,height,lo+1,maximum);return a.map((v,i)=>v*(1-t)+b[i]!*t);}
 const pass=(input:Float32Array,horizontal:boolean)=>{
  const out=new Float32Array(input.length),length=horizontal?width:height,rows=horizontal?height:width,queue=new Int32Array(length);
  for(let row=0;row<rows;row++){
   const at=(i:number)=>horizontal?row*width+i:i*width+row;let head=0,tail=0,sum=0,right=-1;
   for(let i=0;i<length;i++){
    const end=Math.min(length-1,i+radius);while(right<end){right++;if(maximum){while(tail>head&&input[at(queue[tail-1]!)]!<=input[at(right)]!)tail--;queue[tail++]=right;}else sum+=input[at(right)]!;}
    if(maximum){while(head<tail&&queue[head]!<i-radius)head++;out[at(i)]=input[at(queue[head]!)]!;}
    else {const gone=i-radius-1;if(gone>=0)sum-=input[at(gone)]!;out[at(i)]=sum/(radius*2+1);}
   }
  }return out;
 };return pass(pass(alpha,true),false);
}
/** Common styles are live parameters. Shadow uses a bounded separable blur; stroke uses square dilation. */
export function styleBitmap(source:Bitmap,styles:LayerStyles|undefined,origin={x:0,y:0}):Bitmap {
 if(!styles?.enabled)return source;
 if(!styles.shadow&&!styles.stroke&&!styles.innerGlow){if(!styles.overlay)return source;const overlay=styles.overlay,color=rgb(overlay.color,source),data=source.data.slice();for(let i=0;i<data.length;i+=4)if(data[i+3])for(let c=0;c<3;c++)data[i+c]=data[i+c]!*(1-overlay.opacity)+color[c]!*overlay.opacity;return withPixels(source.width,source.height,data,source);}
 const {width,height}=source,alpha=Float32Array.from({length:width*height},(_,i)=>source.data[i*4+3]!/255),data=pixelArray(source.data.length,source);
 const put=(i:number,color:readonly number[],a:number)=>{if(!a)return;const b=data[i+3]!/255,o=a+b*(1-a);for(let c=0;c<3;c++)data[i+c]=(color[c]!*a+data[i+c]!*b*(1-a))/o;data[i+3]=o*255;};
 if(styles.shadow){const s=styles.shadow,color=rgb(s.color,source),blurred=spread(alpha,width,height,s.blur,false);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sx=x-s.dx,sy=y-s.dy,ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;const at=(px:number,py:number)=>px>=0&&py>=0&&px<width&&py<height?blurred[py*width+px]!:0;const a=at(ix,iy)*(1-fx)*(1-fy)+at(ix+1,iy)*fx*(1-fy)+at(ix,iy+1)*(1-fx)*fy+at(ix+1,iy+1)*fx*fy;if(a)put((y*width+x)*4,color,a*s.opacity);}}
 if(styles.stroke){const s=styles.stroke,color=rgb(s.color,source),dilated=spread(alpha,width,height,s.size,true);for(let i=0;i<alpha.length;i++)put(i*4,color,Math.max(0,dilated[i]!-alpha[i]!)*s.opacity);}
 const overlay=styles.overlay,color=overlay?rgb(overlay.color,source):null,g=styles.innerGlow,glowColor=g?rgb(g.color,source):null,glowAlpha=g&&g.size?spread(alpha,width,height,Math.ceil(g.size),false):undefined;
 for(let p=0;p<alpha.length;p++){const i=p*4,base=[source.data[i]!,source.data[i+1]!,source.data[i+2]!];if(color&&overlay)for(let c=0;c<3;c++)base[c]=base[c]!*(1-overlay.opacity)+color[c]!*overlay.opacity;if(g&&glowColor){const edge=glowAlpha?Math.max(0,1-glowAlpha[p]!):0,coverage=g.source==='center'?1-edge:edge;const x=p%width+origin.x,y=Math.floor(p/width)+origin.y,seed=Math.imul(x+1,374761393)^Math.imul(y+1,668265263),random=((Math.imul(seed^(seed>>>13),1274126177)>>>0)/4294967296),weight=Math.max(0,Math.min(1,coverage/Math.max(.01,g.range*2)+g.choke/100))*g.opacity*(1-g.noise*random);for(let c=0;c<3;c++){const v=g.blend==='screen'?255-(255-base[c]!)*(255-glowColor[c]!)/255:glowColor[c]!;base[c]=base[c]!*(1-weight)+v*weight;}}put(i,base,alpha[p]!);}
 return withPixels(width,height,data,source);
}

function continuousAdjustment(content:AdjustmentContent):(x:number)=>number {
 if(content.filter==='levels'){const l=content.levels!;return x=>l.outputBlack+Math.pow(Math.max(0,Math.min(1,(x-l.black)/(l.white-l.black))),1/l.gamma)*(l.outputWhite-l.outputBlack);}
 const p=content.curves!,n=p.length,m=new Float64Array(n),u=new Float64Array(n);
 for(let i=1;i<n-1;i++){const span=p[i+1]!.input-p[i-1]!.input,s=(p[i]!.input-p[i-1]!.input)/span,q=s*m[i-1]!+2;m[i]=(s-1)/q;u[i]=(6*((p[i+1]!.output-p[i]!.output)/(p[i+1]!.input-p[i]!.input)-(p[i]!.output-p[i-1]!.output)/(p[i]!.input-p[i-1]!.input))/span-s*u[i-1]!)/q;}for(let i=n-2;i>=0;i--)m[i]=m[i]!*m[i+1]!+u[i]!;
 return x=>{let j=0;while(j<n-2&&x>p[j+1]!.input)j++;const a=p[j]!,b=p[j+1]!,h=b.input-a.input,t=(b.input-x)/h,v=(x-a.input)/h;if(x<0||x>255)return a.output+(x-a.input)*(b.output-a.output)/h;return t*a.output+v*b.output+((t*t*t-t)*m[j]!+(v*v*v-v)*m[j+1]!)*h*h/6;};
}
