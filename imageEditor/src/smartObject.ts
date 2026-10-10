import { projectiveBitmap, mapQuadPoint, quadCoordinates, validateQuad } from './projective.js';
import type { Resampling } from './resampling.js';
import { ImageDocument, findLayer, uid, type Bitmap, type ImageState, type ImageLayer } from './document.js';
import { transformBitmap } from './pixelTools.js';
import { validateContent, type SmartContent, type LayerMask } from './layerFeatures.js';
export function smartBitmap(content:SmartContent):Bitmap { validateContent(content); const t=content.transform;return t.quad?projectiveBitmap(content.source,t.width,t.height,t.quad):transformBitmap(content.source,t.width,t.height,t.angle,t.flipX,t.flipY,t.resampling??'nearest'); }
export function convertSmart(doc:ImageDocument,id:string) {
 const layer=findLayer(doc.state.layers,id);if(!layer?.bitmap||layer.kind!=='pixel'||layer.content)throw new Error('请选择已有像素图层；文字／形状请先栅格化。');
 const content:SmartContent={type:'smart',sourceId:uid(),name:layer.name,source:layer.bitmap,transform:{width:layer.bitmap.width,height:layer.bitmap.height,angle:0,flipX:false,flipY:false}};
 doc.setContent(id,content,layer.bitmap);
}
export function replaceSmart(doc:ImageDocument,id:string,source:Bitmap,name:string) {
 const layer=findLayer(doc.state.layers,id);if(layer?.content?.type!=='smart')throw new Error('请选择智能对象。');
 const content={...layer.content,sourceId:uid(),name,source,sourcePsd:undefined,sourcePdf:undefined};doc.setContent(id,content,smartBitmap(content));
}
export function smartTransform(state:ImageState,layer:ImageLayer,width:number,height:number,angle:number,dx:number,dy:number,flipX=false,flipY=false,resampling:Resampling='bicubic'):ImageLayer {
 if(layer.content?.type!=='smart'||!layer.bitmap)throw new Error('请选择智能对象。');
 const content:SmartContent={...layer.content,transform:{width,height,angle,flipX,flipY,resampling}},bitmap=smartBitmap(content);
 const mask=layer.mask?transformedSmartMask(layer.content,layer.bitmap,content,bitmap,layer.mask):undefined;
 return {...layer,content,bitmap,...(mask?{mask}:{}),x:Math.round(layer.x+(layer.bitmap.width-bitmap.width)/2+dx),y:Math.round(layer.y+(layer.bitmap.height-bitmap.height)/2+dy)};
}

function smartQuad(c:SmartContent,b:Bitmap):number[]{
 const t=c.transform;if(t.quad)return [...t.quad];const a=t.angle*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a);
 return [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].flatMap(([u,v])=>{const x=u!*t.width*(t.flipX?-1:1),y=v!*t.height*(t.flipY?-1:1);return [b.width/2+x*cos-y*sin,b.height/2+x*sin+y*cos];});
}
/** Transform a linked pixel mask through the same old-to-new placement as its smart object. */
function transformedSmartMask(before:SmartContent,old:Bitmap,after:SmartContent,next:Bitmap,m:LayerMask):LayerMask {
 if(m.vector||m.feather)throw Error('带独立矢量蒙版／羽化的智能对象请先应用蒙版再变换。');
 const from=smartQuad(before,old),to=smartQuad(after,next),corners=[[m.x,m.y],[m.x+m.width,m.y],[m.x+m.width,m.y+m.height],[m.x,m.y+m.height]].flatMap(([x,y])=>mapQuadPoint(to,...quadCoordinates(from,x!,y!)));validateQuad(corners);
 const xs=corners.filter((_,i)=>i%2===0),ys=corners.filter((_,i)=>i%2===1),x=Math.floor(Math.min(...xs)),y=Math.floor(Math.min(...ys)),width=Math.ceil(Math.max(...xs))-x,height=Math.ceil(Math.max(...ys))-y;
 const float=m.data instanceof Float32Array,data=float?new Float32Array(m.width*m.height*4):new Uint8ClampedArray(m.width*m.height*4);for(let i=0;i<m.data.length;i++){data.fill(m.data[i]!,i*4,i*4+3);data[i*4+3]=255;}
 const rgba=projectiveBitmap({width:m.width,height:m.height,data,...(float?{depth:16 as const}:{})},width,height,corners.map((v,i)=>v-(i%2?y:x))).data;
 const samples=float?new Float32Array(width*height):new Uint8Array(width*height);for(let i=0;i<samples.length;i++)samples[i]=rgba[i*4+3]?rgba[i*4]!:m.defaultColor;
 return {...m,x,y,width,height,data:samples};
}
