import { isLayerLocked } from './layerLocks.js';
import { IMAGE_LIMITS, pixelBytes, checkSize, type ImageState, type ImageLayer, type Bitmap } from './document.js';
import { cmykBitmap } from './cmyk.js';
import { embeddedProfile } from './colorManagement.js';
import { PixelStroke, editablePixel, parentOffset, replacePixel, type BrushPoint, type BrushDynamics, type Rect } from './pixelTools.js';
import { pixelArray } from './pixelFormat.js';
import { selectionWeight } from './selection.js';
export interface InkPaint { ink:readonly number[]; channels?:readonly number[]; opacity?:number; preserveAlpha?:boolean; erase?:boolean }
function validate(settings:InkPaint){if(settings.ink.length!==4||settings.ink.some(v=>!Number.isFinite(v)||v<0||v>100))throw Error('需要四个 0–100% 油墨分量。');const cs=settings.channels??[0,1,2,3];if(!settings.erase&&(!cs.length||new Set(cs).size!==cs.length||cs.some(c=>!Number.isInteger(c)||c<0||c>3)))throw Error('请选择有效且不重复的 CMYK 通道。');if(!Number.isFinite(settings.opacity??1)||(settings.opacity??1)<=0||(settings.opacity??1)>1)throw Error('不透明度必须大于 0 且不超过 1。');}
/** Coverage and dynamics are shared with RGB brushes; native inks remain authoritative. */
export class CmykStroke {
 readonly layer:ImageLayer; private coverage:PixelStroke;private original:Bitmap;private profile:Uint8Array|undefined;private dirty:Rect|undefined;changed=false;
 get changedBounds(){return this.coverage.changedBounds;}
 takeDirty(){const r=this.dirty;this.dirty=undefined;return r;}
 constructor(private state:ImageState,id:string,size:number,private settings:InkPaint,dynamics:BrushDynamics={}){
  if(isLayerLocked(state.layers,id,'transparency'))this.settings=settings={...settings,preserveAlpha:true};
  validate(settings);if(state.colorMode!=='cmyk')throw Error('需要 CMYK 文档。');const layer=editablePixel(state,id),b=layer.bitmap;
  const parent=parentOffset(state.layers,id)!,bounds=state.selection??{x:0,y:0,width:state.width,height:state.height},left=Math.min(layer.x,bounds.x-parent.x),top=Math.min(layer.y,bounds.y-parent.y),width=Math.max(layer.x+(b?.width??0),bounds.x+bounds.width-parent.x)-left,height=Math.max(layer.y+(b?.height??0),bounds.y+bounds.height-parent.y)-top;
  checkSize(width,height);if(width*height*32>128*1024*1024||pixelBytes(state.layers)-(b?b.data.byteLength+(b.cmyk?.byteLength??0):0)+width*height*((state.bitDepth??8)===8?20:32)>IMAGE_LIMITS.bytes)throw Error('CMYK 绘图超出像素预算，请缩小选区。');
  // Transparent coverage uses existing selection, pressure and event-independent accumulation.
  const empty=b?{width:b.width,height:b.height,depth:16 as const,data:new Float32Array(b.data.length)}:null;
  this.coverage=new PixelStroke({...state,bitDepth:16,layers:replacePixel(state.layers,id,{...layer,bitmap:empty})},id,size,settings.opacity??1,[255,255,255],false,{...dynamics,coverageOnly:true});
  const shape=this.coverage.layer,mask=shape.bitmap!,n=mask.width*mask.height;
  if(n*32>128*1024*1024||pixelBytes(state.layers)-(b?b.data.byteLength+(b.cmyk?.byteLength??0):0)+n*((state.bitDepth??8)===8?20:32)>IMAGE_LIMITS.bytes)throw Error('CMYK 绘图超出像素预算，请缩小选区。');
  const data=pixelArray(n*4,state.bitDepth??8),ink=new Float32Array(n*4);
  if(b)for(let y=0;y<b.height;y++){const at=((y+layer.y-shape.y)*mask.width+layer.x-shape.x)*4;data.set(b.data.subarray(y*b.width*4,(y+1)*b.width*4),at);ink.set(b.cmyk!.subarray(y*b.width*4,(y+1)*b.width*4),at);}
  this.original={width:mask.width,height:mask.height,depth:(state.bitDepth??8),data,cmyk:ink};this.layer={...shape,bitmap:{...this.original,data:data.slice(),cmyk:ink.slice()}};this.profile=embeddedProfile(state);
 }
 private paint(i:number,weight:number){if(!weight)return;const src=this.original,b=this.layer.bitmap!,old=src.data[i+3]!/255;if(this.settings.preserveAlpha&&(!old||this.settings.erase))return;const alpha=this.settings.erase?old*(1-weight):this.settings.preserveAlpha?old:weight+old*(1-weight);
  if(!this.settings.erase)for(const c of this.settings.channels??[0,1,2,3])b.cmyk![i+c]=this.settings.preserveAlpha?src.cmyk![i+c]!*(1-weight)+this.settings.ink[c]!*weight:alpha?(this.settings.ink[c]!*weight+src.cmyk![i+c]!*old*(1-weight))/alpha:src.cmyk![i+c]!;
  b.data[i+3]=alpha*255;for(let c=0;c<4;c++)if(b.cmyk![i+c]!==src.cmyk![i+c]||b.data[i+3]!==src.data[i+3])this.changed=true;
 }
 private preview(rect:Rect){const b=this.layer.bitmap!,ink=new Float32Array(rect.width*rect.height*4),alpha=new Float32Array(rect.width*rect.height);for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++){const i=((y+rect.y)*b.width+x+rect.x)*4,j=y*rect.width+x;ink.set(b.cmyk!.subarray(i,i+4),j*4);alpha[j]=b.data[i+3]!;}const part=cmykBitmap(rect.width,rect.height,ink,alpha,(this.state.bitDepth??8) as 8|16,this.profile);for(let y=0;y<rect.height;y++)b.data.set(part.data.subarray(y*rect.width*4,(y+1)*rect.width*4),((y+rect.y)*b.width+rect.x)*4);
 const a=this.dirty,x=Math.min(a?.x??rect.x,rect.x),y=Math.min(a?.y??rect.y,rect.y);this.dirty={x,y,width:Math.max(a?a.x+a.width:0,rect.x+rect.width)-x,height:Math.max(a?a.y+a.height:0,rect.y+rect.height)-y};}
 point(point:BrushPoint){this.coverage.point(point);const rect=this.coverage.takeDirty();if(!rect)return;const mask=this.coverage.layer.bitmap!;for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++){const i=(y*mask.width+x)*4;this.paint(i,mask.data[i+3]!/255);}this.preview(rect);}
 fill(){const b=this.layer.bitmap!,p=parentOffset(this.state.layers,this.layer.id)!,bounds=this.state.selection??{x:0,y:0,width:this.state.width,height:this.state.height},r={...bounds,x:bounds.x-this.layer.x-p.x,y:bounds.y-this.layer.y-p.y};for(let y=0;y<bounds.height;y++)for(let x=0;x<bounds.width;x++)this.paint(((y+r.y)*b.width+x+r.x)*4,selectionWeight(this.state.selection,x+bounds.x,y+bounds.y)*(this.settings.opacity??1));this.preview(r);return this.layer;}
}
export const fillCmyk=(state:ImageState,id:string,settings:InkPaint)=>new CmykStroke(state,id,1,settings).fill();
