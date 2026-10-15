import type { HYSelect } from '@haiyue/ui/select';
import type { ImageDocument } from './document.js';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export class LayerCompsPanel {
 constructor(private active:()=>ImageDocument|undefined,notice:(s:string,error?:boolean)=>void){
  const guard=(fn:(d:ImageDocument)=>void)=>{try{const d=active();if(!d)throw Error('请先打开文档。');fn(d);this.sync();}catch(e){notice(e instanceof Error?e.message:String(e),true);}};
  $('layer-comp-list').addEventListener('change',()=>this.details());
  $('layer-comp-apply').onclick=()=>guard(d=>d.applyComp(Number($<HYSelect>('layer-comp-list').value)));
  $('layer-comp-create').onclick=()=>guard(d=>d.captureComp($<HTMLInputElement>('layer-comp-name').value||'图层复合 '+((d.state.layerComps?.list.length??0)+1)));
  $('layer-comp-update').onclick=()=>guard(d=>d.captureComp($<HTMLInputElement>('layer-comp-name').value,Number($<HYSelect>('layer-comp-list').value),$('layer-comp-comment').textContent??''));
  $('layer-comp-delete').onclick=()=>guard(d=>d.deleteComp(Number($<HYSelect>('layer-comp-list').value)));
 }
 private details(){const c=this.active()?.state.layerComps?.list.find(c=>String(c.id)===$<HYSelect>('layer-comp-list').value);$<HTMLInputElement>('layer-comp-name').value=c?.name??'';$('layer-comp-comment').textContent=c?.comment??'';}
 sync(){const d=this.active(),select=$<HYSelect>('layer-comp-list'),comps=d?.state.layerComps,old=select.value;select.options=(comps?.list??[]).map(c=>({value:String(c.id),label:c.name}));select.value=comps?.lastApplied!==undefined?String(comps.lastApplied):comps?.list.some(c=>String(c.id)===old)?old:String(comps?.list[0]?.id??'');select.disabled=!comps?.list.length;for(const id of ['apply','update','delete'])$<HTMLButtonElement>('layer-comp-'+id).disabled=!comps?.list.length;$<HTMLButtonElement>('layer-comp-create').disabled=!d;this.details();}
}
