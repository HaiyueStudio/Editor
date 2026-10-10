import { checkImportTextFonts } from './textFonts.js';
import { hydratePixels } from './pagedPixels.js';
import type { ImageState } from './document.js';
import type { PsdImportResult, PsdExportResult } from './psdAdapter.js';
import type { PsdRequest } from './psdWorker.js';
export class PsdJobs {
  private stop: (()=>void) | undefined;
  constructor(private status:(busy:boolean,label:string)=>void) {}
  // Transfer is opt-in: the file picker owns disposable bytes; API/batch callers may reuse theirs.
  import(bytes:Uint8Array,name:string,transferOwnership=false) { return this.run<PsdImportResult>({kind:'import',bytes,name},'正在解析 PSD…',transferOwnership&&bytes.buffer instanceof ArrayBuffer?[bytes.buffer]:[]).then(checkImportTextFonts); }
  export(state:ImageState,allowRasterize=false,embedProfile=true) { return this.run<PsdExportResult>({kind:'export',state,allowRasterize,embedProfile},'正在编码并校验 PSD…'); }
  cancel() { this.stop?.(); }
  private run<T>(request:PsdRequest,label:string,transfer:ArrayBuffer[]=[]):Promise<T> {
    if(this.stop) return Promise.reject(new Error('正在处理另一项 PSD 任务，请完成或取消后重试。'));
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./psd-worker.js',import.meta.url),{type:'module'});
      const done=(error?:Error,value?:T)=>{clearTimeout(timer);worker.terminate();this.stop=undefined;this.status(false,'');if(error)reject(error);else resolve(value!);};
      const timer=setTimeout(()=>done(new Error('PSD 处理超过两分钟，已停止，请缩小文档后重试。')),120000);
      this.stop=()=>done(new Error('PSD 操作已取消，当前文档未改变。'));
      worker.onmessage=(event:MessageEvent<{ok:boolean;value:T;error:string}>)=>event.data.ok?done(undefined,hydratePixels(event.data.value)):done(new Error(event.data.error));
      worker.onerror=event=>{event.preventDefault();done(new Error('PSD 处理失败：'+event.message));};
      this.status(true,label);
      try { worker.postMessage(request,transfer); } catch(error) { done(error instanceof Error?error:new Error(String(error))); }
    });
  }
}
