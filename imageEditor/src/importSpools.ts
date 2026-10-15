import {idleTimer} from './pageLifecycle.js';
import {diskPager,type DiskRef} from './diskPager.js';
import {checkRead,type RasterSource} from './rasterSource.js';
export type ImportFormat='project'|'tiff'|'exr'|'psd'|'psb';
/** Sequential uploads are workspace-owned and retryable at the most recent chunk boundary. */
export class ImportSpools {
 private timer:ReturnType<typeof setTimeout>|undefined;
 private schedule(){if(this.timer)return;this.timer=idleTimer(()=>{this.timer=undefined;this.expire();if(this.files.size)this.schedule();});}
 private files=new Map<string,{name:string;format:ImportFormat;size:number;bytes:number;refs:DiskRef[];expires:number;busy:boolean;last?:{offset:number;bytes:Uint8Array}}>();
 begin(name:string,format:ImportFormat,size:number){this.expire();if(this.files.size>=2)throw Error('最多暂存 2 个导入文件。');if(!Number.isSafeInteger(size)||size<8||size>2*1024**3)throw Error('文件大小应为 8 字节至 2 GiB。');const importId=crypto.randomUUID();this.files.set(importId,{name,format,size,bytes:0,refs:[],expires:Date.now()+1800000,busy:false});this.schedule();return {importId,chunkBytes:4194304,expiresInSeconds:1800};}
 private get(id:string){this.expire();const f=this.files.get(id);if(!f)throw Error('导入不存在或已过期。');f.expires=Date.now()+1800000;return f;}
 async write(id:string,offset:number,data:Uint8Array,signal?:AbortSignal){const f=this.get(id);if(f.busy)throw Error('导入正在处理。');if(f.last?.offset===offset&&data.length===f.last.bytes.length&&data.every((v,i)=>v===f.last!.bytes[i]))return {nextOffset:f.bytes};if(offset!==f.bytes||!data.length||data.length>4194304||offset+data.length>f.size)throw Error('导入分段顺序、长度或范围无效。');f.busy=true;try{const stored=await diskPager.write(data,signal);signal?.throwIfAborted();f.refs.push(...stored.chunks);f.bytes+=data.length;f.last={offset,bytes:data.slice()};return {nextOffset:f.bytes};}finally{f.busy=false;}}
 async read<T>(id:string,consume:(source:RasterSource,name:string,format:ImportFormat)=>Promise<T>):Promise<T>{const f=this.get(id);if(f.busy||f.bytes!==f.size)throw Error('文件尚未上传完成或正在处理。');f.busy=true;try{const boundaries:number[]=[];let n=0;for(const r of f.refs){boundaries.push(n);n+=r.bytes;}const source:RasterSource={size:f.size,async read(offset,length,signal){checkRead(f.size,offset,length);const out=new Uint8Array(length);let lo=0,hi=boundaries.length;while(lo<hi){const mid=(lo+hi)>>>1;if(boundaries[mid]!<=offset)lo=mid+1;else hi=mid;}for(let i=Math.max(0,lo-1);i<f.refs.length&&boundaries[i]!<offset+length;i++){const start=boundaries[i]!,r=f.refs[i]!,a=Math.max(start,offset),b=Math.min(start+r.bytes,offset+length);out.set((await diskPager.read(r,signal)).subarray(a-start,b-start),a-offset);}signal?.throwIfAborted();return out;}};return await consume(source,f.name,f.format);}finally{f.busy=false;f.expires=Date.now()+1800000;}}
 close(id:string){const f=this.files.get(id);if(f?.busy)throw Error('导入正在处理。');this.files.delete(id);diskPager.requestCollection();}
 clear(){this.files.clear();clearTimeout(this.timer);this.timer=undefined;diskPager.requestCollection();}
 private expire(){for(const [id,f] of this.files)if(!f.busy&&f.expires<Date.now())this.files.delete(id);diskPager.requestCollection();}
}
