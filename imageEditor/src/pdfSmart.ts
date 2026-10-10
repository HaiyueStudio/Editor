import type { Layer, Psd } from 'ag-psd';
import type { Bitmap } from './document.js';
import { validateContent, type SmartContent } from './layerFeatures.js';
/** Keep embedded vector bytes separate from the placed layer's cached preview. */
export function readPdfSmart(l:Layer,p:Psd,bitmap:Bitmap|null):SmartContent {
 const placed=l.placedLayer!,file=p.linkedFiles?.find(f=>f.id===placed.id),b=placed.warp?.bounds;
 if(l.text||l.vectorFill||l.vectorMask||l.adjustment)throw Error('矢量智能对象叠加的原生内容尚未支持。');
 if(!bitmap||file?.type?.trim().toLowerCase()!=='pdf'||!file.data||file.linkedFile||placed.filter||placed.warp?.value||placed.warp?.perspective||placed.warp?.perspectiveOther||placed.warp?.style&&placed.warp.style!=='none')throw Error('矢量智能对象需要内嵌 PDF、像素缓存且不含滤镜／网格变形。');
 const bounds=b?[b.left.value,b.top.value,b.right.value,b.bottom.value]:[0,0,placed.width??0,placed.height??0];
 const content:SmartContent={type:'smart',sourceId:placed.id,name:file.name.slice(0,160),source:bitmap,sourcePdf:{data:file.data,bounds,quad:(placed.nonAffineTransform??placed.transform).map((v,i)=>v-(i%2?l.top??0:l.left??0)),pageNumber:placed.pageNumber??1,totalPages:placed.totalPages??1},transform:{width:bitmap.width,height:bitmap.height,angle:0,flipX:false,flipY:false}};validateContent(content);return content;
}
