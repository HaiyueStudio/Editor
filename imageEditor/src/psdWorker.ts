import { initializeIcc } from './iccEngine.js';
import { importPsd, exportPsd } from './psdAdapter.js';
import type { ImageState } from './document.js';
export type PsdRequest = {kind:'import';bytes:Uint8Array;name:string}|{kind:'export';state:ImageState;allowRasterize?:boolean;embedProfile?:boolean};
self.onmessage = async (event: MessageEvent<PsdRequest>) => {
  try { await initializeIcc();const input=event.data; self.postMessage({ok:true,value:input.kind==='import'?importPsd(input.bytes,input.name):exportPsd(input.state,input.allowRasterize,input.embedProfile)}); }
  catch(error) { self.postMessage({ok:false,error:error instanceof Error?error.message:String(error)}); }
};
