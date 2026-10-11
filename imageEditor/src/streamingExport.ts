import {idleTimer} from './pageLifecycle.js';
import {streamProject,type ProjectProgress} from './streamingProject.js';
import { streamTiff } from './streamingTiff.js';
import { streamExr } from './streamingExr.js';
import { streamJpeg } from './streamingJpeg.js';
import { diskPager, type DiskRef } from './diskPager.js';
import { streamPng, type ByteSink } from './streamingPng.js';
import { streamPsd } from './streamingPsd.js';
import type { ImageState } from './document.js';
export interface ExportOptions {format:'project'|'png'|'psd'|'psb'|'jpeg'|'tiff'|'exr';quality?:number;embedProfile?:boolean;allowRasterize?:boolean}
export function streamImage(state:ImageState,options:ExportOptions,sink:ByteSink,signal?:AbortSignal,report?:(p:ProjectProgress)=>void){if(options.format==='project'&&options.embedProfile===false)throw Error('工程始终保留 ICC。');return options.format==='project'?streamProject(state,sink,signal,report): options.format==='tiff'?streamTiff(state,sink,options.embedProfile!==false,signal):options.format==='exr'?streamExr(state,sink,signal):options.format==='jpeg'?streamJpeg(state,sink,options.quality??.92,options.embedProfile!==false,signal):options.format==='png'?streamPng(state,sink,options.embedProfile!==false,signal):streamPsd(state,sink,!!options.allowRasterize,options.embedProfile!==false,signal,options.format==='psb');}
/** A task-owned disk spool. Reads support offsets/retries; only a bounded chunk enters RPC resources. */
export class ExportSpools {
 private timer:ReturnType<typeof setTimeout>|undefined;
 private schedule(){if(this.timer)return;this.timer=idleTimer(()=>{this.timer=undefined;this.expire();if(this.files.size)this.schedule();});}
 private preparing=0;
 private files=new Map<string,{refs:DiskRef[];bytes:number;expires:number}>();
 async prepare(state:ImageState,options:ExportOptions,signal?:AbortSignal,report?:(p:ProjectProgress)=>void){this.expire();if(this.files.size+this.preparing>=4)throw Error('最多保留 4 个导出，请关闭已完成的导出。');this.preparing++;try{const refs:DiskRef[]=[];let bytes=0;await streamImage(state,options,async part=>{bytes+=part.length;if(bytes>2*1024*1024*1024)throw Error('导出超过 2 GiB。');refs.push(...(await diskPager.write(part,signal)).chunks);},signal,report);signal?.throwIfAborted();const exportId=crypto.randomUUID();this.files.set(exportId,{refs,bytes,expires:Date.now()+30*60*1000});this.schedule();return {exportId,bytes,format:options.format,chunkBytes:4*1024*1024,expiresInSeconds:1800};}finally{this.preparing--;}}
 async read(id:string,offset:number,length:number,signal?:AbortSignal){this.expire();const file=this.files.get(id);if(!file)throw Error('导出不存在或已过期。');if(!Number.isSafeInteger(offset)||offset<0||offset>file.bytes||!Number.isInteger(length)||length<1||length>4*1024*1024)throw Error('导出分段范围无效。');file.expires=Date.now()+30*60*1000;const data=new Uint8Array(Math.min(length,file.bytes-offset));let start=0;for(const ref of file.refs){const end=start+ref.bytes;if(start>=offset+data.length)break;if(end>offset){const part=await diskPager.blob({bytes:ref.bytes,chunks:[ref]},signal),a=Math.max(start,offset),b=Math.min(end,offset+data.length);data.set(part.subarray(a-start,b-start),a-offset);}start=end;}return {data,nextOffset:offset+data.length,done:offset+data.length===file.bytes};}
 close(id:string){this.files.delete(id);diskPager.requestCollection();}
 clear(){this.files.clear();clearTimeout(this.timer);this.timer=undefined;diskPager.requestCollection();}
 private expire(){for(const [id,file] of this.files)if(file.expires<Date.now())this.files.delete(id);diskPager.requestCollection();}
}
export async function downloadStream(state:ImageState,options:ExportOptions,name:string,signal?:AbortSignal,report?:(p:ProjectProgress)=>void){
 const picker=(window as unknown as {showSaveFilePicker?:(options:unknown)=>Promise<{createWritable():Promise<{write(b:Uint8Array):Promise<void>;close():Promise<void>;abort():Promise<void>}>}>}).showSaveFilePicker;
 if(picker){const handle=await picker({suggestedName:name}),writer=await handle.createWritable();try{await streamImage(state,options,b=>writer.write(b),signal,report);await writer.close();}catch(error){await writer.abort();throw error;}return;}
 const parts:BlobPart[]=[];let bytes=0;await streamImage(state,options,b=>{bytes+=b.length;if(bytes>512*1024*1024)throw Error('此浏览器的下载缓冲超过 512 MiB，请使用支持直接保存的浏览器或分段导出 API。');parts.push(b.slice().buffer);},signal,report);const url=URL.createObjectURL(new Blob(parts,{type:options.format==='project'?'application/octet-stream':options.format==='tiff'?'image/tiff':options.format==='exr'?'image/x-exr':options.format==='png'?'image/png':options.format==='jpeg'?'image/jpeg':'image/vnd.adobe.photoshop'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
