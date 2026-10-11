import { seedImagePreview,seedRasterDocumentPreview } from './imagePreviews.js';
import { checkImportTextFonts } from './textFonts.js';
import { workerTask,progressLabel,type TaskReport } from './workerTask.js';
import type { ImageState } from './document.js';
import type { PsdImportResult, PsdExportResult } from './psdAdapter.js';
import type { PsdRequest } from './psdWorker.js';
export class PsdJobs {
  private stop: (()=>void) | undefined;
  constructor(private status:(busy:boolean,label:string)=>void,private unavailable:()=>boolean=()=>false) {}
  get busy(){return !!this.stop;}
  // Transfer is opt-in: the file picker owns disposable bytes; API/batch callers may reuse theirs.
  import(bytes:Uint8Array,name:string,transferOwnership=false) { return this.run<PsdImportResult>({kind:'import',bytes,name},'正在解析 PSD…',transferOwnership&&bytes.buffer instanceof ArrayBuffer?[bytes.buffer]:[]).then(result=>{if(result.layered)seedImagePreview(result.layered,result.preview);return checkImportTextFonts(result);}); }
  export(state:ImageState,allowRasterize=false,embedProfile=true) { return this.run<PsdExportResult>({kind:'export',state,allowRasterize,embedProfile},'正在编码并校验 PSD…'); }
  importFile(file:File){return this.run<PsdImportResult>({kind:'file',file,format:'psd'},'正在后台解析 PSD…').then(result=>{if(result.layered)seedImagePreview(result.layered,result.preview);return checkImportTextFonts(result);});}
  productionFile(file:File){return this.run<ImageState>({kind:'file',file,format:/\.exr$/i.test(file.name)?'exr':'tiff'},'正在后台解码图像…');}
  cancel() { this.stop?.(); }
  private async run<T>(request:PsdRequest,label:string,transfer:ArrayBuffer[]=[]):Promise<T> {
    if(this.stop||this.unavailable())throw new Error('正在处理另一项文件任务，请完成或取消后重试。');
    const controller=new AbortController();this.stop=()=>controller.abort(new DOMException('文件操作已取消，当前文档未改变。','AbortError'));this.status(true,label);
    try{return await psdJob<T>(request,controller.signal,p=>this.status(true,progressLabel(label,p)),transfer);}
    finally{this.stop=undefined;this.status(false,'');}
  }
}
export async function psdJob<T>(request:PsdRequest,signal?:AbortSignal,report?:TaskReport,transfer:ArrayBuffer[]=[]):Promise<T>{
 signal?.throwIfAborted();const value=await workerTask<T>(new Worker(new URL('./psd-worker.js',import.meta.url),{type:'module'}),request,{signal,report,transfer});const data=value as {layered?:ImageState;layers?:unknown};if(data.layered)seedRasterDocumentPreview(data.layered);else if(data.layers)seedRasterDocumentPreview(value as ImageState);return value;
}
