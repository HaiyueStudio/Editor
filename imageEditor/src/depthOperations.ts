import type { EditorDisposable, EditorJsonValue } from '@haiyue/editor-plugin-sdk';
import type { ImageWorkspace } from './workspace.js';
import { checkSize, findLayer } from './document.js';
import { type BitDepth, type DisplaySettings, withPixels, validateBitmap } from './pixelFormat.js';
const str={type:'string',minLength:1,maxLength:160} as const;
type Params={readonly[key:string]:EditorJsonValue};
export function registerDepthOperations(workspace:ImageWorkspace):EditorDisposable{
 const p=workspace.platform,owned:EditorDisposable[]=[];
 const definitions=[
  {id:'document.depth',properties:{depth:{type:'integer',minimum:8,maximum:32},allowLoss:{type:'boolean'}},required:['depth']},
  {id:'document.display',properties:{output:{type:'string',enum:['auto','sdr','hdr']},exposure:{type:'number',minimum:-20,maximum:20},operator:{type:'string',enum:['clip','reinhard','aces']}},required:['exposure','operator']},
  {id:'pixels.write',properties:{layerId:str,resourceId:str,width:{type:'integer',minimum:1,maximum:8192},height:{type:'integer',minimum:1,maximum:8192},format:{type:'string',enum:['rgba8','rgba16le','rgba32fle']}},required:['layerId','resourceId','width','height','format']},
  {id:'hdr.exposure',properties:{layerId:str,ev:{type:'number',minimum:-20,maximum:20}},required:['layerId','ev']},
 ] as const;
 for(const def of definitions)owned.push(workspace.registerOperation({ownerId:'image.operations',descriptor:{id:'image.'+def.id,title:def.id,version:1,target:'document',documentKinds:['haiyue.image'],access:'write',input:{type:'object',properties:def.properties,required:def.required},output:{type:'json'}},prepare(params:Params,c){const d=workspace.documents.find(d=>d.identity.id===c.document?.id);if(!d)throw Error('文档已关闭。');const layer=params.layerId?findLayer(d.state.layers,params.layerId as string):undefined;
  let bitmap=layer?.bitmap;
  if(def.id==='pixels.write'){if(!layer||layer.content||layer.kind!=='pixel')throw Error('请选择像素层。');const w=params.width as number,h=params.height as number;checkSize(w,h);const depth:BitDepth=params.format==='rgba8'?8:params.format==='rgba16le'?16:32;if(depth!==(d.state.bitDepth??8))throw Error('资源位深必须与文档一致，请先转换文档位深。');const bytes=p.resources.read(params.resourceId as string),size=depth/8;if(bytes.length!==w*h*4*size)throw Error('像素资源长度不匹配。');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),data=depth===8?new Uint8ClampedArray(bytes):Float32Array.from({length:w*h*4},(_,i)=>depth===16?v.getUint16(i*2,true)/257:v.getFloat32(i*4,true)*255);bitmap=withPixels(w,h,data,depth);validateBitmap(bitmap);}
  if(def.id==='hdr.exposure'){if(d.state.bitDepth!==32||!bitmap)throw Error('曝光需要 32 位 HDR 像素层。');const data=bitmap.data.slice(),gain=2**(params.ev as number);for(let i=0;i<data.length;i++)if(i%4!==3)data[i]=data[i]!*gain;bitmap={...bitmap,data};}
  return {d,params,layer,bitmap};},commit({d,params,layer,bitmap}){return d.runAtomic(()=>{if(def.id==='document.depth')d.setDepth(params.depth as BitDepth,params.allowLoss===true);else if(def.id==='document.display')d.setDisplay(params as unknown as DisplaySettings);else d.replaceLayerPixels(layer!.id,{...layer!,bitmap:bitmap!},def.id);return {applied:true,bitDepth:d.state.bitDepth??8};});},rollback(){}}));
 return {async dispose(){await Promise.all(owned.map(o=>o.dispose()));}};
}
