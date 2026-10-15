import { type ImageDocument,type ImageState,type Bitmap } from './document.js';
import { FILTERS,type FilterKind,type FilterSettings } from './filters.js';
import { editablePixel,parentOffset } from './pixelTools.js';
import { pixelJob } from './pixelJobs.js';
import { applyFilterJob,filterState } from './filterJobs.js';
import { colorDisplay } from './iccEngine.js';
import { progressLabel } from './workerTask.js';
import type { CompositeRect } from './compositor.js';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const selectKind=()=>$<HTMLSelectElement>('filter-kind').value;
export class FilterPanel {
 private debounce:ReturnType<typeof setTimeout>|undefined;private generation=0;
 private doc:ImageDocument|undefined;private before:ImageState|undefined;private rect:CompositeRect|undefined;
 private preview:{original:Bitmap;filtered:Bitmap}|undefined;private applying=false;
 private abort=new AbortController();private computation:AbortController|undefined;
 constructor(private active:()=>ImageDocument|undefined,private notify:(message:string,error?:boolean)=>void){
  const select=$<HTMLSelectElement>('filter-kind');for(const [value,config] of Object.entries(FILTERS)){const option=document.createElement('option');option.value=value;option.textContent=config.name;select.append(option);}
  const options={signal:this.abort.signal};select.addEventListener('change',()=>{this.configure();this.schedule();},options);
  for(const id of ['filter-amount','filter-radius','filter-threshold'])$(id).addEventListener('input',()=>this.schedule(),options);
  $('filter-original').addEventListener('change',()=>this.render(),options);
  $('filter-dialog').addEventListener('close',()=>{if(!$<HTMLDialogElement>('filter-dialog').open)this.stop();},options);
  $('filter-form').addEventListener('submit',event=>{event.preventDefault();void this.apply();},options);
 }
 open(){
  this.stop();const doc=this.active();if(!doc?.selected)throw Error('请先选择像素图层。');
  const l=editablePixel(doc.state,doc.selected.id),b=l.bitmap;if(!b)throw Error('请选择含像素的图层。');
  this.doc=doc;this.before=doc.state;const offset=parentOffset(doc.state.layers,l.id)!,s=doc.state.selection,width=Math.min(512,b.width),height=Math.min(256,b.height);
  const cx=s?s.x+s.width/2-l.x-offset.x:b.width/2,cy=s?s.y+s.height/2-l.y-offset.y:b.height/2;
  this.rect={x:Math.max(0,Math.min(b.width-width,Math.floor(cx-width/2))),y:Math.max(0,Math.min(b.height-height,Math.floor(cy-height/2))),width,height};
  $<HTMLInputElement>('filter-original').checked=false;this.configure();$<HTMLDialogElement>('filter-dialog').showModal();this.schedule();
 }
 private configure(){const config=FILTERS[selectKind() as FilterKind],input=$<HTMLInputElement>('filter-amount');input.step=selectKind()==='gaussian'?'0.1':'1';$('filter-usm').hidden=selectKind()!=='usm';input.min=String(config.min);input.max=String(config.max);input.value=String(config.value);$('filter-unit').textContent=config.unit;this.controls(false);}
 private controls(busy:boolean){for(const id of ['filter-kind','filter-amount','filter-radius','filter-threshold'])$<HTMLInputElement>(id).disabled=busy||(['filter-radius','filter-threshold'].includes(id)&&selectKind()!=='usm');}
 private settings():FilterSettings{return {kind:selectKind() as FilterKind,amount:Number($<HTMLInputElement>('filter-amount').value),...(selectKind()==='usm'?{radius:Number($<HTMLInputElement>('filter-radius').value),threshold:Number($<HTMLInputElement>('filter-threshold').value)}:{})};}
 private cancel(){this.generation++;this.computation?.abort();this.computation=undefined;clearTimeout(this.debounce);}
 private schedule(){if(this.applying)return;this.cancel();this.preview=undefined;$<HTMLButtonElement>('filter-apply').disabled=true;$('filter-value').textContent=$<HTMLInputElement>('filter-amount').value;$('filter-error').textContent='';$('filter-status').textContent='正在生成局部预览…';this.debounce=setTimeout(()=>void this.compute(),100);}
 private async compute(){
  if(!this.before||!this.rect)return;const generation=this.generation,controller=this.computation=new AbortController();
  try{const state=this.before,id=state.selectedId!;const result=await pixelJob<{original:Bitmap;filtered:Bitmap}>({kind:'filter-preview',state:filterState(state,id),id,settings:this.settings(),rect:this.rect},controller.signal);
   if(generation!==this.generation)return;this.preview=result;const r=this.rect;$('filter-status').textContent=`预览已更新 · 当前图层局部 ${r.width} × ${r.height}（${r.x}, ${r.y}）· 应用时处理完整图层`;$<HTMLButtonElement>('filter-apply').disabled=false;this.render();
  }catch(error){if(generation===this.generation){$('filter-status').textContent='预览失败';$('filter-error').textContent=error instanceof Error?error.message:String(error);}}
 }
 private render(){
  if(!this.before||!this.preview)return;const raw=$<HTMLInputElement>('filter-original').checked?this.preview.original:this.preview.filtered,b=colorDisplay(raw,this.before),source=document.createElement('canvas');source.width=b.width;source.height=b.height;source.getContext('2d')!.putImageData(new ImageData(b.data as Uint8ClampedArray<ArrayBuffer>,b.width,b.height),0,0);
  const canvas=$<HTMLCanvasElement>('filter-preview'),ctx=canvas.getContext('2d')!,scale=Math.min(1,canvas.width/b.width,canvas.height/b.height);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,(canvas.width-b.width*scale)/2,(canvas.height-b.height*scale)/2,b.width*scale,b.height*scale);source.width=source.height=1;
 }
 private async apply(){
  if(!this.preview||!this.before||!this.doc||this.applying)return;const before=this.before,doc=this.doc,settings=this.settings();this.cancel();const generation=this.generation,controller=this.computation=new AbortController();
  this.applying=true;this.controls(true);$<HTMLButtonElement>('filter-apply').disabled=true;
  try{if(this.active()!==doc||doc.state!==before)throw Error('文档已变化，请关闭滤镜后重新操作。');
   const selected=editablePixel(before,before.selectedId!),r=this.rect!,whole=r.x===0&&r.y===0&&r.width===selected.bitmap!.width&&r.height===selected.bitmap!.height;
   const layer=whole?{...selected,bitmap:this.preview.filtered}:await applyFilterJob(before,before.selectedId!,settings,controller.signal,p=>{if(generation===this.generation)$('filter-status').textContent=progressLabel('正在应用滤镜',p);});
   controller.signal.throwIfAborted();if(generation!==this.generation)return;if(this.active()!==doc||doc.state!==before)throw Error('文档已变化，未应用滤镜；请重新操作。');
   doc.replaceLayerPixels(layer.id,layer,'滤镜：'+FILTERS[settings.kind].name,before.revision);$<HTMLDialogElement>('filter-dialog').close();this.notify('滤镜已应用到当前图层；选区外像素保持原样，可撤销。');
  }catch(error){if(generation===this.generation){$('filter-status').textContent='未应用滤镜';$('filter-error').textContent=error instanceof Error?error.message:String(error);}}
  finally{if(generation===this.generation){this.applying=false;this.controls(false);$<HTMLButtonElement>('filter-apply').disabled=!this.preview;}}
 }
 private stop(){this.cancel();this.applying=false;this.controls(false);this.preview=undefined;this.before=undefined;this.doc=undefined;this.rect=undefined;const canvas=$<HTMLCanvasElement>('filter-preview');canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);}
 dispose(){this.stop();this.abort.abort();}
}
