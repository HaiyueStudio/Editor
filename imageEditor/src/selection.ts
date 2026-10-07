import type { Bitmap } from './document.js';
import type { Point, Rect, Color } from './pixelTools.js';
/** Missing selection means unrestricted editing; an all-zero mask means explicitly empty. */
export interface Selection extends Rect { readonly mask?: Uint8Array }
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';
export function selectionWeight(selection: Selection | null | undefined, x: number, y: number): number {
  if (!selection) return 1;
  x = Math.floor(x) - selection.x; y = Math.floor(y) - selection.y;
  if (x < 0 || y < 0 || x >= selection.width || y >= selection.height) return 0;
  return selection.mask ? selection.mask[y * selection.width + x]! / 255 : 1;
}
export function selectionCount(selection: Selection): number {
  return selection.mask ? selection.mask.reduce((n, value) => n + Number(value > 0), 0) : selection.width * selection.height;
}
export function maskSelection(mask: Uint8Array, width: number, height: number): Selection {
  if (mask.length !== width * height) throw new Error('选区蒙版尺寸无效。');
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) { x0 = Math.min(x0,x); y0 = Math.min(y0,y); x1 = Math.max(x1,x); y1 = Math.max(y1,y); }
  if (x1 < 0) return { x:0, y:0, width:1, height:1, mask:new Uint8Array(1) };
  const w = x1-x0+1, h = y1-y0+1, data = new Uint8Array(w*h); let solid = true;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = mask[(y+y0)*width+x+x0]!; data[y*w+x] = v; if (v !== 255) solid = false; }
  return { x:x0,y:y0,width:w,height:h,...(solid ? {} : {mask:data}) };
}
export function combineSelection(before: Selection | null | undefined, next: Selection, mode: SelectionMode, width: number, height: number): Selection {
  if (mode === 'replace') return next;
  const mask = new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    // No active region is empty for add/subtract, unrestricted for intersection.
    const a = before ? selectionWeight(before,x,y)*255 : mode === 'intersect' ? 255 : 0, b=selectionWeight(next,x,y)*255;
    mask[y*width+x]=mode==='add'?Math.max(a,b):mode==='subtract'?Math.max(0,a-b):Math.min(a,b);
  }
  return maskSelection(mask,width,height);
}
export function invertSelection(selection: Selection | null | undefined, width: number,height: number): Selection {
  const mask=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)mask[y*width+x]=selection?255-Math.round(selectionWeight(selection,x,y)*255):255;
  return maskSelection(mask,width,height);
}
export function ellipseSelection(rect: Rect): Selection {
  const mask=new Uint8Array(rect.width*rect.height);
  for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++) if(((x+.5-rect.width/2)/(rect.width/2))**2+((y+.5-rect.height/2)/(rect.height/2))**2<=1)mask[y*rect.width+x]=255;
  return {...rect,mask};
}
/** Even/odd scanline fill; pixel centers define the edge of a freehand or polygonal lasso. */
export function polygonSelection(points: readonly Point[], width:number,height:number): Selection {
  const mask=new Uint8Array(width*height);
  if(points.length<3)return maskSelection(mask,width,height);
  const y0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))),y1=Math.min(height,Math.ceil(Math.max(...points.map(p=>p.y))));
  for(let y=y0;y<y1;y++) {
    const hits:number[]=[];
    for(let i=0,j=points.length-1;i<points.length;j=i++) {
      const a=points[i]!,b=points[j]!;
      if((a.y>y+.5)!==(b.y>y+.5))hits.push(a.x+(y+.5-a.y)*(b.x-a.x)/(b.y-a.y));
    }
    hits.sort((a,b)=>a-b);
    for(let i=0;i+1<hits.length;i+=2)for(let x=Math.max(0,Math.ceil(hits[i]!-.5));x<Math.min(width,Math.ceil(hits[i+1]!-.5));x++)mask[y*width+x]=255;
  }
  return maskSelection(mask,width,height);
}
/** RGBA comparison ignores hidden RGB of transparent pixels and includes alpha differences. */
export function colorSelection(bitmap: Bitmap, color: Color | readonly [number,number,number,number], tolerance:number, seed?:Point): Selection {
  if(!Number.isFinite(tolerance)||tolerance<0||tolerance>255)throw new Error('颜色容差应在 0–255 内。');
  const {width,height,data}=bitmap,mask=new Uint8Array(width*height),alpha=color.length===4?color[3]!:255;
  const matches=(p:number)=>{const a=data[p*4+3]!;let distance=Math.abs(a-alpha);for(let c=0;c<3;c++)distance=Math.max(distance,Math.abs(data[p*4+c]!*a/255-color[c]!*alpha/255));return distance<=tolerance;};
  if(!seed){for(let i=0;i<mask.length;i++)if(matches(i))mask[i]=255;}
  else {
    const x=Math.floor(seed.x),y=Math.floor(seed.y);
    if(x<0||y<0||x>=width||y>=height)return maskSelection(mask,width,height);
    const queue=new Int32Array(width*height),seen=new Uint8Array(width*height);let head=0,tail=0;
    const push=(p:number)=>{if(!seen[p]){seen[p]=1;if(matches(p)){mask[p]=255;queue[tail++]=p;}}};push(y*width+x);
    while(head<tail){const p=queue[head++]!,px=p%width;if(px>0)push(p-1);if(px+1<width)push(p+1);if(p>=width)push(p-width);if(p+width<mask.length)push(p+width);}
  }
  return maskSelection(mask,width,height);
}
export function modifySelection(selection:Selection,width:number,height:number,kind:'feather'|'expand'|'contract',radius:number):Selection {
  if(!Number.isInteger(radius)||radius<1||radius>64)throw new Error('选区半径应为 1–64 px。');
  const source=new Uint8Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)source[y*width+x]=Math.round(selectionWeight(selection,x,y)*255);
  // Separable square dilation/erosion or box feather; O(pixel count), with zero beyond canvas.
  const pass=(input:Uint8Array,horizontal:boolean)=>{
    const output=new Uint8Array(input.length),length=horizontal?width:height,lines=horizontal?height:width,window=radius*2+1;
    const index=(line:number,p:number)=>horizontal?line*width+p:p*width+line;
    for(let line=0;line<lines;line++) {
      if(kind==='feather') {let sum=0;for(let p=0;p<=radius&&p<length;p++)sum+=input[index(line,p)]!;
        for(let p=0;p<length;p++){output[index(line,p)]=Math.round(sum/window);if(p-radius>=0)sum-=input[index(line,p-radius)]!;if(p+radius+1<length)sum+=input[index(line,p+radius+1)]!;}
      }else {const queue:number[]=[];let head=0;
        for(let p=-radius;p<length+radius;p++) {const value=p<0||p>=length?0:input[index(line,p)]!;
          while(queue.length>head){const last=queue[queue.length-1]!,v=last<0||last>=length?0:input[index(line,last)]!;if(kind==='expand'?v>value:v<value)break;queue.pop();}queue.push(p);
          while(queue[head]!<p-2*radius)head++;
          const center=p-radius;if(center>=0&&center<length){const best=queue[head]!;output[index(line,center)]=best<0||best>=length?0:input[index(line,best)]!;}
        }
      }
    }return output;
  };return maskSelection(pass(pass(source,true),false),width,height);
}
