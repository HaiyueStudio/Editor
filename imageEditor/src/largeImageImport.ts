import { RasterPreviewBuilder } from './rasterPreviews.js';
import { Inflate, deflate } from 'pako';
import type { Bitmap } from './document.js';
import { diskPager, type DiskBlob } from './diskPager.js';
import { PAGE_SIZE, pagedBitmap, clearPagedPixelCache, type PixelPages } from './pagedPixels.js';
import { psdSections } from './psdResources.js';

/** Feed small compressed chunks so even a highly compressible channel has bounded output. */
export function* inflateChunks(parts:readonly Uint8Array[],expected:number,signal?:AbortSignal):Generator<Uint8Array>{
 const queue:Uint8Array[]=[];let count=0;const z=new Inflate({chunkSize:65536});
 z.onData=part=>{count+=part.length;if(count>expected)throw Error('解码像素超出声明尺寸。');queue.push(part);};
 for(let n=0;n<parts.length;n++){const bytes=parts[n]!;for(let p=0;p<bytes.length;p+=1024){signal?.throwIfAborted();if(!z.push(bytes.subarray(p,p+1024),n===parts.length-1&&p+1024>=bytes.length)||z.err)throw Error('ZIP 像素损坏。');while(queue.length)yield queue.shift()!;}}
 if(count!==expected)throw Error('ZIP 像素长度不符。');
}
function* channelStripes(width:number,height:number,channel:Extract<PixelPages,{kind:'psd-rgb8'}>['channels'][number],signal?:AbortSignal):Generator<Uint8Array>{
 const bytes=channel.data;if(!bytes)throw Error('PSD 通道数据缺失。');
 const zipped=channel.compression>=2?inflateChunks([bytes],width*height,signal):undefined;
 let block=new Uint8Array(0) as Uint8Array<ArrayBufferLike>,at=0,offset=height*2;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(let y=0;y<height;y+=PAGE_SIZE){signal?.throwIfAborted();const h=Math.min(PAGE_SIZE,height-y),stripe=new Uint8Array(width*h);
  if(zipped){let written=0;while(written<stripe.length){if(at===block.length){const next=zipped.next();if(next.done)throw Error('PSD ZIP 通道截断。');block=next.value;at=0;}const size=Math.min(stripe.length-written,block.length-at);stripe.set(block.subarray(at,at+size),written);at+=size;written+=size;}
   if(channel.compression===3)for(let row=0;row<h;row++)for(let x=1;x<width;x++){const i=row*width+x;stripe[i]=(stripe[i]!+stripe[i-1]!)&255;}
  }else if(channel.compression===0)stripe.set(bytes.subarray(y*width,(y+h)*width));
  else if(channel.compression===1){for(let row=0;row<h;row++){const end=offset+view.getUint16((y+row)*2);let x=0;if(end>bytes.length)throw Error('PSD RLE 行截断。');while(offset<end){const n=bytes[offset++]!;if(n===128)continue;const size=n<128?n+1:257-n;if(x+size>width||offset+(n<128?size:1)>end)throw Error('PSD RLE 行损坏。');if(n<128){stripe.set(bytes.subarray(offset,offset+size),row*width+x);offset+=size;}else stripe.fill(bytes[offset++]!,row*width+x,row*width+x+size);x+=size;}if(x!==width)throw Error('PSD RLE 行长度不符。');}}
  else throw Error('PSD 压缩方式未支持。');yield stripe;
 }
 if(zipped&&!zipped.next().done)throw Error('PSD ZIP 通道有多余像素。');
}
/** Stream all four channels in bounded row bands, committing immutable disk tiles. */
export async function spillPsdBitmap(bitmap:Bitmap,signal?:AbortSignal){
 const preview=new RasterPreviewBuilder(bitmap.width,bitmap.height),p=bitmap.pages;if(p?.kind!=='psd-rgb8')throw Error('需要 PSD 通道存储。');
 const channels=p.channels.filter(c=>c.data).map(c=>({id:c.id===-1?3:c.id,rows:channelStripes(bitmap.width,bitmap.height,c,signal)})),tiles:DiskBlob[]=[];
 for(let y=0;y<bitmap.height;y+=PAGE_SIZE){const h=Math.min(PAGE_SIZE,bitmap.height-y),stripes=channels.map(c=>({...c,data:c.rows.next().value as Uint8Array}));
  for(let x=0;x<bitmap.width;x+=PAGE_SIZE){signal?.throwIfAborted();const w=Math.min(PAGE_SIZE,bitmap.width-x),rgba=new Uint8Array(w*h*4);for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
   for(const c of stripes)for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)rgba[(yy*w+xx)*4+c.id]=c.data[yy*bitmap.width+x+xx]!;
   preview.add(x,y,{width:w,height:h,data:new Uint8ClampedArray(rgba.buffer)});tiles.push(await diskPager.write(deflate(rgba),signal));
  }
 }
 for(const c of channels)if(!c.rows.next().done)throw Error('PSD 通道长度不符。');signal?.throwIfAborted();
 const target=p as unknown as Record<string,unknown>;for(const key of Object.keys(target))delete target[key];Object.assign(target,{kind:'disk',tiles});clearPagedPixelCache();preview.finish(bitmap);
}
/** Expose the merged image as planar channels without a document-sized RGBA allocation. */
export function pagedMergedPsd(bytes:Uint8Array):Bitmap {
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),w=v.getUint32(18),h=v.getUint32(14),count=v.getUint16(12),start=psdSections(bytes).composite,compression=v.getUint16(start);
 const channels:Extract<PixelPages,{kind:'psd-rgb8'}>['channels']=[];let offset=start+2+count*h*2;
 for(let c=0;c<count;c++){let data:Uint8Array;
  if(compression===0)data=bytes.subarray(start+2+c*w*h,start+2+(c+1)*w*h);
  else if(compression===1){const table=bytes.subarray(start+2+c*h*2,start+2+(c+1)*h*2);let n=0;for(let y=0;y<h;y++)n+=v.getUint16(start+2+(c*h+y)*2);data=new Uint8Array(h*2+n);data.set(table);data.set(bytes.subarray(offset,offset+n),h*2);offset+=n;}
  else throw Error('大图合并像素需要 Raw 或 RLE 压缩。');
  channels.push({id:c===3?-1:c,compression,data});
 }
 return pagedBitmap(w,h,{kind:'psd-rgb8',channels});
}

