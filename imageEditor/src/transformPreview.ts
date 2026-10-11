import { gpuImageLayers, gpuDisplayProfile } from './gpuImagePlan.js';
import { rasterPreview, rememberRasterPreview } from './rasterPreviews.js';
import { bitmapRegionAsync } from './diskCompositor.js';
import { transformTargets, transformBounds } from './multiTransform.js';
import type { ImageState, ImageLayer, Bitmap } from './document.js';
import type { Point } from './pixelTools.js';
import type { TransformValues } from './freeTransform.js';

/** Inverse quad mapping from display pixels to source texels (two padded WGSL rows). */
export function previewMatrix(a:Point,b:Point,c:Point,source:Bitmap,doc:Point,display:Point){
 const ux=b.x-a.x,uy=b.y-a.y,vx=c.x-a.x,vy=c.y-a.y,det=ux*vy-uy*vx;
 if(!Number.isFinite(det)||Math.abs(det)<1e-12)throw Error('变换预览矩阵无效。');
 return new Float32Array([vy/det*doc.x/display.x*source.width,-vx/det*doc.y/display.y*source.width,(vx*a.y-vy*a.x)/det*source.width,0,-uy/det*doc.x/display.x*source.height,ux/det*doc.y/display.y*source.height,(uy*a.x-ux*a.y)/det*source.height,0]);
}
/** Bounded, disposable samples. Imported previews usually avoid all native reads here. */
async function proxy(b:Bitmap,signal:AbortSignal){
 const cached=rasterPreview(b,512);if(cached)return cached;
 const scale=Math.min(1,512/Math.max(b.width,b.height)),width=Math.max(1,Math.round(b.width*scale)),height=Math.max(1,Math.round(b.height*scale)),data=new Uint8ClampedArray(width*height*4);
 if(scale===1)return bitmapRegionAsync(b,{x:0,y:0,width,height},signal);
 // Read each native tile once, never a full layer or a full-width decoded stripe.
 for(let y=0;y<b.height;y+=256)for(let x=0;x<b.width;x+=256){
  signal.throwIfAborted();const right=Math.min(b.width,x+256),bottom=Math.min(b.height,y+256),left=Math.max(0,Math.ceil(x*width/b.width-.5)),top=Math.max(0,Math.ceil(y*height/b.height-.5)),endX=Math.min(width,Math.ceil(right*width/b.width-.5)),endY=Math.min(height,Math.ceil(bottom*height/b.height-.5));if(endX<=left||endY<=top)continue;
  const tile=await bitmapRegionAsync(b,{x,y,width:right-x,height:bottom-y},signal);
  for(let yy=top;yy<endY;yy++)for(let xx=left;xx<endX;xx++){const at=((Math.floor((yy+.5)*b.height/height)-y)*tile.width+Math.floor((xx+.5)*b.width/width)-x)*4;data.set(tile.data.subarray(at,at+4),(yy*width+xx)*4);}
  await new Promise<void>(r=>setTimeout(r,0));
 }
 const result={width,height,data};rememberRasterPreview(b,[result]);return result;
}
/** Ephemeral RGB layer stack. Native pixels/history are never changed by dragging. */
export async function prepareTransformPreview(before:ImageState,ids:readonly string[],center:Point,multiple:boolean,signal:AbortSignal){
 const plan=gpuImageLayers(before,false,false);
 if(!plan||!gpuDisplayProfile(before)||plan.length>8||plan.some(e=>e.layer.mask&&!e.layer.mask.disabled))return;
 const targets=new Set(multiple?transformTargets(before,ids).map(l=>l.id):ids),bounds=multiple?transformBounds(before,ids):undefined;
 if(!multiple&&plan.some(e=>targets.has(e.layer.id)&&e.layer.content?.type==='smart'&&e.layer.content.transform.mesh))return;
 const scale=Math.min(1,1024/Math.max(before.width,before.height)),width=Math.max(1,Math.round(before.width*scale)),height=Math.max(1,Math.round(before.height*scale)),layers:ImageLayer[]=[];
 for(const e of plan){const original=!multiple&&targets.has(e.layer.id)&&e.layer.content?.type==='smart'?e.layer.content.source:e.layer.bitmap!;layers.push({...e.layer,x:0,y:0,bitmap:await proxy(original,signal),children:[]});}
 signal.throwIfAborted();const state={...before,id:before.id+':transform-preview',width,height,layers};
 return {state,matrices(value:TransformValues){
  const angle=value.angle*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),map=(x:number,y:number)=>({x:center.x+value.dx+x*cos-y*sin,y:center.y+value.dy+x*sin+y*cos}),out=new Map<string,Float32Array>();
  for(let i=0;i<plan.length;i++){const e=plan[i]!,b=e.layer.bitmap!,texture=layers[i]!.bitmap;let at=(u:number,v:number)=>({x:e.x+u*b.width,y:e.y+v*b.height});
   if(targets.has(e.layer.id))at=multiple?(u,v)=>map((e.x+u*b.width-center.x)*value.width/bounds!.width*(value.flipX?-1:1),(e.y+v*b.height-center.y)*value.height/bounds!.height*(value.flipY?-1:1)):(u,v)=>map((u-.5)*value.width*(value.flipX?-1:1),(v-.5)*value.height*(value.flipY?-1:1));
   out.set(e.layer.id,previewMatrix(at(0,0),at(1,0),at(0,1),texture!,{x:before.width,y:before.height},{x:width,y:height}));
  }return out;
 }};
}
