import { adoptRasterPreviews } from './rasterPreviews.js';
import type { EditorTaskProgress } from '@haiyue/editor-plugin-sdk';
import { hydratePixels } from './pagedPixels.js';
const terminated=new WeakSet<Worker>();
export function stopWorker(worker:Worker){if(!terminated.has(worker)){terminated.add(worker);worker.terminate();}}
export type TaskReport=(progress:EditorTaskProgress)=>void;
export function progressLabel(fallback:string,p:EditorTaskProgress){return (p.message||fallback)+(p.total&&p.total>0?' '+Math.floor(Math.max(0,Math.min(1,p.current/p.total))*100)+'%':'');}
/** One request owns its handlers. Progress and heartbeats renew an inactivity deadline. */
export function workerTask<T>(worker:Worker,payload:unknown,options:{signal?:AbortSignal|undefined;report?:TaskReport|undefined;transfer?:Transferable[];idleMs?:number;retain?:boolean;preview?:(bitmap:import('./document.js').Bitmap)=>void}={}):Promise<T>{
 return new Promise((resolve,reject)=>{
  let finished=false,timer:ReturnType<typeof setTimeout>;const {signal}=options;
  const finish=(error?:unknown,value?:T)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.onmessage=null;worker.onerror=null;if(!options.retain||error)stopWorker(worker);error?reject(error):resolve(value!);};
  const abort=()=>finish(signal?.reason??new DOMException('已取消','AbortError'));
  const renew=()=>{clearTimeout(timer);timer=setTimeout(()=>finish(Error('后台任务长时间无响应，已停止；可重试或取消。')),options.idleMs??120000);};
  worker.onmessage=event=>{if(finished)return;try{const data=event.data;renew();if(data.kind==='heartbeat')return;if(data.kind==='preview'){options.preview?.(data.bitmap);return;}if(data.kind==='progress'){options.report?.(data.progress);return;}if(data.error||data.ok===false){finish(Error(data.error||'后台任务失败。'));return;}if(data.previews)adoptRasterPreviews(hydratePixels(data.previews));finish(undefined,hydratePixels('value'in data?data.value:'result'in data?data.result:data.layer));}catch(error){finish(error);}};
  worker.onerror=event=>{event.preventDefault();finish(Error(event.message||'后台处理器加载失败。'));};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}renew();try{worker.postMessage(payload,options.transfer??[]);}catch(error){finish(error);}
 });
}
/** Worker-side liveness is separate from measured phase progress. */
export function workerProgress(target:{postMessage(value:unknown):void}){
 const timer=setInterval(()=>target.postMessage({kind:'heartbeat'}),1000);let last=0;
 const report:TaskReport=progress=>{const now=Date.now();if(now-last<80&&progress.current!==0&&progress.current!==progress.total)return;last=now;target.postMessage({kind:'progress',progress});};
 return {report,stop:()=>clearInterval(timer)};
}
