import type { Filter, PlacedLayerFilter } from 'ag-psd';
import { BLEND_MODES } from './layerFeatures.js';
import { validateSmartFilters, type SmartFilter } from './liveEffects.js';
import type { FilterSettings } from './filters.js';
export function nativeSmartFilters(filters:readonly SmartFilter[]|undefined){return !filters||filters.every(f=>['gaussian','blur','usm'].includes(f.settings.kind)||f.settings.kind==='invert'&&f.settings.amount===100);}
export function writeSmartFilters(filters:readonly SmartFilter[]):PlacedLayerFilter {
 validateSmartFilters(filters);if(!nativeSmartFilters(filters))throw Error('此智能滤镜尚未提供 PSD 原生映射。');
 return {enabled:true,validAtPosition:true,maskEnabled:false,maskLinked:true,maskExtendWithWhite:true,list:[...filters].reverse().map(f=>{
 const s=f.settings,base={name:s.kind,opacity:f.opacity,blendMode:f.blend.replaceAll('-',' ') as Filter['blendMode'],enabled:f.enabled,hasOptions:true,foregroundColor:{r:0,g:0,b:0},backgroundColor:{r:255,g:255,b:255}};
 if(s.kind==='invert')return {...base,type:'invert'};
 if(s.kind==='usm')return {...base,type:'unsharp mask',filter:{amount:s.amount,radius:{units:'Pixels',value:s.radius??2},threshold:s.threshold??0}};
 return {...base,type:s.kind==='gaussian'?'gaussian blur':'box blur',filter:{radius:{units:'Pixels',value:s.amount}}};
 })};
}
export function readSmartFilters(value:PlacedLayerFilter|undefined):SmartFilter[]|undefined {
 if(!value)return;if(value.maskEnabled||!value.validAtPosition)throw Error('智能滤镜蒙版或无效滤镜位置尚不能原生映射。');
 const result=[...value.list].reverse().map((f,i):SmartFilter=>{let settings:FilterSettings;switch(f.type){case 'invert':settings={kind:'invert',amount:100};break;case 'gaussian blur':case 'box blur':if(f.filter.radius.units!=='Pixels')throw Error('滤镜半径需要像素单位。');settings={kind:f.type==='gaussian blur'?'gaussian':'blur',amount:f.filter.radius.value};break;case 'unsharp mask':if(f.filter.radius.units!=='Pixels')throw Error('滤镜半径需要像素单位。');settings={kind:'usm',amount:f.filter.amount,radius:f.filter.radius.value,threshold:f.filter.threshold};break;default:throw Error('尚未支持的原生智能滤镜：'+f.type);}
 const blend=f.blendMode.replaceAll(' ','-') as SmartFilter['blend'];if(!Object.hasOwn(BLEND_MODES,blend))throw Error('智能滤镜混合模式尚未支持。');return {id:'psd-filter-'+i,settings,enabled:value.enabled&&f.enabled,opacity:f.opacity,blend};});validateSmartFilters(result);return result;
}
/** Spatial filters run after placement here, but in source coordinates in PSD. Only identity scale/warp is equivalent. */
export function nativeFilterPlacement(c:import('./layerFeatures.js').SmartContent,filters:readonly SmartFilter[]|undefined){
 if(!filters?.some(f=>['gaussian','blur','usm'].includes(f.settings.kind)))return true;const t=c.transform,w=c.source.width,h=c.source.height,near=(a:number,b:number)=>Math.abs(a-b)<1e-6;
 if(t.width!==w||t.height!==h||t.angle||t.flipX||t.flipY||t.mesh?.some((p,i)=>!near(p.x,i%4/3)||!near(p.y,Math.floor(i/4)/3)))return false;
 return !t.quad||t.quad.every((n,i)=>near(n,[0,0,w,0,w,h,0,h][i]!));
}
