import { filterLayer, type FilterSettings } from './filters.js';
import type { ImageState } from './document.js';
const worker=self as unknown as {onmessage:((event:MessageEvent<{state:ImageState;id:string;settings:FilterSettings}>)=>void)|null;postMessage(value:unknown,transfer?:Transferable[]):void};
worker.onmessage=event=>{try{const layer=filterLayer(event.data.state,event.data.id,event.data.settings);worker.postMessage({layer},layer.bitmap?[layer.bitmap.data.buffer as ArrayBuffer]:[]);}catch(error){worker.postMessage({error:error instanceof Error?error.message:String(error)});}};
