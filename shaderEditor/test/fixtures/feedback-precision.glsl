// A data texel like a reprojection camera: small coefficients and large translations.
// These values cannot survive an RGBA16F round-trip within the required tolerance.
const vec4 CAMERA = vec4(0.99978307, 0.02082881, 2000.1234, -401.53784);
bool accurate(vec4 value) {
  return abs(value.x-CAMERA.x)<0.000001 && abs(value.y-CAMERA.y)<0.000001
      && abs(value.z-CAMERA.z)<0.00025 && abs(value.w-CAMERA.w)<0.0001;
}
void mainImage(out vec4 fragColor,in vec2 fragCoord) {
  ivec2 pixel=ivec2(fragCoord);
  if(pixel.x==0 && pixel.y==0) { fragColor=CAMERA; return; }
  vec3 color=(pixel.x&1)==0?vec3(.25,.5,.75):vec3(.75,.5,.25);
  if(iFrame>0) {
    vec4 camera=texelFetch(iChannel0,ivec2(0,0),0);
    vec3 history=textureLod(iChannel0,fragCoord/iResolution.xy,0.0).xyz;
    color=mix(history,color,0.1);
    if(!accurate(camera)) color=vec3(1.0,0.0,0.0);
  }
  fragColor=vec4(color,1.0);
}
