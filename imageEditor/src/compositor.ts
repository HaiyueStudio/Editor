import { bitmapRegion, isPaged } from './pagedPixels.js';
import { withIccTransforms } from './iccEngine.js';
import { compositeCmyk } from './cmyk.js';
import { pixelArray, withPixels, type PixelArray } from './pixelFormat.js';
import { blendChannel, blendIfWeight, liveBitmap, type BlendIf } from './liveEffects.js';
import type { Bitmap, ImageState, ImageLayer } from './document.js';
import { maskWeight, type BlendMode } from './layerFeatures.js';
import { adjustmentBitmap, styleBitmap } from './nonDestructiveRender.js';
export { blendChannel } from './liveEffects.js';
let livePass:Map<ImageLayer,Bitmap|null>|undefined;
function renderedBitmap(layer:ImageLayer){if(!livePass)return liveBitmap(layer);if(!livePass.has(layer))livePass.set(layer,liveBitmap(layer));return livePass.get(layer)!;}
/** Encoded RGB / isolated groups. Clipped runs form one isolated base-alpha group. */
export function compositeReference(state:ImageState,region={x:0,y:0,width:state.width,height:state.height}):Bitmap {
 if(state.colorMode==='cmyk')return compositeCmyk(state,region);
 const {width,height}=region,empty=():Bitmap=>withPixels(width,height,pixelArray(width*height*4,state.bitDepth??8),state.bitDepth??8);
 const blend=(out:Bitmap,source:Bitmap,opacity:number,mode:BlendMode,atop=false,left=0,top=0,mask?:ImageLayer['mask'],rule?:BlendIf)=>{
  const cropX=Math.max(0,-left),cropY=Math.max(0,-top),cropW=Math.min(source.width-cropX,width-Math.max(0,left)),cropH=Math.min(source.height-cropY,height-Math.max(0,top));if(cropW<=0||cropH<=0)return;const paged=isPaged(source),pixels=paged?bitmapRegion(source,cropX,cropY,cropW,cropH).data:source.data;
  for(let y=Math.max(0,top);y<Math.min(height,top+source.height);y++)for(let x=Math.max(0,left);x<Math.min(width,left+source.width);x++){
   const i=(y*width+x)*4,j=(paged?((y-top-cropY)*cropW+x-left-cropX):((y-top)*source.width+x-left))*4,sa=(pixels instanceof Float32Array?pixels[j+3]!*maskWeight(mask,x-left,y-top):Math.round(pixels[j+3]!*maskWeight(mask,x-left,y-top)))/255*opacity*blendIfWeight(rule,pixels,j,out.data,i),da=out.data[i+3]!/255,a=atop?da:sa+da*(1-sa);if(!sa||!a)continue;
   for(let c=0;c<3;c++){const cs=pixels[j+c]!/255,cb=out.data[i+c]!/255,b=blendChannel(cb,cs,mode);out.data[i+c]=(atop?cb*(1-sa)+b*sa:((1-sa)*da*cb+(1-da)*sa*cs+sa*da*b)/a)*255;}out.data[i+3]=a*255;
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
  else if(layer.bitmap){const b=renderedBitmap(layer)!,x0=Math.max(0,left),x1=Math.min(width,left+b.width),y0=Math.max(0,top),y1=Math.min(height,top+b.height);if(x1>x0&&y1>y0){const part=isPaged(b)?bitmapRegion(b,x0-left,y0-top,x1-x0,y1-y0):b;const data=part.data;for(let y=y0;y<y1;y++){const i=(y*width+x0)*4,s=isPaged(b)?(y-y0)*(x1-x0)*4:((y-top)*b.width+x0-left)*4;source.data.set(data.subarray(s,s+(x1-x0)*4),i);}}}

  if(layer.mask)for(let y=0;y<height;y++)for(let x=0;x<width;x++)source.data[(y*width+x)*4+3]=source.data[(y*width+x)*4+3]!*maskWeight(layer.mask,x-left,y-top);
  if(styles)source=styleBitmap(source,layer.styles,{x:region.x,y:region.y});return source;
 };
 const draw=(layers:readonly ImageLayer[],out:Bitmap,px=0,py=0)=>{
  for(let i=0;i<layers.length;i++){
   const layer=layers[i]!;if(layer.clipping)continue;
   let last=i;while(layers[last+1]?.clipping)last++;
   if(layer.visible&&layer.opacity){
    if(layer.bitmap&&last===i){const halo=compositeHalo([layer]),left=px+layer.x,top=py+layer.y;if(left-halo>=width||top-halo>=height||left+layer.bitmap.width+halo<=0||top+layer.bitmap.height+halo<=0){i=last;continue;}}
    if(layer.kind==='group'&&layer.passThrough&&last===i){if(layer.opacity===1)draw(layer.children,out,px+layer.x,py+layer.y);else{const before=out.data.slice();draw(layer.children,out,px+layer.x,py+layer.y);for(let p=0;p<out.data.length;p+=4){const a=before[p+3]!/255,b=out.data[p+3]!/255,alpha=a*(1-layer.opacity)+b*layer.opacity;for(let c=0;c<3;c++)out.data[p+c]=alpha?(before[p+c]!*a*(1-layer.opacity)+out.data[p+c]!*b*layer.opacity)/alpha:0;out.data[p+3]=alpha*255;}}}
    else if(layer.content?.type==='adjustment')adjust(out,layer,px,py);
    else if(last===i&&layer.bitmap&&!layer.styles?.enabled)blend(out,renderedBitmap(layer)!,layer.opacity,layer.blend,false,px+layer.x,py+layer.y,layer.mask,layer.blendIf);
    else {let source=render(layer,px,py,false);
     for(let j=i+1;j<=last;j++){const clip=layers[j]!;if(!clip.visible||!clip.opacity)continue;if(clip.kind==='adjustment')adjust(source,clip,px,py);else blend(source,render(clip,px,py),clip.opacity,clip.blend,true,0,0,undefined,clip.blendIf);}
     source=styleBitmap(source,layer.styles,{x:region.x,y:region.y});blend(out,source,layer.opacity,layer.blend,false,0,0,undefined,layer.blendIf);
    }
   }i=last;
  }
 };
 const out=empty();draw(state.layers,out,-region.x,-region.y);return out;
}
export function hasAdvancedComposite(layers:readonly ImageLayer[]):boolean {return layers.some(l=>Boolean(l.passThrough||l.bitmap?.pages||l.mask||l.clipping||l.styles?.enabled||l.smartFilters?.length||l.blendIf?.enabled)||l.kind==='adjustment'||hasAdvancedComposite(l.children));}

export interface CompositeRect {x:number;y:number;width:number;height:number}
/** Sum all spatial effect supports, including clipped and nested groups. Overscan prevents seams. */
export function compositeHalo(layers:readonly ImageLayer[]):number {
 return layers.reduce((n,l)=>n+compositeHalo(l.children)+(l.styles?.enabled?Math.max(l.styles.innerGlow?.size??0,l.styles.stroke?.size??0,l.styles.shadow?Math.max(Math.abs(l.styles.shadow.dx),Math.abs(l.styles.shadow.dy))+l.styles.shadow.blur:0):0),0);
}
export function compositeRegion(state:ImageState,rect:CompositeRect):Bitmap {
 if(![rect.x,rect.y,rect.width,rect.height].every(Number.isInteger)||rect.x<0||rect.y<0||rect.width<1||rect.height<1||rect.x+rect.width>state.width||rect.y+rect.height>state.height)throw new Error('合成区域超出画布。');
 const halo=Math.ceil(compositeHalo(state.layers)),x=Math.max(0,rect.x-halo),y=Math.max(0,rect.y-halo),right=Math.min(state.width,rect.x+rect.width+halo),bottom=Math.min(state.height,rect.y+rect.height+halo),source=compositeReference(state,{x,y,width:right-x,height:bottom-y});
 if(x===rect.x&&y===rect.y&&source.width===rect.width&&source.height===rect.height)return source;
 const data=pixelArray(rect.width*rect.height*4,state.bitDepth??8);for(let row=0;row<rect.height;row++){const at=((rect.y-y+row)*source.width+rect.x-x)*4;data.set(source.data.subarray(at,at+rect.width*4),row*rect.width*4);}return withPixels(rect.width,rect.height,data,state.bitDepth??8);
}
/** Conservative paint damage in document coordinates. Non-local smart filters use a full repaint. */
export function compositeDamage(state:ImageState,id:string,local:CompositeRect):CompositeRect|undefined {
 const hasFilters=(ls:readonly ImageLayer[]):boolean=>ls.some(l=>l.smartFilters?.some(f=>f.enabled)||hasFilters(l.children));
 if(hasFilters(state.layers))return;
 const locate=(ls:readonly ImageLayer[],x=0,y=0):{x:number;y:number}|undefined=>{for(const l of ls){const at={x:x+l.x,y:y+l.y};if(l.id===id)return at;const found=locate(l.children,at.x,at.y);if(found)return found;}return;};
 const at=locate(state.layers);if(!at)return;
 const halo=Math.ceil(compositeHalo(state.layers)),x=Math.max(0,at.x+local.x-halo),y=Math.max(0,at.y+local.y-halo),right=Math.min(state.width,at.x+local.x+local.width+halo),bottom=Math.min(state.height,at.y+local.y+local.height+halo);
 return {x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};
}
export function forEachCompositeTile(state:ImageState,visit:(bitmap:Bitmap,rect:CompositeRect)=>void,size=256,region:CompositeRect={x:0,y:0,width:state.width,height:state.height}){
 if(!Number.isInteger(size)||size<16||size>1024)throw new Error('合成分块大小应为 16–1024。');
 if(![region.x,region.y,region.width,region.height].every(Number.isInteger)||region.x<0||region.y<0||region.width<0||region.height<0||region.x+region.width>state.width||region.y+region.height>state.height)throw Error('合成区域超出画布。');
 if(!region.width||!region.height)return;
 const previous=livePass;livePass=new Map();
 try{withIccTransforms(()=>{
  // Very large effect supports favor one pass over repeated full-frame overscan.
  if(compositeHalo(state.layers)>size){visit(compositeReference(state),{x:0,y:0,width:state.width,height:state.height});return;}
  for(let y=region.y;y<region.y+region.height;y+=size)for(let x=region.x;x<region.x+region.width;x+=size){const rect={x,y,width:Math.min(size,region.x+region.width-x),height:Math.min(size,region.y+region.height-y)};visit(compositeRegion(state,rect),rect);}
 });}finally{livePass=previous;}
}
export function compositeState(state:ImageState):Bitmap {
 if(state.colorMode==='cmyk')return compositeCmyk(state);
 if(state.width<=256&&state.height<=256)return compositeReference(state);
 const data=pixelArray(state.width*state.height*4,state.bitDepth??8);forEachCompositeTile(state,(b,r)=>{for(let y=0;y<r.height;y++)data.set(b.data.subarray(y*r.width*4,(y+1)*r.width*4),((r.y+y)*state.width+r.x)*4);});return withPixels(state.width,state.height,data,state.bitDepth??8);
}
