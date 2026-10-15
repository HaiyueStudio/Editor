import type { Layer, LayerTextData, Psd, TextStyle } from 'ag-psd';
import type { ImageLayer, ImageState } from './document.js';
import { textStyles } from './richText.js';
export interface TextIssue {code:string;detail:string}
export interface TextLayerDiagnostic {layerId:string;path:string;fontNames:string[];issues:TextIssue[];fontCheck:'pending'|'checked'|'unavailable'}
export const textDiagnosticMessage=(d:TextLayerDiagnostic)=>`文字「${d.path}」：${d.issues.map(i=>i.detail).join('；')}。`;
/** Inspect descriptors, never infer layout instructions from user-controlled layer names. */
export function textDescriptorIssues(t:LayerTextData):TextIssue[]{
 const result:TextIssue[]=[],add=(code:string,detail:string)=>{if(!result.some(i=>i.code===code))result.push({code,detail});},base=t.style??{},styles=[base,...(t.styleRuns??[]).filter(r=>r.length>0).map(r=>({...base,...r.style}))];
 if(t.antiAlias!==undefined)add('antialias',`原抗锯齿为 ${t.antiAlias}，修改后使用浏览器抗锯齿`);
 if(styles.some(s=>s.autoKerning===false||s.kerning))add('kerning','含关闭自动字偶距或自定义字偶距的样式，当前重排未保留该设置');
 if(styles.some(s=>(s.tracking??0)!==(base.tracking??0)))add('run-tracking','含分段字距，当前重排使用图层统一字距');
 if(styles.some(s=>s.autoLeading===false&&s.leading!==undefined&&s.leading!==(base.leading??(base.fontSize??12)*1.4)))add('run-leading','含分段行距，当前重排使用统一行距');
 const p=t.paragraphStyle;if(t.shapeType==='box'&&p?.autoHyphenate&&Array.from(t.text.matchAll(/\p{L}+/gu)).some(m=>m[0].length>=(p.hyphenatedWordSize??6)))add('hyphenation','文字框启用自动断词，当前重排不会自动插入连字符');
 if(p?.everyLineComposer)add('paragraph-composer','使用多行段落排版器，当前按行排版');
 if(p?.hanging||p?.burasagari)add('hanging-punctuation','启用标点悬挂，当前重排不支持悬挂');
 if(styles.some(s=>s.ligatures===false))add('ligatures','禁用了连字，当前浏览器绘制未保留此设置');
 if(styles.some(s=>s.fontCaps))add('font-caps','含字体大写／小型大写设置，当前重排未保留该设置');
 return result;
}
export function inspectTextLayers(psd:Psd,state:ImageState):TextLayerDiagnostic[]{
 const result:TextLayerDiagnostic[]=[];
 const walk=(raw:readonly Layer[],layers:readonly ImageLayer[],parent:string)=>{for(let i=0;i<raw.length;i++){const r=raw[i]!,l=layers[i];if(!l)continue;const path=parent?parent+' / '+l.name:l.name;if(r.text&&l.content?.type==='text'){
  const c=l.content,names=new Set<string>();for(const s of textStyles(c)){const name=s.fontName??(s.family&&s.family!==c.family?undefined:c.fontName);if(name)names.add(name);}
  result.push({layerId:l.id,path,fontNames:[...names],issues:textDescriptorIssues(r.text),fontCheck:names.size?'pending':'checked'});
 }walk(r.children??[],l.children,path);}};walk(psd.children??[],state.layers,'');return result;
}
