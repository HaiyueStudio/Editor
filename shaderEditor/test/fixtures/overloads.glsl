#define PICK(x) shade(x)

float shade(float);
vec2 shade(vec2);
float shade(float, float);
float shade(int);
float shade(uint);
float shade(bool);
float shade(void);

void mainImage(out vec4 c, in vec2 p) {
  vec2 v = PICK(vec2(0.5, 1.0));
  float r = PICK(1);
  float g = PICK(1.0);
  float b = PICK(1u);
  c = vec4((r + v.x) * 0.5, (g + v.y) * 0.5, shade(b, shade(false)), shade());
}

float shade(float x) { x *= 0.5; return x; }
vec2 shade(vec2 x) { return vec2(shade(x.x), shade(x.y)); }
float shade(float x, float y) { return x + y; }
float shade(int x) { return float(x) * 0.25; }
float shade(uint x) { return float(x) * 0.75; }
float shade(bool x) { if (x) { return 1.0; } return 0.0; }
float shade(void) { return 1.0; }
