#define COUNT 3
const float weights[COUNT] = float[](0.1, 0.2, 0.3);
float globals[2] = float[2](0.25, 0.5);
struct Item { vec2 points[2]; mat2 basis[2]; };
float sum(const float a[3]) { float total=0.; for(int i=0;i<a.length();i++) total+=a[i]; return total; }
void bump(inout float value) { value+=0.125; }
void fill(out float values[2]) { values[0]=0.2; values[1]=0.4; }
void advance(inout float values[2]) { values[0]+=0.1; values[1]+=0.2; }
float[2] make() { return float[2](0.2,0.4); }
void mainImage(out vec4 color, in vec2 coord) {
    int column=int(floor(coord.x))%8;
    float a[2]=make(),b[2]; fill(b); advance(b);
    float v=0.;
    if(column==0) v=sum(weights);
    if(column==1) { int i=0; a[i++]+=0.1; v=a[0]+float(i)*0.1; }
    if(column==2) { int i=0; bump(a[i++]); v=a[0]+float(i)*0.1; }
    if(column==3) { Item items[2]; items[1].points[0]=vec2(0.1,0.2);int i=1,j=0; items[i++].points[j++].yx+=vec2(0.3,0.1);v=items[1].points[0].x+items[1].points[0].y; }
    if(column==4) { Item items[2];items[0].basis[1]=mat2(0.2);int i=0,j=1; bump(items[i++].basis[j++][0][0]);v=items[0].basis[1][0][0]; }
    if(column==5) { float c[2]=column>0?a:b;v=(c==a?0.2:0.1)+b[1]; }
    if(column==6) { globals[0]++;v=globals[0]-1.0+globals[1]; }
    if(column==7) { const vec2 offsets[2]=vec2[2](vec2(0.1,0.2),vec2(0.3,0.4)); int i=int(coord.y)%2;v=offsets[i].y; }
    color=vec4(v,v*0.5,0.1,1.);
}
