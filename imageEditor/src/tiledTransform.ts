import {smartGeometryAsync} from './smartGeometry.js';
import { depthOf, pixelArray, pixelBytesView, withPixels } from './pixelFormat.js';
import { cmykBitmap } from './cmyk.js';
import { embeddedProfile } from './colorManagement.js';
import { deflate } from 'pako';
import { diskPager, type DiskBlob } from './diskPager.js';
import { bitmapRegionAsync } from './diskCompositor.js';
import { pagedBitmap } from './pagedPixels.js';
import { checkSize, findLayer, layerLocked, type Bitmap, type ImageState } from './document.js';
import { kernel, weights, validateResampling } from './resampling.js';
import type { Resampling } from './resampling.js';
import type { TransformValues } from './freeTransform.js';
/** Bounded row cache for scale-aware separable resampling. No full intermediate plane. */
async function resize(source:Bitmap,width:number,height:number,method:Resampling,signal?:AbortSignal):Promise<Bitmap>{
 if(source.width===width&&source.height===height)return source;
 const wx=method==='nearest'?undefined:weights(source.width,width,method),wy=method==='nearest'?undefined:weights(source.height,height,method),cache=new Map<number,Float32Array>();let bytes=0;
 let strip:Bitmap|undefined,stripY=-1;
 const row=async(y:number)=>{let hit=cache.get(y);if(hit){cache.delete(y);cache.set(y,hit);return hit;}const top=Math.floor(y/32)*32;if(top!==stripY){strip=await bitmapRegionAsync(source,{x:0,y:top,width:source.width,height:Math.min(32,source.height-top)},signal);stripY=top;}hit=new Float32Array(width*4);const raw=strip!.data,offset=(y-stripY)*source.width*4;
  for(let x=0;x<width;x++){const w=wx?.[x],indices=w?.indices??[Math.min(source.width-1,Math.floor((x+.5)*source.width/width))],values=w?.values??[1];for(let k=0;k<indices.length;k++){const i=offset+indices[k]!*4,a=raw[i+3]!,v=values[k]!;hit[x*4+3]!+=a*v;for(let c=0;c<3;c++)hit[x*4+c]!+=raw[i+c]!*a/255*v;}}
  while(bytes+hit.byteLength>16*1024*1024&&cache.size){const [key,value]=cache.entries().next().value!;cache.delete(key);bytes-=value.byteLength;}cache.set(y,hit);bytes+=hit.byteLength;return hit;
 };
 const tiles:DiskBlob[]=[];
 for(let top=0;top<height;top+=256){const h=Math.min(256,height-top),parts=Array.from({length:Math.ceil(width/256)},(_,i)=>pixelArray(Math.min(256,width-i*256)*h*4,source));
  for(let y=top;y<top+h;y++){signal?.throwIfAborted();const w=wy?.[y],indices=w?.indices??[Math.min(source.height-1,Math.floor((y+.5)*source.height/height))],values=w?.values??[1],sum=new Float32Array(width*4);
   for(let k=0;k<indices.length;k++){const r=await row(indices[k]!);for(let i=0;i<sum.length;i++)sum[i]!+=r[i]!*values[k]!;}
   for(let x=0;x<width;x++){const tx=Math.floor(x/256),tw=Math.min(256,width-tx*256),i=((y-top)*tw+x%256)*4,p=x*4,a=sum[p+3]!,out=parts[tx]!;for(let c=0;c<3;c++)out[i+c]=a>1e-6?sum[p+c]!*255/a:0;out[i+3]=a;}
  }
  for(const data of parts){bound(data,source);tiles.push(await diskPager.write(deflate(pixelBytesView(withPixels(data.length/4,1,data,source))),signal));}await new Promise<void>(r=>setTimeout(r,0));
 }return pagedBitmap(width,height,{kind:'disk',tiles},depthOf(source));
}
async function rotate(source:Bitmap,angle:number,flipX:boolean,flipY:boolean,method:Resampling,signal?:AbortSignal):Promise<Bitmap>{
 if(!angle&&!flipX&&!flipY)return source;
 const rad=angle*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad),sw=source.width,sh=source.height,width=Math.ceil(Math.abs(sw*c)+Math.abs(sh*s)-1e-8),height=Math.ceil(Math.abs(sw*s)+Math.abs(sh*c)-1e-8);checkSize(width,height);
 const radius=method==='nearest'?0:method==='bilinear'?1:method==='bicubic'?2:3,tiles:DiskBlob[]=[];
 const map=(x:number,y:number)=>{const cx=x+.5-width/2,cy=y+.5-height/2;let sx=cx*c+cy*s+sw/2-.5,sy=-cx*s+cy*c+sh/2-.5;if(flipX)sx=sw-1-sx;if(flipY)sy=sh-1-sy;return {x:sx,y:sy};};
 for(let y=0;y<height;y+=256)for(let x=0;x<width;x+=256){signal?.throwIfAborted();const w=Math.min(256,width-x),h=Math.min(256,height-y),corners=[map(x,y),map(x+w-1,y),map(x,y+h-1),map(x+w-1,y+h-1)],left=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x))-radius)),top=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y))-radius)),right=Math.min(sw,Math.ceil(Math.max(...corners.map(p=>p.x))+radius)+1),bottom=Math.min(sh,Math.ceil(Math.max(...corners.map(p=>p.y))+radius)+1),data=pixelArray(w*h*4,source);
  if(right>left&&bottom>top){const src=await bitmapRegionAsync(source,{x:left,y:top,width:right-left,height:bottom-top},signal);
   for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){const p=map(x+xx,y+yy),at=(yy*w+xx)*4;
    if(method==='nearest'||Math.abs(p.x-Math.round(p.x))<1e-8&&Math.abs(p.y-Math.round(p.y))<1e-8){const sx=Math.round(p.x),sy=Math.round(p.y);if(sx>=0&&sy>=0&&sx<sw&&sy<sh){const i=((sy-top)*src.width+sx-left)*4;data.set(src.data.subarray(i,i+4),at);}continue;}
    let a=0,r=0,g=0,b=0,sumX=0,sumY=0;for(let k=Math.ceil(p.x-radius);k<=Math.floor(p.x+radius);k++)sumX+=kernel(p.x-k,method);for(let k=Math.ceil(p.y-radius);k<=Math.floor(p.y+radius);k++)sumY+=kernel(p.y-k,method);
    for(let sy=Math.max(0,Math.ceil(p.y-radius));sy<=Math.min(sh-1,Math.floor(p.y+radius));sy++)for(let sx=Math.max(0,Math.ceil(p.x-radius));sx<=Math.min(sw-1,Math.floor(p.x+radius));sx++){const i=((sy-top)*src.width+sx-left)*4,v=kernel(p.x-sx,method)*kernel(p.y-sy,method)*src.data[i+3]!;a+=v;r+=v*src.data[i]!;g+=v*src.data[i+1]!;b+=v*src.data[i+2]!;}if(a>1e-6){data[at]=r/a;data[at+1]=g/a;data[at+2]=b/a;data[at+3]=a/(sumX*sumY);}
   }
  }bound(data,source);tiles.push(await diskPager.write(deflate(pixelBytesView(withPixels(data.length/4,1,data,source))),signal));
 }return pagedBitmap(width,height,{kind:'disk',tiles},depthOf(source));
}
async function nearestTransform(source:Bitmap,v:TransformValues,signal?:AbortSignal):Promise<Bitmap>{
 const rad=v.angle*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad),width=Math.ceil(Math.abs(v.width*c)+Math.abs(v.height*s)-1e-8),height=Math.ceil(Math.abs(v.width*s)+Math.abs(v.height*c)-1e-8);checkSize(width,height);const tiles:DiskBlob[]=[],cache=new Map<string,Bitmap>();
 for(let y=0;y<height;y+=256)for(let x=0;x<width;x+=256){signal?.throwIfAborted();const w=Math.min(256,width-x),h=Math.min(256,height-y),data=pixelArray(w*h*4,source);
 for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){const cx=x+xx+.5-width/2,cy=y+yy+.5-height/2;let sx=(cx*c+cy*s)/v.width+.5,sy=(-cx*s+cy*c)/v.height+.5;if(v.flipX)sx=1-sx;if(v.flipY)sy=1-sy;if(sx<0||sy<0||sx>=1||sy>=1)continue;const px=Math.floor(sx*source.width),py=Math.floor(sy*source.height),tx=Math.floor(px/256)*256,ty=Math.floor(py/256)*256,key=`${tx}/${ty}`;let b=cache.get(key);if(!b){b=await bitmapRegionAsync(source,{x:tx,y:ty,width:Math.min(256,source.width-tx),height:Math.min(256,source.height-ty)},signal);if(cache.size>=32)cache.delete(cache.keys().next().value!);cache.set(key,b);}const i=((py-ty)*b.width+px-tx)*4;data.set(b.data.subarray(i,i+4),(yy*w+xx)*4);}
 bound(data,source);tiles.push(await diskPager.write(deflate(pixelBytesView(withPixels(data.length/4,1,data,source))),signal));}return pagedBitmap(width,height,{kind:'disk',tiles},depthOf(source));
}
export async function tiledTransform(state:ImageState,id:string,v:TransformValues,signal?:AbortSignal):Promise<import('./document.js').ImageLayer>{
 const layer=findLayer(state.layers,id);if(!layer?.bitmap||layer.kind!=='pixel'||layerLocked(state.layers,id,'position'))throw Error('请选择未锁定的像素图层。');if(layer.content?.type==='smart'&&!layer.mask&&!layer.filterMask){if(layer.content.transform.mesh){const content={...layer.content,transform:{mesh:layer.content.transform.mesh,width:v.width,height:v.height,angle:v.angle,flipX:!!v.flipX,flipY:!!v.flipY}},bitmap=await smartGeometryAsync(content,signal);return {...layer,content,bitmap,x:Math.round(layer.x+(layer.bitmap.width-bitmap.width)/2+v.dx),y:Math.round(layer.y+(layer.bitmap.height-bitmap.height)/2+v.dy)};}const {content,...plain}=layer;const rendered=await tiledTransform({...state,layers:[{...plain,bitmap:content.source,children:[]}]},id,v,signal),bitmap=rendered.bitmap!;return {...layer,bitmap,content:{...content,transform:{width:v.width,height:v.height,angle:v.angle,flipX:!!v.flipX,flipY:!!v.flipY,resampling:v.resampling??'bicubic'}},x:Math.round(layer.x+(layer.bitmap.width-bitmap.width)/2+v.dx),y:Math.round(layer.y+(layer.bitmap.height-bitmap.height)/2+v.dy)};}if(layer.content||layer.mask||layer.filterMask)throw Error('分块自由变换前请栅格化内容／应用蒙版。');checkSize(v.width,v.height);if(!Number.isFinite(v.angle)||Math.abs(v.angle)>360||![v.dx,v.dy].every(n=>Number.isInteger(n)&&Math.abs(n)<=32768))throw Error('变换参数无效。');const method=v.resampling??'bicubic';validateResampling(method);
 const transform=(b:Bitmap)=>method==='nearest'?nearestTransform(b,v,signal):resize(b,v.width,v.height,method,signal).then(s=>rotate(s,v.angle,!!v.flipX,!!v.flipY,method,signal));const bitmap=state.colorMode==='cmyk'?await transformInks(layer.bitmap,state,transform,signal):await transform(layer.bitmap);signal?.throwIfAborted();return {...layer,bitmap,x:Math.round(layer.x+(layer.bitmap.width-bitmap.width)/2+v.dx),y:Math.round(layer.y+(layer.bitmap.height-bitmap.height)/2+v.dy)};
}

