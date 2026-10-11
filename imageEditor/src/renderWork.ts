/** Only resource-owning work belongs in this lane. Compression and persistence
 * await outside it so a foreground frame never queues behind a cache write. */
export class RenderWorkQueue {
 private tail:Promise<unknown>=Promise.resolve();
 run<T>(work:()=>Promise<T>,signal:AbortSignal):Promise<T>{
  const job=this.tail.catch(()=>{}).then(()=>{signal.throwIfAborted();return work();});
  this.tail=job.then(()=>{},()=>{});return job;
 }
}

/** For disposable reads only; callers must check cancellation before using results. */
export function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};
  signal.addEventListener('abort',abort,{once:true});
  promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  if(signal.aborted)abort();
 });
}

/** Debounce background work and yield between bounded batches. */
export function backgroundTurn(signal:AbortSignal,delay=0):Promise<void>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delay);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
}
