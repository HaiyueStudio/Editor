import type { ImageDocument } from './document.js';
import type { Histogram } from './histogram.js';
import { pixelJob } from './pixelJobs.js';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export function drawHistogram(canvas:HTMLCanvasElement,h:Histogram,channel:string='rgb') {
 const ctx=canvas.getContext('2d')!,w=canvas.width,hgt=canvas.height;ctx.clearRect(0,0,w,hgt);ctx.fillStyle='#191d23';ctx.fillRect(0,0,w,hgt);
 const names=channel==='rgb'?['red','green','blue']:[channel],colors:Record<string,string>={red:'#f07070',green:'#70d790',blue:'#70aaff',luminance:'#d6dde6'};
 ctx.globalAlpha=names.length===1?1:.65;
 const maximum=Math.max(1,...names.flatMap(k=>h[k as 'red']));for(const name of names){ctx.fillStyle=colors[name]!;const bins=h[name as 'red'];for(let i=0;i<256;i++){const height=bins[i]!/maximum*(hgt-4);ctx.fillRect(i*w/256,hgt-height,Math.max(1,w/256),height);}}ctx.globalAlpha=1;
}
export class HistogramPanel {
 private controller:AbortController|undefined;
 constructor(private active:()=>ImageDocument|undefined){
  document.body.insertAdjacentHTML('beforeend',`<dialog id="histogram-dialog"><h2>直方图</h2><label>来源<select id="histogram-source"><option value="composite">可见合成</option><option value="layer">当前图层</option></select></label><label>通道<select id="histogram-channel"><option value="rgb">RGB 叠加</option><option value="red">红</option><option value="green">绿</option><option value="blue">蓝</option><option value="luminance">亮度</option></select></label><label><input type="checkbox" id="histogram-selection">仅选区</label><canvas id="histogram-canvas" width="512" height="180" aria-label="图像直方图"></canvas><p id="histogram-info" role="status"></p><p class="muted">透明度与选区覆盖率加权；亮度按 sRGB 编码值计算。</p><div class="dialog-actions"><button id="histogram-refresh">刷新</button><button data-close-dialog>关闭</button></div></dialog>`);
  for(const id of ['histogram-source','histogram-channel','histogram-selection'])$(id).addEventListener('change',()=>void this.refresh());$('histogram-refresh').onclick=()=>void this.refresh();$('histogram-dialog').addEventListener('close',()=>{if(!$<HTMLDialogElement>('histogram-dialog').open)this.controller?.abort();});
 }
 open(){if(!this.active())throw new Error('请先打开文档。');$<HTMLDialogElement>('histogram-dialog').showModal();void this.refresh();}
 private async refresh(){this.controller?.abort();const controller=this.controller=new AbortController(),doc=this.active();if(!doc)return;const state=doc.state;
  try{$('histogram-info').textContent='正在计算…';const layerId=$<HTMLSelectElement>('histogram-source').value==='layer'?state.selectedId:undefined;if(layerId===null)throw new Error('请选择图层。');const h=await pixelJob<Histogram>({kind:'histogram',state,id:layerId,selectionOnly:$<HTMLInputElement>('histogram-selection').checked},controller.signal);if(this.active()!==doc||doc.state!==state)throw new Error('文档已变化，请刷新。');drawHistogram($<HTMLCanvasElement>('histogram-canvas'),h,$<HTMLSelectElement>('histogram-channel').value);$('histogram-info').textContent=`有效像素 ${h.pixels} · 加权像素 ${h.weight.toFixed(2)} · 均值 ${h.mean.toFixed(2)} · 中位数 ${h.median} · 标准差 ${h.deviation.toFixed(2)}`;
  }catch(e){if(!controller.signal.aborted){$<HTMLCanvasElement>('histogram-canvas').getContext('2d')!.clearRect(0,0,512,180);$('histogram-info').textContent=e instanceof Error?e.message:String(e);}}
 }
 dispose(){this.controller?.abort();}
}
