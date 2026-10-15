import type { Bitmap } from './document.js';
import { checkSize } from './document.js';
import type { SmartContent } from './layerFeatures.js';
import { mapQuadPoint, inverseQuad } from './projective.js';
import { depthOf, pixelArray, pixelBytesView, withPixels } from './pixelFormat.js';
import { bitmapRegionAsync } from './diskCompositor.js';
import { pagedBitmap } from './pagedPixels.js';
import { diskPager, type DiskBlob } from './diskPager.js';
import { deflate } from 'pako';
export type MeshPoint = Readonly<{x:number;y:number}>;
export const identityMesh=():MeshPoint[]=>Array.from({length:16},(_,i)=>({x:i%4/3,y:Math.floor(i/4)/3}));
const basis=(t:number)=>[(1-t)**3,3*t*(1-t)**2,3*t*t*(1-t),t**3];
export function meshPoint(mesh:readonly MeshPoint[],u:number,v:number):[number,number]{const a=basis(u),b=basis(v);let x=0,y=0;for(let j=0;j<4;j++)for(let i=0;i<4;i++){const w=a[i]!*b[j]!,p=mesh[j*4+i]!;x+=p.x*w;y+=p.y*w;}return [x,y];}
export function validateMesh(mesh:readonly MeshPoint[]){
 if(!Array.isArray(mesh)||mesh.length!==16||mesh.some(p=>!p||![p.x,p.y].every(v=>Number.isFinite(v)&&v>=-4&&v<=5)))throw Error('网格需要 4×4 个有限控制点，归一化坐标范围 −4～5。');
 // A positive control-net Jacobian is a conservative sufficient condition, rather than a sparse visual test.
 const du:MeshPoint[]=[],dv:MeshPoint[]=[];for(let j=0;j<4;j++)for(let i=0;i<3;i++)du.push({x:mesh[j*4+i+1]!.x-mesh[j*4+i]!.x,y:mesh[j*4+i+1]!.y-mesh[j*4+i]!.y});for(let j=0;j<3;j++)for(let i=0;i<4;i++)dv.push({x:mesh[(j+1)*4+i]!.x-mesh[j*4+i]!.x,y:mesh[(j+1)*4+i]!.y-mesh[j*4+i]!.y});
 if(du.some(a=>dv.some(b=>a.x*b.y-a.y*b.x<=1e-8)))throw Error('网格可能折叠或退化，请减小控制点位移。');
}
export function placementQuad(c:SmartContent,width:number,height:number):number[]{const t=c.transform;if(t.quad)return [...t.quad];const a=t.angle*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a);return [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].flatMap(([u,v])=>{const x=u!*t.width*(t.flipX?-1:1),y=v!*t.height*(t.flipY?-1:1);return [width/2+x*cos-y*sin,height/2+x*sin+y*cos];});}
export function smartSize(c:SmartContent){const t=c.transform,a=t.angle*Math.PI/180;return t.quad?{width:t.width,height:t.height}:{width:Math.ceil(Math.abs(t.width*Math.cos(a))+Math.abs(t.height*Math.sin(a))-1e-8),height:Math.ceil(Math.abs(t.width*Math.sin(a))+Math.abs(t.height*Math.cos(a))-1e-8)};}
function mapper(c:SmartContent,width:number,height:number){const inv=inverseQuad(placementQuad(c,width,height)),mesh=c.transform.mesh;return (x:number,y:number):[number,number]|undefined=>{const [tx,ty]=inv(x,y);let u=tx,v=ty;if(mesh){for(let k=0;k<16;k++){const p=meshPoint(mesh,u,v),ex=p[0]-tx,ey=p[1]-ty;if(Math.abs(ex)+Math.abs(ey)<1e-8)break;const a=meshPoint(mesh,u+1e-5,v),b=meshPoint(mesh,u,v+1e-5),ax=(a[0]-p[0])*1e5,ay=(a[1]-p[1])*1e5,bx=(b[0]-p[0])*1e5,by=(b[1]-p[1])*1e5,det=ax*by-ay*bx;if(Math.abs(det)<1e-10)return;u-=(ex*by-ey*bx)/det;v-=(ey*ax-ex*ay)/det;if(Math.abs(u)+Math.abs(v)>20)return;}
 const p=meshPoint(mesh,u,v);if(Math.abs(p[0]-tx)+Math.abs(p[1]-ty)>1e-5)return;}
 return Number.isFinite(u+v)&&u>=0&&u<=1&&v>=0&&v<=1?[Math.max(0,Math.min(c.source.width-1,u*c.source.width-.5)),Math.max(0,Math.min(c.source.height-1,v*c.source.height-.5))]:undefined;};}
