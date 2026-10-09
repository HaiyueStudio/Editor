import type { ImageState } from './document.js';
import type { EditorJsonValue } from '@haiyue/editor-plugin-sdk';
export interface AlphaChannel { readonly id:string; readonly name:string; readonly data:Uint8Array }
export interface Guide { readonly id:string; readonly axis:'x'|'y'; readonly position:number }
export interface Layout { readonly visible:boolean; readonly snap:boolean; readonly canvas:boolean; readonly layers:boolean; readonly tolerance:number; readonly guides:readonly Guide[] }
export interface ActionParameter { readonly name:string; readonly type:'string'|'number'|'boolean'; readonly default?:string|number|boolean }
export interface ImageAction { readonly id:string; readonly name:string; readonly parameters:readonly ActionParameter[]; readonly steps:readonly { readonly operation:string; readonly params:EditorJsonValue }[] }
export const ACTION_OPERATIONS=['layer.update','pixels.fill','filter.apply','text.replace','smart.filters','layer.transform'] as const;
export const defaultLayout=():Layout=>({visible:true,snap:true,canvas:true,layers:true,tolerance:6,guides:[]});
const name=(v:unknown,max=160)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function validateAction(action:ImageAction){
 if(!action||!name(action.id,80)||!name(action.name)||!Array.isArray(action.parameters)||action.parameters.length>32||!Array.isArray(action.steps)||!action.steps.length||action.steps.length>32||JSON.stringify(action).length>65536)throw new Error('动作需要有效名称、最多 32 个参数和 1–32 个步骤（64 KiB 内）。');
 const parameters=new Set<string>();for(const p of action.parameters){if(!p||!name(p.name,64)||!(/^[A-Za-z][A-Za-z0-9_]*$/).test(p.name)||parameters.has(p.name)||!['string','number','boolean'].includes(p.type)||p.default!==undefined&&(typeof p.default!==p.type||typeof p.default==='number'&&!Number.isFinite(p.default)))throw new Error('动作参数定义无效。');parameters.add(p.name);}
 const visit=(value:unknown,depth=0)=>{if(depth>12)throw new Error('动作参数嵌套过深。');if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;if(Array.isArray(value)){for(const v of value)visit(v,depth+1);return;}if(value&&typeof value==='object'){const o=value as Record<string,unknown>;if(Object.hasOwn(o,'param')){if(Object.keys(o).length!==1||typeof o.param!=='string'||!parameters.has(o.param))throw new Error('动作引用未声明参数。');return;}for(const [k,v] of Object.entries(o)){if(['__proto__','prototype','constructor'].includes(k))throw new Error('动作字段无效。');visit(v,depth+1);}return;}throw new Error('动作只能使用 JSON 参数。');};
 for(const step of action.steps){if(!step||!ACTION_OPERATIONS.includes(step.operation as typeof ACTION_OPERATIONS[number])||!step.params||typeof step.params!=='object'||Array.isArray(step.params))throw new Error('动作步骤不受支持。');visit(step.params);}
}
export function validateProductivity(state:ImageState):number {
 let bytes=0;const ids=new Set<string>();if(state.channels!==undefined){if(!Array.isArray(state.channels)||state.channels.length>32)throw new Error('最多保存 32 个 Alpha 通道。');for(const c of state.channels){if(!c||!name(c.id,80)||!name(c.name)||ids.has(c.id)||!(c.data instanceof Uint8Array)||c.data.length!==state.width*state.height)throw new Error('Alpha 通道名称、ID 或尺寸无效。');ids.add(c.id);bytes+=c.data.byteLength;}}
 if(state.layout!==undefined){const l=state.layout;if(!l||!['visible','snap','canvas','layers'].every(k=>typeof l[k as keyof Layout]==='boolean')||!Number.isFinite(l.tolerance)||l.tolerance<0||l.tolerance>32||!Array.isArray(l.guides)||l.guides.length>128)throw new Error('参考线／吸附设置无效。');ids.clear();for(const g of l.guides){if(!g||!name(g.id,80)||ids.has(g.id)||!['x','y'].includes(g.axis)||!Number.isInteger(g.position)||Math.abs(g.position)>32768)throw new Error('参考线参数无效。');ids.add(g.id);}}
 if(state.actions!==undefined){if(!Array.isArray(state.actions)||state.actions.length>32||JSON.stringify(state.actions).length>262144)throw new Error('动作库最多 32 个动作、256 KiB。');ids.clear();for(const a of state.actions){validateAction(a);if(ids.has(a.id))throw new Error('动作 ID 重复。');ids.add(a.id);}}
 return bytes;
}
export const hasProductivity=(s:ImageState)=>s.channels!==undefined||s.layout!==undefined||s.actions!==undefined;
export function freezeProductivity(s:ImageState){const freeze=(v:unknown):unknown=>{if(v&&typeof v==='object'&&!ArrayBuffer.isView(v)){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};return {...(s.channels?{channels:Object.freeze(s.channels.map(c=>Object.freeze({...c})))}:{}),...(s.layout?{layout:freeze(structuredClone(s.layout)) as Layout}:{}),...(s.actions?{actions:freeze(structuredClone(s.actions)) as readonly ImageAction[]}: {})};}
