import { pixelArray, withPixels, type PixelArray } from './pixelFormat.js';
import type { Bitmap } from './document.js';
/** Normalized Gaussian, truncated at 3 sigma, clamped boundary, associated alpha. */
export function gaussianBlur(source:Bitmap,sigma:number):Bitmap {
 const {width,height,data}=source,radius=Math.ceil(sigma*3),kernel=Float64Array.from({length:radius*2+1},(_,i)=>Math.exp(-((i-radius)**2)/(2*sigma*sigma))),sum=kernel.reduce((a,b)=>a+b,0);for(let i=0;i<kernel.length;i++)kernel[i]!/=sum;
 const out=pixelArray(data.length,source),tmp=new Float32Array(width*height),alpha=new Float32Array(width*height);
 for(const c of [3,0,1,2]){
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){let value=0;for(let k=-radius;k<=radius;k++){const i=(y*width+Math.max(0,Math.min(width-1,x+k)))*4;value+=kernel[k+radius]!*(c===3?data[i+3]!:data[i+c]!*data[i+3]!/255);}tmp[y*width+x]=value;}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){let value=0;for(let k=-radius;k<=radius;k++)value+=kernel[k+radius]!*tmp[Math.max(0,Math.min(height-1,y+k))*width+x]!;const p=y*width+x;if(c===3){alpha[p]=value;out[p*4+3]=value;}else out[p*4+c]=alpha[p]!>1e-6?value*255/alpha[p]!:0;}
 }
 return withPixels(width,height,out,source);
}
export function unsharpMask(source:Bitmap,amount:number,radius:number,threshold:number):Bitmap {
 if(!amount)return {...source,data:source.data.slice()};
 const blurred=gaussianBlur(source,radius).data,data=source.data.slice();
 for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;for(let c=0;c<3;c++){const difference=source.data[i+c]!-blurred[i+c]!;if(Math.abs(difference)>=threshold)data[i+c]=source.data[i+c]!+difference*amount/100;}}
 return {...source,data};
}
