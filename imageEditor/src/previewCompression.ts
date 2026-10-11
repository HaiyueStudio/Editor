import {stopWorker,workerTask} from './workerTask.js';
export type PreviewEntries=(readonly [string,Uint8Array])[];
/** Input buffers are disposable readback copies, never native document pixels. */
export class PreviewCompression {
 private worker:Worker|undefined;
 private batches=0;
 get completedBatches(){return this.batches;}
 async encode(entries:PreviewEntries,signal:AbortSignal):Promise<PreviewEntries|undefined>{
  signal.throwIfAborted();if(!entries.length)return [];
  if(typeof Worker==='undefined')return; // Optional disk previews must not block the UI.
  let worker:Worker|undefined;
  try{
   worker=this.worker??=new Worker(new URL('./psd-worker.js',import.meta.url),{type:'module'});
   const result=await workerTask<PreviewEntries>(worker,{kind:'preview-compress',entries},{signal,retain:true,transfer:entries.map(([,b])=>b.buffer as ArrayBuffer)});
   signal.throwIfAborted();this.batches++;return result;
  }catch{if(worker)stopWorker(worker);if(this.worker===worker)this.worker=undefined;signal.throwIfAborted();return;}
 }
 dispose(){if(this.worker)stopWorker(this.worker);this.worker=undefined;}
}
