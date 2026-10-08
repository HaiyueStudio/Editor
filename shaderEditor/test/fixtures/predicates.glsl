#define BAD(x) isnan(x)
const bool ZERO_OK=!isnan(0.0) && !isinf(0.0);
const bvec2 CONSTANT_FLAGS=isnan(vec2(0.0,1.0));
bool initial=isnan(iTime);
int calls=0;
float once(float value){calls++;return value;}
float change(inout float value){return value++;}
bool accepts(bool value){return value;}
bool accepts(bvec2 value){return any(value);}
void invert(inout bvec2 value){value=not(value);}
bvec3 classify(vec3 value){return isnan(value);}
bool checkSpecial(float n,float inf,float negativeInf){
  bool ok=isnan(n) && !isinf(n) && !isnan(inf) && !isnan(negativeInf);
  ok=ok && isinf(inf) && isinf(negativeInf);
  vec4 values=vec4(n,inf,negativeInf,0.0);
  bvec4 nanFlags=isnan(values),infFlags=isinf(values);
  ok=ok && nanFlags.x && !nanFlags.y && !nanFlags.z && !nanFlags.w;
  ok=ok && !infFlags.x && infFlags.y && infFlags.z && !infFlags.w;
  ok=ok && any(nanFlags) && !all(nanFlags) && any(infFlags) && !all(infFlags);
  ok=ok && all(not(isnan(vec3(inf,negativeInf,0.0))));
  bvec2 shortFlags=nanFlags.xy;invert(shortFlags);
  ok=ok && !shortFlags.x && shortFlags.y && accepts(shortFlags);
  return ok;
}
void mainImage(out vec4 c,in vec2 p){
  bool ok=ZERO_OK && !any(CONSTANT_FLAGS) && !initial;
  float value=p.x/iResolution.x;
  ok=ok && !BAD(value) && !isinf(value) && !isnan(-0.0);
  bvec2 flags=isnan(vec2(value,-value));
  ok=ok && !any(flags) && all(not(flags));
  flags.xy=not(flags.yx);ok=ok && flags.x && flags[1];
  invert(flags);ok=ok && !any(flags);
  bvec3 flags3=classify(vec3(value,0.0,-1.0));
  bvec4 flags4=isinf(vec4(value,3.402823466e38,-3.402823466e38,-0.0));
  ok=ok && !any(flags3) && !any(flags4);
  bvec2 selected=value<0.5?bvec2(true,false):bvec2(false,true);
  ok=ok && accepts(selected) && accepts(selected.x || selected.y);
  ok=ok && selected.x==(value<0.5) && selected.y==(value>=0.5);
  float v=2.0;
  bool n=isnan(v++),i=isinf(change(v));
  ok=ok && !n && !i && v==4.0;
  bool checked=isnan(once(value));ok=ok && !checked && calls==1;
  bool skipped=false && isnan(once(value));ok=ok && !skipped && calls==1;
  bvec4 constructed=bvec4(selected,bvec2(false,true));
  vec4 colors=vec4(constructed);ok=ok && colors.z==0.0 && colors.w==1.0;
  c=ok?vec4(0.25,0.5,0.75,1.0):vec4(1.0,0.0,0.0,1.0);
}
