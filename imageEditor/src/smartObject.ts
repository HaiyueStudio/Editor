import type { Resampling } from './resampling.js';
import { ImageDocument, findLayer, uid, type Bitmap, type ImageState, type ImageLayer } from './document.js';
import { transformBitmap } from './pixelTools.js';
import { validateContent, type SmartContent } from './layerFeatures.js';
export function smartBitmap(content:SmartContent):Bitmap { validateContent(content); const t=content.transform;return transformBitmap(content.source,t.width,t.height,t.angle,t.flipX,t.flipY,t.resampling??'nearest'); }
export function convertSmart(doc:ImageDocument,id:string) {
 const layer=findLayer(doc.state.layers,id);if(!layer?.bitmap||layer.kind!=='pixel'||layer.content)throw new Error('请选择已有像素图层；文字／形状请先栅格化。');
 const content:SmartContent={type:'smart',sourceId:uid(),name:layer.name,source:layer.bitmap,transform:{width:layer.bitmap.width,height:layer.bitmap.height,angle:0,flipX:false,flipY:false}};
 doc.setContent(id,content,layer.bitmap);
}
export function replaceSmart(doc:ImageDocument,id:string,source:Bitmap,name:string) {
 const layer=findLayer(doc.state.layers,id);if(layer?.content?.type!=='smart')throw new Error('请选择智能对象。');
 const content={...layer.content,sourceId:uid(),name,source,sourcePsd:undefined};doc.setContent(id,content,smartBitmap(content));
}
export function smartTransform(state:ImageState,layer:ImageLayer,width:number,height:number,angle:number,dx:number,dy:number,flipX=false,flipY=false,resampling:Resampling='bicubic'):ImageLayer {
 if(layer.content?.type!=='smart'||!layer.bitmap)throw new Error('请选择智能对象。');
 const content:SmartContent={...layer.content,transform:{width,height,angle,flipX,flipY,resampling}},bitmap=smartBitmap(content);
 return {...layer,content,bitmap,x:Math.round(layer.x+(layer.bitmap.width-bitmap.width)/2+dx),y:Math.round(layer.y+(layer.bitmap.height-bitmap.height)/2+dy)};
}
