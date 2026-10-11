import type { Layer,Psd } from 'ag-psd';
import type { SmartContent } from './layerFeatures.js';
import { validateQuad } from './projective.js';
import { validateMesh } from './smartGeometry.js';
export function readSmartLink(psd:Psd,id:string):Pick<SmartContent,'link'>{const record=psd.linkedFiles?.find(f=>f.id===id&&f.linkedFile),f=record?.linkedFile;return f?{link:{name:(f.name||record!.name).slice(0,160),uri:f.fullPath||f.originalPath||f.relativePath||f.name||record!.name}}:{};}
export function readSmartPlacement(l:Layer,w:number,h:number):SmartContent['transform'] {
 const p=l.placedLayer!,q=p.nonAffineTransform??p.transform;validateQuad(q);const width=(l.right??((l.left??0)+(l.imageData?.width??0)))-(l.left??0),height=(l.bottom??((l.top??0)+(l.imageData?.height??0)))-(l.top??0),warp=p.warp;
 let mesh:NonNullable<SmartContent['transform']['mesh']>|undefined;
 if(warp?.style&&warp.style!=='none'){
 if(warp.style!=='custom'||warp.value||warp.perspective||warp.perspectiveOther||warp.uOrder!==4||warp.vOrder!==4||warp.customEnvelopeWarp?.meshPoints.length!==16||warp.customEnvelopeWarp.quiltSliceX||warp.customEnvelopeWarp.quiltSliceY)throw Error('仅支持单片 4×4 贝塞尔智能网格。');
 const left=warp.bounds?.left.value??0,top=warp.bounds?.top.value??0,sw=(warp.bounds?.right.value??w)-left,sh=(warp.bounds?.bottom.value??h)-top;
 const zeroOrigin=warp.customEnvelopeWarp.meshPoints.every((v,i)=>Math.abs(v.x-i%4*sw/3)<.001&&Math.abs(v.y-Math.floor(i/4)*sh/3)<.001);mesh=warp.customEnvelopeWarp.meshPoints.map(v=>({x:(v.x-(zeroOrigin?0:left))/sw,y:(v.y-(zeroOrigin?0:top))/sh}));validateMesh(mesh);
 }
 const ax=q[2]!-q[0]!,ay=q[3]!-q[1]!,bx=q[6]!-q[0]!,by=q[7]!-q[1]!,projective=!!p.nonAffineTransform||Math.abs(q[4]!-q[0]!-ax-bx)>.01||Math.abs(q[5]!-q[1]!-ay-by)>.01||Math.abs(ax*bx+ay*by)>.02;
 return {...(mesh?{mesh}:{}),...(projective?{width,height,angle:0,flipX:false,flipY:false,quad:q.map((v,i)=>v-(i%2?(l.top??0):(l.left??0)))}:{width:Math.round(Math.hypot(ax,ay)),height:Math.round(Math.hypot(bx,by)),angle:Math.atan2(ay,ax)*180/Math.PI,flipX:false,flipY:ax*by-ay*bx<0})};
}
