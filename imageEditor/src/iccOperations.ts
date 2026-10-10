import { pixelJob } from './pixelJobs.js';
import type { EditorDisposable,EditorJsonValue } from '@haiyue/editor-plugin-sdk';
import type { ImageWorkspace } from './workspace.js';
import { initializeIcc,profileInfo,iccTransform,type IccSettings } from './iccEngine.js';
import { embeddedProfile } from './colorManagement.js';
import { ICC_PRESETS,builtinIcc,iccDocumentInfo,applyIccPolicy,defaultIccSettings,type IccPreset } from './iccWorkflow.js';
const str={type:'string',minLength:1,maxLength:160} as const,intent={type:'integer',minimum:0,maximum:3} as const;
type Params={readonly[key:string]:EditorJsonValue};
export function registerIccOperations(w:ImageWorkspace):EditorDisposable {
 const owned:EditorDisposable[]=[],p=w.platform;
 for(const mode of ['inspect','transform','assign','convert','proof','query','read','remove','builtin'] as const){
  const document=!['inspect','transform','builtin'].includes(mode),read=['inspect','query','read','builtin'].includes(mode);
  owned.push(p.operations.register({ownerId:'image.operations',descriptor:{id:'image.icc.'+mode,title:'ICC '+mode,version:1,target:document?'document':'workspace',...(document?{documentKinds:['haiyue.image']}:{}),access:read?'read':'write',input:{type:'object',properties:{profileId:str,preset:{type:'string',enum:[...ICC_PRESETS]},slot:{type:'string',enum:['working','proof','monitor']},resourceId:str,source:str,target:str,proofProfile:str,monitorProfile:str,intent,bpc:{type:'boolean'},proofIntent:intent,gamutWarning:{type:'boolean'},proofEnabled:{type:'boolean'},clearProof:{type:'boolean'},clearMonitor:{type:'boolean'}},required:mode==='inspect'?['profileId']:mode==='transform'?['resourceId','source','target']:mode==='builtin'?['preset']:[]},output:{type:'json'}},async prepare(a:Params,c){
   await initializeIcc();c.signal.throwIfAborted();const d=document?w.documents.find(d=>d.identity.id===c.document?.id):undefined;if(document&&!d)throw Error('文档已关闭。');const created=[] as string[];
   const profile=(id:string)=>{const bytes=p.resources.read(id);profileInfo(bytes);return bytes;};
   if(mode==='query')return {info:iccDocumentInfo(d!.state),created};
   if(mode==='builtin'||mode==='read'){const bytes=mode==='builtin'?builtinIcc(a.preset as IccPreset):a.slot==='proof'?d!.state.icc?.proofProfile:a.slot==='monitor'?d!.state.icc?.monitorProfile:embeddedProfile(d!.state);if(!bytes)throw Error('没有可导出的 ICC 配置。');return {bytes,info:{...profileInfo(bytes),format:'icc'},created};}
   if(a.profileId&&a.preset)throw Error('profileId 与 preset 只能选一个。');
   const target=a.profileId?profile(a.profileId as string):a.preset?builtinIcc(a.preset as IccPreset):undefined;
   if(mode==='inspect')return {info:profileInfo(target!),created};
   const settings:IccSettings={...(d?.state.icc??defaultIccSettings()),...(a.intent!==undefined?{intent:a.intent as 0|1|2|3}:{}),...(a.bpc!==undefined?{bpc:a.bpc as boolean}:{}),...(a.proofIntent!==undefined?{proofIntent:a.proofIntent as 0|1|2|3}:{}),...(a.gamutWarning!==undefined?{gamutWarning:a.gamutWarning as boolean}:{}),...(a.proofEnabled!==undefined?{proofEnabled:a.proofEnabled as boolean}:{})};
   if(a.clearProof&&a.proofProfile||a.clearMonitor&&a.monitorProfile)throw Error('不能同时设置和移除同一配置。');
   if(a.clearProof){delete settings.proofProfile;settings.proofEnabled=false;}if(a.clearMonitor)delete settings.monitorProfile;
   if(a.proofProfile){settings.proofProfile=profile(a.proofProfile as string);settings.proofEnabled=a.proofEnabled!==false;}
   if(a.monitorProfile)settings.monitorProfile=profile(a.monitorProfile as string);
   if(settings.proofEnabled===true&&!settings.proofProfile)throw Error('请先选择打样配置。');
   for(const [kind,bytes] of [['打样',settings.proofProfile],['显示器',settings.monitorProfile]] as const)if(bytes){const info=profileInfo(bytes);if(!['mntr','scnr','prtr','spac'].includes(info.profileClass)||!(kind==='显示器'?['RGB']:['RGB','CMYK','GRAY','Lab','XYZ']).includes(info.space))throw Error(kind+'配置的颜色空间或设备类别不支持。');}
  if(mode==='transform'){const bytes=p.resources.read(a.resourceId as string);if(bytes.length%4)throw Error('ICC 输入需要 little-endian float32 样本。');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),input=Float32Array.from({length:bytes.length/4},(_,i)=>v.getFloat32(i*4,true)),get=(name:string)=>['srgb','lab','xyz'].includes(name)?name as 'srgb'|'lab'|'xyz':profile(name),r=typeof Worker==='undefined'?iccTransform(input,get(a.source as string),get(a.target as string),settings):await pixelJob<ReturnType<typeof iccTransform>>({kind:'icc-transform',iccInput:input,iccSource:get(a.source as string),iccTarget:get(a.target as string),iccSettings:settings},c.signal),out=new Uint8Array(r.data.length*4),ov=new DataView(out.buffer);r.data.forEach((n,i)=>ov.setFloat32(i*4,n,true));return {bytes:out,info:{sourceSpace:r.sourceSpace,targetSpace:r.targetSpace,pixels:r.pixels,channels:r.channels,format:'float32le'},created:[] as string[]};}

   if(mode==='proof'){if(d!.state.colorMode==='cmyk'&&!embeddedProfile(d!.state)&&(settings.proofProfile&&settings.proofEnabled!==false||settings.monitorProfile))throw Error('CMYK 打样前请先指定工作 ICC。');iccTransform(new Float32Array([.5,.5,.5]),'srgb',settings.monitorProfile??'srgb',{...settings,...(settings.proofProfile?{proofEnabled:true}:{}),gamutWarning:false});return {d,state:d!.state,settings,created};}
   const state=await applyIccPolicy(d!.state,mode,target,settings,c.signal);return {d,state,settings,created};
  },commit(r){if(r.bytes){const resource=p.resources.put(r.bytes);r.created.push(resource.resourceId);return {...resource,...r.info};}if(r.d){r.d.runAtomic(()=>r.d!.commitIcc(r.state!.psdOrigin?.resources??new Uint8Array(),r.settings!,r.state!.layers));return {applied:true};}return r.info!;},rollback(r){for(const id of r?.created??[])p.resources.release(id);}}));
 }
 return {async dispose(){await Promise.all(owned.map(o=>o.dispose()));}};
}
