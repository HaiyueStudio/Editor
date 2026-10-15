import type { TaskReport } from './workerTask.js';
import { DiskRasterWriter } from './rasterSource.js';
import type { Layer, Psd, LayerRawData } from 'ag-psd';
import type { Bitmap } from './document.js';
import { checkSize } from './document.js';
import { deflate } from 'pako';
import { inflateChunks } from './largeImageImport.js';
import { diskPager, type DiskBlob } from './diskPager.js';
import { pagedBitmap } from './pagedPixels.js';
import { withPixels, pixelArray, pixelBytesView, type BitDepth, validateBitmap } from './pixelFormat.js';
import { cmykBitmap } from './cmyk.js';
import { runSelection } from './selectionRuns.js';
import type { LayerMask } from './layerFeatures.js';
const STRIPE=32;
type Channel=LayerRawData['channels'][number];
/** Raw, PackBits and ZIP prediction share bounded, native-endian row bands. */
export function* nativePsdRows(width:number,height:number,channel:Channel,depth:BitDepth,large=false,signal?:AbortSignal):Generator<Uint8Array>{
 const bytes=channel.data;if(!bytes)throw Error('PSD 通道缺失。');const row=width*depth/8,tableBytes=large?4:2,v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),zip=channel.compression>=2?inflateChunks([bytes],row*height,signal):undefined;
 let block=new Uint8Array(0) as Uint8Array<ArrayBufferLike>,at=0,offset=height*tableBytes;
 if(channel.compression===0&&bytes.length!==row*height)throw Error('PSD 原始通道长度不符。');if(channel.compression===1&&bytes.length<offset)throw Error('PSD 行表截断。');
 for(let y=0;y<height;y+=STRIPE){signal?.throwIfAborted();const h=Math.min(STRIPE,height-y),out=new Uint8Array(row*h);
  if(zip){let written=0;while(written<out.length){if(at===block.length){const next=zip.next();if(next.done)throw Error('PSD ZIP 截断。');block=next.value;at=0;}const n=Math.min(out.length-written,block.length-at);out.set(block.subarray(at,at+n),written);written+=n;at+=n;}
   if(channel.compression===3){if(depth===16){const view=new DataView(out.buffer);for(let yy=0;yy<h;yy++)for(let x=1;x<width;x++){const i=yy*row+x*2;view.setUint16(i,(view.getUint16(i)+view.getUint16(i-2))&65535);}}else{for(let yy=0;yy<h;yy++)for(let x=1;x<row;x++){const i=yy*row+x;out[i]=(out[i]!+out[i-1]!)&255;}if(depth===32){const copy=out.slice();for(let yy=0;yy<h;yy++)for(let x=0;x<width;x++)for(let c=0;c<4;c++)out[yy*row+x*4+c]=copy[yy*row+c*width+x]!;}}}
  }else if(channel.compression===0)out.set(bytes.subarray(y*row,(y+h)*row));
  else if(channel.compression===1){for(let yy=0;yy<h;yy++){const n=large?v.getUint32((y+yy)*4):v.getUint16((y+yy)*2),end=offset+n;let x=0;if(end>bytes.length)throw Error('PSD RLE 截断。');while(offset<end){const control=bytes[offset++]!;if(control===128)continue;const count=control<128?control+1:257-control;if(x+count>row||offset+(control<128?count:1)>end)throw Error('PSD RLE 编码无效。');if(control<128){out.set(bytes.subarray(offset,offset+count),yy*row+x);offset+=count;}else out.fill(bytes[offset++]!,yy*row+x,yy*row+x+count);x+=count;}if(x!==row)throw Error('PSD RLE 行宽不符。');}}
  else throw Error('PSD 压缩方式无效。');yield out;
 }
 if(zip&&!zip.next().done||channel.compression===1&&offset!==bytes.length)throw Error('PSD 通道尾部数据无效。');
}
function value(bytes:Uint8Array,i:number,depth:BitDepth,v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)){return depth===8?bytes[i]!:depth===16?v.getUint16(i*2)/257:v.getFloat32(i*4)*255;}
/** Only 32 scanlines per channel and one row of 256px tiles are resident. */
export async function decodeNativePsdBitmap(width:number,height:number,channels:Channel[],depth:BitDepth,cmyk:boolean,large=false,profile?:Uint8Array,signal?:AbortSignal,report?:TaskReport):Promise<Bitmap>{
 checkSize(width,height);const ids=new Set(channels.map(c=>c.id));if(cmyk&&![0,1,2,3].every(c=>ids.has(c)))throw Error('CMYK 图层缺少原生通道。');if(ids.size!==channels.length||channels.some(c=>c.id < -1||c.id>(cmyk?3:2)))throw Error('PSD 包含额外通道。');
 return decodePsdRowReaders(width,height,channels.map(c=>({id:c.id,rows:nativePsdRows(width,height,c,depth,large,signal)})),depth,cmyk,profile,signal,report);
}
export async function decodePsdRowReaders(width:number,height:number,readers:{id:number;rows:AsyncGenerator<Uint8Array>|Generator<Uint8Array>}[],depth:BitDepth,cmyk:boolean,profile?:Uint8Array,signal?:AbortSignal,report?:TaskReport):Promise<Bitmap>{
 const writer=new DiskRasterWriter(width,height,depth,cmyk,report);
 for(let y=0;y<height;y+=STRIPE){
  const sh=Math.min(STRIPE,height-y),rows=await Promise.all(readers.map(async c=>{const result=await c.rows.next(),data=result.value;if(result.done||!(data instanceof Uint8Array)||data.length!==width*sh*depth/8)throw Error('PSD 通道长度不符。');return {...c,data,view:new DataView(data.buffer,data.byteOffset,data.byteLength)};})),data=pixelArray(width*sh*4,depth),ink=cmyk?new Float32Array(data.length):undefined;
  for(let i=3;i<data.length;i+=4)data[i]=255;
  for(let i=0;i<width*sh;i++)for(const r of rows){const n=value(r.data,i,depth,r.view);if(cmyk&&r.id>=0)ink![i*4+r.id]=(1-n/255)*100;else data[i*4+(r.id===-1?3:r.id)]=n;}
  await writer.write(cmyk?cmykBitmap(width,sh,ink!,Float32Array.from({length:width*sh},(_,i)=>data[i*4+3]!),depth as 8|16,profile):withPixels(width,sh,data,depth),signal);
  // Yield between bands in the main-thread fallback as well as Worker imports.
  if(y%256===0)await new Promise<void>(r=>setTimeout(r,0));
 }
 for(const r of readers)if(!(await r.rows.next()).done)throw Error('PSD 通道长度不符。');return writer.finish();
}