function sample(data:Uint8ClampedArray|Float32Array,at:number,x:number,y:number,get:(x:number,y:number)=>ArrayLike<number>){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;let a=0,r=0,g=0,b=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const p=get(ix+dx,iy+dy),w=(dx?fx:1-fx)*(dy?fy:1-fy)*p[3]!;a+=w;r+=w*p[0]!;g+=w*p[1]!;b+=w*p[2]!;}if(a>1e-8){data[at]=r/a;data[at+1]=g/a;data[at+2]=b/a;data[at+3]=a;}}
export function smartGeometryBitmap(c:SmartContent):Bitmap {const {width,height}=smartSize(c);checkSize(width,height);if(width*height*(depthOf(c.source)===8?4:16)>128*1024*1024)throw Error('网格输出超过连续内存预算，请使用异步分块路径。');const data=pixelArray(width*height*4,c.source),map=mapper(c,width,height),src=c.source,pixels=src.data;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const uv=map(x+.5,y+.5);if(uv)sample(data,(y*width+x)*4,...uv,(sx,sy)=>{const i=(Math.min(src.height-1,sy)*src.width+Math.min(src.width-1,sx))*4;return pixels.subarray(i,i+4);});}return withPixels(width,height,data,src);}
/** Destination tiles and a bounded source-tile LRU, including arbitrary projective/Bezier placement. */
export async function smartGeometryAsync(c:SmartContent,signal?:AbortSignal):Promise<Bitmap>{
 const {width,height}=smartSize(c);checkSize(width,height);const src=c.source,map=mapper(c,width,height),tiles:DiskBlob[]=[],cache=new Map<string,Bitmap>();
 const get=async(x:number,y:number)=>{x=Math.min(src.width-1,x);y=Math.min(src.height-1,y);const left=Math.floor(x/256)*256,top=Math.floor(y/256)*256,key=left+'/'+top;let b=cache.get(key);if(!b){b=await bitmapRegionAsync(src,{x:left,y:top,width:Math.min(256,src.width-left),height:Math.min(256,src.height-top)},signal);if(cache.size>=16)cache.delete(cache.keys().next().value!);}cache.delete(key);cache.set(key,b);const i=((y-top)*b.width+x-left)*4;return b.data.subarray(i,i+4);};
 for(let y=0;y<height;y+=256)for(let x=0;x<width;x+=256){signal?.throwIfAborted();const w=Math.min(256,width-x),h=Math.min(256,height-y),data=pixelArray(w*h*4,src);for(let yy=0;yy<h;yy++){signal?.throwIfAborted();for(let xx=0;xx<w;xx++){const uv=map(x+xx+.5,y+yy+.5);if(!uv)continue;const [sx,sy]=uv,ix=Math.floor(sx),iy=Math.floor(sy),samples=[await get(ix,iy),await get(ix+1,iy),await get(ix,iy+1),await get(ix+1,iy+1)];sample(data,(yy*w+xx)*4,sx,sy,(px,py)=>samples[(py-iy)*2+px-ix]!);}}tiles.push(await diskPager.write(deflate(pixelBytesView(withPixels(w,h,data,src))),signal));await new Promise<void>(r=>setTimeout(r,0));}
 signal?.throwIfAborted();return pagedBitmap(width,height,{kind:'disk',tiles},depthOf(src));
}
