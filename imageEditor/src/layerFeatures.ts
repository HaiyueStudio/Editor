import {validateMesh,type MeshPoint} from './smartGeometry.js';
import {isDesignAdjustment,validateDesignAdjustment,type DesignAdjustment,type AdjustmentParameters} from './designAdjustments.js';
import { validateHueSaturation } from './hueSaturation.js';
import { validateQuad } from './projective.js';
import type { Layer } from 'ag-psd';
import { isPaged, hydrateBitmap } from './pagedPixels.js';
import { validateBitmap } from './pixelFormat.js';
import { effectiveMaskWeight } from './maskEffects.js';
import { validateResampling, type Resampling } from './resamplingTypes.js';
import type { Bitmap } from './document.js';
export const BLEND_MODES = { normal:'正常', multiply:'正片叠底', screen:'滤色', overlay:'叠加', darken:'变暗', lighten:'变亮', 'hard-light':'强光', difference:'差值', exclusion:'排除', 'soft-light':'柔光', 'color-dodge':'颜色减淡', 'color-burn':'颜色加深', 'linear-dodge':'线性减淡', 'linear-burn':'线性加深', 'vivid-light':'亮光', 'linear-light':'线性光', 'pin-light':'点光', 'hard-mix':'实色混合', subtract:'减去', divide:'划分', 'darker-color':'深色', 'lighter-color':'浅色', hue:'色相', saturation:'饱和度', color:'颜色', luminosity:'明度' } as const;
export type BlendMode = keyof typeof BLEND_MODES;
export interface LayerMask { samples?:import('./diskMasks.js').MaskSamples; coverage?:import('./selection.js').Selection; vector?:NonNullable<Layer['vectorMask']>; width:number; height:number; x:number; y:number; data:Uint8Array|Float32Array; precision?:'float32'; disabled:boolean; defaultColor:number; density?:number; feather?:number }
export interface TextContent { layout?:{transform?:readonly number[];box?:readonly number[];firstLineIndent?:number;startIndent?:number;endIndent?:number;spaceBefore?:number;spaceAfter?:number;scaleX?:number;scaleY?:number;tracking?:number;x:number;y:number;leading:number;width:number;height:number}; type:'text'; text:string; size:number; family:'sans-serif'|'serif'|'monospace'; bold:boolean; italic:boolean; align:'left'|'center'|'right'; color:string; fontName?:string; runs?:readonly TextRun[]; wrapWidth?:number }
export interface TextRun { start:number; end:number; size?:number; family?:TextContent['family']; fontName?:string; bold?:boolean; italic?:boolean; color?:string; underline?:boolean }
export interface PathNode { x:number;y:number;inX:number;inY:number;outX:number;outY:number }
export interface PathContour { closed:boolean; fillRule:'nonzero'|'evenodd'; operation:'combine'|'continue'; nodes:readonly PathNode[] }
export interface HueSaturation { colorize:boolean; hue:number; saturation:number; lightness:number; ranges?:readonly {a:number;b:number;c:number;d:number;hue:number;saturation:number;lightness:number}[] }
export interface PathContent { contours?:readonly PathContour[]; type:'path';strokeAlignment?:'center'|'inside';width:number;height:number;closed:boolean;fill:string|null;stroke:string;strokeWidth:number;fillRule:'nonzero'|'evenodd';nodes:readonly PathNode[] }
export interface ShapeContent { type:'shape'; shape:'rectangle'|'ellipse'|'line'; width:number; height:number; radius:number; fill:string; stroke:string; strokeWidth:number }
export interface Levels { black:number; white:number; gamma:number; outputBlack:number; outputWhite:number }
export interface CurvePoint { input:number; output:number }
export interface AdjustmentContent { type:'adjustment'; parameters?:AdjustmentParameters; hueSaturation?:HueSaturation; filter:DesignAdjustment|'hue-saturation'|'brightness'|'contrast'|'saturation'|'hue'|'grayscale'|'invert'|'levels'|'curves'; amount:number; levels?:Levels; curves?:readonly CurvePoint[]; channels?:Partial<Record<'red'|'green'|'blue',{levels?:Levels;curves?:readonly CurvePoint[]}>> }
export interface SmartContent { type:'smart'; link?:{uri:string;name:string}|undefined; sourceId:string; name:string; source:Bitmap; sourcePsd?:Uint8Array|undefined; sourcePdf?:{data:Uint8Array;bounds:readonly number[];quad:readonly number[];pageNumber:number;totalPages:number}|undefined; transform:{mesh?:readonly MeshPoint[];quad?:readonly number[];width:number;height:number;angle:number;flipX:boolean;flipY:boolean;resampling?:Resampling} }
export interface StylePaint { color:string; opacity:number; blend?:BlendMode; enabled?:boolean }
export interface ShadowStyle extends StylePaint { dx:number;dy:number;blur:number;spread?:number;contour?:readonly number[] }
export interface StrokeStyle extends StylePaint { size:number;position?:'inside'|'center'|'outside' }
export interface GlowStyle extends StylePaint { size:number;choke:number;noise:number;range:number;contour?:readonly number[] }
export interface GradientStyle { enabled?:boolean;opacity:number;blend?:BlendMode;angle:number;scale:number;reverse:boolean;type:'linear'|'radial';offsetX?:number;offsetY?:number;align?:boolean;stops:readonly {position:number;color:string;opacity:number}[] }
export interface LayerStyles {
 enabled:boolean; overlay?:StylePaint; stroke?:StrokeStyle; shadow?:ShadowStyle;
 innerGlow?:GlowStyle & {source:'edge'|'center'}; outerGlow?:GlowStyle; innerShadow?:ShadowStyle;
 gradient?:GradientStyle; satin?:ShadowStyle & {invert:boolean};
 bevel?:{enabled?:boolean;size:number;soften:number;depth:number;angle:number;altitude:number;direction:'up'|'down';highlight:StylePaint;shadow:StylePaint};
 extraShadows?:readonly ShadowStyle[];extraStrokes?:readonly StrokeStyle[];
}
export function validateStyles(styles:LayerStyles) {
 const fail=()=>{throw Error('图层样式参数无效或超出范围。');},num=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
 if(!styles||typeof styles.enabled!=='boolean'||Object.keys(styles).some(k=>!['enabled','innerGlow','outerGlow','innerShadow','gradient','satin','bevel','overlay','stroke','shadow','extraShadows','extraStrokes'].includes(k)))fail();
 const paint=(e:StylePaint)=>{if(!e||!color(e.color)||!num(e.opacity,0,1)||e.blend!==undefined&&!Object.hasOwn(BLEND_MODES,e.blend)||e.enabled!==undefined&&typeof e.enabled!=='boolean')fail();};
 const contour=(v:readonly number[]|undefined)=>{if(v&&(!Array.isArray(v)||v.length<2||v.length>64||v.some(n=>!num(n,0,1))))fail();};
 const shadow=(e:ShadowStyle)=>{paint(e);if(!num(e.dx,-256,256)||!num(e.dy,-256,256)||!num(e.blur,0,64)||e.spread!==undefined&&!num(e.spread,0,64))fail();contour(e.contour);};
 const stroke=(e:StrokeStyle)=>{paint(e);if(!num(e.size,0,64)||e.position!==undefined&&!['inside','center','outside'].includes(e.position))fail();};
 if(styles.overlay)paint(styles.overlay);if(styles.stroke)stroke(styles.stroke);if(styles.shadow)shadow(styles.shadow);if(styles.innerShadow)shadow(styles.innerShadow);
 for(const list of [styles.extraShadows,styles.extraStrokes])if(list&&(!Array.isArray(list)||list.length>9))fail();styles.extraShadows?.forEach(shadow);styles.extraStrokes?.forEach(stroke);
 for(const g of [styles.innerGlow,styles.outerGlow])if(g){paint(g);if(!num(g.size,0,64)||!num(g.choke,0,100)||!num(g.noise,0,1)||!num(g.range,.0001,1))fail();contour(g.contour);}
 if(styles.innerGlow&&!['edge','center'].includes(styles.innerGlow.source))fail();
 if(styles.satin){shadow(styles.satin);if(typeof styles.satin.invert!=='boolean')fail();}
 const g=styles.gradient;if(g){if(!num(g.opacity,0,1)||!num(g.angle,-360,360)||!num(g.scale,.01,10)||typeof g.reverse!=='boolean'||!['linear','radial'].includes(g.type)||g.blend!==undefined&&!Object.hasOwn(BLEND_MODES,g.blend)||g.enabled!==undefined&&typeof g.enabled!=='boolean'||g.align!==undefined&&typeof g.align!=='boolean'||[g.offsetX,g.offsetY].some(v=>v!==undefined&&!num(v,-100,100))||!Array.isArray(g.stops)||g.stops.length<2||g.stops.length>64)fail();if(g.stops[0]!.position!==0||g.stops.at(-1)!.position!==1)fail();g.stops.forEach((v,i)=>{if(!num(v.position,0,1)||!color(v.color)||!num(v.opacity,0,1)||i>0&&v.position<=g.stops[i-1]!.position)fail();});}
 const b=styles.bevel;if(b){paint(b.highlight);paint(b.shadow);if(!num(b.size,0,64)||!num(b.soften,0,64)||!num(b.depth,0,10)||!num(b.angle,-360,360)||!num(b.altitude,0,90)||!['up','down'].includes(b.direction)||b.enabled!==undefined&&typeof b.enabled!=='boolean')fail();}
}
export function freezeStyles(styles:LayerStyles):LayerStyles {
 const deep=(v:unknown):unknown=>{if(v&&typeof v==='object'){for(const x of Object.values(v))deep(x);Object.freeze(v);}return v;};return deep(structuredClone(styles)) as LayerStyles;
}
export function cloneContent(content:LayerContent):LayerContent { return content.type==='smart'&&isPaged(content.source)?{...content,source:content.source,transform:{...content.transform},...(content.sourcePsd?{sourcePsd:content.sourcePsd.slice()}:{}),...(content.sourcePdf?{sourcePdf:{...content.sourcePdf,data:content.sourcePdf.data.slice(),quad:[...content.sourcePdf.quad],bounds:[...content.sourcePdf.bounds]}}:{})}:structuredClone(content); }
export function freezeContent(content:LayerContent):LayerContent {
 if(content.type==='path')return Object.freeze({...content,...(content.contours?{contours:Object.freeze(content.contours.map(p=>Object.freeze({...p,nodes:Object.freeze(p.nodes.map(n=>Object.freeze({...n})))})))}:{}),nodes:Object.freeze(content.nodes.map(p=>Object.freeze({...p})))});
 if(content.type==='text')return Object.freeze({...content,...(content.layout?{layout:Object.freeze({...content.layout,...(content.layout.transform?{transform:Object.freeze([...content.layout.transform])}:{}),...(content.layout.box?{box:Object.freeze([...content.layout.box])}:{})})}:{}),...(content.runs?{runs:Object.freeze(content.runs.map(r=>Object.freeze({...r})))}:{})});
 // Pixel values stay immutable; the shared backing header may switch from RAM to disk.
 if(content.type==='smart')return Object.freeze({...content,source:hydrateBitmap(content.source),...(content.sourcePdf?{sourcePdf:Object.freeze({...content.sourcePdf,quad:Object.freeze([...content.sourcePdf.quad]),bounds:Object.freeze([...content.sourcePdf.bounds])})}:{}),...(content.link?{link:Object.freeze({...content.link})}:{}),transform:Object.freeze({...content.transform,...(content.transform.quad?{quad:Object.freeze([...content.transform.quad])}:{}),...(content.transform.mesh?{mesh:Object.freeze(content.transform.mesh.map(p=>Object.freeze({...p})))}:{})})});
 if(content.type==='adjustment')return Object.freeze({...content,...(content.parameters?{parameters:Object.freeze({...content.parameters})}:{}),...(content.hueSaturation?{hueSaturation:Object.freeze({...content.hueSaturation,...(content.hueSaturation.ranges?{ranges:Object.freeze(content.hueSaturation.ranges.map(r=>Object.freeze({...r})))}:{})})}:{}),...(content.channels?{channels:Object.freeze(Object.fromEntries(Object.entries(content.channels).map(([k,v])=>[k,Object.freeze({...(v.levels?{levels:Object.freeze({...v.levels})}:{}),...(v.curves?{curves:Object.freeze(v.curves.map(p=>Object.freeze({...p})))}:{})})])))}:{}),...(content.levels?{levels:Object.freeze({...content.levels})}:{}),...(content.curves?{curves:Object.freeze(content.curves.map(p=>Object.freeze({...p})))}:{})});
 return Object.freeze({...content});
}
export type LayerContent = TextContent | ShapeContent | AdjustmentContent | SmartContent | PathContent;
const color=(value:unknown)=>typeof value==='string'&&/^#[a-f0-9]{6}$/i.test(value);
export function validateContent(content:LayerContent) {
 if(!content||typeof content!=='object')throw new Error('图层内容无效。');
 if(content.type==='path') {
  if(content.contours){if(!Array.isArray(content.contours)||content.contours.length>128||content.contours.reduce((n,p)=>n+p.nodes.length,content.nodes.length)>8192)throw Error('复合路径超过限制。');for(const p of content.contours){if(!['combine','continue'].includes(p.operation))throw Error('复合路径运算无效。');const {contours,...base}=content;validateContent({...base,nodes:p.nodes,closed:p.closed,fillRule:p.fillRule});}}
  if(content.strokeAlignment!==undefined&&!['center','inside'].includes(content.strokeAlignment))throw Error('路径描边对齐方式无效。');
  if(![content.width,content.height].every(n=>Number.isInteger(n)&&n>=1&&n<=8192)||content.width*content.height>16777216||typeof content.closed!=='boolean'||content.fill!==null&&!color(content.fill)||!color(content.stroke)||!Number.isFinite(content.strokeWidth)||content.strokeWidth<0||content.strokeWidth>512||!['nonzero','evenodd'].includes(content.fillRule)||!Array.isArray(content.nodes)||content.nodes.length<2||content.nodes.length>256||content.nodes.some(n=>![n.x,n.y,n.inX,n.inY,n.outX,n.outY].every(v=>Number.isFinite(v)&&Math.abs(v)<=32768)))throw new Error('贝塞尔路径参数无效。');
 }else if(content.type==='smart') {
  const b=content.source,t=content.transform; if(b)validateBitmap(b);
  if(content.sourcePsd!==undefined&&(!(content.sourcePsd instanceof Uint8Array)||content.sourcePsd.length<26||content.sourcePsd.length>32*1024*1024||new DataView(content.sourcePsd.buffer,content.sourcePsd.byteOffset).getUint32(0)!==0x38425053))throw new Error('多层智能源 PSD 无效或超过 32 MiB。');
  if(content.sourcePdf){const p=content.sourcePdf;if(content.sourcePsd||!(p.data instanceof Uint8Array)||p.data.length<8||p.data.length>32*1024*1024||new TextDecoder().decode(p.data.subarray(0,5))!=='%PDF-'||![p.pageNumber,p.totalPages].every(n=>Number.isInteger(n)&&n>=1&&n<=10000)||p.pageNumber>p.totalPages)throw Error('PDF 智能源无效或超过 32 MiB。');validateQuad(p.quad);if(!Array.isArray(p.bounds)||p.bounds.length!==4||p.bounds.some(v=>!Number.isFinite(v)||Math.abs(v)>32768)||p.bounds[2]!<=p.bounds[0]!||p.bounds[3]!<=p.bounds[1]!)throw Error('PDF 智能源尺寸无效。');}
  if(content.link&&(!content.link.uri||typeof content.link.uri!=='string'||content.link.uri.length>2048||/[\x00-\x1f]/.test(content.link.uri)||typeof content.link.name!=='string'||!content.link.name.length||content.link.name.length>160))throw Error('智能对象外链描述无效。');
  if(t?.mesh){if(content.sourcePdf)throw Error('PDF 矢量智能源尚不支持网格编辑。');validateMesh(t.mesh);}
  if(t?.quad)validateQuad(t.quad);
  if(t?.resampling!==undefined)validateResampling(t.resampling);
  if(!/^[a-f0-9-]{36}$/i.test(content.sourceId)||typeof content.name!=='string'||!content.name.length||content.name.length>160||!b||![b.width,b.height,t?.width,t?.height].every(n=>Number.isInteger(n)&&n>=1&&n<=30000)||!isPaged(b)&&(!(b.data instanceof Uint8ClampedArray||b.data instanceof Float32Array)||b.data.length!==b.width*b.height*4)||!Number.isFinite(t.angle)||Math.abs(t.angle)>360||typeof t.flipX!=='boolean'||typeof t.flipY!=='boolean')throw new Error('智能对象源或变换参数无效。');
 }else if(content.type==='text') {
  const l=content.layout;if(l?.transform&&(l.transform.length!==4||l.transform.some(n=>!Number.isFinite(n)||Math.abs(n)>100)||Math.abs(l.transform[0]!*l.transform[3]!-l.transform[1]!*l.transform[2]!)<1e-6))throw Error('文字仿射变换无效。');
  if(l?.box&&(l.box.length!==4||l.box.some(n=>!Number.isFinite(n)||Math.abs(n)>8192)||l.box[2]!<=l.box[0]!||l.box[3]!<=l.box[1]!))throw Error('文字框无效。');
  for(const k of ['firstLineIndent','startIndent','endIndent','spaceBefore','spaceAfter'] as const)if(l?.[k]!==undefined&&(!Number.isFinite(l[k])||Math.abs(l[k]!)>8192))throw Error('文字段落参数无效。');
  if(content.layout&&(![content.layout.x,content.layout.y,content.layout.leading,content.layout.width,content.layout.height].every(Number.isFinite)||Math.abs(content.layout.x)>8192||Math.abs(content.layout.y)>8192||content.layout.leading<0||content.layout.leading>8192||content.layout.width<1||content.layout.width>8192||content.layout.height<1||content.layout.height>8192))throw Error('文字原生布局无效。');
  if(content.layout&&((content.layout.scaleX!==undefined&&(!Number.isFinite(content.layout.scaleX)||content.layout.scaleX<=0||content.layout.scaleX>100))||(content.layout.scaleY!==undefined&&(!Number.isFinite(content.layout.scaleY)||content.layout.scaleY<=0||content.layout.scaleY>100))||(content.layout.tracking!==undefined&&(!Number.isFinite(content.layout.tracking)||Math.abs(content.layout.tracking)>10000))))throw Error('文字缩放或字距无效。');
  if(content.wrapWidth!==undefined&&(!Number.isInteger(content.wrapWidth)||content.wrapWidth<16||content.wrapWidth>8192))throw new Error('文字换行宽度应为 16–8192。');
  if(content.runs){if(!Array.isArray(content.runs)||content.runs.length>128)throw new Error('富文本片段数量无效。');let previous=0;for(const run of content.runs){if(!Number.isInteger(run.start)||!Number.isInteger(run.end)||run.start<previous||run.start>=run.end||run.end>content.text.length||run.underline!==undefined&&typeof run.underline!=='boolean'||[run.start,run.end].some(i=>i>0&&i<content.text.length&&/[\uD800-\uDBFF]/.test(content.text[i-1]!)&&/[\uDC00-\uDFFF]/.test(content.text[i]!)))throw new Error('富文本范围无效，不能重叠或拆开代理对。');validateContent({...content,...run,text:'a',runs:undefined} as TextContent);previous=run.end;}}
  if(content.fontName!==undefined&&(typeof content.fontName!=='string'||!/^[\w .-]{1,120}$/.test(content.fontName)))throw new Error('字体名称无效。');
  if(typeof content.text!=='string'||!content.text.trim()||content.text.length>2000||!Number.isFinite(content.size)||content.size<6||content.size>512||!['sans-serif','serif','monospace'].includes(content.family)||typeof content.bold!=='boolean'||typeof content.italic!=='boolean'||!['left','center','right'].includes(content.align)||!color(content.color))throw new Error('文字参数无效。');
 }else if(content.type==='shape') {
  if(!['rectangle','ellipse','line'].includes(content.shape)||![content.width,content.height].every(n=>Number.isInteger(n)&&n>=1&&n<=8192)||content.width*content.height>16777216||!Number.isFinite(content.radius)||content.radius<0||content.radius>4096||!Number.isInteger(content.strokeWidth)||content.strokeWidth<(content.shape==='line'?1:0)||content.strokeWidth>512||!color(content.fill)||!color(content.stroke))throw new Error('形状参数无效。');
 }else if(content.type==='adjustment') {
  if(isDesignAdjustment(content.filter)){validateDesignAdjustment(content);return;}
  if(content.filter==='hue-saturation'){validateHueSaturation(content.hueSaturation);if(content.amount!==100)throw Error('色相／饱和度使用独立 HSL 参数。');return;}
  if(content.channels!==undefined){if(!['levels','curves'].includes(content.filter)||!content.channels||typeof content.channels!=='object'||Array.isArray(content.channels)||Object.keys(content.channels).some(k=>!['red','green','blue'].includes(k)))throw new Error('调整通道无效。');for(const v of Object.values(content.channels)){if(!v||Object.keys(v).some(k=>k!==content.filter))throw new Error('通道参数与调整类型不符。');validateContent({type:'adjustment',filter:content.filter,amount:100,...v});}}
  const ranges={brightness:[-100,100],contrast:[-100,100],saturation:[-100,100],hue:[-180,180],grayscale:[0,100],invert:[0,100]};
  if(['levels','curves'].includes(content.filter)&&content.amount!==100)throw new Error('曲线／色阶的 amount 必须为 100；强度请使用图层不透明度。');
  if(content.filter==='levels'){const l=content.levels;if(!l||![l.black,l.white,l.outputBlack,l.outputWhite].every(n=>Number.isInteger(n)&&n>=0&&n<=255)||l.black>253||l.white<2||l.black>=l.white||l.outputBlack>l.outputWhite||!Number.isFinite(l.gamma)||l.gamma<.1||l.gamma>9.99||Math.abs(l.gamma*100-Math.round(l.gamma*100))>1e-6)throw new Error('色阶参数无效。');return;}
  if(content.filter==='curves'){const p=content.curves;if(!p||p.length<2||p.length>16||p[0]!.input!==0||p.at(-1)!.input!==255||p.some((v,i)=>![v.input,v.output].every(n=>Number.isInteger(n)&&n>=0&&n<=255)||(i>0&&v.input<=p[i-1]!.input)))throw new Error('曲线需要 2–16 个按输入递增的点，端点为 0 和 255。');return;}
  const range=ranges[content.filter as keyof typeof ranges];if(!range||!Number.isInteger(content.amount)||content.amount<range[0]!||content.amount>range[1]!)throw new Error('调整参数无效。');
 }else throw new Error('未知图层内容。');
}
export const maskWeight=effectiveMaskWeight;

export function nativeWritable(c:LayerContent):boolean {return c.type==='smart'?c.source.width*c.source.height*((c.source.depth??8)===8?4:16)<=32*1024*1024:c.type==='text'?!!c.layout&&!c.wrapWidth&&!/[\r\n]$/.test(c.text)||!c.runs?.length&&!c.wrapWidth&&!/[\r\n]$/.test(c.text):c.type!=='adjustment'||isDesignAdjustment(c.filter)||c.filter==='hue-saturation'||c.filter==='levels'||c.filter==='curves'||c.filter==='invert'&&c.amount===100;}

export function qualityContent(content:LayerContent|undefined):boolean {return content?.type==='adjustment'&&content.channels!==undefined||content?.type==='smart'&&content.transform.resampling!==undefined;}
