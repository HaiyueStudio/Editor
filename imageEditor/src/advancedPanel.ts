import { formatRange, rebaseRuns } from './richText.js';
import { AdjustmentControls } from './adjustmentControls.js';
import { ImageDocument, makeLayer, layerLocked } from './document.js';
import { BLEND_MODES, type TextContent, type ShapeContent, type AdjustmentContent } from './layerFeatures.js';
import { rasterContent } from './contentRaster.js';
import { maskFromSelection } from './maskTools.js';
import type { EditingTools } from './editingTools.js';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const val=(id:string)=>$<HTMLInputElement>(id).value;
export class AdvancedPanel {
 private rangeFormatted=false;
 private rich:TextContent|undefined;
 private adjustments=new AdjustmentControls();
 private target:{doc:ImageDocument;revision:number;id:string|null}|undefined;
 constructor(private active:()=>ImageDocument|undefined,private editing:EditingTools){
  $('text-content').addEventListener('input',()=>{if(this.rich){this.rich={...this.rich,runs:rebaseRuns(this.rich,val('text-content')),text:val('text-content')};this.runInfo();}});
  $('text-format-range').onclick=()=>{try{if(!this.rich)return;const area=$<HTMLTextAreaElement>('text-content');this.rangeFormatted=true;this.rich={...this.rich,runs:formatRange(this.rich,area.selectionStart,area.selectionEnd,{size:Number(val('text-size')),family:val('text-family') as TextContent['family'],bold:$<HTMLInputElement>('text-bold').checked,italic:$<HTMLInputElement>('text-italic').checked,underline:$<HTMLInputElement>('text-underline').checked,color:val('text-color')})};this.runInfo();$('text-error').textContent='';}catch(e){$('text-error').textContent=String(e);}};
  const select=$<HTMLSelectElement>('blend-mode');select.replaceChildren();for(const [value,label] of Object.entries(BLEND_MODES)){const option=new Option(label,value);select.add(option);}
 }
 private begin(edit:boolean){const doc=this.active();if(!doc)throw new Error('请先打开文档。');this.target={doc,revision:doc.revision,id:edit?doc.state.selectedId:null};return doc;}
 openText(edit=false){const doc=this.begin(edit),c=edit&&doc.selected?.content?.type==='text'?doc.selected.content:undefined;
  $('text-error').textContent='';$<HTMLTextAreaElement>('text-content').value=c?.text??'';$<HTMLInputElement>('text-size').value=String(c?.size??64);
  $<HTMLSelectElement>('text-family').value=c?.family??'sans-serif';$<HTMLSelectElement>('text-align').value=c?.align??'left';$<HTMLInputElement>('text-bold').checked=c?.bold??false;$<HTMLInputElement>('text-italic').checked=c?.italic??false;$<HTMLInputElement>('text-color').value=c?.color??val('paint-color');
  this.rangeFormatted=false;this.rich=c??{type:'text',text:'',size:64,family:'sans-serif',align:'left',bold:false,italic:false,color:val('paint-color')};$<HTMLInputElement>('text-wrap').value=String(c?.wrapWidth??0);$<HTMLInputElement>('text-underline').checked=false;this.runInfo();
  $<HTMLDialogElement>('text-dialog').showModal();$('text-content').focus();
 }
 private runInfo(){$('text-run-info').textContent=`${this.rich?.runs?.length??0} 个样式片段；先选中文字，再应用样式。`;}
 openShape(edit=false){const doc=this.begin(edit),c=edit&&doc.selected?.content?.type==='shape'?doc.selected.content:undefined;
  $('shape-error').textContent='';for(const [id,value] of Object.entries({type:c?.shape??'rectangle',width:c?.width??200,height:c?.height??120,radius:c?.radius??0,fill:c?.fill??val('paint-color'),stroke:c?.stroke??'#ffffff','stroke-width':c?.strokeWidth??0}))$<HTMLInputElement>('shape-'+id).value=String(value);
  $<HTMLDialogElement>('shape-dialog').showModal();
 }
 openAdjustment(edit=false){const doc=this.begin(edit),c=edit&&doc.selected?.content?.type==='adjustment'?doc.selected.content:undefined;
  $('adjustment-error').textContent='';this.adjustments.open(c,doc.state);$<HTMLDialogElement>('adjustment-dialog').showModal();
 }
 dispose(){this.adjustments.dispose();}
 editContent(){const type=this.active()?.selected?.content?.type;if(type==='text')this.openText(true);else if(type==='shape')this.openShape(true);else if(type==='adjustment')this.openAdjustment(true);else throw new Error('请选择可编辑文字、形状或调整图层。');}
 submit(type:'text'|'shape'|'adjustment'){
  const target=this.target;if(!target||this.active()!==target.doc||target.doc.revision!==target.revision)throw new Error('文档已变化，请重新打开编辑面板。');
  const content:TextContent|ShapeContent|AdjustmentContent=type==='text'?{type,text:val('text-content'),size:Number(val('text-size')),family:val('text-family') as TextContent['family'],align:val('text-align') as TextContent['align'],bold:$<HTMLInputElement>('text-bold').checked,italic:$<HTMLInputElement>('text-italic').checked,color:val('text-color')}:type==='shape'?{type,shape:val('shape-type') as ShapeContent['shape'],width:Number(val('shape-width')),height:Number(val('shape-height')),radius:Number(val('shape-radius')),fill:val('shape-fill'),stroke:val('shape-stroke'),strokeWidth:Number(val('shape-stroke-width'))}:{type,filter:val('adjustment-kind') as AdjustmentContent['filter'],amount:Number(val('adjustment-amount'))};
  if(content.type==='text'){if(this.rangeFormatted&&this.rich){for(const key of ['size','family','bold','italic','color'] as const)Object.assign(content,{[key]:this.rich[key]});}if(this.rich){const runs=this.rich.text===content.text?this.rich.runs:rebaseRuns(this.rich,content.text);if(runs?.length)content.runs=runs;}const wrap=Number(val('text-wrap'));if(wrap)content.wrapWidth=wrap;const old=target.id?target.doc.selected?.content:undefined;if(old?.type==='text'&&old.family===content.family&&old.fontName)content.fontName=old.fontName;}
  if(content.type==='adjustment')Object.assign(content,this.adjustments.read());
  if(content.type==='shape'&&content.shape==='line'&&content.strokeWidth===0)content.strokeWidth=1;
  const bitmap=content.type==='adjustment'?null:rasterContent(content);
  if(target.id)target.doc.setContent(target.id,content,bitmap);
  else{
   const name=content.type==='text'?content.text.trim().split('\n')[0]!.slice(0,150)+' · 文字':content.type==='shape'?'形状图层':'调整 · '+content.filter;
   target.doc.addLayer({...makeLayer(name,bitmap),kind:content.type==='adjustment'?'adjustment':'pixel',content,x:bitmap?Math.round((target.doc.state.width-bitmap.width)/2):0,y:bitmap?Math.round((target.doc.state.height-bitmap.height)/2):0},false);
  }
 }
 mask(action:'add'|'invert'|'toggle'|'remove'|'paint'|'pixels'|'apply'){
  const doc=this.active(),layer=doc?.selected;if(!doc||!layer)throw new Error('请先选择图层。');this.editing.cancel();
  if(action==='pixels'){this.editing.setMaskEditing(false);return;}
  if(action==='add'){if(layer.mask)throw new Error('图层已有蒙版。');doc.setMask(layer.id,maskFromSelection(doc.state,layer.id));return;}
  if(!layer.mask)throw new Error('请先添加图层蒙版。');
  if(action==='paint'){this.editing.setMaskEditing(true);return;}
  if(action==='apply'){doc.applySelectedMask();this.editing.setMaskEditing(false);return;}
  if(action==='remove'){doc.setMask(layer.id,undefined);this.editing.setMaskEditing(false);return;}
  doc.setMask(layer.id,action==='toggle'?{...layer.mask,disabled:!layer.mask.disabled}:{...layer.mask,data:layer.mask.data.map(v=>255-v),defaultColor:255-layer.mask.defaultColor});
 }
 sync(){const layer=this.active()?.selected;$('content-edit').hidden=!layer?.content||layer.content.type==='smart';$('content-rasterize').hidden=!layer?.content||layer.kind==='adjustment';$('mask-state').textContent=layer?.mask?`${layer.mask.disabled?'已停用':'已启用'} · ${layer.mask.width} × ${layer.mask.height}`:'无蒙版';
  $<HTMLSelectElement>('blend-mode').disabled=layer?.kind==='adjustment'||!layer||layerLocked(this.active()!.state.layers,layer.id);
  for(const button of document.querySelectorAll<HTMLButtonElement>('[data-mask-required]'))button.disabled=!layer?.mask||layerLocked(this.active()!.state.layers,layer.id);
 }
}
