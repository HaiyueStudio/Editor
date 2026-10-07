import type { Bitmap, ImageState, ImageLayer } from './document.js';
import { maskWeight, type BlendMode } from './layerFeatures.js';
import { filterBitmap } from './filters.js';
export function blendChannel(back:number,source:number,mode:BlendMode):number {
 switch(mode){case 'multiply':return back*source;case 'screen':return back+source-back*source;case 'overlay':return back<=.5?2*back*source:1-2*(1-back)*(1-source);case 'hard-light':return source<=.5?2*back*source:1-2*(1-back)*(1-source);case 'darken':return Math.min(back,source);case 'lighten':return Math.max(back,source);case 'difference':return Math.abs(back-source);case 'exclusion':return back+source-2*back*source;default:return source;}
}
/** Encoded RGB / source-over, isolated groups. Text/shape use their stored raster cache. */
export function compositeState(state:ImageState):Bitmap {
 const {width,height}=state,empty=():Bitmap=>({width,height,data:new Uint8ClampedArray(width*height*4)});
 const draw=(layers:readonly ImageLayer[],out:Bitmap,px=0,py=0)=>{
  for(const layer of layers){if(!layer.visible||!layer.opacity)continue;const left=px+layer.x,top=py+layer.y;
   if(layer.content?.type==='adjustment'){
    const filtered=filterBitmap(out,{kind:layer.content.filter,amount:layer.content.amount});
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,w=layer.opacity*maskWeight(layer.mask,x-left,y-top);for(let c=0;c<3;c++)out.data[i+c]=out.data[i+c]!*(1-w)+filtered.data[i+c]!*w;}continue;
   }
   const source=layer.kind==='group'?empty():layer.bitmap;if(!source)continue;
   if(layer.kind==='group')draw(layer.children,source,left,top);
   const sx=layer.kind==='group'?0:left,sy=layer.kind==='group'?0:top;
   for(let y=Math.max(0,sy);y<Math.min(height,sy+source.height);y++)for(let x=Math.max(0,sx);x<Math.min(width,sx+source.width);x++){
    const s=((y-sy)*source.width+x-sx)*4,d=(y*width+x)*4,sa=source.data[s+3]!/255*layer.opacity*maskWeight(layer.mask,x-left,y-top),da=out.data[d+3]!/255,a=sa+da*(1-sa);if(!sa)continue;
    for(let c=0;c<3;c++){const cs=source.data[s+c]!/255,cb=out.data[d+c]!/255,b=blendChannel(cb,cs,layer.blend);out.data[d+c]=((1-sa)*da*cb+(1-da)*sa*cs+sa*da*b)/a*255;}out.data[d+3]=a*255;
   }
  }
 };
 const out=empty();draw(state.layers,out);return out;
}
export function hasAdvancedComposite(layers:readonly ImageLayer[]):boolean {return layers.some(l=>Boolean(l.mask)||l.kind==='adjustment'||hasAdvancedComposite(l.children));}
