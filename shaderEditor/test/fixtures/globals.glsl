#define BASE 0.125
const float scale = 2.0;
float seed, base = BASE, chain = base * scale;
int calls;
uint mark = 1u;
bool ready;
vec2 tint = vec2(0.25, 0.5);
float frameValue = float(iFrame), clock = iTime;
float next() { seed += 0.125; calls++; return seed; }
float adjust(float value);
float adjust(int value);
float ordered = next(), adjusted = adjust(base);
void mainImage(out vec4 c, in vec2 p) {
  float base = 0.0;
  float incremented = next();
  ready = true;
  tint.xy = tint.yx;
  if (ready) {
    c = vec4(chain + ordered + incremented + float(calls) * 0.0625 + base,
             tint.x + adjusted + float(mark) * 0.125,
             frameValue * 0.125 + clock,
             1.0);
  }
}
float adjust(float value) { return value; }
float adjust(int value) { return float(value); }
