import { blendChannel, blendIfWeight, liveBitmap, type BlendIf } from './liveEffects.js';
import type { Bitmap, ImageState, ImageLayer } from './document.js';
import { maskWeight, type BlendMode } from './layerFeatures.js';
import { adjustmentBitmap, styleBitmap } from './nonDestructiveRender.js';
export { blendChannel } from './liveEffects.js';
/** Encoded RGB / isolated groups. Clipped runs form one isolated base-alpha group. */
export function compositeReference(state:ImageState,region={x:0,y:0,width:state.width,height:state.height}):Bitmap {
 const {width,height}=region,empty=():Bitmap=>({width,height,data:new Uint8ClampedArray(width*height*4)});
 const blend=(out:Bitmap,source:Bitmap,opacity:number,mode:BlendMode,atop=false,left=0,top=0,mask?:ImageLayer['mask'],rule?:BlendIf)=>{
  for(let y=Math.max(0,top);y<Math.min(height,top+source.height);y++)for(let x=Math.max(0,left);x<Math.min(width,left+source.width);x++){
   const i=(y*width+x)*4,j=((y-top)*source.width+x-left)*4,sa=Math.round(source.data[j+3]!*maskWeight(mask,x-left,y-top))/255*opacity*blendIfWeight(rule,source.data,j,out.data,i),da=out.data[i+3]!/255,a=atop?da:sa+da*(1-sa);if(!sa||!a)continue;
   for(let c=0;c<3;c++){const cs=source.data[j+c]!/255,cb=out.data[i+c]!/255,b=blendChannel(cb,cs,mode);out.data[i+c]=(atop?cb*(1-sa)+b*sa:((1-sa)*da*cb+(1-da)*sa*cs+sa*da*b)/a)*255;}out.data[i+3]=a*255;
  }
 };
 const adjust=(out:Bitmap,layer:ImageLayer,px:number,py:number)=>{
  if(layer.content?.type!=='adjustment'||!layer.visible)return;
  const filtered=adjustmentBitmap(out,layer.content);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,w=layer.opacity*maskWeight(layer.mask,x-px-layer.x,y-py-layer.y)*blendIfWeight(layer.blendIf,filtered.data,i,out.data,i);for(let c=0;c<3;c++)out.data[i+c]=out.data[i+c]!*(1-w)+filtered.data[i+c]!*w;}
 };
 const render=(layer:ImageLayer,px:number,py:number,styles=true):Bitmap=>{
  let source=empty();const left=px+layer.x,top=py+layer.y;
  if(layer.kind==='group')draw(layer.children,source,left,top);
  else if(layer.bitmap){const b=liveBitmap(layer)!;for(let y=Math.max(0,top);y<Math.min(height,top+b.height);y++)for(let x=Math.max(0,left);x<Math.min(width,left+b.width);x++){const i=(y*width+x)*4,s=((y-top)*b.width+x-left)*4;source.data.set(b.data.subarray(s,s+4),i);}}
  if(layer.mask)for(let y=0;y<height;y++)for(let x=0;x<width;x++)source.data[(y*width+x)*4+3]=source.data[(y*width+x)*4+3]!*maskWeight(layer.mask,x-left,y-top);
  if(styles)source=styleBitmap(source,layer.styles);return source;
 };
 const draw=(layers:readonly ImageLayer[],out:Bitmap,px=0,py=0)=>{
  for(let i=0;i<layers.length;i++){
   const layer=layers[i]!;if(layer.clipping)continue;
   let last=i;while(layers[last+1]?.clipping)last++;
   if(layer.visible&&layer.opacity){
    if(layer.content?.type==='adjustment')adjust(out,layer,px,py);
    else if(last===i&&layer.bitmap&&!layer.styles?.enabled)blend(out,liveBitmap(layer)!,layer.opacity,layer.blend,false,px+layer.x,py+layer.y,layer.mask,layer.blendIf);
    else {let source=render(layer,px,py,false);
     for(let j=i+1;j<=last;j++){const clip=layers[j]!;if(!clip.visible||!clip.opacity)continue;if(clip.kind==='adjustment')adjust(source,clip,px,py);else blend(source,render(clip,px,py),clip.opacity,clip.blend,true,0,0,undefined,clip.blendIf);}
     source=styleBitmap(source,layer.styles);blend(out,source,layer.opacity,layer.blend,false,0,0,undefined,layer.blendIf);
    }
   }i=last;
  }
 };
 const out=empty();draw(state.layers,out,-region.x,-region.y);return out;
}
export function hasAdvancedComposite(layers:readonly ImageLayer[]):boolean {return layers.some(l=>Boolean(l.mask||l.clipping||l.styles?.enabled||l.smartFilters?.length||l.blendIf?.enabled)||l.kind==='adjustment'||hasAdvancedComposite(l.children));}

export interface CompositeRect {x:number;y:number;width:number;height:number}
/** Sum all spatial effect supports, including clipped and nested groups. Overscan prevents seams. */
export function compositeHalo(layers:readonly ImageLayer[]):number {
 return layers.reduce((n,l)=>n+compositeHalo(l.children)+(l.styles?.enabled?Math.max(l.styles.stroke?.size??0,l.styles.shadow?Math.max(Math.abs(l.styles.shadow.dx),Math.abs(l.styles.shadow.dy))+l.styles.shadow.blur:0):0),0);
}
export function compositeRegion(state:ImageState,rect:CompositeRect):Bitmap {
 if(![rect.x,rect.y,rect.width,rect.height].every(Number.isInteger)||rect.x<0||rect.y<0||rect.width<1||rect.height<1||rect.x+rect.width>state.width||rect.y+rect.height>state.height)throw new Error('合成区域超出画布。');
 const halo=compositeHalo(state.layers),x=Math.max(0,rect.x-halo),y=Math.max(0,rect.y-halo),right=Math.min(state.width,rect.x+rect.width+halo),bottom=Math.min(state.height,rect.y+rect.height+halo),source=compositeReference(state,{x,y,width:right-x,height:bottom-y});
 if(x===rect.x&&y===rect.y&&source.width===rect.width&&source.height===rect.height)return source;
 const data=new Uint8ClampedArray(rect.width*rect.height*4);for(let row=0;row<rect.height;row++){const at=((rect.y-y+row)*source.width+rect.x-x)*4;data.set(source.data.subarray(at,at+rect.width*4),row*rect.width*4);}return {width:rect.width,height:rect.height,data};
}
export function forEachCompositeTile(state:ImageState,visit:(bitmap:Bitmap,rect:CompositeRect)=>void,size=256){
 if(!Number.isInteger(size)||size<16||size>1024)throw new Error('合成分块大小应为 16–1024。');
 // Very large effect supports favor one pass over repeated full-frame overscan.
 if(compositeHalo(state.layers)>size){visit(compositeReference(state),{x:0,y:0,width:state.width,height:state.height});return;}
 for(let y=0;y<state.height;y+=size)for(let x=0;x<state.width;x+=size){const rect={x,y,width:Math.min(size,state.width-x),height:Math.min(size,state.height-y)};visit(compositeRegion(state,rect),rect);}
}
export function compositeState(state:ImageState):Bitmap {
 if(state.width<=256&&state.height<=256)return compositeReference(state);
 const data=new Uint8ClampedArray(state.width*state.height*4);forEachCompositeTile(state,(b,r)=>{for(let y=0;y<r.height;y++)data.set(b.data.subarray(y*r.width*4,(y+1)*r.width*4),((r.y+y)*state.width+r.x)*4);});return {width:state.width,height:state.height,data};
}
