import { Deflate } from 'pako';
import { writePsdUint8Array, type Layer } from 'ag-psd';
import { asPsd } from './psdAdapter.js';
import { normalizeExportedLevels } from './psdLevels.js';
import { psdExportWarnings, psdMetadataWarnings } from './psdExportPolicy.js';
import { diskPager, readDiskPixels, withDiskPages, type DiskBlob } from './diskPager.js';
import { liveBitmapRegionAsync, bitmapRegionAsync, compositeRegionAsync } from './diskCompositor.js';
import { rawMaskWeight } from './maskEffects.js';
import { concatBytes, psdSections, psdLength, resourceBlocks, DERIVED_RESOURCE_IDS, preservePatternBlocks } from './psdResources.js';
import { makeLayer, allLayers, validateState, type ImageState, type ImageLayer } from './document.js';
import type { ByteSink } from './streamingPng.js';
const u32=(n:number)=>{if(!Number.isSafeInteger(n)||n<0||n>0xffffffff)throw Error('PSD 区段超出 32 位长度，请使用 PSB 工作流。');const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n);return b;};
interface Spool {bytes:number;parts:DiskBlob[];compression:number}
async function zipPlane(width:number,height:number,read:(y:number,h:number)=>Promise<Uint8Array>,signal?:AbortSignal):Promise<Spool>{
 const parts:DiskBlob[]=[],pending:Uint8Array[]=[],z=new Deflate({chunkSize:65536});let bytes=0;z.onData=b=>pending.push(b);
 const flush=async()=>{for(const b of pending){signal?.throwIfAborted();parts.push(await diskPager.write(b,signal));bytes+=b.length;}pending.length=0;};
 for(let y=0;y<height;y+=32){signal?.throwIfAborted();z.push(await read(y,Math.min(32,height-y)),false);if(z.err)throw Error(z.msg);await flush();}z.push(new Uint8Array(),true);if(z.err)throw Error(z.msg);await flush();return {bytes,parts,compression:2};
}
/** PackBits literals are bounded at 128 samples; RLE handles repeated runs and 30,000px rows. */
export function packBits(row:Uint8Array):Uint8Array {const out:number[]=[];for(let p=0;p<row.length;){let n=1;while(n<128&&p+n<row.length&&row[p+n]===row[p])n++;if(n>=3){out.push(257-n,row[p]!);p+=n;continue;}const start=p;p+=n;while(p<row.length&&p-start<128){let k=1;while(k<3&&p+k<row.length&&row[p+k]===row[p])k++;if(k>=3)break;p+=Math.min(k,128-(p-start));}out.push(p-start-1,...row.subarray(start,p));}return Uint8Array.from(out);}
async function rlePlanes(width:number,height:number,channels:number,read:(y:number,h:number)=>Promise<Uint8Array[]>,signal?:AbortSignal):Promise<{table:Uint8Array;planes:Spool[]}>{
 const table=new Uint8Array(height*channels*2),v=new DataView(table.buffer),planes=Array.from({length:channels},()=>({bytes:0,parts:[] as DiskBlob[],compression:1}));
 for(let y=0;y<height;y+=32){signal?.throwIfAborted();const h=Math.min(32,height-y),input=await read(y,h);for(let c=0;c<channels;c++){const packed:Uint8Array[]=[];for(let yy=0;yy<h;yy++){const row=packBits(input[c]!.subarray(yy*width,(yy+1)*width));v.setUint16((c*height+y+yy)*2,row.length);packed.push(row);}const b=concatBytes(packed);planes[c]!.parts.push(await diskPager.write(b,signal));planes[c]!.bytes+=b.length;}await new Promise<void>(r=>setTimeout(r,0));}return {table,planes};
}
/** PSD8 layered export: metadata-only codec, disk-spooled channel streams, RLE composite. */
export async function streamPsd(state:ImageState,sink:ByteSink,allowRasterize=false,embedProfile=true,signal?:AbortSignal,psb=false){
 const length=(n:number)=>{if(!psb)return u32(n);if(!Number.isSafeInteger(n)||n<0)throw Error('PSB 长度无效。');const b=new Uint8Array(8);new DataView(b.buffer).setBigUint64(0,BigInt(n));return b;},ls=psb?8:4;
 validateState(state);const depth=state.bitDepth??8,cmyk=state.colorMode==='cmyk',sampleBytes=depth/8;const warnings=[...psdMetadataWarnings(state),...psdExportWarnings(state)];if(warnings.length&&!allowRasterize)throw Error('需要确认 PSD 导出转换：'+warnings.join(' '));
 const flatten=psdExportWarnings(state).length>0,original=state;
 // Keep native descriptors and linked assets, but never provide dense imageData to the codec.
 const psd=await withDiskPages([state.psdArchiveStore??state.psdArchive,...(flatten?[]:allLayers(state.layers).flatMap(l=>l.content?.type==='smart'?[l.content.source]:[]))],()=>asPsd(flatten?{...state,layers:[makeLayer('合并副本')]}:state,true),signal);
 const jobs:(ImageLayer|undefined)[]=[];
 const setup=(layers:Layer[],sources:readonly ImageLayer[])=>{for(let i=0;i<layers.length;i++){const l=layers[i]!,src=sources[i];if(l.children){jobs.push(undefined);setup(l.children,src?.children??[]);}jobs.push(src);
  if(l.vectorMask)l.vectorMask={...l.vectorMask,paths:l.vectorMask.paths.map(p=>({...p,knots:p.knots.map(k=>({...k,points:k.points.map((v,i)=>v/(i%2?state.height:state.width)) as typeof k.points}))}))};
  l.rawData={colorMode:3,bitsPerChannel:8,large:psb,channels:[...(src?.bitmap||flatten?(cmyk?[-1,0,1,2,3]:[-1,0,1,2]):[]),...(src?.mask?[-2]:[])].map(id=>({id,compression:2,data:new Uint8Array()}))};
  if(flatten){l.top=l.left=0;l.right=state.width;l.bottom=state.height;}
 }};setup(psd.children??[],flatten?[]:state.layers);if(!jobs.length)jobs.push(undefined);
 psd.bitsPerChannel=8;psd.colorMode=3;psd.width=psd.height=1;psd.imageData={width:1,height:1,data:new Uint8ClampedArray(4)};delete psd.canvas;
 let encoded=normalizeExportedLevels(writePsdUint8Array(psd,{psb,noBackground:true,invalidateTextLayers:!!state.psdArchive&&!psd.engineData}));
 encoded=await withDiskPages(state.psdArchiveStore??state.psdArchive,()=>state.psdArchive?preservePatternBlocks(encoded,state.psdArchive):encoded,signal);
 const sections=psdSections(encoded),v=new DataView(encoded.buffer,encoded.byteOffset,encoded.byteLength),oldSize=psdLength(v,sections.layers.data,psb),oldEnd=sections.layers.data+ls+oldSize,count=Math.abs(v.getInt16(sections.layers.data+ls));let p=sections.layers.data+ls+2;
 const output:{at:number;spool:Spool}[]=[];
 for(let index=0;index<count;index++){const src=jobs[index],n=v.getUint16(p+16);p+=18;for(let c=0;c<n;c++){const id=v.getInt16(p),at=p+2;let spool:Spool={bytes:0,parts:[],compression:0};
   if(id===-2&&src?.mask&&(depth!==8||psb)){const m=src.mask;spool=await zipPlane(m.width,m.height,async(y,h)=>readDiskPixels(()=>planeSamples(m.width*h,depth,i=>rawMaskWeight(m,i%m.width+m.x,y+Math.floor(i/m.width)+m.y)*255),signal),signal);}
   else if(id===-2&&src?.mask){const m=src.mask,rle=await rlePlanes(m.width,m.height,1,async(y,h)=>readDiskPixels(()=>{const data=new Uint8Array(m.width*h);for(let yy=0;yy<h;yy++)for(let x=0;x<m.width;x++)data[yy*m.width+x]=Math.round(rawMaskWeight(m,x+m.x,y+yy+m.y)*255);return [data];},signal),signal);spool={compression:1,bytes:rle.table.length+rle.planes[0]!.bytes,parts:[await diskPager.write(rle.table,signal),...rle.planes[0]!.parts]};}
   else if(id>=-1&&id<=(cmyk?3:2)&&(src?.bitmap||flatten)){const b=src?.bitmap,width=flatten?state.width:b!.width,height=flatten?state.height:b!.height,channel=id===-1?3:id;spool=await zipPlane(width,height,async(y,h)=>{const pixels=flatten?await compositeRegionAsync(original,{x:0,y,width,height:h},signal):src?.smartFilters?.length?await liveBitmapRegionAsync(src,{x:0,y,width,height:h},signal):await bitmapRegionAsync(b!,{x:0,y,width,height:h},signal);return planeSamples(width*h,depth,i=>cmyk&&id>=0?(1-pixels.cmyk![i*4+id]!/100)*255:pixels.data[i*4+channel]!);},signal);}
   if(psb)v.setBigUint64(at,BigInt(spool.bytes+2));else v.setUint32(at,spool.bytes+2);output.push({at,spool});p+=psb?10:6;
  }p+=12;const size=v.getUint32(p);p+=4+size;
 }
 const records=encoded.slice(sections.layers.data+ls,p),channelsSize=output.reduce((n,o)=>n+2+o.spool.bytes,0),infoSize=records.length+channelsSize,padding=(4-infoSize%4)%4,tail=encoded.slice(oldEnd,sections.layers.end),layerSize=depth===8?ls+infoSize+padding+tail.length:ls+tail.length+8+ls+infoSize+padding+8+ls;
 const source=resourceBlocks(state.psdOrigin?.resources??new Uint8Array()),generated=resourceBlocks(encoded.slice(sections.resources.data,sections.resources.end)),kept=source.filter(b=>!DERIVED_RESOURCE_IDS.has(b.id)&&(embedProfile||b.id!==1039)),resources=concatBytes([...kept,...generated.filter(g=>(embedProfile||g.id!==1039)&&!kept.some(b=>b.id===g.id))].map(b=>b.bytes));
 const header=encoded.slice(0,sections.resources.start),hv=new DataView(header.buffer);hv.setUint32(14,state.height);hv.setUint32(18,state.width);hv.setUint16(22,depth);hv.setUint16(12,cmyk?5:4);hv.setUint16(24,cmyk?4:3);
 const readComposite=async(c:number,y:number,h:number)=>{const b=await compositeRegionAsync(original,{x:0,y,width:state.width,height:h},signal);return planeSamples(state.width*h,depth,i=>{const a=b.data[i*4+3]!/255;if(cmyk)return c<4?(1-b.cmyk![i*4+c]!/100*a)*255:b.data[i*4+3]!;const v=b.data[i*4+c]!;return c<3&&a>0&&a<1?v*a+255*(1-a):v;});};
 let composite:{table:Uint8Array;planes:Spool[]},compression:number;
 if(depth===8&&!cmyk&&!psb){compression=1;composite=await rlePlanes(state.width,state.height,4,async(y,h)=>{const b=await compositeRegionAsync(original,{x:0,y,width:state.width,height:h},signal);return Array.from({length:4},(_,c)=>planeSamples(state.width*h,8,i=>{const a=b.data[i*4+3]!/255,v=b.data[i*4+c]!;return c<3&&a>0&&a<1?v*a+255*(1-a):v;}));},signal);}
 else {compression=2;const parts:DiskBlob[]=[],pending:Uint8Array[]=[],z=new Deflate({chunkSize:65536});let bytes=0;z.onData=b=>pending.push(b);const flush=async()=>{for(const b of pending){parts.push(await diskPager.write(b,signal));bytes+=b.length;}pending.length=0;};for(let c=0;c<(cmyk?5:4);c++)for(let y=0;y<state.height;y+=32){signal?.throwIfAborted();z.push(await readComposite(c,y,Math.min(32,state.height-y)),false);if(z.err)throw Error(z.msg);await flush();}z.push(new Uint8Array(),true);if(z.err)throw Error(z.msg);await flush();composite={table:new Uint8Array(),planes:[{parts,bytes,compression:2}]};}
 const total=header.length+4+resources.length+4+layerSize+2+composite.table.length+composite.planes.reduce((n,p)=>n+p.bytes,0);if(!psb&&total>2*1024*1024*1024)throw Error('PSD 超过 2 GiB，请使用 PSB 工作流。');
 const write=async(b:Uint8Array)=>{signal?.throwIfAborted();await sink(b);},spoolOut=async(s:Spool)=>{for(const b of s.parts)for(const r of b.chunks)await write(await diskPager.blob({bytes:r.bytes,chunks:[r]},signal));};
 await write(header);await write(u32(resources.length));await write(resources);await write(length(layerSize));
 if(depth!==8){await write(length(0));await write(tail);await write(new TextEncoder().encode(depth===16?'8BIMLr16':'8BIMLr32'));}
 await write(length(infoSize+padding));await write(records);for(const o of output){await write(new Uint8Array([0,o.spool.compression]));await spoolOut(o.spool);}if(padding)await write(new Uint8Array(padding));
 if(depth===8)await write(tail);else{await write(new TextEncoder().encode(depth===16?'8BIMMt16':'8BIMMt32'));await write(length(0));}
 await write(new Uint8Array([0,compression]));await write(composite.table);for(const s of composite.planes)await spoolOut(s);
}
function planeSamples(n:number,depth:8|16|32,value:(i:number)=>number){const out=new Uint8Array(n*depth/8),v=new DataView(out.buffer);for(let i=0;i<n;i++){const sample=value(i);if(depth===8)out[i]=Math.round(Math.max(0,Math.min(255,sample)));else if(depth===16)v.setUint16(i*2,Math.round(Math.max(0,Math.min(255,sample))*257));else v.setFloat32(i*4,sample/255);}return out;}