/** Non-interlaced 8-bit RGB(A) PNG, decoded a row at a time into disk tiles. */
export async function importLargePng(bytes:Uint8Array,signal?:AbortSignal):Promise<Bitmap>{
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=v.getUint32(16),height=v.getUint32(20),channels=bytes[25]===6?4:3;
 if(bytes[24]!==8||![2,6].includes(bytes[25]!)||bytes[26]||bytes[27]||bytes[28])throw Error('大图 PNG 当前支持非交错 RGB/RGBA 8 位。');
 const parts:Uint8Array[]=[];let ended=false,srgb=false,customPrimaries=false,cicp=false,gamma:number|undefined,profile:Uint8Array|undefined;
 for(let p=8;p+12<=bytes.length;){const n=v.getUint32(p);if(p+12+n>bytes.length)throw Error('PNG 数据截断。');const kind=v.getUint32(p+4);let crc=0xffffffff;for(const b of bytes.subarray(p+4,p+8+n)){crc^=b;for(let k=0;k<8;k++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}if(((crc^0xffffffff)>>>0)!==v.getUint32(p+8+n))throw Error('PNG 数据校验失败。');if(kind===0x73524742)srgb=true;if(kind===0x6348524d)customPrimaries=true;if(kind===0x63494350)cicp=true;if(kind===0x67414d41&&n===4)gamma=v.getUint32(p+8)/100000;
 if(kind===0x69434350){const payload=bytes.subarray(p+8,p+8+n),zero=payload.indexOf(0);if(zero<1||zero>79||payload[zero+1]!==0)throw Error('PNG ICC 块无效。');const chunks:Uint8Array[]=[];let total=0;const z=new Inflate({chunkSize:16384});z.onData=b=>{total+=b.length;if(total>4*1024*1024)throw Error('PNG ICC 超过预算。');chunks.push(b);};if(!z.push(payload.subarray(zero+2),true)||z.err)throw Error('PNG ICC 压缩无效。');profile=new Uint8Array(total);let at=0;for(const b of chunks){profile.set(b,at);at+=b.length;}}
 if(kind===0x49444154)parts.push(bytes.subarray(p+8,p+8+n));if(kind===0x49454e44){ended=true;break;}p+=12+n;}
 if(!ended||!parts.length)throw Error('PNG 数据不完整。');
 if(cicp||customPrimaries&&!srgb&&!profile)throw Error('此大图 PNG 色彩描述需要先转换为 sRGB 或带 ICC 的 PNG。');
 let convert:((b:Bitmap)=>Bitmap)|undefined;
 if(profile){const icc=await import('./iccEngine.js'),color=await import('./colorManagement.js');await icc.initializeIcc();const source=profile,target=color.srgbProfileBytes();convert=b=>icc.transformBitmapIcc(b,source,target,{intent:1,bpc:true});}
 else if(gamma!==undefined&&!srgb){if(!Number.isFinite(gamma)||gamma<=0)throw Error('PNG Gamma 无效。');const g=gamma;convert=b=>{const data=new Uint8ClampedArray(b.data);for(let i=0;i<data.length;i++)if(i%4!==3){const v=(data[i]!/255)**(1/g);data[i]=255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055);}return {...b,data};};}
 const stride=width*channels,stream=inflateChunks(parts,(stride+1)*height,signal);let block=new Uint8Array(0) as Uint8Array<ArrayBufferLike>,at=0,previous=new Uint8Array(stride);const tiles:DiskBlob[]=[];
 const read=(out:Uint8Array)=>{let p=0;while(p<out.length){if(at===block.length){const next=stream.next();if(next.done)throw Error('PNG 像素截断。');block=next.value;at=0;}const n=Math.min(out.length-p,block.length-at);out.set(block.subarray(at,at+n),p);at+=n;p+=n;}};
 for(let y=0;y<height;y+=PAGE_SIZE){const h=Math.min(PAGE_SIZE,height-y),stripe=new Uint8Array(width*h*4);
  for(let row=0;row<h;row++){signal?.throwIfAborted();const raw=new Uint8Array(stride+1);read(raw);const filter=raw[0]!,line=raw.subarray(1);if(filter>4)throw Error('PNG 滤波无效。');for(let i=0;i<stride;i++){const a=i>=channels?line[i-channels]!:0,b=previous[i]!,c=i>=channels?previous[i-channels]!:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);line[i]=(line[i]!+(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?pa<=pb&&pa<=pc?a:pb<=pc?b:c:0))&255;}for(let x=0;x<width;x++){const i=(row*width+x)*4;stripe[i]=line[x*channels]!;stripe[i+1]=line[x*channels+1]!;stripe[i+2]=line[x*channels+2]!;stripe[i+3]=channels===4?line[x*channels+3]!:255;}previous.set(line);}
  for(let x=0;x<width;x+=PAGE_SIZE){const w=Math.min(PAGE_SIZE,width-x),data=new Uint8Array(w*h*4);for(let r=0;r<h;r++)data.set(stripe.subarray((r*width+x)*4,(r*width+x+w)*4),r*w*4);const output=convert?new Uint8Array(convert({width:w,height:h,data:new Uint8ClampedArray(data)}).data):data;tiles.push(await diskPager.write(deflate(output),signal));}
 }
 if(!stream.next().done)throw Error('PNG 像素有多余数据。');return pagedBitmap(width,height,{kind:'disk',tiles});
}

