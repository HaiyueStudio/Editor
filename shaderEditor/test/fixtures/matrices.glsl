#define TURN mat2(0.0, 1.0, -1.0, 0.0)
const mat2 unit = mat2(1.0), turn = TURN, unturn = inverse(TURN);
const mat3 extended = mat3(turn);
const mat2 ones = mat2(1.0) + 1.0;
mat2 animated = mat2(cos(iTime), sin(iTime), -sin(iTime), cos(iTime));
mat2 mutableGlobal = mat2(1.0);
float trace(mat2 m) { return m[0][0] + m[1][1]; }
float trace(mat3 m) { return m[0][0] + m[1][1] + m[2][2]; }
bool close(vec2 a, vec2 b) { return distance(a,b) < 0.0001; }
bool close(vec3 a, vec3 b) { return distance(a,b) < 0.0001; }
bool close(vec4 a, vec4 b) { return distance(a,b) < 0.0001; }
mat2 rotation(float a) { float s=sin(a), c=cos(a); return mat2(c,s,-s,c); }
void mainImage(out vec4 c, in vec2 p) {
  bool ok=unit[0][0]==1.0 && unit[0][1]==0.0 && extended[2][2]==1.0 && extended[2][0]==0.0;
  mat2 diagonal=mat2(2), mixed=mat2(vec3(1.0,2.0,3.0),4.0), truncated=mat2(vec3(1.0,2.0,3.0),vec2(4.0,99.0));
  mat2 integerParts=mat2(ivec2(1,2),uvec2(3u,4u));
  mat4 big=mat4(diagonal);
  ok=ok && diagonal[0][1]==0.0 && big[2][2]==1.0 && big[3][3]==1.0 && big[0][0]==2.0;
  ok=ok && mixed==truncated && mixed==integerParts && trace(unit)==2.0 && trace(extended)==1.0;
  ok=ok && close(vec4(mixed),vec4(1.0,2.0,3.0,4.0)) && float(mixed)==1.0 && int(mixed)==1 && bool(mixed);
  ok=ok && ones[0][0]==2.0 && ones[0][1]==1.0;
  if(!ok){c=vec4(0.1,0.0,0.0,1.0);return;}
  mat2 a=mat2(1.0,2.0,3.0,4.0), b=mat2(2.0,0.0,1.0,3.0), product=a*b;
  vec2 left=a*vec2(1.0,2.0), right=vec2(1.0,2.0)*a;
  ok=close(left,vec2(7.0,10.0)) && close(right,vec2(5.0,11.0)) && product==mat2(2.0,4.0,10.0,14.0);
  vec2 uv=vec2(1.0,0.0); uv*=turn;
  vec3 swizzle=vec3(0.0,1.0,0.5);swizzle.yx*=turn;
  ok=ok && close(uv,vec2(0.0,-1.0)) && close(swizzle,vec3(-1.0,0.0,0.5));
  ok=ok && close(turn*vec2(1.0,0.0),vec2(0.0,1.0)) && close(rotation(0.5)*rotation(-0.5)*vec2(1.0,2.0),vec2(1.0,2.0));
  mat2 scaled=2.0*a/2.0, divided=a/a, shifted=a+2.0, subtracted=2.0-a, reciprocal=2.0/a;
  scaled*=b; scaled/=2.0; scaled+=1.0; scaled-=1.0;
  ok=ok && scaled==product/2.0 && divided==mat2(vec2(1.0),vec2(1.0)) && shifted[1][0]==5.0 && subtracted[1][1]==-2.0 && reciprocal[0][1]==1.0;
  ok=ok && (-a)[0][1]==-2.0 && (+a)==a && a!=b;
  if(!ok){c=vec4(0.2,0.0,0.0,1.0);return;}
  mat2x3 tall=mat2x3(1.0,2.0,3.0,4.0,5.0,6.0);
  mat3x2 wide=mat3x2(vec2(1.0,0.0),vec2(0.0,1.0),vec2(1.0,1.0)), transposed=transpose(tall);
  mat3 square=tall*wide;mat2 small=wide*tall;
  mat4x2 resized=mat4x2(tall);
  ok=close(tall*vec2(1.0,2.0),vec3(9.0,12.0,15.0)) && close(vec3(1.0,2.0,3.0)*tall,vec2(14.0,32.0));
  ok=ok && close(square[2],vec3(5.0,7.0,9.0)) && small==mat2(4.0,5.0,10.0,11.0) && close(transposed[2],vec2(3.0,6.0));
  ok=ok && resized[0][1]==2.0 && resized[1][1]==5.0 && resized[2][0]==0.0;
  mat2x3 outer=outerProduct(vec3(1.0,2.0,3.0),vec2(4.0,5.0));
  ok=ok && close(outer[1],vec3(5.0,10.0,15.0)) && matrixCompMult(a,a)==mat2(1.0,4.0,9.0,16.0);
  if(!ok){c=vec4(0.3,0.0,0.0,1.0);return;}
  mat3 invert3=mat3(2.0,0.0,0.0,1.0,3.0,0.0,4.0,5.0,4.0);
  mat4 invert4=mat4(2.0,0.0,0.0,0.0,1.0,3.0,0.0,0.0,4.0,5.0,4.0,0.0,6.0,7.0,8.0,1.0);
  mat2 identity2=a*inverse(a);mat3 identity3=inverse(invert3)*invert3;mat4 identity4=invert4*inverse(invert4);
  ok=determinant(a)==-2.0 && determinant(invert3)==24.0 && determinant(invert4)==24.0 && unturn*turn==unit;
  ok=ok && close(identity2[0],vec2(1.0,0.0)) && close(identity2[1],vec2(0.0,1.0));
  ok=ok && close(identity3[0],vec3(1.0,0.0,0.0)) && close(identity3[1],vec3(0.0,1.0,0.0)) && close(identity3[2],vec3(0.0,0.0,1.0));
  ok=ok && close(identity4[0],vec4(1.0,0.0,0.0,0.0)) && close(identity4[1],vec4(0.0,1.0,0.0,0.0)) && close(identity4[2],vec4(0.0,0.0,1.0,0.0)) && close(identity4[3],vec4(0.0,0.0,0.0,1.0));
  ok=ok && abs(determinant(animated)-1.0)<0.0001;
  if(!ok){c=vec4(0.4,0.0,0.0,1.0);return;}
  int column=0,row=0;
  mat2 changed=mat2(1.0), original=changed++, next=++changed;
  --changed;changed--;
  ok=original==unit && next[0][0]==3.0 && next[0][1]==2.0 && changed==unit;
  float previous=changed[column++][row++]++;
  ok=ok && column==1 && row==1 && previous==1.0 && changed[0][0]==2.0;
  column=0;row=1; changed[column++][row++]+=3.0;
  ok=ok && column==1 && row==2 && changed[0][1]==3.0;
  column=1;changed[column++].yx=vec2(4.0,5.0);
  ok=ok && column==2 && changed[1][0]==5.0 && changed[1][1]==4.0;
  column=0;vec2 oldColumn=changed[column++]++;
  ok=ok && column==1 && close(oldColumn,vec2(2.0,3.0)) && close(changed[0],vec2(3.0,4.0));
  column=1;row=0;float swizzled=++changed[column++].yx[row++];
  ok=ok && column==2 && row==1 && swizzled==5.0 && changed[1][1]==5.0;
  mutableGlobal[0][1]=2.0;mutableGlobal*=turn;mutableGlobal[1].xy++;
  ok=ok && mutableGlobal[0][1]==1.0 && mutableGlobal[1][0]==0.0 && mutableGlobal[1][1]==-1.0;
  float once=2.0;mat2 constructedOnce=mat2(once++);
  ok=ok && once==3.0 && constructedOnce[0][0]==2.0 && constructedOnce[1][1]==2.0;
  column=0;row=0;bool skip=false && ++changed[column++][row++]>0.0;
  ok=ok && column==0 && row==0;
  if(!ok){c=vec4(0.5,0.0,0.0,1.0);return;}
  c=vec4(0.25,0.5,0.75,1.0);
}
