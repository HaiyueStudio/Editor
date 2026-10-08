precision highp sampler2D;
uniform sampler2D iChannel0, iChannel1, iChannel2, iChannel3;
#define SAMPLE texture2D
vec4 lookup(sampler2D source, vec2 uv);
vec4 lookup(sampler2D source, ivec2 coord) { return texelFetch(source, coord, 0); }
vec4 relay(const in sampler2D first, sampler2D second, vec2 uv) { return (lookup(first,uv)+lookup(second,uv))*0.5; }
vec4 lookup(sampler2D source, vec2 uv) { return (texture(source,uv)+SAMPLE(source,uv)+textureLod(source,uv,0.0))/3.0; }
vec4 shadow(sampler2D iChannel0, vec2 uv) { return texture((iChannel0),uv); }
ivec2 dimensions(sampler2D source) { return textureSize(source,0); }
vec4 initialPixel=lookup(iChannel0,ivec2(0,0));
void mainImage(out vec4 c,in vec2 p) {
  vec2 uv=p/iResolution.xy;
  ivec2 imageSize=dimensions(iChannel0),bufferSize=dimensions(iChannel1);
  bool ok=imageSize.x==2 && imageSize.y==2 && bufferSize.x==int(iResolution.x) && bufferSize.y==int(iResolution.y);
  vec4 lower=lookup(iChannel0,ivec2(0,0)),upper=lookup(iChannel2,ivec2(0,1));
  ok=ok && distance(lower,vec4(0.0,0.0,1.0,1.0))<0.001 && distance(upper,vec4(1.0,0.0,0.0,1.0))<0.001 && distance(initialPixel,lower)<0.001;
  ok=ok && distance(shadow(iChannel1,uv),vec4(0.0,0.5,0.0,1.0))<0.001;
  ok=ok && distance(lookup(iChannel3,uv),vec4(0.25,0.0,0.75,1.0))<0.001;
  int level=0;ivec2 size=textureSize(iChannel0,level++);
  ivec2 coord=ivec2(0);vec4 fetched=texelFetch(iChannel0,coord++,0);
  vec2 once=vec2(0.25);float lod=0.0;vec4 sampled=textureLod(iChannel0,once++,lod++);
  ok=ok && level==1 && size.x==2 && coord.x==1 && coord.y==1 && once.x==1.25 && once.y==1.25 && lod==1.0;
  ok=ok && distance(fetched,lower)<0.001 && distance(sampled,lower)<0.001;
  if(!ok){c=vec4(1.0,0.0,1.0,1.0);return;}
  c=relay(iChannel0,iChannel3,uv);
}
