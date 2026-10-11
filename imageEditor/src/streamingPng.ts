import { Deflate, deflate } from 'pako';
import type { ImageState } from './document.js';
import { compositeRegionAsync } from './diskCompositor.js';
import { colorDisplay } from './iccEngine.js';
import { srgbProfileBytes } from './colorManagement.js';
export type ByteSink=(chunk:Uint8Array)=>void|Promise<void>;
export function pngChunk(type:string,data:Uint8Array){const out=new Uint8Array(data.length+12),v=new DataView(out.buffer);v.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);let crc=0xffffffff;for(const byte of out.subarray(4,-4)){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}v.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;}
/** RGBA8 PNG, sequential strips, backpressure at every compressed chunk. Output is sRGB. */
export async function streamPng(state:ImageState,sink:ByteSink,embedProfile=true,signal?:AbortSignal){
 signal?.throwIfAborted();const output={...state,...(state.icc?{icc:{intent:state.icc.intent,bpc:state.icc.bpc,proofIntent:1 as const,gamutWarning:false}}:{})};
 await sink(new Uint8Array([137,80,78,71,13,10,26,10]));const header=new Uint8Array(13),v=new DataView(header.buffer);v.setUint32(0,state.width);v.setUint32(4,state.height);header[8]=8;header[9]=6;await sink(pngChunk('IHDR',header));
 if(embedProfile){const profile=deflate(srgbProfileBytes()),name=new TextEncoder().encode('Haiyue ICC\0\0'),data=new Uint8Array(name.length+profile.length);data.set(name);data.set(profile,name.length);await sink(pngChunk('iCCP',data));}
 const encoder=new Deflate({chunkSize:65536}),chunks:Uint8Array[]=[];encoder.onData=chunk=>chunks.push(chunk);const drain=async()=>{for(const c of chunks){signal?.throwIfAborted();await sink(pngChunk('IDAT',c));}chunks.length=0;};
 for(let top=0;top<state.height;top+=32){signal?.throwIfAborted();const h=Math.min(32,state.height-top),b=colorDisplay(await compositeRegionAsync(state,{x:0,y:top,width:state.width,height:h},signal),output),stride=state.width*4+1,rows=new Uint8Array(stride*h);
  for(let y=0;y<h;y++)rows.set(b.data.subarray(y*state.width*4,(y+1)*state.width*4),y*stride+1);encoder.push(rows,false);if(encoder.err)throw Error(encoder.msg);await drain();await new Promise<void>(r=>setTimeout(r,0));
 }encoder.push(new Uint8Array(),true);if(encoder.err)throw Error(encoder.msg);await drain();signal?.throwIfAborted();await sink(pngChunk('IEND',new Uint8Array()));
}
