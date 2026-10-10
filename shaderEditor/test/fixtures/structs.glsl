#define MAT Material
#define MEMBER ref
struct Material { vec3 color; float ref; bool active; };
struct Hit { Material material; mat2 basis; vec2 uv, st; float weight; int index; };
const float ref = 0.25;
const Material BASE = Material(vec3(0.25, 0.5, 0.75), 1.0, true);
const Material SELECTED = (1 < 2) ? BASE : Material(vec3(0.0), 2.0, false);
const Hit SELECTED_HIT = (2 > 1) ? Hit(BASE, mat2(1.0), vec2(0.0), vec2(0.0), 0.0, 0)
                                : Hit(BASE, mat2(2.0), vec2(1.0), vec2(1.0), 1.0, 1);
const bool SAME = SELECTED_HIT == SELECTED_HIT;
int calls = 0;
Material make(float ref) { return Material(BASE.color, ref, true); }
float measure(Material ref) { ref.ref += 1.0; return ref.ref; }
float measure(float ref) { return ref + 1.0; }
float original() { return ref; }
float fn(float let, const float override) { return let + override; }
Material marked(float ref) { calls++; return make(ref); }
Hit shared = Hit(make(1.0), mat2(1.0), vec2(0.0), vec2(0.0), 0.0, 0);
void paint(inout Material ref, out vec2 target) { ref.ref += 2.0; target = vec2(2.0, 3.0); }
void pair(out float ref, out float let) { ref = 4.0; let = 5.0; }
void adjust(inout float ref) { ref += 1.0; }
void whole(out Hit ref) { ref = SELECTED_HIT; ref.material.ref = 7.0; }
Material revise(inout Hit ref, out Material result) {
  ref.weight += 1.0; result = make(8.0); return ref.material;
}
void mainImage(out vec4 ref, in vec2 var) {
  bool good = SAME && SELECTED.ref == 1.0 && SELECTED.active;
  good = good && original() == 0.25 && fn(0.25, 0.5) == 0.75;
  MAT filter = BASE;
  good = good && measure(filter) == 2.0 && measure(1.0) == 2.0 && filter.MEMBER == 1.0;
  Hit hit = shared, copy = hit;
  hit.material.color.rg = vec2(0.5, 0.25);
  good = good && hit.material.color.r == 0.5 && copy.material.color.r == 0.25;
  hit.material.color.rg = hit.material.color.gr;
  good = good && hit.material.color.r == 0.25 && hit.material.color.g == 0.5;
  hit.uv = vec2(1.0, 2.0); hit.st = vec2(3.0, 4.0);
  float first = hit.uv.x++, second = ++hit.st.x;
  good = good && first == 1.0 && second == 4.0 && hit.uv.x == 2.0 && hit.st.x == 4.0;
  int index = 0;
  hit.uv[index++]++;
  good = good && index == 1 && hit.uv.x == 3.0;
  hit.basis[0][1] += 2.0;
  good = good && hit.basis[0][1] == 2.0;
  pair(hit.material.ref, hit.weight);
  good = good && hit.material.ref == 4.0 && hit.weight == 5.0;
  paint(hit.material, hit.uv.yx);
  good = good && hit.material.ref == 6.0 && hit.uv.x == 3.0 && hit.uv.y == 2.0;
  index = 0;
  adjust(hit.basis[index++][1]);
  good = good && index == 1 && hit.basis[0][1] == 3.0;
  Material outputValue;
  Material returned = revise(hit, outputValue);
  good = good && hit.weight == 6.0 && outputValue.ref == 8.0 && returned.ref == 6.0;
  whole(copy);
  good = good && copy.material.ref == 7.0 && copy.basis[0][1] == 0.0;
  pair(shared.material.ref, shared.weight);
  good = good && shared.material.ref == 4.0 && shared.weight == 5.0;
  Material choice = var.x < iResolution.x * 0.5 ? marked(2.0) : marked(3.0);
  good = good && calls == 1 && choice.ref == (var.x < iResolution.x * 0.5 ? 2.0 : 3.0);
  calls = 0;
  good = good && marked(1.0) == marked(1.0) && calls == 2;
  good = good && make(1.0) != make(2.0);
  {
    struct Material { float ref; };
    Material ref = Material(9.0);
    ref.ref++;
    good = good && ref.ref == 10.0;
  }
  Material afterScope = BASE;
  good = good && afterScope.active;
  {
    struct type { float ref, let; } value;
    value.ref = 1.0; value.let = 2.0;
    good = good && value.ref == 1.0 && value.let == 2.0;
  }
  int count = 0;
  for (struct Cursor { int ref; } cursor = Cursor(0); cursor.ref < 2; ++cursor.ref) { count++; }
  good = good && count == 2;
  switch (int(var.x) & 1) {
    case 0: Material local = make(2.0); good = good && local.ref == 2.0; break;
    default: local = make(3.0); good = good && local.ref == 3.0; break;
  }
  float let = 0.25, override = 0.5, _ = 0.75, reference = 1.0;
  bool diagnostic = var.x < iResolution.x * 0.5;
  float alias = diagnostic ? let : override;
  good = good && alias == (diagnostic ? 0.25 : 0.5) && reference == 1.0;
  ref = good ? vec4(let, override, _, 1.0) : vec4(1.0, 0.0, 0.0, 1.0);
}
