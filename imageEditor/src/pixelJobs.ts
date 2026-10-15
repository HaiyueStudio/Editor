import { workerTask,type TaskReport } from './workerTask.js';
/** UI and API use the same cancellation, progress and inactivity contract. Live buffers are never transferred. */
export function pixelJob<T>(payload:unknown,signal?:AbortSignal,report?:TaskReport):Promise<T>{
 signal?.throwIfAborted();return workerTask<T>(new Worker(new URL('./filter-worker.js',import.meta.url),{type:'module'}),payload,{signal,report});
}
