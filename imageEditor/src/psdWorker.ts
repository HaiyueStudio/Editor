import { collectRasterPreviews } from './rasterPreviews.js';
import { workerProgress } from './workerTask.js';
import { previewRegion,displayRegion } from './previewJobs.js';
import { blobSource } from './rasterSource.js';
import { readProductionImage } from './productionImport.js';
import { importStreamingPsd } from './streamingPsdImport.js';
import type { CompositeRect } from './compositor.js';
import { withDiskPages } from './diskPager.js';
import { hydratePixels } from './pagedPixels.js';
import { initializeIcc } from './iccEngine.js';
import { importPsdAsync, exportPsd } from './psdAdapter.js';
import type { ImageState } from './document.js';
import { psdTransferBuffers } from './psdTransfer.js';
export type PsdRequest = {kind:'file';file:File;format:'psd'|'tiff'|'exr'}|{kind:'preview-init';state:ImageState;hdr:boolean}|{kind:'preview-read';rect:CompositeRect}| {kind:'import';bytes:Uint8Array;name:string}|{kind:'export';state:ImageState;allowRasterize?:boolean;embedProfile?:boolean};
const worker=self as unknown as {onmessage:((event:MessageEvent<PsdRequest>)=>void)|null;postMessage(value:unknown,transfer?:Transferable[]):void};
let preview:ImageState|undefined,hdr=false;
worker.onmessage = async (event: MessageEvent<PsdRequest>) => {
  const progress=workerProgress(worker);try { progress.report({current:0,message:'正在准备颜色与文件处理器'});await initializeIcc();const input=hydratePixels(event.data);if(input.kind==='preview-init'){preview=input.state;hdr=input.hdr;worker.postMessage({ok:true});return;}if(input.kind==='preview-read'){if(!preview)throw Error('预览状态未初始化。');const value=displayRegion(await previewRegion(preview,input.rect),preview,hdr);worker.postMessage({ok:true,value},psdTransferBuffers(value));return;}const value=input.kind==='file'?(input.format==='psd'?await importStreamingPsd(blobSource(input.file),input.file.name,undefined,progress.report):await readProductionImage(blobSource(input.file),input.file.name,input.format,undefined,progress.report)):input.kind==='import'?await importPsdAsync(input.bytes,input.name,undefined,progress.report):await withDiskPages(input.state,()=>exportPsd(input.state,input.allowRasterize,input.embedProfile)); progress.report({current:1,total:1,message:'文件处理完成'});const response={ok:true,value,previews:collectRasterPreviews(value)};worker.postMessage(response,psdTransferBuffers(response)); }
  catch(error) { worker.postMessage({ok:false,error:error instanceof Error?error.message:String(error)}); }finally{progress.stop();}
};