function bound(data:Uint8ClampedArray|Float32Array,source:Bitmap){if(depthOf(source)===8)return;for(let i=0;i<data.length;i++)if(i%4===3||depthOf(source)===16)data[i]=Math.max(0,Math.min(255,data[i]!));}
async function transformInks(source:Bitmap,state:ImageState,transform:(b:Bitmap)=>Promise<Bitmap>,signal?:AbortSignal){
 const inputs:Bitmap[]=[];
 for(let pass=0;pass<2;pass++){const tiles:DiskBlob[]=[];for(let y=0;y<source.height;y+=256)for(let x=0;x<source.width;x+=256){const b=await bitmapRegionAsync(source,{x,y,width:Math.min(256,source.width-x),height:Math.min(256,source.height-y)},signal),data=new Float32Array(b.data.length);for(let i=0;i<data.length;i+=4){for(let c=0;c<3;c++)data[i+c]=b.cmyk![i+(pass?3:c)]!;data[i+3]=b.data[i+3]!;}tiles.push(await diskPager.write(deflate(pixelBytesView(withPixels(b.width,b.height,data,16))),signal));}inputs.push(await transform(pagedBitmap(source.width,source.height,{kind:'disk',tiles},16)));}
 const a=inputs[0]!,tiles:DiskBlob[]=[],inks:DiskBlob[]=[];
 for(let y=0;y<a.height;y+=256)for(let x=0;x<a.width;x+=256){const r={x,y,width:Math.min(256,a.width-x),height:Math.min(256,a.height-y)},cmy=await bitmapRegionAsync(a,r,signal),k=await bitmapRegionAsync(inputs[1]!,r,signal),ink=new Float32Array(cmy.data.length),alpha=new Float32Array(r.width*r.height);for(let i=0;i<alpha.length;i++){for(let c=0;c<4;c++)ink[i*4+c]=Math.max(0,Math.min(100,c===3?k.data[i*4]!:cmy.data[i*4+c]!));alpha[i]=cmy.data[i*4+3]!;}const b=cmykBitmap(r.width,r.height,ink,alpha,(state.bitDepth??8) as 8|16,embeddedProfile(state));tiles.push(await diskPager.write(deflate(pixelBytesView(b)),signal));inks.push(await diskPager.write(deflate(pixelBytesView(withPixels(r.width,r.height,ink,16))),signal));}
 return pagedBitmap(a.width,a.height,{kind:'disk',tiles,inks},depthOf(source));
}
