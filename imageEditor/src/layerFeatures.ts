export const BLEND_MODES = { normal:'正常', multiply:'正片叠底', screen:'滤色', overlay:'叠加', darken:'变暗', lighten:'变亮', 'hard-light':'强光', difference:'差值', exclusion:'排除' } as const;
export type BlendMode = keyof typeof BLEND_MODES;
export interface LayerMask { width:number; height:number; x:number; y:number; data:Uint8Array; disabled:boolean; defaultColor:number }
export interface TextContent { type:'text'; text:string; size:number; family:'sans-serif'|'serif'|'monospace'; bold:boolean; italic:boolean; align:'left'|'center'|'right'; color:string }
export interface ShapeContent { type:'shape'; shape:'rectangle'|'ellipse'|'line'; width:number; height:number; radius:number; fill:string; stroke:string; strokeWidth:number }
export interface AdjustmentContent { type:'adjustment'; filter:'brightness'|'contrast'|'saturation'|'hue'|'grayscale'|'invert'; amount:number }
export type LayerContent = TextContent | ShapeContent | AdjustmentContent;
const color=(value:unknown)=>typeof value==='string'&&/^#[a-f0-9]{6}$/i.test(value);
export function validateContent(content:LayerContent) {
 if(!content||typeof content!=='object')throw new Error('图层内容无效。');
 if(content.type==='text') {
  if(typeof content.text!=='string'||!content.text.trim()||content.text.length>2000||!Number.isInteger(content.size)||content.size<6||content.size>512||!['sans-serif','serif','monospace'].includes(content.family)||typeof content.bold!=='boolean'||typeof content.italic!=='boolean'||!['left','center','right'].includes(content.align)||!color(content.color))throw new Error('文字参数无效。');
 }else if(content.type==='shape') {
  if(!['rectangle','ellipse','line'].includes(content.shape)||![content.width,content.height].every(n=>Number.isInteger(n)&&n>=1&&n<=8192)||content.width*content.height>16777216||!Number.isFinite(content.radius)||content.radius<0||content.radius>4096||!Number.isInteger(content.strokeWidth)||content.strokeWidth<(content.shape==='line'?1:0)||content.strokeWidth>512||!color(content.fill)||!color(content.stroke))throw new Error('形状参数无效。');
 }else if(content.type==='adjustment') {
  const ranges={brightness:[-100,100],contrast:[-100,100],saturation:[-100,100],hue:[-180,180],grayscale:[0,100],invert:[0,100]};
  const range=ranges[content.filter];if(!range||!Number.isInteger(content.amount)||content.amount<range[0]!||content.amount>range[1]!)throw new Error('调整参数无效。');
 }else throw new Error('未知图层内容。');
}
export function maskWeight(mask:LayerMask|undefined,x:number,y:number):number {
 if(!mask||mask.disabled)return 1;x-=mask.x;y-=mask.y;
 return (x<0||y<0||x>=mask.width||y>=mask.height?mask.defaultColor:mask.data[y*mask.width+x]!)/255;
}
