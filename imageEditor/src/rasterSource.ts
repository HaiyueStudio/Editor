import { RasterPreviewBuilder } from './rasterPreviews.js';
import type { TaskReport } from './workerTask.js';
import { deflate } from 'pako';
import { diskPager, type DiskBlob } from './diskPager.js';
import { pagedBitmap } from './pagedPixels.js';
import { validateBitmap, pixelBytesView, type BitDepth } from './pixelFormat.js';
import type { Bitmap } from './document.js';
/** Random access to local files or RPC disk spools, without a whole-file ArrayBuffer. */
export interface RasterSource {size:number;read(offset:number,length:number,signal?:AbortSignal):Promise<Uint8Array>}
export function blobSource(blob:Blob):RasterSource{return {size:blob.size,async read(offset,length,signal){checkRead(blob.size,offset,length);signal?.throwIfAborted();const b=new Uint8Array(await blob.slice(offset,offset+length).arrayBuffer());signal?.throwIfAborted();return b;}};}
export function checkRead(size:number,offset:number,length:number){if(![offset,length].every(Number.isSafeInteger)||offset<0||length<0||length>32*1024*1024||offset+length>size)throw Error('文件范围无效、截断或单次读取超过 32 MiB。');}
/** Keep compressed input I/O separate from the inflater's bounded push size. */
export function readAhead(source:RasterSource,start:number,end:number):RasterSource {
 let offset=-1,buffer:Uint8Array=new Uint8Array();
 return {size:source.size,async read(at,length,signal){
  checkRead(source.size,at,length);signal?.throwIfAborted();if(at<start||at+length>end)throw Error('通道读取越界。');
  if(at<offset||at+length>offset+buffer.length){offset=at;buffer=await source.read(at,Math.min(end-at,Math.max(length,65536)),signal);}
  signal?.throwIfAborted();return buffer.slice(at-offset,at-offset+length);
 }};
}
/** Retain at most 16 MiB of the current tile row; spill the remaining columns.
 * Common widths write only final tiles, with no staging writes or rereads. */
export const RASTER_STRIP_BUDGET=16*1024*1024;
export class DiskRasterWriter {
 private top=0;private bands:{rgb:DiskBlob[];inks:DiskBlob[]}[]=[];private tiles:DiskBlob[]=[];private inks:DiskBlob[]=[];
 private resident=new Map<number,{rgb:Uint8Array;ink?:Uint8Array}>();private residentBytes=0;
 private preview:RasterPreviewBuilder;
 constructor(readonly width:number,readonly height:number,readonly depth:BitDepth,readonly cmyk=false,private report?:TaskReport){this.preview=new RasterPreviewBuilder(width,height);}
 stats(){return {residentBytes:this.residentBytes,budget:RASTER_STRIP_BUDGET};}
 async write(bitmap:Bitmap,signal?:AbortSignal){
  signal?.throwIfAborted();validateBitmap(bitmap);const {width,height}=bitmap;
  if(width!==this.width||height!==Math.min(32,this.height-this.top)||!!bitmap.cmyk!==this.cmyk||(bitmap.depth??8)!==this.depth)throw Error('条带尺寸不一致。');
  this.preview.add(0,this.top,bitmap);
  const band={rgb:[] as DiskBlob[],inks:[] as DiskBlob[]},bpp=this.depth===8?4:16,tileHeight=Math.min(256,this.height-Math.floor(this.top/256)*256),row=this.top%256,input=pixelBytesView(bitmap),inks=bitmap.cmyk&&new Uint8Array(bitmap.cmyk.buffer,bitmap.cmyk.byteOffset,bitmap.cmyk.byteLength);
  for(let x=0,tx=0;x<width;x+=256,tx++){
   const w=Math.min(256,width-x),bytes=w*tileHeight*(bpp+(this.cmyk?16:0));
   if(row===0&&this.residentBytes+bytes<=RASTER_STRIP_BUDGET){this.resident.set(tx,{rgb:new Uint8Array(w*tileHeight*bpp),...(this.cmyk?{ink:new Uint8Array(w*tileHeight*16)}:{})});this.residentBytes+=bytes;}
   const memory=this.resident.get(tx),rgb=memory?.rgb??new Uint8Array(w*height*bpp),ink=memory?.ink??(this.cmyk?new Uint8Array(w*height*16):undefined),base=memory?row:0;
   for(let y=0;y<height;y++){rgb.set(input.subarray((y*width+x)*bpp,(y*width+x+w)*bpp),(base+y)*w*bpp);if(ink)ink.set(inks!.subarray((y*width+x)*16,(y*width+x+w)*16),(base+y)*w*16);}
   if(!memory){band.rgb[tx]=await diskPager.write(rgb,signal);if(ink)band.inks[tx]=await diskPager.write(ink,signal);}
  }
  this.bands.push(band);this.top+=height;
  if(this.top%256===0||this.top===this.height){
   for(let tx=0;tx<Math.ceil(width/256);tx++){
    const w=Math.min(256,width-tx*256),memory=this.resident.get(tx),rgb=memory?.rgb??new Uint8Array(w*tileHeight*bpp),ink=memory?.ink??(this.cmyk?new Uint8Array(w*tileHeight*16):undefined);
    if(!memory)for(let n=0;n<this.bands.length;n++){rgb.set(await diskPager.blob(this.bands[n]!.rgb[tx]!,signal),n*32*w*bpp);if(ink)ink.set(await diskPager.blob(this.bands[n]!.inks[tx]!,signal),n*32*w*16);}
    this.tiles.push(await diskPager.write(deflate(rgb),signal));if(ink)this.inks.push(await diskPager.write(deflate(ink),signal));
   }
   this.bands=[];this.resident.clear();this.residentBytes=0;
  }
  signal?.throwIfAborted();this.report?.({current:this.top,total:this.height,message:'正在解码、存储并生成多级预览'});
 }
 finish(){if(this.top!==this.height)throw Error('图像条带不完整。');return this.preview.finish(pagedBitmap(this.width,this.height,{kind:'disk',tiles:this.tiles,...(this.cmyk?{inks:this.inks}:{})},this.depth));}
}
