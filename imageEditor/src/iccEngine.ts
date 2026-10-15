import { instantiate, type Lcms } from 'lcms-wasm';
import { srgbProfileBytes, embeddedProfile } from './colorManagement.js';
import { depthOf, displayBitmap, withPixels, pixelArray } from './pixelFormat.js';
import type { Bitmap, ImageState, ImageLayer } from './document.js';
export interface IccSettings {intent:0|1|2|3;bpc:boolean;proofIntent:0|1|2|3;gamutWarning:boolean;proofEnabled?:boolean;proofProfile?:Uint8Array;monitorProfile?:Uint8Array}
let engine:Lcms|undefined,pending:Promise<Lcms>|undefined;
export function initializeIcc(wasmBinary?:Uint8Array):Promise<Lcms>{return pending??=instantiate({... (wasmBinary?{wasmBinary}:{}),locateFile:()=>new URL('./lcms.wasm',import.meta.url).href,printErr:()=>{}}).then(m=>engine=m).catch(e=>{pending=undefined;throw e;});}
export function inspectIccBytes(bytes:Uint8Array){if(!(bytes instanceof Uint8Array)||bytes.length<132||bytes.length>4*1024*1024)throw Error('ICC 文件应为 132 B–4 MiB。');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(v.getUint32(0)!==bytes.length||v.getUint32(36)!==0x61637370||![2,4].includes(bytes[8]!))throw Error('需要有效的 ICC v2/v4 配置。');const count=v.getUint32(128);if(count>1024||132+count*12>bytes.length)throw Error('ICC 标签表无效。');for(let i=0;i<count;i++){const p=132+i*12,start=v.getUint32(p+4),size=v.getUint32(p+8);if(start<132+count*12||start+size>bytes.length||size<8)throw Error('ICC 标签范围无效。');}}
function cms(){if(!engine)throw Error('ICC 引擎尚未初始化。');return engine;}
function open(profile:Uint8Array|'srgb'|'lab'|'xyz'){const m=cms();if(typeof profile==='string')return profile==='srgb'?m.cmsCreate_sRGBProfile():profile==='lab'?m.cmsCreateLab4Profile():m.cmsCreateXYZProfile();inspectIccBytes(profile);const h=m.cmsOpenProfileFromMem(profile,profile.length);if(!h)throw Error('Little CMS 无法打开 ICC。');return h;}
export function profileInfo(profile:Uint8Array){const m=cms(),h=open(profile);try{return {space:m.cmsGetColorSpaceASCII(h),name:m.cmsGetProfileInfoASCII(h,0,'en','US'),profileClass:String.fromCharCode(...profile.subarray(12,16)),version:`${profile[8]}.${profile[9]!>>4}.${profile[9]!&15}`,bytes:profile.length,engine:'Little CMS 2.16'};}finally{m.cmsCloseProfile(h);}}
type IccProfile=Uint8Array|'srgb'|'lab'|'xyz';
interface TransformEntry {source:IccProfile;target:IccProfile;proof:Uint8Array|undefined;key:string;handle:number;handles:number[];sourceSpace:string;targetSpace:string;inch:number;outch:number}
let transforms:TransformEntry[]|undefined;
let createdTransforms=0,reusedTransforms=0,liveTransforms=0;
export const iccTransformStats=()=>({created:createdTransforms,reused:reusedTransforms,live:liveTransforms});
function closeTransform(t:TransformEntry){const m=cms();m.cmsDeleteTransform(t.handle);for(const h of t.handles)m.cmsCloseProfile(h);liveTransforms--;}
/** Synchronous rendering scope: share CMM setup across tiles, release native memory even on failure. */
export function withIccTransforms<T>(action:()=>T):T {
 if(transforms)return action();transforms=[];
 try{return action();}finally{for(const t of transforms)closeTransform(t);transforms=undefined;}
}
const sameProfile=(a:IccProfile|undefined,b:IccProfile|undefined)=>a===b||a instanceof Uint8Array&&b instanceof Uint8Array&&a.length===b.length&&a.every((v,i)=>v===b[i]);
function createTransform(source:IccProfile,target:IccProfile,settings:Partial<IccSettings>):TransformEntry {
 const intent=settings.intent??1,proofIntent=settings.proofIntent??1;
 if(![0,1,2,3].includes(intent)||![0,1,2,3].includes(proofIntent))throw Error('ICC 转换意图无效。');
 const proof=settings.proofEnabled!==false?settings.proofProfile:undefined,key=[intent,proofIntent,!!settings.bpc,!!settings.gamutWarning].join(':');
 const cached=transforms?.find(t=>sameProfile(t.source,source)&&sameProfile(t.target,target)&&sameProfile(t.proof,proof)&&t.key===key);if(cached){reusedTransforms++;return cached;}
 const m=cms(),handles:number[]=[];let handle=0;
 try{const a=open(source);handles.push(a);const b=open(target);handles.push(b);const spaces:Record<string,number>={RGB:3,CMYK:4,GRAY:1,Lab:3,XYZ:3},sourceSpace=m.cmsGetColorSpaceASCII(a),targetSpace=m.cmsGetColorSpaceASCII(b),inch=spaces[sourceSpace],outch=spaces[targetSpace];
  if(!inch||!outch)throw Error('ICC 颜色空间无效。');
  const af=m.cmsFormatterForColorspaceOfProfile(a,4,true),bf=m.cmsFormatterForColorspaceOfProfile(b,4,true),flags=0x0100|(settings.bpc?0x2000:0);
  if(proof){const p=open(proof);handles.push(p);handle=m.cmsCreateProofingTransform(a,af,b,bf,p,intent,proofIntent,flags|0x4000|(settings.gamutWarning?0x1000:0));}else handle=m.cmsCreateTransform(a,af,b,bf,intent,flags);
  if(!handle)throw Error('ICC 配置不支持所选转换／软打样。');
  const entry={source,target,proof,key,handle,handles,sourceSpace,targetSpace,inch,outch};createdTransforms++;liveTransforms++;
  if(transforms){if(transforms.length===8)closeTransform(transforms.shift()!);transforms.push(entry);}return entry;
 }catch(e){if(handle)m.cmsDeleteTransform(handle);for(const h of handles)m.cmsCloseProfile(h);throw e;}
}
export function iccTransform(input:Float32Array,source:IccProfile,target:IccProfile,settings:Partial<IccSettings>={}){
 const t=createTransform(source,target,settings),m=cms();
 try{const {inch,outch,sourceSpace,targetSpace}=t;
  if(input.length%inch||input.byteLength+input.length/inch*outch*4>128*1024*1024||input.some(n=>!Number.isFinite(n)||Math.abs(n)>65504))throw Error('ICC 样本数量、颜色空间或预算无效。');
  const pixels=input.length/inch,out=new Float32Array(pixels*outch);
  for(let start=0;start<pixels;start+=4096){const n=Math.min(4096,pixels-start);out.set(m.cmsDoTransform(t.handle,input.subarray(start*inch,(start+n)*inch),n),start*outch);}
  if(out.some(v=>!Number.isFinite(v)))throw Error('ICC 转换产生无效样本。');return {data:out,sourceSpace,targetSpace,pixels,channels:outch};
 }finally{if(!transforms)closeTransform(t);}
}
/** Linear sRGB ICC for the 32-bit working space, with the same D50 colorants as sRGB. */
export function linearSrgbProfile(){const bytes=srgbProfileBytes(),v=new DataView(bytes.buffer);for(let i=0;i<v.getUint32(128);i++){const p=132+i*12,tag=v.getUint32(p);if([0x72545243,0x67545243,0x62545243].includes(tag)){const offset=v.getUint32(p+4);v.setUint16(offset+8,0);v.setInt32(offset+12,65536);}}return bytes;}
export function workingProfile(state:ImageState):Uint8Array{return embeddedProfile(state)??(state.bitDepth===32?linearSrgbProfile():srgbProfileBytes());}
export function transformBitmapIcc(b:Bitmap,source:Uint8Array,target:Uint8Array,settings:Partial<IccSettings>={}):Bitmap{
 const rgb=new Float32Array(b.width*b.height*3);for(let i=0,j=0;i<b.data.length;i+=4,j+=3){rgb[j]=b.data[i]!/255;rgb[j+1]=b.data[i+1]!/255;rgb[j+2]=b.data[i+2]!/255;}const result=iccTransform(rgb,source,target,settings);if(result.channels!==3)throw Error('文档工作空间必须是 RGB。');const data=pixelArray(b.data.length,b);for(let i=0;i<b.width*b.height;i++){for(let c=0;c<3;c++)data[i*4+c]=result.data[i*3+c]!*255;data[i*4+3]=b.data[i*4+3]!;}return withPixels(b.width,b.height,data,b);
}
let displaySrgb:Uint8Array|undefined,displayLinear:Uint8Array|undefined;
const canvasProfile=()=>displaySrgb??=srgbProfileBytes();
const linearProfile=()=>displayLinear??=linearSrgbProfile();
function monitorToCanvas(b:Bitmap,settings:IccSettings|undefined):Bitmap{return settings?.monitorProfile?transformBitmapIcc(b,settings.monitorProfile,canvasProfile(),{intent:settings.intent,bpc:settings.bpc}):b;}
export function colorDisplay(b:Bitmap,state:ImageState):Bitmap{
 if(state.colorMode==='cmyk'&&b.cmyk){const profile=embeddedProfile(state);if(!profile)return displayBitmap(b);const settings=state.icc,r=iccTransform(b.cmyk,profile,settings?.monitorProfile??'srgb',settings),data=new Float32Array(b.data.length);for(let i=0;i<b.width*b.height;i++){for(let c=0;c<3;c++)data[i*4+c]=r.data[i*3+c]!*255;data[i*4+3]=b.data[i*4+3]!;}return displayBitmap(monitorToCanvas(withPixels(b.width,b.height,data,16),settings));}
 const profile=state.colorMode==='cmyk'?undefined:embeddedProfile(state),settings=state.icc;if(!profile&&!settings)return displayBitmap(b,state.display);
 if(!engine)throw Error('ICC 引擎未就绪，不能显示未转换的颜色。');
 if(depthOf(b)===32){const linear=profile?transformBitmapIcc(b,profile,linearProfile(),{intent:settings?.intent??1,bpc:settings?.bpc??true}):b;const mapped=displayBitmap(linear,state.display);return (settings?.proofProfile&&settings.proofEnabled!==false)||settings?.monitorProfile?monitorToCanvas(transformBitmapIcc(mapped,canvasProfile(),settings.monitorProfile??canvasProfile(),settings),settings):mapped;}
 const converted=transformBitmapIcc(b,profile??canvasProfile(),settings?.monitorProfile??canvasProfile(),settings);return displayBitmap(monitorToCanvas(converted,settings));
}
export function convertIccLayers(layers:readonly ImageLayer[],source:Uint8Array,target:Uint8Array,settings:Partial<IccSettings>):readonly ImageLayer[]{
 return layers.map(l=>{if(l.content||l.smartFilters?.length||l.styles?.enabled||l.blendIf?.enabled)throw Error('配置转换包含参数化颜色内容，请先明确栅格化这些图层以保持外观。');return {...l,bitmap:l.bitmap?transformBitmapIcc(l.bitmap,source,target,{intent:settings.intent??1,bpc:settings.bpc??true}):null,children:convertIccLayers(l.children,source,target,settings)};});
}
