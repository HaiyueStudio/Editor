import { checkSize, type Bitmap } from './document.js';
import { pixelArray, withPixels } from './pixelFormat.js';
import { mapCmykGeometry } from './cmykGeometry.js';
/** Four corners in clockwise or counter-clockwise order; reject folded/degenerate mappings. */
export function validateQuad(q:readonly number[]){
 if(!Array.isArray(q)||q.length!==8||q.some(v=>!Number.isFinite(v)||Math.abs(v)>32768))throw Error('透视四边形坐标无效。');
 let sign=0;for(let i=0;i<4;i++){const j=(i+1)%4,k=(i+2)%4,c=(q[j*2]!-q[i*2]!)*(q[k*2+1]!-q[j*2+1]!)-(q[j*2+1]!-q[i*2+1]!)*(q[k*2]!-q[j*2]!);if(Math.abs(c)<1e-6||sign&&Math.sign(c)!==sign)throw Error('透视四边形不能折叠或退化。');sign=Math.sign(c);}
}
function inverseMap(q:readonly number[]){
 const uv=[[0,0],[1,0],[1,1],[0,1]],a:number[][]=[];
 for(let i=0;i<4;i++){const x=q[i*2]!,y=q[i*2+1]!,[u,v]=uv[i]!;a.push([x,y,1,0,0,0,-u!*x,-u!*y,u!],[0,0,0,x,y,1,-v!*x,-v!*y,v!]);}
 for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(a[r]![c]!)>Math.abs(a[p]![c]!))p=r;[a[p],a[c]]=[a[c]!,a[p]!];const d=a[c]![c]!;if(Math.abs(d)<1e-12)throw Error('透视矩阵不可逆。');for(let j=c;j<9;j++)a[c]![j]!/=d;for(let r=0;r<8;r++)if(r!==c){const f=a[r]![c]!;for(let j=c;j<9;j++)a[r]![j]!-=f*a[c]![j]!;}}
 return a.map(r=>r[8]!);
}
/** Inverse homography with bilinear associated-alpha sampling; source precision is retained. */
export function projectiveBitmap(source:Bitmap,width:number,height:number,quad:readonly number[]):Bitmap {
 checkSize(width,height);validateQuad(quad);if(source.cmyk)return mapCmykGeometry(source,b=>projectiveBitmap(b,width,height,quad));
 const m=inverseMap(quad),data=pixelArray(width*height*4,source),pixels=source.data;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const px=x+.5,py=y+.5,z=m[6]!*px+m[7]!*py+1,u=(m[0]!*px+m[1]!*py+m[2]!)/z,v=(m[3]!*px+m[4]!*py+m[5]!)/z;if(!Number.isFinite(u+v)||u<0||v<0||u>1||v>1)continue;const sx=Math.max(0,Math.min(source.width-1,u*source.width-.5)),sy=Math.max(0,Math.min(source.height-1,v*source.height-.5)),ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;let alpha=0,r=0,g=0,b=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=(Math.min(source.height-1,iy+dy)*source.width+Math.min(source.width-1,ix+dx))*4,w=(dx?fx:1-fx)*(dy?fy:1-fy)*pixels[i+3]!;alpha+=w;r+=pixels[i]!*w;g+=pixels[i+1]!*w;b+=pixels[i+2]!*w;}
  const i=(y*width+x)*4;if(alpha){data[i]=r/alpha;data[i+1]=g/alpha;data[i+2]=b/alpha;data[i+3]=alpha;}
 }return withPixels(width,height,data,source);
}

/** Map a source unit-square point through a convex destination quad. */
export function mapQuadPoint(q:readonly number[],u:number,v:number):[number,number] {
 const dx1=q[2]!-q[4]!,dx2=q[6]!-q[4]!,dy1=q[3]!-q[5]!,dy2=q[7]!-q[5]!,sx=q[0]!-q[2]!+q[4]!-q[6]!,sy=q[1]!-q[3]!+q[5]!-q[7]!,den=dx1*dy2-dx2*dy1;
 const g=(sx*dy2-dx2*sy)/den,h=(dx1*sy-sx*dy1)/den,z=g*u+h*v+1;
 return [((q[2]!-q[0]!+g*q[2]!)*u+(q[6]!-q[0]!+h*q[6]!)*v+q[0]!)/z,((q[3]!-q[1]!+g*q[3]!)*u+(q[7]!-q[1]!+h*q[7]!)*v+q[1]!)/z];
}
export function quadCoordinates(q:readonly number[],x:number,y:number):[number,number] {
 const m=inverseMap(q),z=m[6]!*x+m[7]!*y+1;return [(m[0]!*x+m[1]!*y+m[2]!)/z,(m[3]!*x+m[4]!*y+m[5]!)/z];
}
