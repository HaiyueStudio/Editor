import { importPsd, exportPsd } from './psdAdapter.js';
import type { ImageState } from './document.js';
export type PsdRequest = {kind:'import';bytes:Uint8Array;name:string}|{kind:'export';state:ImageState;allowRasterize?:boolean};
self.onmessage = (event: MessageEvent<PsdRequest>) => {
  try { const input=event.data; self.postMessage({ok:true,value:input.kind==='import'?importPsd(input.bytes,input.name):exportPsd(input.state,input.allowRasterize)}); }
  catch(error) { self.postMessage({ok:false,error:error instanceof Error?error.message:String(error)}); }
};
