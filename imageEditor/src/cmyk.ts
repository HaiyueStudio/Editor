import { bitmapRegion, isPaged } from './pagedPixels.js';
import { blendChannel } from './liveEffects.js';
import { checkSize, type Bitmap, type ImageLayer, type ImageState } from './document.js';
import { srgbProfileBytes, embeddedProfile, profileResource } from './colorManagement.js';
import { iccTransform, profileInfo, workingProfile, type IccSettings } from './iccEngine.js';
import { withPixels,pixelArray,depthOf } from './pixelFormat.js';
import { concatBytes,resourceBlocks } from './psdResources.js';
import { maskWeight } from './layerFeatures.js';
export function validateCmyk(b:Bitmap){if(!(b.cmyk instanceof Float32Array)||b.cmyk.length!==b.width*b.height*4||b.cmyk.some(v=>!Number.isFinite(v)||v<0||v>100))throw Error('CMYK 通道必须为四分量 0–100% 浮点数据。');}
export function cmykBitmap(width:number,height:number,ink:Float32Array,alpha:ArrayLike<number>,depth:8|16,profile?:Uint8Array):Bitmap {
 checkSize(width,height);if(width*height*(depth===8?20:32)>128*1024*1024)throw Error('CMYK 像素超过 128 MiB 预算。');if(alpha.length!==width*height)throw Error('CMYK 透明通道尺寸不符。');const raw={...withPixels(width,height,pixelArray(width*height*4,depth),depth),cmyk:ink.slice()};validateCmyk(raw);const rgb=profile?iccTransform(ink,profile,'srgb').data:undefined;
 for(let i=0;i<width*height;i++){for(let c=0;c<3;c++)raw.data[i*4+c]=(rgb?rgb[i*3+c]!:(1-ink[i*4+c]!/100)*(1-ink[i*4+3]!/100))*255;raw.data[i*4+3]=alpha[i]??255;}return raw;
}
function separate(b:Bitmap,profile:Uint8Array,old?:Bitmap,settings:Partial<IccSettings>={},source:Uint8Array|'srgb'='srgb'):Bitmap {
 const rgb=Float32Array.from({length:b.width*b.height*3},(_,i)=>b.data[Math.floor(i/3)*4+i%3]!/255),converted=iccTransform(rgb,source,profile,settings).data,ink=new Float32Array(b.data.length);
 for(let i=0;i<b.width*b.height;i++){const unchanged=old?.cmyk&&old.width===b.width&&old.height===b.height&&[0,1,2].every(c=>b.data[i*4+c]===old.data[i*4+c]);for(let c=0;c<4;c++)ink[i*4+c]=unchanged?old!.cmyk![i*4+c]!:Math.max(0,Math.min(100,converted[i*4+c]!));}
 return {...b,cmyk:ink};
}
/** Native separations are authoritative. RGB is a disposable preview/editing cache. */
export function synchronizeCmyk(state:ImageState,before?:ImageState):ImageState {
 if(state.colorMode!=='cmyk')return state;const profile=embeddedProfile(state),depth=state.bitDepth??8;if(depth===32)throw Error('CMYK 文档支持 8／16 位；HDR 请使用 RGB。');
 const oldProfile=before?embeddedProfile(before):undefined,profileChanged=!!before&&(profile?.length!==oldProfile?.length||!!profile?.some((v,i)=>v!==oldProfile?.[i]));
 const old=new Map<string,ImageLayer>();const collect=(ls:readonly ImageLayer[])=>ls.forEach(l=>{old.set(l.id,l);collect(l.children);});collect(before?.layers??[]);
 const visit=(ls:readonly ImageLayer[]):readonly ImageLayer[]=>ls.map(l=>{const prev=old.get(l.id)?.bitmap,b=l.bitmap;let bitmap=b;
 if(b&&b!==prev&&!(b.pages?.kind==='disk'&&!before)){if(b.cmyk&&(!before||profileChanged||!prev?.cmyk||b.width!==prev.width||b.height!==prev.height||b.cmyk.length!==prev.cmyk.length||b.cmyk.some((v,i)=>v!==prev.cmyk![i])))bitmap=cmykBitmap(b.width,b.height,b.cmyk,Array.from({length:b.width*b.height},(_,i)=>b.data[i*4+3]!),depth,profile);else {const same=prev&&prev.width===b.width&&prev.height===b.height&&b.data.every((v,i)=>i%4===3||v===prev.data[i]);if(same)bitmap={...b,cmyk:prev.cmyk!};else {if(!profile)throw Error('RGB 工具编辑 CMYK 前需要指定 CMYK ICC 配置；可直接编辑原生通道。');bitmap=separate(b,profile,prev??undefined,state.icc);}}}
 return bitmap===b&&!l.children.length?l:{...l,bitmap,children:visit(l.children)};});return {...state,layers:visit(state.layers)};
}
export function convertDocumentCmyk(state:ImageState,profile:Uint8Array,settings:Partial<IccSettings>=state.icc??{}):ImageState {
 settings={intent:settings.intent??1,bpc:settings.bpc??true};
 if(state.colorMode==='cmyk'&&!embeddedProfile(state))throw Error('请先指定 CMYK 源配置，再转换配置。');
 if(profileInfo(profile).space!=='CMYK')throw Error('请选择 CMYK ICC 配置。');if(state.bitDepth===32)throw Error('先将 RGB HDR 转为 8／16 位。');const clean=(ls:readonly ImageLayer[]):ImageLayer[]=>ls.map(l=>{if(l.content||l.styles?.enabled||l.smartFilters?.length||l.blendIf?.enabled)throw Error('CMYK 模式转换前请栅格化参数化内容／效果。');return {...l,bitmap:l.bitmap?state.colorMode==='cmyk'?cmykBitmap(l.bitmap.width,l.bitmap.height,iccTransform(l.bitmap.cmyk!,embeddedProfile(state)!,profile,settings).data,Array.from({length:l.bitmap.width*l.bitmap.height},(_,i)=>l.bitmap!.data[i*4+3]!), (state.bitDepth??8) as 8|16,profile):separate(l.bitmap,profile,undefined,settings,workingProfile(state)):null,children:clean(l.children)};});
 const resources=concatBytes([...resourceBlocks(state.psdOrigin?.resources??new Uint8Array()).filter(b=>b.id!==1039).map(b=>b.bytes),profileResource(profile)]);
 return {...state,colorMode:'cmyk',layers:clean(state.layers),psdOrigin:{sourceName:state.psdOrigin?.sourceName??state.name,flattened:state.psdOrigin?.flattened??false,resources}};
}
/** Separable blend functions operate on inverted ink values, independently on C/M/Y/K. */
export function compositeCmyk(state:ImageState,region={x:0,y:0,width:state.width,height:state.height}):Bitmap {
 const pixels=region.width*region.height;if(pixels*32>128*1024*1024)throw Error('CMYK 合成输出超过 128 MiB，请分块或缩小画布。');if(pixels>65536){const out={...withPixels(region.width,region.height,pixelArray(pixels*4,state.bitDepth??8),state.bitDepth??8),cmyk:new Float32Array(pixels*4)};for(let y=0;y<region.height;y+=256)for(let x=0;x<region.width;x+=256){const b=compositeCmyk(state,{x:region.x+x,y:region.y+y,width:Math.min(256,region.width-x),height:Math.min(256,region.height-y)});for(let row=0;row<b.height;row++){const dest=((y+row)*region.width+x)*4;out.data.set(b.data.subarray(row*b.width*4,(row+1)*b.width*4),dest);out.cmyk.set(b.cmyk!.subarray(row*b.width*4,(row+1)*b.width*4),dest);}}return out;}
 state={...state,width:region.width,height:region.height};
 const n=state.width*state.height;if(n*32>128*1024*1024)throw Error('CMYK 合成输出超过 128 MiB，请分块或缩小画布。');const empty=()=>({ink:new Float32Array(n*4),alpha:new Float32Array(n)});
 const draw=(layers:readonly ImageLayer[],out:ReturnType<typeof empty>,px=0,py=0)=>{for(const l of layers){if(!l.visible||!l.opacity)continue;const x=px+l.x,y=py+l.y;let source:ReturnType<typeof empty>|undefined;if(l.kind==='group'){source=empty();draw(l.children,source,x,y);}let b=l.bitmap;let cropX=0,cropY=0;if(b&&isPaged(b)){cropX=Math.max(0,-x);cropY=Math.max(0,-y);const w=Math.min(b.width-cropX,state.width-Math.max(0,x)),h=Math.min(b.height-cropY,state.height-Math.max(0,y));if(w<=0||h<=0)continue;b=bitmapRegion(b,cropX,cropY,w,h);}
 for(let yy=0;yy<state.height;yy++)for(let xx=0;xx<state.width;xx++){const i=yy*state.width+xx,sx=xx-x-cropX,sy=yy-y-cropY,j=sy*(b?.width??0)+sx;if(!source&&(!b?.cmyk||sx<0||sy<0||sx>=b.width||sy>=b.height))continue;const sa=(source?source.alpha[i]!:(b!.data[j*4+3]!/255))*l.opacity*maskWeight(l.mask,sx+cropX,sy+cropY),da=out.alpha[i]!,a=sa+da*(1-sa);if(!sa||!a)continue;for(let c=0;c<4;c++){const sc=source?source.ink[i*4+c]!:b!.cmyk![j*4+c]!,dc=out.ink[i*4+c]!;const mixed=l.blend==='normal'?sc:100*(1-blendChannel(1-dc/100,1-sc/100,l.blend));out.ink[i*4+c]=Math.max(0,Math.min(100,((1-sa)*da*dc+(1-da)*sa*sc+sa*da*mixed)/a));}out.alpha[i]=a;}
 }};const out=empty();draw(state.layers,out,-region.x,-region.y);return cmykBitmap(state.width,state.height,out.ink,Float32Array.from(out.alpha,v=>v*255),(state.bitDepth??8) as 8|16,embeddedProfile(state));
}

export function convertDocumentRgb(state:ImageState):ImageState {
 if(state.colorMode!=='cmyk')throw Error('文档已经是 RGB。');const profile=embeddedProfile(state);if(!profile)throw Error('请先指定 CMYK ICC 配置。');
 const clean=(ls:readonly ImageLayer[]):ImageLayer[]=>ls.map(l=>{const b=l.bitmap,preview=b?cmykBitmap(b.width,b.height,b.cmyk!,Array.from({length:b.width*b.height},(_,i)=>b.data[i*4+3]!),(state.bitDepth??8) as 8|16,profile):null; return {...l,bitmap:preview?withPixels(preview.width,preview.height,preview.data,preview):null,children:clean(l.children)};});
 const resources=concatBytes([...resourceBlocks(state.psdOrigin?.resources??new Uint8Array()).filter(b=>b.id!==1039).map(b=>b.bytes),profileResource(srgbProfileBytes())]);return {...state,colorMode:'rgb',layers:clean(state.layers),psdOrigin:{sourceName:state.psdOrigin?.sourceName??state.name,flattened:state.psdOrigin?.flattened??false,resources}};
}
