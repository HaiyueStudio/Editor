import { CurveEditor } from './curveEditor.js';
import { validateContent, type AdjustmentContent, type Levels } from './layerFeatures.js';
import type { ImageState } from './document.js';
import type { Histogram } from './histogram.js';
import { drawHistogram } from './histogramPanel.js';
import { pixelJob } from './pixelJobs.js';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const identity=()=>({black:0,white:255,gamma:1,outputBlack:0,outputWhite:255});
export class AdjustmentControls {
 private curve=new CurveEditor();
 private channel='rgb';private kind='brightness';private drafts:Record<string,AdjustmentContent>={};
 private histogram:Histogram|undefined;private controller:AbortController|undefined;
 constructor(){
  $('adjustment-channel').addEventListener('change',()=>{const next=$<HTMLSelectElement>('adjustment-channel').value;try{this.save();this.channel=next;this.load();$('adjustment-error').textContent='';}catch(e){$<HTMLSelectElement>('adjustment-channel').value=this.channel;$('adjustment-error').textContent=String(e);}});
  $('adjustment-kind').addEventListener('change',()=>{const next=$<HTMLSelectElement>('adjustment-kind').value;try{this.save();this.kind=next;this.load();$('adjustment-error').textContent='';}catch(e){$<HTMLSelectElement>('adjustment-kind').value=this.kind;$('adjustment-error').textContent=String(e);}});
  $('adjustment-dialog').addEventListener('close',()=>{if(!$<HTMLDialogElement>('adjustment-dialog').open)this.controller?.abort();});
 }
 open(c:AdjustmentContent|undefined,state:ImageState){
  this.drafts={levels:{type:'adjustment',filter:'levels',amount:100,levels:identity()},curves:{type:'adjustment',filter:'curves',amount:100,curves:[{input:0,output:0},{input:255,output:255}]}};
  if(c&&(c.filter==='levels'||c.filter==='curves'))this.drafts[c.filter]=structuredClone(c);
  this.kind=c?.filter??'brightness';this.channel='rgb';$<HTMLSelectElement>('adjustment-kind').value=this.kind;$<HTMLSelectElement>('adjustment-channel').value='rgb';$<HTMLInputElement>('adjustment-amount').value=String(c?.amount??15);this.histogram=undefined;this.load();
  this.controller?.abort();const controller=this.controller=new AbortController();$('adjustment-histogram-info').textContent='正在计算当前合成直方图…';$<HTMLCanvasElement>('adjustment-histogram').getContext('2d')!.clearRect(0,0,256,90);
  void pixelJob<Histogram>({kind:'histogram',state},controller.signal).then(h=>{if(controller.signal.aborted)return;this.histogram=h;this.draw();$('adjustment-histogram-info').textContent='打开面板时的可见合成 · 透明度加权';}).catch(e=>{if(!controller.signal.aborted)$('adjustment-histogram-info').textContent=String(e);});
 }
 private save(){if(!['levels','curves'].includes(this.kind))return;const draft=this.drafts[this.kind]!,part=this.kind==='levels'?{levels:Object.fromEntries(['black','white','gamma','outputBlack','outputWhite'].map(k=>[k,Number($<HTMLInputElement>('levels-'+k).value)])) as unknown as Levels}:{curves:this.curve.points()};validateContent({type:'adjustment',filter:this.kind as 'levels',amount:100,...part});
  if(this.channel==='rgb')Object.assign(draft,part);else draft.channels={...draft.channels,[this.channel]:part};
 }
 private load(){const tonal=['levels','curves'].includes(this.kind);$('adjustment-channel-label').hidden=!tonal;$('levels-settings').hidden=this.kind!=='levels';$('curves-settings').hidden=this.kind!=='curves';$<HTMLInputElement>('adjustment-amount').disabled=tonal;$('adjustment-amount').parentElement!.hidden=tonal;
  if(tonal){const d=this.drafts[this.kind]!,part=this.channel==='rgb'?d:d.channels?.[this.channel as 'red'];for(const [key,value] of Object.entries(part?.levels??identity()))$<HTMLInputElement>('levels-'+key).value=String(value);this.curve.set(part?.curves??[{input:0,output:0},{input:255,output:255}]);}this.draw();
 }
 private draw(){if(this.histogram)drawHistogram($<HTMLCanvasElement>('adjustment-histogram'),this.histogram,this.channel);}
 read():AdjustmentContent {this.save();return structuredClone(this.drafts[this.kind]??{type:'adjustment',filter:this.kind as AdjustmentContent['filter'],amount:Number($<HTMLInputElement>('adjustment-amount').value)});}
 dispose(){this.controller?.abort();}
}
