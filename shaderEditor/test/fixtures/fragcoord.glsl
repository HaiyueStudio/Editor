#define res iResolution
vec2 initialUV=gl_FragCoord.xy/res.xy;
vec4 coordinates(){return gl_FragCoord;}
vec3 dof(sampler2D image,vec2 uv,float depth){
  vec4 pixel=coordinates();
  bool valid=distance(initialUV,uv)<0.00001 && distance(pixel.xy/res.xy,uv)<0.00001;
  valid=valid && pixel.z==0.5 && pixel.w==1.0 && gl_FragCoord[3]==1.0;
  valid=valid && abs(fract(pixel.x)-0.5)<0.00001 && abs(fract(pixel.y)-0.5)<0.00001;
  if(!valid){return vec3(0.0,1.0,0.0);}
  return texture(image,uv).rgb*depth;
}
void mainImage(out vec4 fragColor,in vec2 fragCoord)
{
  vec2 uv = gl_FragCoord.xy / res.xy;
  fragColor=vec4(dof(iChannel0,uv,texture(iChannel0,uv).w),1.);
}
