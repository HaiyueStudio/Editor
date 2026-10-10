float calls=0.;
float nextValue(){calls+=1.;return .2;}
struct Item {vec2 v;};
void mainImage(out vec4 color,in vec2 p){
 int test=int(p.x)%16;float v=0.;
 if(test==0){vec2 q=vec2(20.,0.);if(q.x>13.)q.x=q.x=26.-q.x;v=q.x/10.;}
 if(test==1){vec2 q=vec2(5.,0.);if(q.x>13.)q.x=q.x=26.-q.x;else v=q.x/10.;}
 if(test==2){float a=0.,b=0.,c=0.;a=b=c=nextValue();v=a+b+c+calls*.1;}
 if(test==3){float a[2],b[2];int i=0,j=0;a[i++]=b[j++]=nextValue();v=a[0]+b[0]+float(i+j)*.1;}
 if(test==4){vec2 a=vec2(0.),b=vec2(0.);a.xy=b.yx=vec2(.2,.3);v=a.x+b.x;}
 if(test==5){Item a,b;a.v=b.v=vec2(.1,.2);v=a.v.x+b.v.y;}
 if(test==6){mat2 a=mat2(0.),b=mat2(0.);a=b=mat2(.2);v=a[0][0]+b[1][1];}
 if(test==7){float a[2],b[2];a=b=float[2](.2,.3);v=a[0]+b[1];}
 if(test==8){float a=.1,b=.2;a+=b*=2.;v=a+b;}
 if(test==9){int a=1,b=1;a=b<<=2;v=float(a+b)*.1;}
 if(test==10){float a=0.,b=0.;bool hit=false&&((a=b=nextValue())>.0);v=(hit?.5:.1)+a+b+calls*.1;}
 if(test==11){float a=0.,b=0.;float c=p.x>0.?(a=b=.2):(a=b=nextValue());v=a+b+c+calls*.1;}
 if(test==12){float a=0.,b=0.;for(int i=0;i<2;i++,a=b=b+.2){continue;}v=a+b;}
 if(test==13){float a=0.;float b=(a=.2)+.1;v=a+b;}
 if(test==14){bool a=false,b=false;if(a=b=true)v=.3;}
 if(test==15){float a=0.,b=0.;a=b=.2,b=.3;v=a+b;}
 color=vec4(v,0.,0.,1.);
}