export async function decodeNativeMask(layer:Layer,depth:BitDepth,signal?:AbortSignal):Promise<Pick<LayerMask,'data'|'coverage'|'precision'|'samples'>|undefined>{
 const m=layer.mask,c=layer.rawData?.channels.find(c=>c.id===-2);if(!m||!c)return;const w=(m.right??0)-(m.left??0),h=(m.bottom??0)-(m.top??0);if(!w||!h)return;checkSize(w,h);
 const rows=nativePsdRows(w,h,c,depth,!!layer.rawData?.large,signal);if(depth!==8){const {pageMaskRows}=await import('./diskMasks.js');function* samples(){for(const stripe of rows){const view=new DataView(stripe.buffer,stripe.byteOffset,stripe.byteLength);yield Float32Array.from({length:stripe.length/(depth/8)},(_,i)=>value(stripe,i,depth,view));}}return {data:new Float32Array(),precision:'float32',samples:await pageMaskRows(w,h,samples(),signal)};}
 let stripe=new Uint8Array(),top=-STRIPE;const coverage=runSelection(w,h,y=>{if(y>=top+STRIPE){stripe=rows.next().value as Uint8Array<ArrayBuffer>;top=y;}const row:number[]=[];let start=0,v=stripe[(y-top)*w]!;for(let x=1;x<=w;x++){const next=x<w?stripe[(y-top)*w+x]!:0;if(next!==v||x===w){if(v)row.push(start,x,v);start=x;v=next;}}return row;});if(!rows.next().done)throw Error('PSD 蒙版尾部数据无效。');return {data:new Uint8Array(),...(coverage?{coverage}:{})};
}