/** Quick merged overview samples selected scanlines, without expanding the merged image. */
export function psdOverview(bytes:Uint8Array):Bitmap {
 const b=pagedMergedPsd(bytes),p=b.pages as Extract<PixelPages,{kind:'psd-rgb8'}>,scale=Math.min(1,512/Math.max(b.width,b.height)),width=Math.max(1,Math.round(b.width*scale)),height=Math.max(1,Math.round(b.height*scale)),data=new Uint8ClampedArray(width*height*4);
 for(let i=3;i<data.length;i+=4)data[i]=255;
 for(const channel of p.channels){if(!channel.data)continue;const source=channel.data,c=channel.id===-1?3:channel.id;if(c===3)continue;const offsets=new Uint32Array(b.height+1),v=new DataView(source.buffer,source.byteOffset,source.byteLength);if(channel.compression===1){offsets[0]=b.height*2;for(let y=0;y<b.height;y++)offsets[y+1]=offsets[y]!+v.getUint16(y*2);}
  for(let y=0;y<height;y++){const sy=Math.min(b.height-1,Math.floor((y+.5)*b.height/height)),row=new Uint8Array(b.width);if(channel.compression===0)row.set(source.subarray(sy*b.width,(sy+1)*b.width));else{let at=offsets[sy]!,x=0;while(at<offsets[sy+1]!){const n=source[at++]!;if(n===128)continue;const count=n<128?n+1:257-n;if(x+count>b.width||at+(n<128?count:1)>offsets[sy+1]!)throw Error('PSD 预览行损坏。');if(n<128){row.set(source.subarray(at,at+count),x);at+=count;}else row.fill(source[at++]!,x,x+count);x+=count;}}
   for(let x=0;x<width;x++)data[(y*width+x)*4+c]=row[Math.min(b.width-1,Math.floor((x+.5)*b.width/width))]!;
  }
 }
 return {width,height,data};
}
