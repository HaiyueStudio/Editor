import { adjustmentBitmap } from './nonDestructiveRender.js';
import { validateContent, type CurvePoint } from './layerFeatures.js';
/** Direct manipulation and an editable numeric representation use the same validated points. */
export class CurveEditor {
 private values:CurvePoint[]=[{input:0,output:0},{input:255,output:255}];
 private drag:number|undefined;
 private canvas=document.getElementById('curve-editor') as HTMLCanvasElement;
 private input=document.getElementById('curve-points') as HTMLInputElement;
 constructor(){
  const position=(e:PointerEvent|MouseEvent)=>{const r=this.canvas.getBoundingClientRect();return {input:Math.max(0,Math.min(255,Math.round((e.clientX-r.left)*255/r.width))),output:Math.max(0,Math.min(255,255-Math.round((e.clientY-r.top)*255/r.height)))};};
  this.canvas.addEventListener('pointerdown',e=>{if(e.button)return;const p=position(e);let i=this.values.findIndex(v=>Math.hypot(v.input-p.input,v.output-p.output)<12);if(i<0){if(this.values.length>=16||this.values.some(v=>v.input===p.input))return;this.values.push(p);this.values.sort((a,b)=>a.input-b.input);i=this.values.indexOf(p);}this.drag=i;this.canvas.setPointerCapture(e.pointerId);this.draw();});
  this.canvas.addEventListener('pointermove',e=>{if(this.drag===undefined)return;const i=this.drag,p=position(e);p.input=i===0?0:i===this.values.length-1?255:Math.max(this.values[i-1]!.input+1,Math.min(this.values[i+1]!.input-1,p.input));this.values[i]=p;this.draw();});
  const release=()=>{this.drag=undefined;};this.canvas.addEventListener('pointerup',release);this.canvas.addEventListener('pointercancel',release);this.canvas.addEventListener('lostpointercapture',release);
  this.canvas.addEventListener('contextmenu',e=>{e.preventDefault();const p=position(e),i=this.values.findIndex(v=>Math.hypot(v.input-p.input,v.output-p.output)<12);if(i>0&&i<this.values.length-1){this.values.splice(i,1);this.draw();}});
  this.input.addEventListener('change',()=>{try{this.values=this.points();this.input.setCustomValidity('');this.draw();}catch(e){this.input.setCustomValidity(String(e));this.input.reportValidity();}});
 }
 set(points:readonly CurvePoint[]){this.input.setCustomValidity('');this.values=points.map(p=>({...p}));this.draw();}
 points():CurvePoint[]{const points=this.input.value.split(/[,;\n]+/).map(s=>{const [input,output]=s.trim().split(':').map(Number);return {input:input!,output:output!};});validateContent({type:'adjustment',filter:'curves',amount:100,curves:points});return points;}
 private draw(){const ctx=this.canvas.getContext('2d')!;ctx.clearRect(0,0,256,256);ctx.fillStyle='#1e2228';ctx.fillRect(0,0,256,256);ctx.strokeStyle='#404853';for(let i=0;i<=256;i+=64){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,256);ctx.moveTo(0,i);ctx.lineTo(256,i);ctx.stroke();}
  const data=Uint8ClampedArray.from({length:256*4},(_,i)=>i%4===3?255:Math.floor(i/4)),lut=adjustmentBitmap({width:256,height:1,data},{type:'adjustment',filter:'curves',amount:100,curves:this.values});ctx.strokeStyle='#8bd5ff';ctx.beginPath();for(let x=0;x<256;x++)x?ctx.lineTo(x,255-lut.data[x*4]!):ctx.moveTo(0,255-lut.data[0]!);ctx.stroke();ctx.fillStyle='#ffb17d';for(const p of this.values){ctx.beginPath();ctx.arc(p.input,255-p.output,4,0,Math.PI*2);ctx.fill();}this.input.value=this.values.map(p=>`${p.input}:${p.output}`).join(', ');
 }
}
