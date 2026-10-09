/** Cancellable worker jobs share the existing raster worker and never transfer live document buffers. */
export function pixelJob<T>(payload:unknown,signal?:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{if(signal?.aborted){reject(new DOMException('已取消','AbortError'));return;}const worker=new Worker(new URL('./filter-worker.js',import.meta.url),{type:'module'});let done=false;
  const finish=(error?:unknown,value?:T)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(value!);},abort=()=>finish(new DOMException('已取消','AbortError')),timer=setTimeout(()=>finish(new Error('处理超时，请缩小图像后重试。')),120000);
  signal?.addEventListener('abort',abort,{once:true});worker.onerror=e=>{e.preventDefault();finish(new Error(e.message||'后台图像处理器加载失败。'));};worker.onmessage=e=>e.data.error?finish(new Error(e.data.error)):finish(undefined,e.data.result);
  try{worker.postMessage(payload);}catch(error){finish(error);}
 });
}
