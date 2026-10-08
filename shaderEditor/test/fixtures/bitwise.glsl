#define BIT(n) (1<<(n))
const int SIGN=BIT(31);
const uint ALL=~0u;
int kind(int x){return 1;}
int kind(uint x){return 2;}
int writes=0;
int once(){writes++;return 16;}
void mainImage(out vec4 c,in vec2 p){
  bool ok=true;
  for(int sh=0;sh<16;sh++){
    // The exact expression from the reported Shadertoy shader.
    vec2 o2=vec2((5493>>sh)&3,(10903>>sh)&3)*1.0-2.0;
    vec2 expected=mod(floor(vec2(5493.0,10903.0)/exp2(float(sh))),4.0)-2.0;
    ok=ok && distance(o2,expected)<0.0001;
  }
  int spatial=int(p.x/iResolution.x*14.0);
  int packed=(5493>>spatial)&3;
  float reference=mod(floor(5493.0/exp2(float(spatial))),4.0);
  ok=ok && float(packed)==reference;
  int negative=-16,count=2;
  uint high=2147483648u,ucount=2u;
  ok=ok && negative>>count==-4 && high>>count==536870912u;
  ok=ok && kind(1<<ucount)==1 && kind(high>>count)==2;
  int a=1,b=2,d=3;
  ok=ok && (a|b^d&a+1<<b*2)==3 && (16>>a>>b)==2;
  ok=ok && SIGN==-2147483647-1 && ALL==4294967295u;
  int signCount=31;ok=ok && (1<<signCount)==SIGN && (high>>signCount)==1u;
  int wrapped=(1<<31)>>31;ok=ok && wrapped==-1;
  switch(10){case BIT(3)|2:break;default:ok=false;}
  switch(SIGN){case 1<<31:break;default:ok=false;}
  ivec2 values=ivec2(-8,12),steps=ivec2(1,2);
  ivec2 r=values>>steps,s=values>>count,t=3|values,inv=~values;
  uvec2 unsignedValues=uvec2(8u,16u),u=unsignedValues<<steps;
  ok=ok && r.x==-4 && r.y==3 && s.x==-2 && s.y==3;
  ok=ok && t.x==-5 && t.y==15 && inv.x==7 && inv.y==-13 && u.x==16u && u.y==64u;
  int masks=13;ok=ok && (masks&7)==5 && (masks^7)==10 && (masks|2)==15;
  int source=16,shiftCount=0;
  int shifted=source++>>++shiftCount;
  ok=ok && shifted==8 && source==17 && shiftCount==1;
  int called=once()>>shiftCount++;ok=ok && writes==1 && called==8 && shiftCount==2;
  ivec2 v=ivec2(16,32);int index=0,amount=1;
  v[index++]>>=amount++;v.yx>>=ivec2(1,2);
  ok=ok && index==1 && amount==2 && v.x==2 && v.y==16;
  int mask=3;mask&=1;mask^=2;mask|=4;mask<<=2;mask>>=1;
  ok=ok && mask==14;
  uint umask=ALL;umask>>=31;umask<<=4;umask|=3u;umask^=2u;umask&=31u;
  ok=ok && umask==17u;
  int sum=0;for(int i=1;i<16;i<<=1){if(i==4)continue;sum+=i;}ok=ok && sum==11;
  ivec2 casted=ivec2(vec2(1.9,2.9));
  vec3 mixed=vec3(casted,mask);vec2 truncated=vec2(ivec3(3,4,5));
  ok=ok && mixed.x==1.0 && mixed.y==2.0 && mixed.z==14.0 && truncated.x==3.0 && truncated.y==4.0;
  int lazy=0;int selected=spatial>=0?(1<<lazy++):(1<<lazy++);
  ok=ok && selected==1 && lazy==1;
  c=ok?vec4(0.25,0.5,0.75,1.0):vec4(1.0,0.0,0.0,1.0);
}
