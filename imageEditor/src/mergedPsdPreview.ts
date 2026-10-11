import type { RasterSource } from './rasterSource.js';
import type { BitDepth } from './pixelFormat.js';
import { withPixels,pixelArray } from './pixelFormat.js';
import { cmykBitmap } from './cmyk.js';
/** Seek only sampled rows of a real, opaque Raw/RLE merged image. ZIP falls back to layer previews. */
export async function mergedPsdPreview(source:RasterSource,start:number,width:number,height:number,channels:number,depth:BitDepth,cmyk:boolean,large:boolean,profile?:Uint8Array,signal?:AbortSignal){
 if(channels!==(cmyk?4:3)||start+2>source.size)return;
 const compression=new DataView((await source.read(start,2,signal)).buffer).getUint16(0);if(compression>1)return;
 const scale=Math.min(1,(cmyk?256:512)/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale)),data=pixelArray(w*h*4,depth),ink=cmyk?new Float32Array(w*h*4):undefined,rowBytes=width*depth/8,unit=large?4:2;for(let i=3;i<data.length;i+=4)data[i]=255;
 let offset=start+2+channels*height*unit;
 for(let c=0;c<channels;c++){
  let positions:Float64Array|undefined;if(compression===1){const table=new DataView((await source.read(start+2+c*height*unit,height*unit,signal)).buffer);positions=new Float64Array(height+1);positions[0]=offset;for(let y=0;y<height;y++)positions[y+1]=positions[y]!+(large?table.getUint32(y*4):table.getUint16(y*2));offset=positions[height]!;}
  for(let y=0;y<h;y++){signal?.throwIfAborted();const sy=Math.min(height-1,Math.floor((y+.5)*height/h));let row:Uint8Array;
   if(!positions)row=await source.read(start+2+(c*height+sy)*rowBytes,rowBytes,signal);
   else{const bytes=await source.read(positions[sy]!,positions[sy+1]!-positions[sy]!,signal);row=new Uint8Array(rowBytes);let p=0,x=0;while(p<bytes.length){const n=bytes[p++]!;if(n===128)continue;const count=n<128?n+1:257-n;if(x+count>rowBytes||p+(n<128?count:1)>bytes.length)throw Error('PSD 预览行无效。');if(n<128){row.set(bytes.subarray(p,p+count),x);p+=count;}else row.fill(bytes[p++]!,x,x+count);x+=count;}if(x!==rowBytes)throw Error('PSD 预览行截断。');}
   const v=new DataView(row.buffer,row.byteOffset,row.byteLength);for(let x=0;x<w;x++){const sx=Math.min(width-1,Math.floor((x+.5)*width/w)),value=depth===8?row[sx]!:depth===16?v.getUint16(sx*2)/257:v.getFloat32(sx*4)*255,i=(y*w+x)*4+c;if(ink)ink[i]=(1-value/255)*100;else data[i]=value;}
  }
 }
 return ink?cmykBitmap(w,h,ink,new Float32Array(w*h).fill(255),depth as 8|16,profile):withPixels(w,h,data,depth);
}
