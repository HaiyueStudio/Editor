import { type ImageDocument, type ImageLayer, type ImageState } from './document.js';
import { FILTERS, type FilterKind } from './filters.js';
import { paintDocument } from './canvasView.js';
import { editablePixel, replacePixel } from './pixelTools.js';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export class FilterPanel {
  private worker:Worker|undefined; private timer:ReturnType<typeof setTimeout>|undefined; private debounce:ReturnType<typeof setTimeout>|undefined;
  private generation=0;private doc:ImageDocument|undefined;private before:ImageState|undefined;private result:ImageLayer|undefined;
  private abort=new AbortController();
  constructor(private active:()=>ImageDocument|undefined,private notify:(message:string,error?:boolean)=>void){
    const select=$<HTMLSelectElement>('filter-kind');for(const [value,config] of Object.entries(FILTERS)){const option=document.createElement('option');option.value=value;option.textContent=config.name;select.append(option);}
    const options={signal:this.abort.signal};
    select.addEventListener('change',()=>{this.configure();this.schedule();},options);
    $('filter-amount').addEventListener('input',()=>this.schedule(),options);
    $('filter-original').addEventListener('change',()=>this.render(),options);
    // The previous session's queued close event can arrive after a fast reopen.
    $('filter-dialog').addEventListener('close',()=>{if(!$<HTMLDialogElement>('filter-dialog').open)this.stop();},options);
    $('filter-form').addEventListener('submit',event=>{event.preventDefault();this.apply();},options);
  }
  open(){
    this.stop();const doc=this.active();if(!doc?.selected)throw new Error('请先选择像素图层。');
    if(!editablePixel(doc.state,doc.selected.id).bitmap)throw new Error('请选择含像素的图层。');
    this.doc=doc;this.before=doc.state;$<HTMLInputElement>('filter-original').checked=false;
    this.configure();$<HTMLDialogElement>('filter-dialog').showModal();this.render();this.schedule();
  }
  private configure(){const config=FILTERS[$<HTMLSelectElement>('filter-kind').value as FilterKind],input=$<HTMLInputElement>('filter-amount');input.min=String(config.min);input.max=String(config.max);input.value=String(config.value);$('filter-unit').textContent=config.unit;}
  private cancelWorker(){this.generation++;this.worker?.terminate();this.worker=undefined;clearTimeout(this.timer);clearTimeout(this.debounce);}
  private schedule(){
    this.cancelWorker();this.result=undefined;$<HTMLButtonElement>('filter-apply').disabled=true;
    $('filter-value').textContent=$<HTMLInputElement>('filter-amount').value;$('filter-error').textContent='';$('filter-status').textContent='正在生成预览…';
    this.debounce=setTimeout(()=>this.compute(),100);
  }
  private compute(){
    if(!this.before||!this.doc?.selected)return;const generation=this.generation;
    const fail=(message:string)=>{if(generation!==this.generation)return;this.cancelWorker();$('filter-status').textContent='预览失败';$('filter-error').textContent=message;};
    try{
      const worker=this.worker=new Worker(new URL('./filter-worker.js',import.meta.url),{type:'module'});
      this.timer=setTimeout(()=>fail('滤镜处理超时，请缩小图层后重试。'),120000);
      worker.onerror=event=>{event.preventDefault();fail('滤镜处理失败：'+event.message);};
      worker.onmessage=(event:MessageEvent<{layer?:ImageLayer;error?:string}>)=>{
        if(generation!==this.generation)return;
        if(event.data.error||!event.data.layer){fail(event.data.error??'滤镜未返回有效结果。');return;}
        this.result=event.data.layer;this.cancelWorker();$('filter-status').textContent='预览已更新 · 应用后可撤销';$<HTMLButtonElement>('filter-apply').disabled=false;this.render();
      };
      const selectedId=this.before.selectedId;
      const strip=(layers:readonly ImageLayer[]):ImageLayer[]=>layers.map(layer=>({...layer,bitmap:layer.id===selectedId?layer.bitmap:null,children:strip(layer.children)}));
      worker.postMessage({state:{...this.before,layers:strip(this.before.layers),psdOrigin:undefined},id:selectedId,settings:{kind:$<HTMLSelectElement>('filter-kind').value,amount:Number($<HTMLInputElement>('filter-amount').value)}});
    }catch(error){fail(String(error));}
  }
  private render(){
    if(!this.before)return;const state=this.result&&!$<HTMLInputElement>('filter-original').checked?{...this.before,layers:replacePixel(this.before.layers,this.result.id,this.result)}:this.before;
    const source=document.createElement('canvas');paintDocument(source,state);
    const canvas=$<HTMLCanvasElement>('filter-preview'),ctx=canvas.getContext('2d')!,scale=Math.min(canvas.width/state.width,canvas.height/state.height);
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,(canvas.width-state.width*scale)/2,(canvas.height-state.height*scale)/2,state.width*scale,state.height*scale);source.width=source.height=1;
  }
  private apply(){
    try{if(!this.result||!this.before||!this.doc)return;if(this.active()!==this.doc||this.doc.state!==this.before)throw new Error('文档已变化，请关闭滤镜后重新操作。');
      this.doc.replaceLayerPixels(this.result.id,this.result,'滤镜：'+FILTERS[$<HTMLSelectElement>('filter-kind').value as FilterKind].name,this.before.revision);
      $<HTMLDialogElement>('filter-dialog').close();this.notify('滤镜已应用到当前图层；选区外像素保持原样，可撤销。');
    }catch(error){$('filter-error').textContent=error instanceof Error?error.message:String(error);}
  }
  private stop(){const canvas=$<HTMLCanvasElement>('filter-preview');canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);this.cancelWorker();this.result=undefined;this.before=undefined;this.doc=undefined;}
  dispose(){this.stop();this.abort.abort();}
}
