#define MODE 2
#define ENABLED
#define FLAGS 0x5u
#define DOUBLE(x) ((x)*2)
#ifndef QUALITY
#define QUALITY 3
#endif
#ifdef GL_ES
precision highp float;
#endif
#if __VERSION__ < 300 || !GL_FRAGMENT_PRECISION_HIGH
#error unexpected import profile
#endif
#if defined(ENABLED) && DOUBLE(MODE)==4
float selected(){return 0.25;}
#elif MODE==1
float selected(){return 0.5;}
#else
float selected(){return 0.75;}
#endif
#if 0
// Neither unsupported source nor directives in an inactive group are translated.
struct Wrong { samplerCube unsupported; };
#include "missing.glsl"
#define LEAK 1
#undef ENABLED
#error ignored failure
@
#if missing_call(
void mainImage(invalid) {
#else
#endif
#endif
#if !defined(ENABLED) || defined(LEAK)
#error inactive branch changed macro definitions
#endif
#if defined(OPTIONAL) && OPTIONAL>0
#error absent optional feature was enabled
#endif
#if !defined(OPTIONAL) || OPTIONAL/0
#define GREEN 0.5
#else
#error short circuit failed
#endif
#define BLUE 0.0
#if QUALITY>=3
#undef BLUE
#define BLUE 0.75
#endif
void mainImage(out vec4 c,in vec2 p){
  vec3 color=vec3(selected(),GREEN,BLUE);
#if QUALITY>=2
  #if ((FLAGS&1u)!=0u) && ((1<<2)==4) && (~0==-1) && (010==8)
    color.g=0.5;
  #else
    color=vec3(1.0,0.0,0.0);
  #endif
#endif
#ifdef ENABLED
  c=vec4(color,1.0);
#else
  c=vec4(1.0,0.0,0.0,1.0);
#endif
}
