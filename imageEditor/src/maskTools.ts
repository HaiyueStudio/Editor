import { pixelArray,withPixels } from './pixelFormat.js';
import { rawMaskWeight } from './maskEffects.js';
import { checkSize, findLayer, type ImageState, type ImageLayer } from './document.js';
import { parentOffset, replacePixel } from './pixelTools.js';
import { selectionWeight } from './selection.js';
import { maskWeight, type LayerMask } from './layerFeatures.js';
export function maskFromSelection(state:ImageState,id:string):LayerMask {
 const layer=findLayer(state.layers,id);if(!layer)throw new Error('图层不存在。');const parent=parentOffset(state.layers,id)!;
 const data=new Uint8Array(state.width*state.height);for(let y=0;y<state.height;y++)for(let x=0;x<state.width;x++)data[y*state.width+x]=Math.round(selectionWeight(state.selection,x,y)*255);
 return {width:state.width,height:state.height,x:-parent.x-layer.x,y:-parent.y-layer.y,data,disabled:false,defaultColor:0};
}
export function maskStrokeState(state:ImageState,id:string,target:'layer'|'filter'='layer'):ImageState {
 const layer=findLayer(state.layers,id),mask=target==='filter'?layer?.filterMask:layer?.mask;if(!layer||!mask)throw new Error('请先为图层添加蒙版。');if(mask.disabled)throw new Error('请先启用蒙版。');const parent=parentOffset(state.layers,id)!;
 const left=Math.min(mask.x,-parent.x-layer.x),top=Math.min(mask.y,-parent.y-layer.y),right=Math.max(mask.x+mask.width,state.width-parent.x-layer.x),bottom=Math.max(mask.y+mask.height,state.height-parent.y-layer.y),width=right-left,height=bottom-top;checkSize(width,height);
 const depth=(state.bitDepth??8)===8?8:16;const data=pixelArray(width*height*4,depth);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=rawMaskWeight(mask,x+left,y+top)*255,i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}
 const {mask:old,content,smartFilters,filterMask,blendIf,...rest}=layer;const synthetic:ImageLayer={...rest,kind:'pixel',x:layer.x+left,y:layer.y+top,children:[],bitmap:withPixels(width,height,data,depth)};
 // Image-pixel/alpha locks protect the image, while the mask has its own pixels. Keep full locks on the synthetic tree.
 const maskLayers=(layers:readonly ImageLayer[]):ImageLayer[]=>layers.map(l=>({...l,...(l.locks?{locks:{...l.locks,pixels:false,transparency:false}}:{}),children:maskLayers(l.children)}));
 return {...state,bitDepth:depth,layers:maskLayers(replacePixel(state.layers,id,synthetic))};
}
export function maskFromStroke(original:ImageLayer,stroke:ImageLayer,target:'layer'|'filter'='layer'):LayerMask {
 const mask=target==='filter'?original.filterMask:original.mask;const bitmap=stroke.bitmap!;const data=bitmap.depth?new Float32Array(bitmap.width*bitmap.height):new Uint8Array(bitmap.width*bitmap.height);for(let i=0;i<data.length;i++)data[i]=bitmap.data[i*4]!;
 return {...mask,...(bitmap.depth?{precision:'float32' as const}:{}),width:bitmap.width,height:bitmap.height,x:stroke.x-original.x,y:stroke.y-original.y,data,disabled:false,defaultColor:mask?.defaultColor??0};
}
