import type { ImageState } from './document.js';
import { allLayers,layerLocked } from './document.js';
import { embeddedProfile,profileResource,srgbProfileBytes,builtinProfile } from './colorManagement.js';
import { concatBytes,resourceBlocks } from './psdResources.js';
import { profileInfo,linearSrgbProfile,workingProfile,convertIccLayers,type IccSettings } from './iccEngine.js';
import { convertDocumentCmyk } from './cmyk.js';
import { pixelJob } from './pixelJobs.js';
export const ICC_PRESETS=['srgb','linear-srgb','display-p3','adobe-rgb'] as const;
export type IccPreset=typeof ICC_PRESETS[number];
export function builtinIcc(preset:IccPreset):Uint8Array {
 if(!ICC_PRESETS.includes(preset))throw Error('未知 ICC 预设。');const bytes=preset==='linear-srgb'?linearSrgbProfile():srgbProfileBytes(),v=new DataView(bytes.buffer),name={'srgb':'Haiyue sRGB','linear-srgb':'Linear sRGB','display-p3':'Display P3','adobe-rgb':'Adobe RGB'}[preset];
 const matrix=builtinProfile(preset==='linear-srgb'?'srgb':preset).matrix;
 for(let i=0;i<v.getUint32(128);i++){const at=132+i*12,tag=v.getUint32(at),p=v.getUint32(at+4),size=v.getUint32(at+8),column=[0x7258595a,0x6758595a,0x6258595a].indexOf(tag);
  if(column>=0)for(let row=0;row<3;row++)v.setInt32(p+8+row*4,Math.round(matrix[row*3+column]!*65536));
  if(preset==='adobe-rgb'&&[0x72545243,0x67545243,0x62545243].includes(tag)){bytes.fill(0,p+8,p+size);v.setInt32(p+12,563/256*65536);}
  if(tag===0x64657363){v.setUint32(p+20,name.length*2);bytes.fill(0,p+28,p+size);for(let c=0;c<name.length;c++)v.setUint16(p+28+c*2,name.charCodeAt(c));}
 }return bytes;
}
export const defaultIccSettings=():IccSettings=>({intent:1,bpc:true,proofIntent:1,gamutWarning:false});
export function profileResources(state:ImageState,profile?:Uint8Array){return concatBytes([...resourceBlocks(state.psdOrigin?.resources??new Uint8Array()).filter(b=>b.id!==1039).map(b=>b.bytes),...(profile?[profileResource(profile)]:[])]);}
export function assertWorkingProfile(state:ImageState,profile:Uint8Array){const info=profileInfo(profile);if(info.space!==(state.colorMode==='cmyk'?'CMYK':'RGB'))throw Error('ICC 与文档 RGB／CMYK 模式不匹配；请先转换颜色模式。');if(!['mntr','scnr','prtr','spac'].includes(info.profileClass))throw Error('设备链接、抽象或命名色配置不能用作文档工作配置。');return info;}
export function withDocumentProfile(state:ImageState,profile?:Uint8Array):ImageState{return {...state,psdOrigin:{sourceName:state.psdOrigin?.sourceName??state.name,flattened:state.psdOrigin?.flattened??false,resources:profileResources(state,profile)}};}
export async function applyIccPolicy(state:ImageState,policy:'preserve'|'assign'|'convert'|'remove',profile?:Uint8Array,settings:IccSettings=state.icc??defaultIccSettings(),signal?:AbortSignal):Promise<ImageState>{
 signal?.throwIfAborted();if(policy==='preserve'){if(profile)throw Error('保留配置策略不能同时指定目标配置。');const source=embeddedProfile(state);if(source)assertWorkingProfile(state,source);return state;}
 if(policy==='remove')return withDocumentProfile(state);
 if(!profile)throw Error('指定或转换配置需要目标 ICC。');assertWorkingProfile(state,profile);
 if(policy==='assign')return {...withDocumentProfile(state,profile),icc:settings};
 if(allLayers(state.layers).some(l=>layerLocked(state.layers,l.id)))throw Error('请先解除图层锁定。');const source=embeddedProfile(state);if(source)assertWorkingProfile(state,source);
 const conversion={intent:settings.intent,bpc:settings.bpc};
 const converted=state.colorMode==='cmyk'?convertDocumentCmyk(state,profile,conversion):{...withDocumentProfile(state,profile),layers:typeof Worker==='undefined'?convertIccLayers(state.layers,workingProfile(state),profile,conversion):await pixelJob<ReturnType<typeof convertIccLayers>>({kind:'icc-layers',state,iccSource:workingProfile(state),iccTarget:profile,iccSettings:conversion},signal)};
 signal?.throwIfAborted();return {...converted,icc:settings};
}
export function iccDocumentInfo(state:ImageState){const bytes=embeddedProfile(state),describe=(p:Uint8Array|undefined)=>{if(!p)return null;try{return {...profileInfo(p),status:'valid',reason:null};}catch(e){return {status:'invalid',name:'无效 ICC',space:null,profileClass:null,version:null,bytes:p.length,engine:'Little CMS 2.16',reason:e instanceof Error?e.message:String(e)};}};
 let status=bytes?'embedded':'untagged',reason='';if(bytes)try{assertWorkingProfile(state,bytes);}catch(e){status='invalid';reason=e instanceof Error?e.message:String(e);}
 return {colorMode:state.colorMode??'rgb',status,reason,working:describe(bytes),effective:bytes?'embedded':state.colorMode==='cmyk'?'approximate-cmyk':state.bitDepth===32?'assumed-linear-srgb':'assumed-srgb',proof:describe(state.icc?.proofProfile),monitor:describe(state.icc?.monitorProfile),proofEnabled:!!state.icc?.proofProfile&&state.icc.proofEnabled!==false&&(state.colorMode!=='cmyk'||!!bytes),intent:state.icc?.intent??1,bpc:state.icc?.bpc??true,proofIntent:state.icc?.proofIntent??1,gamutWarning:state.icc?.gamutWarning??false};
}
