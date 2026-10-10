import { withDiskPages } from './diskPager.js';
import { hydratePixels } from './pagedPixels.js';
import { initializeIcc } from './iccEngine.js';
import { importPsd, exportPsd } from './psdAdapter.js';
import type { ImageState } from './document.js';
import { psdTransferBuffers } from './psdTransfer.js';
export type PsdRequest = {kind:'import';bytes:Uint8Array;name:string}|{kind:'export';state:ImageState;allowRasterize?:boolean;embedProfile?:boolean};
const worker=self as unknown as {onmessage:((event:MessageEvent<PsdRequest>)=>void)|null;postMessage(value:unknown,transfer?:Transferable[]):void};
worker.onmessage = async (event: MessageEvent<PsdRequest>) => {
  try { await initializeIcc();const input=hydratePixels(event.data),value=input.kind==='import'?importPsd(input.bytes,input.name):await withDiskPages(input.state,()=>exportPsd(input.state,input.allowRasterize,input.embedProfile)); worker.postMessage({ok:true,value},psdTransferBuffers(value)); }
  catch(error) { worker.postMessage({ok:false,error:error instanceof Error?error.message:String(error)}); }
};
