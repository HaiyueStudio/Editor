import { seedRasterDocumentPreview } from './imagePreviews.js';
import type { TaskReport } from './workerTask.js';
import { ImageDocument,makeLayer,uid,type Bitmap,type ImageState } from './document.js';
import { profileResource } from './colorManagement.js';
import { initializeIcc,profileInfo } from './iccEngine.js';
import { readTiff } from './streamingTiff.js';
import { readExr } from './streamingExr.js';
import { blobSource,type RasterSource } from './rasterSource.js';
export async function readProductionImage(source:RasterSource,name:string,format:'tiff'|'exr',signal?:AbortSignal,report?:TaskReport):Promise<ImageState>{if(source.size>2*1024**3)throw Error('导入文件超过 2 GiB。');await initializeIcc();const result:{bitmap:Bitmap;profile?:Uint8Array;canvas?:{width:number;height:number;x:number;y:number}}=await(format==='tiff'?readTiff(source,signal,report):readExr(source,signal,report)),{bitmap,profile}=result,canvas=result.canvas,layer={...makeLayer(name.slice(0,160)||'图像',bitmap),x:canvas?.x??0,y:canvas?.y??0};if(profile&&profileInfo(profile).space!==(bitmap.pages?.kind==='disk'&&bitmap.pages.inks?'CMYK':'RGB'))throw Error('此 ICC 与 TIFF／EXR 像素模式不匹配。');const state:ImageState={id:uid(),name:name.slice(0,160)||'图像',width:canvas?.width??bitmap.width,height:canvas?.height??bitmap.height,bitDepth:bitmap.depth??8,colorMode:bitmap.pages?.kind==='disk'&&bitmap.pages.inks?'cmyk':'rgb',paging:{enabled:true},layers:[layer],selectedId:layer.id,revision:1,...(profile?{psdOrigin:{sourceName:name.slice(0,160),flattened:true,resources:profileResource(profile)}}:{})};seedRasterDocumentPreview(state);return state;}
export async function openProductionFile(file:File,signal?:AbortSignal){return new ImageDocument(await readProductionImage(blobSource(file),file.name,/\.exr$/i.test(file.name)?'exr':'tiff',signal));}
