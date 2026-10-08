#define PICK(c,a,b) ((c)?(a):(b))
const bool FIRST=2<3;
const int COUNT=FIRST ? 3 : 7;
const vec2 CONSTANT=FIRST ? vec2(0.25,0.5) : vec2(0.0);
const mat2 BASIS=FIRST ? mat2(2.0) : mat2(3.0);
float counter=0.0;
float initial=iResolution.x>0.0 ? counter++ : --counter;
float touch(inout float x){return x++;}
float choose(bool flag,inout float x){return flag ? touch(x) : --x;}
void set(out float x,float value){x=value;}
float kill(){discard;return 99.0;}
float identity(float x){return x;}
float identity(int x){return float(x)+10.0;}
float lexical(float v){const float readOnly=2.0;return v>0.0 ? v+readOnly : v-readOnly;}
vec4 sampleChoice(sampler2D tex,vec2 uv,bool yes){return yes ? texture(tex,uv) : texture(tex,vec2(0.0));}
void mainImage(out vec4 c,in vec2 p){
  // Spatially varying conditions exercise both branches on the real GPU.
  bool left=p.x<iResolution.x*0.5;
  bool ok=COUNT==3 && CONSTANT.x==0.25 && BASIS[0][0]==2.0 && initial==0.0 && counter==1.0;
  float a=2.0,b=8.0;
  float old=left ? a++ : ++b;
  ok=ok && (left ? a==3.0 && b==8.0 && old==2.0 : a==2.0 && b==9.0 && old==9.0);
  int conditionCalls=0;
  float selected=conditionCalls++==0 ? float(conditionCalls) : float(conditionCalls++);
  ok=ok && conditionCalls==1 && selected==1.0;
  float value=5.0,result=left ? choose(true,value) : choose(false,value);
  ok=ok && (left ? result==5.0 && value==6.0 : result==4.0 && value==4.0);
  (left ? (set(value,2.0)) : (set(value,3.0)));
  ok=ok && value==(left ? 2.0 : 3.0);
  float nested=left ? false ? 1.0 : 2.0 : true ? 3.0 : 4.0;
  float precedence=1+2*3==7 && 2<3 ? 9.0 : 0.0;
  ok=ok && nested==(left?2.0:3.0) && precedence==9.0;
  float grouped=(left ? 2.0 : 3.0)*2.0;
  ok=ok && grouped==(left?4.0:6.0);
  float lexicalValue=lexical(left?1.0:-1.0);
  ok=ok && lexicalValue==(left?3.0:-3.0);
  vec4 v=vec4(1.0,2.0,3.0,4.0);float x=5.0,scale=7.0;
  float names=left ? v.x+x+float(2) : v.y+scale+1.e-2;
  ok=ok && abs(names-(left?8.0:9.01))<0.0001;
  float e=99.0;float scientific=left?1.e-2:2.e-2;ok=ok && scientific>0.0 && scientific<1.0;
  int index=0;float indexed=left ? v.yx[index++]++ : v[index++]++;
  ok=ok && index==1 && (left?indexed==2.0 && v.y==3.0:indexed==1.0 && v.x==2.0);
  v[left?1:2]+=1.0;ok=ok && (left?v.y==4.0:v.z==4.0);
  mat2 matrixValue=left?BASIS:mat2(3.0);
  float cell=left?matrixValue[0][0]++:++matrixValue[1][1];
  ok=ok && cell==(left?2.0:4.0);
  uint bits=left?2u:3u;int integer=left?2:3;
  ok=ok && bits==(left?2u:3u) && identity(integer)==(left?12.0:13.0);
  const float localConst=left ? 0.25 : 0.5;
  ok=ok && PICK(left,localConst==0.25,localConst==0.5);
  float skip=0.0;
  bool unused=false && (left?skip++>0.0:++skip>0.0),unused2=true || (left?skip++>0.0:++skip>0.0);
  ok=ok && skip==0.0;
  float guarded=left ? (left?1.0:kill()) : (left?kill():1.0);ok=ok && guarded==1.0;
  int step=0,trips=0;
  while(left ? step++<2 : step++<3){trips++;}
  ok=ok && (left ? step==3 && trips==2 : step==4 && trips==3);
  int visits=0;
  for(int i=0;left?i<2:i<3;left?i++:++i){if(i==1){continue;}visits++;}
  ok=ok && visits==(left?1:2);
  vec4 sampled=sampleChoice(iChannel0,p/iResolution.xy,left);
  ok=ok && sampled.a==1.0;
  c=ok ? vec4(0.25,0.5,0.75,1.0) : vec4(1.0,0.0,0.0,1.0);
}
