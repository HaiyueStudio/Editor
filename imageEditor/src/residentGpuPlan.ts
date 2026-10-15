import {modernComposite} from './advancedBlend.js';
import {compositeHalo,type CompositeRect} from './compositor.js';
import {gpuDisplayProfile,GPU_BLEND_MODES,GPU_POINT_FILTERS,type GpuImageLayer} from './gpuImagePlan.js';
import type {ImageState,ImageLayer} from './document.js';
export interface ResidentRun {base:GpuImageLayer;clips:GpuImageLayer[]}
export const overlaps=(a:CompositeRect,b:CompositeRect)=>a.x<b.x+b.width&&a.y<b.y+b.height&&a.x+a.width>b.x&&a.y+a.height>b.y;
export const entryRect=(e:GpuImageLayer):CompositeRect=>({x:e.x,y:e.y,width:e.layer.bitmap!.width,height:e.layer.bitmap!.height});
export const gpuFilters=(l:ImageLayer)=>!l.smartFilters?.some(f=>f.enabled&&f.opacity&&(f.blend!=='normal'||!GPU_POINT_FILTERS.includes(f.settings.kind as typeof GPU_POINT_FILTERS[number])||l.filterMask&&!l.filterMask.disabled));
/** Backdrop-dependent effects use the reference stack only on affected tiles. Global
 * adjustments / isolated groups remain conservative. Clipping boundaries never cross groups. */
export function residentGpuPlan(state:ImageState){
 if((state.bitDepth??8)!==8||state.colorMode==='cmyk')return;
 const profile=gpuDisplayProfile(state);if(!profile)return;
 const runs:ResidentRun[]=[],reference:CompositeRect[]=[];let supported=true;
 const walk=(layers:readonly ImageLayer[],x=0,y=0)=>{
  for(let i=0;i<layers.length;i++){
   const l=layers[i]!;if(l.clipping)continue;let last=i;while(layers[last+1]?.clipping)last++;
   const group=layers.slice(i,last+1);i=last;if(!l.visible||!l.opacity)continue;
   if(l.kind==='group'&&l.passThrough&&l.opacity===1&&!l.mask&&group.length===1){walk(l.children,x+l.x,y+l.y);continue;}
   const entries=group.filter(a=>a.visible&&a.opacity).map(layer=>({layer,x:x+layer.x,y:y+layer.y}));
   if(entries.some(e=>e.layer.kind==='group'||!e.layer.bitmap||!Number.isInteger(e.x)||!Number.isInteger(e.y)||e.layer.content?.type==='adjustment')){supported=false;return;}
   if(entries.some(e=>modernComposite(e.layer)||e.layer.styles?.enabled||e.layer.blendIf?.enabled||!GPU_BLEND_MODES.includes(e.layer.blend))){
    // Include the whole clipping run and effect overscan; clipped sources cannot
    // be independently flattened without losing the base-alpha semantics.
    const halo=Math.ceil(compositeHalo(group));for(const e of entries){const b=entryRect(e);reference.push({x:b.x-halo,y:b.y-halo,width:b.width+2*halo,height:b.height+2*halo});}
   }else runs.push({base:entries[0]!,clips:entries.slice(1)});
  }
 };
 walk(state.layers);return supported?{runs,reference,profile}:undefined;
}
export function residentTilePlan(plan:NonNullable<ReturnType<typeof residentGpuPlan>>,rect:CompositeRect){
 return {reference:plan.reference.some(b=>overlaps(b,rect)),runs:plan.runs.filter(run=>overlaps(entryRect(run.base),rect)).map(run=>({...run,clips:run.clips.filter(e=>overlaps(entryRect(e),rect))}))};
}
