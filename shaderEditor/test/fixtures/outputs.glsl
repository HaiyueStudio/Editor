// A known color is produced only when copy-in/copy-out and evaluation order agree.
float globalValue=3.0;
vec2 globalPair=vec2(4.0,5.0);
float bump(inout float);
float initialized=bump(globalValue);
float bump(inout float value){return value++;}
void fill(out float value){value=7.0;}
void fill(out vec2 value){value=vec2(8.0,9.0);}
void early(out float result,inout float value){result=2.0;value+=1.0;if(value>0.0){return;}result=99.0;}
bool copies(inout float a,inout float b){a+=1.0;bool independent=b==2.0;b+=2.0;return independent;}
float globalAlias(inout float localCopy){localCopy+=1.0;float original=globalValue;globalValue=99.0;return original;}
float observe(inout float value,float later){return value*10.0+later;}
void pair(out float a,out float b){a=20.0;b=30.0;}
void column(inout vec2 v){v+=vec2(2.0,3.0);}
void matrixChange(inout mat2 value,out mat2 result){value*=2.0;result=value;}
void flags(out bool value,inout uint bits,inout int number){value=true;bits+=1u;number+=2;}
float nested(inout float value,out float old){old=bump(value);return bump(value);}
void shadow(out float value){value=6.0;{float value=99.0;return;}}
void renamed(out float prototypeName);
void renamed(out float definedName){definedName=12.0;}
void unnamed(inout float){return;}
bool advance(inout int value){value++;return value<3;}
void paint(sampler2D tex,vec2 uv,out vec4 result){result=texture(tex,uv);}
void mainImage(out vec4 c,in vec2 p){
  bool ok=initialized==3.0 && globalValue==4.0;
  float value=100.0;fill(value);ok=ok && value==7.0;
  float result;early(result,value);ok=ok && result==2.0 && value==8.0;
  value=2.0;bool independent=copies(value,value);ok=ok && independent && value==4.0;
  float original=globalAlias(globalValue);ok=ok && original==4.0 && globalValue==5.0;
  float captured=observe(value,value++);ok=ok && captured==44.0 && value==4.0;
  vec2 v=vec2(1.0,2.0);int i=0;
  float indexed=observe(v[i++],v[0]++);ok=ok && i==1 && indexed==11.0 && v.x==1.0;
  pair(v[i++],v[0]);ok=ok && i==2 && v.x==30.0 && v.y==20.0;
  fill(v.yx);ok=ok && v.x==9.0 && v.y==8.0;
  column(v.yx);ok=ok && v.x==12.0 && v.y==10.0;
  mat2 m=mat2(1.0);int col=0,row=1;
  fill(m[col++][row--]);ok=ok && col==1 && row==0 && m[0][1]==7.0;
  column(m[col--].yx);ok=ok && col==0 && m[1][0]==3.0 && m[1][1]==3.0;
  float cell=bump(m[col++].yx[row++]);ok=ok && col==1 && row==1 && cell==7.0 && m[0][1]==8.0;
  mat2 scaled;matrixChange(m,scaled);ok=ok && m[0][1]==16.0 && scaled[1][0]==6.0;
  i=0;float globalOld=bump(globalPair[i++]);ok=ok && i==1 && globalOld==4.0 && globalPair.x==5.0;
  value=1.0;float old;float next=nested(value,old);ok=ok && value==3.0 && old==1.0 && next==2.0;
  shadow(value);ok=ok && value==6.0;renamed(value);ok=ok && value==12.0;unnamed(value);ok=ok && value==12.0;
  bool flag=false;uint bits=2u;int number=3;flags(flag,bits,number);ok=ok && flag && bits==3u && number==5;
  float skipped=1.0;bool a=false && bump(skipped)>0.0,b=true || bump(skipped)>0.0;ok=ok && skipped==1.0;
  int trips=0,sum=0;while(advance(trips)){sum++;}ok=ok && trips==3 && sum==2;
  for(int step=0;step<3;advance(step)){if(step==1){continue;}sum++;}ok=ok && sum==4;
  vec4 sampled;paint(iChannel0,p/iResolution.xy,sampled);ok=ok && sampled.a==1.0;
  if(ok){c=vec4(0.25,0.5,0.75,1.0);}else{c=vec4(1.0,0.0,0.0,1.0);}
}
