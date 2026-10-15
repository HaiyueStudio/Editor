import { checkSize } from './document.js';
import { profileTransform, type RgbProfile } from './colorManagement.js';
export interface PrecisionJob {bytes:Uint8Array;width:number;height:number;input:'rgba16le'|'rgba32fle';output:'rgba8'|'rgba16le'|'rgba32fle';source:RgbProfile;target:RgbProfile;exposure:number}
/** Straight encoded SDR samples; conversion works in float64 and quantizes only at the output boundary. */
export function precisionConvert(job:PrecisionJob){
 const {width,height,input,output,bytes}=job;checkSize(width,height);
 if(!['rgba16le','rgba32fle'].includes(input)||!['rgba8','rgba16le','rgba32fle'].includes(output)||!Number.isFinite(job.exposure)||Math.abs(job.exposure)>20)throw new Error('高精度转换参数无效。');
 const inSize=input==='rgba16le'?2:4,outSize=output==='rgba8'?1:output==='rgba16le'?2:4,n=width*height*4;
 if(bytes.length!==n*inSize||bytes.length+n*outSize>128*1024*1024)throw new Error('高精度输入长度无效或输入／输出合计超过 128 MiB。');
 const source=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),result=new Uint8Array(n*outSize),dest=new DataView(result.buffer),convert=profileTransform(job.source,job.target,job.exposure);let clippedPixels=0;
 const read=(i:number)=>input==='rgba16le'?source.getUint16(i*2,true)/65535:source.getFloat32(i*4,true),write=(i:number,v:number)=>{if(output==='rgba8')dest.setUint8(i,Math.round(v*255));else if(output==='rgba16le')dest.setUint16(i*2,Math.round(v*65535),true);else dest.setFloat32(i*4,v,true);};
 for(let i=0;i<n;i+=4){const samples=[read(i),read(i+1),read(i+2),read(i+3)];if(samples.some(v=>!Number.isFinite(v)||v<0||v>1))throw new Error('浮点接口目前仅接收 SDR 0–1；不自动截断 HDR／NaN。');const rgb=convert(samples[0]!,samples[1]!,samples[2]!);if(rgb.clipped)clippedPixels++;for(let c=0;c<3;c++)write(i+c,rgb.values[c]!);write(i+3,samples[3]!);}
 return {bytes:result,width,height,format:output,clippedPixels};
}
