import { mergedPsdPreview } from './mergedPsdPreview.js';
import { resourceBlocks, MAX_PSD_RESOURCES, psdLength } from './psdResources.js';
import { embeddedProfile } from './colorManagement.js';
import { colorDisplay } from './iccEngine.js';
import { checkSize, type ImageState } from './document.js';
import type { RasterSource } from './rasterSource.js';
import type { BitDepth } from './pixelFormat.js';

/** Read only header/resources and sampled merged rows. No layer pixels or disk writes.
 * Optional display data must never prevent the authoritative import from running. */
export async function earlyPsdPreview(source:RasterSource,signal?:AbortSignal){
 try{
  const head=await source.read(0,26,signal),v=new DataView(head.buffer,head.byteOffset,head.byteLength),version=v.getUint16(4),depth=v.getUint16(22) as BitDepth,mode=v.getUint16(24),width=v.getUint32(18),height=v.getUint32(14);
  if(v.getUint32(0)!==0x38425053||![1,2].includes(version)||![8,16,32].includes(depth)||![3,4].includes(mode)||mode===4&&depth===32)return;
  checkSize(width,height);let at=26;
  const section=async(wide=false)=>{const bytes=await source.read(at,wide?8:4,signal),n=psdLength(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),0,wide),start=at+(wide?8:4);if(start+n>source.size)throw Error('PSD 预览区段截断。');at=start+n;return {start,length:n};};
  await section();const r=await section();if(r.length>MAX_PSD_RESOURCES)return;const resources=await source.read(r.start,r.length,signal);
  const versionInfo=resourceBlocks(resources).find(b=>b.id===1057)?.bytes;
  if(versionInfo){const name=versionInfo[6]!+1,offset=6+name+name%2+4;if(versionInfo[offset+4]===0)return;}
  await section(version===2);
  const state={width,height,bitDepth:depth,colorMode:mode===4?'cmyk':'rgb',psdOrigin:{sourceName:'preview',flattened:true,resources}} as ImageState;
  const raw=await mergedPsdPreview(source,at,width,height,v.getUint16(12),depth,mode===4,version===2,embeddedProfile(state),signal);
  return raw?colorDisplay(raw,state):undefined;
 }catch(error){if(signal?.aborted)throw error;return;}
}
