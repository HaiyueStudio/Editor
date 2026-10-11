import { streamJpeg } from './streamingJpeg.js';
import { needsTiledView } from './imageLimits.js';
import { streamPng } from './streamingPng.js';
import { concatBytes } from './psdResources.js';
import { embedRasterIcc } from './rasterIcc.js';
import { srgbProfileBytes } from './colorManagement.js';
import type { ImageState } from './document.js';
import { paintDocumentAsync } from './canvasView.js';
export async function exportRaster(state: ImageState, format: 'png' | 'jpeg', quality: number,embedProfile=true): Promise<Uint8Array> {
  if(needsTiledView(state)){const chunks:Uint8Array[]=[];let bytes=0;const sink=(c:Uint8Array)=>{bytes+=c.length;if(bytes>128*1024*1024)throw Error('输出超过 128 MiB，请使用流式导出接口。');chunks.push(c);};if(format==='jpeg')await streamJpeg(state,sink,quality,embedProfile);else await streamPng(state,sink,embedProfile);return concatBytes(chunks);}
  const canvas = document.createElement('canvas');
  try {
    await paintDocumentAsync(canvas, {...state,...(state.icc?{icc:{intent:state.icc.intent,bpc:state.icc.bpc,proofIntent:1,gamutWarning:false}}:{})});
    if (format === 'jpeg') { const ctx = canvas.getContext('2d')!; ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('导出失败。')), `image/${format}`, quality));
    const bytes=new Uint8Array(await blob.arrayBuffer());return embedProfile?embedRasterIcc(bytes,format,srgbProfileBytes()):bytes;
  } finally { canvas.width = canvas.height = 1; }
}
