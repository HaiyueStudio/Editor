#define COLOR vec3(.2)
#define SET_BOTH c = COLOR, sp = 3.
struct Hit { int id; };
float trace = 0.0;
void mark(float x) { trace = trace * 10.0 + x; }
void add(inout float ref, float amount) { ref += amount; }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  Hit h = Hit(fragCoord.x < iResolution.x * .5 ? 2 : 1);
  vec3 c = vec3(.1);
  float sp = 1.;
  if (h.id == 2)
    c = vec3(.2), sp = 3.;
  bool good = h.id == 2 ? c.x == .2 && sp == 3. : c.x == .1 && sp == 1.;
  if (h.id == 2)
    c = vec3(.4), sp = 5.;
  else
    c = vec3(.6), sp = 7.;
  good = good && (h.id == 2 ? c.x == .4 && sp == 5. : c.x == .6 && sp == 7.);
  c = vec3(.1), sp = 1.;
  if (h.id == 2)
    if (fragCoord.y < iResolution.y * .5)
      c = vec3(.4), sp = 5.;
    else
      c = vec3(.6), sp = 7.;
  good = good && (h.id != 2 ? c.x == .1 && sp == 1. :
    fragCoord.y < iResolution.y * .5 ? c.x == .4 && sp == 5. : c.x == .6 && sp == 7.);
  if (h.id == 2) SET_BOTH;
  good = good && (h.id != 2 || (c.x == .2 && sp == 3.));
  mark(1.0), mark(2.0), mark(3.0);
  true ? mark(4.0) : mark(8.0), mark(5.0);
  good = good && trace == 12345.0;
  float count = 0.0;
  add(count, 1.0), add(count, 2.0), sp = count;
  good = good && count == 3.0 && sp == 3.0;
  vec3 v = vec3(1.0, 2.0, 3.0);
  int index = 0;
  v.xy = v.yx, v[index++] += 3.0, ++v.z;
  good = good && v.x == 5.0 && v.y == 1.0 && v.z == 4.0 && index == 1;
  mat2 m = mat2(1.0);
  m[0][1] = 2.0, m[0][1]++, m *= 2.0;
  good = good && m[0][1] == 6.0;
  h = Hit(2), h.id <<= 1, h.id |= 1;
  good = good && h.id == 5;
  int i = 99, j = 99, total = 0, visits = 0;
  for (i = 0, j = 6; i < 3; i++, j -= 2, total += i) {
    if (i == 1) continue;
    visits++;
  }
  good = good && i == 3 && j == 0 && total == 6 && visits == 2;
  for (int a = 0, b = 3; a < 3; a++, b--) {
    good = good && a + b == 3;
  }
  for (i = 0, j = 0; i < 2; i++) j += i;
  good = good && i == 2 && j == 1;
  i = 0, total = 0;
  while (i < 3) i++, total += i;
  good = good && i == 3 && total == 6;
  switch (int(fragCoord.x) & 1) {
    case 0: sp = 2.0, c = vec3(sp); break;
    default: sp = 4.0, c = vec3(sp); break;
  }
  good = good && c.x == sp;
  fragColor = good ? vec4(.25, .5, .75, 1.0) : vec4(1.0, 0.0, 0.0, 1.0);
}
