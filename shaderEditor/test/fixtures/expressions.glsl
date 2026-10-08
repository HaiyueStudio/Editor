#define ADVANCE(x) (++(x))
float counter=0.0, initial=counter++, advanced=++counter;
vec2 globalPair=vec2(0.25,0.5);
float oldValue(float x){return x++;}
float newValue(float x){return ++x;}
void mainImage(out vec4 c,in vec2 p){
  bool ok=initial==0.0 && advanced==2.0 && counter==2.0;
  float f=1.25, old=f++, next=++f;
  --f; f--;
  ok=ok && old==1.25 && next==3.25 && f==1.25;
  int i=0; ++i; i++; --i;
  uint u=2u, before=u--, after=++u;
  ok=ok && i==1 && before==2u && after==2u && u==2u;
  vec2 v=vec2(0.25,0.5), previous=v++, incremented=++v;
  --v; v--;
  ok=ok && previous.x==0.25 && previous.y==0.5 && incremented.x==2.25 && v.x==0.25;
  vec2 swapped=v.yx++;
  ok=ok && swapped.x==0.5 && swapped.y==0.25 && v.x==1.25 && v.y==1.5;
  int index=0;
  float indexed=v[index++]++, scalar=++v.y, mapped=v.yx[1]--;
  ok=ok && index==1 && indexed==1.25 && scalar==2.5 && mapped==2.25 && v.x==1.25;
  vec2 gp=globalPair++;
  ok=ok && gp.x==0.25 && gp.y==0.5 && globalPair.x==1.25;
  float skip=0.0;
  bool unused=false && skip++>0.0, unused2=true || ++skip>0.0;
  ok=ok && skip==0.0;
  float iteration=0.0, sum=0.0;
  while(iteration++<3.0){if(iteration==2.0){continue;} sum+=1.0;}
  ok=ok && iteration==4.0 && sum==2.0;
  for(float a=0.0,b=a+1.0;a<3.0;ADVANCE(a)){if(a==1.0){continue;} sum+=b;}
  for(int step=0;step<2;++step){sum+=1.0;}
  ok=ok && sum==6.0;
  float used=1.25, remainder=mod(used++,2.0);
  vec2 uv=vec2(0.25);
  vec4 sampled=textureLod(iChannel0,uv++,0.0);
  ok=ok && used==2.25 && remainder==1.25 && uv.x==1.25;
  vec2 n=vec2(0.25,0.75), b=floor(n), blend=smoothstep(vec2(0.0),vec2(1.0),fract(n));
  const float low=0.15625, high=1.0-low;
  ok=ok && b.x==0.0 && blend.x==low && blend.y==high;
  ok=ok && oldValue(2.0)==2.0 && newValue(2.0)==3.0;
  float emptyTrips=0.0;;;
  for(;emptyTrips<2.0;++emptyTrips);;
  if(emptyTrips==2.0);else ok=false;
  while(emptyTrips++<3.0);;
  ok=ok && emptyTrips==4.0;
  int noCondition=0;
  for(;;){++noCondition; if(noCondition==2){break;}}
  ok=ok && noCondition==2;
  if(ok){c=vec4(0.25,0.5,0.75,1.0);}else{c=vec4(1.0,0.0,0.0,1.0);}
}
