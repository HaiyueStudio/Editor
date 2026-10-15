import { previewState } from './previewCache.js';
import { editablePixel } from './pixelTools.js';
import type { ImageState,ImageLayer } from './document.js';
import { filterLayer,type FilterSettings } from './filters.js';
import { tiledFilter } from './tiledFilters.js';
import { tiledEditing } from './tiledEditing.js';
import { pixelJob } from './pixelJobs.js';
import type { TaskReport } from './workerTask.js';
/** Strip unrelated raster/archive payloads while preserving ancestors and effective locks. */
export function filterState(state:ImageState,id:string):ImageState{
 const strip=(ls:readonly ImageLayer[]):ImageLayer[]=>ls.map(l=>{const copy={...l,bitmap:l.id===id?l.bitmap:null,children:strip(l.children)};if(l.id!==id)delete copy.content;return copy;});
 editablePixel(state,id);const snapshot=previewState(state);return {...snapshot,revision:state.revision,selectedId:state.selectedId,...(state.selection?{selection:state.selection}:{}),...(state.paging?{paging:state.paging}:{}),layers:strip(snapshot.layers)};
}
export async function applyFilterJob(state:ImageState,id:string,settings:FilterSettings,signal?:AbortSignal,report?:TaskReport):Promise<ImageLayer>{
 editablePixel(state,id);signal?.throwIfAborted();report?.({current:0,message:'正在应用滤镜'});
 const result=typeof Worker==='undefined'?(tiledEditing(state)?await tiledFilter(state,id,settings,signal,report):filterLayer(state,id,settings)):await pixelJob<ImageLayer>({kind:'filter',state:filterState(state,id),id,settings},signal,report);
 signal?.throwIfAborted();report?.({current:1,total:1,message:'滤镜处理完成'});return result;
}
