#define FIRST (1-1)
const int SECOND=FIRST+1;
int counter=0;
int fall(int n){
  int value=0;
  switch(n){
    case FIRST:value=1;
    case SECOND:value+=2;if(n==1)break;
    case 2:value+=4;break;
    default:value=8;
  }
  return value;
}
int middle(int n){
  int value=0;
  switch(n){case 0:value=1;default:value+=2;case 2:value+=4;break;case 3:value=8;}
  return value;
}
int alias(int n){
  switch(n){case 0:;case 1:default:return 3;case 2:return 4;}
}
int early(int n,inout int value){
  switch(n){case 0:value+=2;return value++;default:value+=3;return value++;}
}
int share(int n){
  int x=11,result=0;
  switch(n){
    case 0:int x=2,y=x+1;const int K=2;const int add=1;
    case 1:
      // Both direct entry and fallthrough assign before reading shared storage.
      x=4;y=5;x=n==0?x+1:x+2;
      result=x+y;break;
    case K:result=20;break;
    default:break;
  }
  return result+x;
}
int scoped(int n){
  int value=0;
  switch(n){
    case 0:{int x=1;value=x;}break;
    case 1:{int x=2;value=x;}break;
    default:{int x=3;value=x;}break;
  }
  return value;
}
float kill(){discard;return 0.0;}
void mainImage(out vec4 c,in vec2 p){
  int key=p.x<iResolution.x*0.5?0:1;
  bool ok=true;
  for(int i=0;i<4;i++){
    int f=fall(i),m=middle(i),a=alias(i);
    ok=ok && f==(i==0?7:i==1?2:i==2?4:8);
    ok=ok && m==(i==0?7:i==1?6:i==2?4:8);
    ok=ok && a==(i==2?4:3);
  }
  ok=ok && share(0)==21 && share(1)==22 && share(2)==31 && share(3)==11;
  ok=ok && scoped(0)==1 && scoped(1)==2 && scoped(2)==3;
  int old=key,value=10;
  int returned=early(key,value);
  ok=ok && returned==(key==0?12:13) && value==returned+1;
  int selected=0;
  switch(key++){
    case 0:selected=key;break;
    case 1:selected=key*2;break;
    default:selected=99;break;
  }
  ok=ok && key==old+1 && selected==(old==0?1:4);
  switch(counter++){}ok=ok && counter==1;
  switch(99){case 0:counter+=100;break;}ok=ok && counter==1;
  const int LOCAL=SECOND*2;
  switch(LOCAL){case int(2.75):counter++;break;default:counter+=100;}
  const uint MAXIMUM=0u-1u;
  switch(MAXIMUM){case 4294967295u:counter++;break;default:counter+=100;}
  switch(-2){case false?9:-2:counter++;break;default:counter+=100;}
  ok=ok && counter==4;
  int iterations=0,total=0,after=0;
  for(int i=0;i<5;i++){
    switch(i){
      case 0:continue;
      case 1:total+=1;
      case 2:total+=2;break;
      default:total+=4;break;
    }
    after++;iterations++;
  }
  ok=ok && total==13 && after==4 && iterations==4;
  int w=0,wtotal=0;
  while(w<4){w++;switch(w){case 1:continue;case 2:wtotal+=2;break;default:wtotal+=4;}wtotal++;}
  ok=ok && wtotal==13;
  int nested=0;
  switch(old){
    case 0:case 1:
      for(int i=0;i<4;i++){
        if(i==0)continue;
        if(i==2)break;
        nested++;
      }
      switch(old){case 0:nested+=2;break;default:nested+=3;break;}
      nested+=4;break;
    default:break;
  }
  ok=ok && nested==(old==0?7:8);
  // A loop lowered for multiple update statements still handles continue.
  vec2 pair=vec2(0.0);int visits=0;
  for(int i=0,j=0;i<3;pair.xy+=vec2(1.0)){
    i++;switch(i){case 1:continue;default:visits++;break;}
  }
  ok=ok && pair.x==3.0 && pair.y==3.0 && visits==2;
  switch(old){case 0:case 1:break;default:kill();}
  // mainImage early return must output its out parameter, just like helpers.
  switch(old){
    case 0:c=ok?vec4(0.25,0.5,0.75,1.0):vec4(1.0,0.0,0.0,1.0);return;
    default:c=ok?vec4(0.25,0.5,0.75,1.0):vec4(1.0,0.0,0.0,1.0);return;
  }
}
