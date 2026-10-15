import type { Bitmap } from './document.js';
import { maskSelection, selectionWeight, modifySelection, type Selection } from './selection.js';
export interface RefineSettings { radius:number; contrast:number; shift:number; edgeAware:boolean }
function box(input:Float32Array,width:number,height:number,radius:number):Float32Array {
 const pass=(source:Float32Array,horizontal:boolean)=>{const out=new Float32Array(source.length),length=horizontal?width:height,lines=horizontal?height:width;for(let line=0;line<lines;line++){const at=(i:number)=>horizontal?line*width+i:i*width+line;let sum=0,right=-1,left=0;for(let p=0;p<length;p++){while(right<Math.min(length-1,p+radius))sum+=source[at(++right)]!;while(left<Math.max(0,p-radius))sum-=source[at(left++)]!;out[at(p)]=sum/(right-left+1);}}return out;};return pass(pass(input,true),false);
}
/** Fast guided filtering: at most 262144 model pixels, full-resolution guide during reconstruction. */
export function refineSelection(source:Bitmap,selection:Selection,settings:RefineSettings):Selection {
 const {radius,contrast,shift,edgeAware}=settings,{width,height}=source;
 if(!Number.isInteger(radius)||radius<1||radius>32||!Number.isFinite(contrast)||contrast<0||contrast>100||!Number.isInteger(shift)||Math.abs(shift)>32||typeof edgeAware!=='boolean')throw new Error('边缘细化参数无效。');
 const region=shift?modifySelection(selection,width,height,shift>0?'expand':'contract',Math.abs(shift)):selection;
 const scale=Math.max(1,Math.ceil(Math.sqrt(width*height/262144))),w=Math.ceil(width/scale),h=Math.ceil(height/scale),guide=new Float32Array(w*h),mask=new Float32Array(w*h);
 const luminance=(x:number,y:number)=>{const i=(y*width+x)*4;return (source.data[i]!*.2126+source.data[i+1]!*.7152+source.data[i+2]!*.0722)*source.data[i+3]!/65025;};
 for(let gy=0;gy<h;gy++)for(let gx=0;gx<w;gx++){let n=0,g=0,p=0;for(let y=gy*scale;y<Math.min(height,(gy+1)*scale);y++)for(let x=gx*scale;x<Math.min(width,(gx+1)*scale);x++){g+=luminance(x,y);p+=selectionWeight(region,x,y);n++;}guide[gy*w+gx]=g/n;mask[gy*w+gx]=p/n;}
 const r=Math.max(1,Math.round(radius/scale)),meanG=box(guide,w,h,r),meanP=box(mask,w,h,r),square=guide.map(x=>x*x),product=guide.map((x,i)=>x*mask[i]!),corr=box(square,w,h,r),cross=box(product,w,h,r),a=new Float32Array(w*h),b=new Float32Array(w*h);
 for(let i=0;i<a.length;i++){a[i]=edgeAware?(cross[i]!-meanG[i]!*meanP[i]!)/(Math.max(0,corr[i]!-meanG[i]!*meanG[i]!)+.001):0;b[i]=meanP[i]!-a[i]!*meanG[i]!;}
 const ma=box(a,w,h,r),mb=box(b,w,h,r),out=new Uint8Array(width*height),gain=1+contrast/10;
 const sample=(array:Float32Array,x:number,y:number)=>{x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));const ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1),fx=x-ix,fy=y-iy;return (array[iy*w+ix]!*(1-fx)+array[iy*w+jx]!*fx)*(1-fy)+(array[jy*w+ix]!*(1-fx)+array[jy*w+jx]!*fx)*fy;};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const gx=(x+.5)/scale-.5,gy=(y+.5)/scale-.5,q=sample(ma,gx,gy)*luminance(x,y)+sample(mb,gx,gy);out[y*width+x]=Math.round(Math.max(0,Math.min(1,(q-.5)*gain+.5))*255);}
 return maskSelection(out,width,height);
}
