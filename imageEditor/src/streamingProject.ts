import {diskPager,diskRefs,validateDiskBlob,validateDiskRef,type DiskBlob,type DiskRef} from './diskPager.js';
import {encodePixelArchive,decodePixelArchive} from './pixelArchive.js';
import {validateState,uid,type ImageState} from './document.js';
import {deserializeDiskProject} from './diskImage.js';
import {MAX_PROJECT_BYTES} from './projectFile.js';
import {type RasterSource} from './rasterSource.js';
import type {ByteSink} from './streamingPng.js';
const encoder=new TextEncoder(),MAGIC=encoder.encode('HYIMG01\n'),END=encoder.encode('HYEND01\n');
export const MAX_STREAM_PROJECT_BYTES=2*1024**3;
const MAX_MANIFEST=16*1024*1024,MAX_PAGES=131072;
const hash=async(b:Uint8Array)=>new Uint8Array(await crypto.subtle.digest('SHA-256',b as Uint8Array<ArrayBuffer>));
const equal=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export interface ProjectProgress {current:number;total:number;message:string}
interface Manifest {format:'haiyue-image';version:20;archive:{tree:unknown;buffers:DiskBlob[]};pages:DiskRef[]}
/** Binary v20: fixed header + hashed JSON directory + unique raw pages + complete footer.
 * Pixels are never Base64 encoded or collected into a whole-file ArrayBuffer. */
export async function streamProject(state:ImageState,sink:ByteSink,signal?:AbortSignal,report?:(p:ProjectProgress)=>void){
 validateState(state);signal?.throwIfAborted();const archive=encodePixelArchive(state),buffers:DiskBlob[]=[];
 for(const b of archive.buffers){buffers.push(await diskPager.write(b,signal));signal?.throwIfAborted();}
 const pages=diskRefs([state,buffers]);if(pages.length>MAX_PAGES)throw Error('工程磁盘页目录过大。');
 const manifest:Manifest={format:'haiyue-image',version:20,archive:{tree:archive.tree,buffers},pages},json=encoder.encode(JSON.stringify(manifest));if(json.length>MAX_MANIFEST)throw Error('工程目录超过 16 MiB。');
 const total=64+json.length+pages.reduce((n,r)=>n+r.bytes,0)+END.length;if(total>MAX_STREAM_PROJECT_BYTES)throw Error('工程文件超过 2 GiB。');
 const header=new Uint8Array(64),v=new DataView(header.buffer);header.set(MAGIC);v.setUint32(8,1,true);v.setUint32(12,json.length,true);v.setUint32(16,buffers.length,true);v.setUint32(20,pages.length,true);v.setBigUint64(24,BigInt(total),true);header.set(await hash(json),32);
 let current=0;const emit=async(b:Uint8Array)=>{signal?.throwIfAborted();await sink(b);current+=b.length;report?.({current,total,message:'保存工程'});};await emit(header);await emit(json);for(const ref of pages)await emit(await diskPager.read(ref,signal));await emit(END);signal?.throwIfAborted();
}
/** Both legacy JSON and binary projects are detected by content, independently of the filename. */
export async function readProject(source:RasterSource,newIdentity=false,signal?:AbortSignal,report?:(p:ProjectProgress)=>void):Promise<ImageState>{
 signal?.throwIfAborted();if(source.size<8||source.size>MAX_STREAM_PROJECT_BYTES)throw Error('工程文件尺寸无效或超过 2 GiB。');
 const magic=await source.read(0,8,signal);
 if(!equal(magic,MAGIC)){if(source.size>MAX_PROJECT_BYTES)throw Error('旧版 JSON 工程超过读取预算。');const decoder=new TextDecoder('utf-8',{fatal:true}),parts:string[]=[];for(let offset=0;offset<source.size;offset+=1024*1024){signal?.throwIfAborted();parts.push(decoder.decode(await source.read(offset,Math.min(1024*1024,source.size-offset),signal),{stream:true}));}parts.push(decoder.decode());return deserializeDiskProject(parts.join(''),newIdentity,signal);}
 const header=await source.read(0,64,signal),v=new DataView(header.buffer,header.byteOffset,header.byteLength),length=v.getUint32(12,true),bufferCount=v.getUint32(16,true),pageCount=v.getUint32(20,true);
 if(v.getUint32(8,true)!==1||length<2||length>MAX_MANIFEST||bufferCount>200000||pageCount>MAX_PAGES||v.getBigUint64(24,true)!==BigInt(source.size)||64+length+8>source.size)throw Error('工程头部或版本无效。');
 const json=await source.read(64,length,signal);if(!equal(await hash(json),header.subarray(32))||!equal(await source.read(source.size-8,8,signal),END))throw Error('工程目录校验失败或文件未完整保存。');
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(json)) as Manifest;
 if(manifest.format!=='haiyue-image'||manifest.version!==20||!manifest.archive||!Array.isArray(manifest.archive.buffers)||manifest.archive.buffers.length!==bufferCount||!Array.isArray(manifest.pages)||manifest.pages.length!==pageCount)throw Error('工程目录无效。');
 const declared=new Map<string,number>();let size=64+length+8;for(const ref of manifest.pages){validateDiskRef(ref);if(declared.has(ref.key))throw Error('工程磁盘页重复。');declared.set(ref.key,ref.bytes);size+=ref.bytes;}if(size!==source.size)throw Error('工程数据长度错误。');
 let inline=0;for(const b of manifest.archive.buffers){validateDiskBlob(b);inline+=b.bytes;}if(inline>128*1024*1024)throw Error('工程内存数据超过工作集预算。');
 const required=diskRefs([manifest.archive.tree,manifest.archive.buffers]);if(required.length!==declared.size||required.some(r=>declared.get(r.key)!==r.bytes))throw Error('工程磁盘页目录缺失、多余或冲突。');
 let offset=64+length;for(const ref of manifest.pages){signal?.throwIfAborted();const bytes=await source.read(offset,ref.bytes,signal),digest='page:'+Array.from(await hash(bytes),v=>v.toString(16).padStart(2,'0')).join('');if(digest!==ref.key)throw Error('工程磁盘页校验失败。');await diskPager.write(bytes,signal);offset+=ref.bytes;report?.({current:offset,total:source.size,message:'打开工程'});}
 const buffers:Uint8Array[]=[];for(const b of manifest.archive.buffers)buffers.push(await diskPager.blob(b,signal));
 const state=decodePixelArchive<ImageState>(manifest.archive.tree,buffers);validateState(state);signal?.throwIfAborted();report?.({current:source.size,total:source.size,message:'打开工程'});return newIdentity?{...state,id:uid()}:state;
}
