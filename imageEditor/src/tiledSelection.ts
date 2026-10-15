import type { ImageState } from './document.js';
import type { Color, Point } from './pixelTools.js';
import { sampleRegion } from './tiledEditing.js';
import { runSelection } from './selectionRuns.js';
/** Scan rows into runs, then connect overlapping runs for a four-connected magic wand. */
export async function tiledColorSelection(state:ImageState,color:Color|readonly [number,number,number,number],tolerance:number,seed?:Point,layerId?:string,signal?:AbortSignal){
 if(!Number.isFinite(tolerance)||tolerance<0||tolerance>255)throw Error('颜色容差应在 0–255 内。');const rows:Uint16Array[]=[],alpha=color.length===4?color[3]!:255;let total=0;
 for(let top=0;top<state.height;top+=32){signal?.throwIfAborted();const h=Math.min(32,state.height-top),b=await sampleRegion(state,{x:0,y:top,width:state.width,height:h},layerId,signal);
  for(let y=0;y<h;y++){const out:number[]=[];let start=-1;for(let x=0;x<=b.width;x++){const i=(y*b.width+x)*4,a=b.data[i+3]!,match=x<b.width&&Math.max(Math.abs(a-alpha),Math.abs(b.data[i]!*a/255-color[0]*alpha/255),Math.abs(b.data[i+1]!*a/255-color[1]*alpha/255),Math.abs(b.data[i+2]!*a/255-color[2]*alpha/255))<=tolerance;if(match&&start<0)start=x;if(!match&&start>=0){out.push(start,x,255);start=-1;}}total+=out.length;if(total*2>32*1024*1024)throw Error('颜色选区复杂度超过 32 MiB，请缩小范围。');rows.push(Uint16Array.from(out));}
  await new Promise<void>(r=>setTimeout(r,0));
 }
 if(!seed)return runSelection(state.width,state.height,y=>Array.from(rows[y]!));
 const sx=Math.floor(seed.x),sy=Math.floor(seed.y);if(sx<0||sy<0||sx>=state.width||sy>=state.height)throw Error('取样坐标超出画布。');
 const offsets=new Uint32Array(state.height+1);for(let y=0;y<state.height;y++)offsets[y+1]=offsets[y]!+rows[y]!.length/3;
 const parent=Int32Array.from({length:total/3},(_,i)=>i),root=(n:number):number=>{while(parent[n]!==n){parent[n]=parent[parent[n]!]!;n=parent[n]!;}return n;};let selected=-1;
 for(let y=0;y<state.height;y++){const row=rows[y]!,prev=rows[y-1];for(let i=0,j=0;i<row.length;i+=3){if(y===sy&&row[i]!<=sx&&row[i+1]!>sx)selected=offsets[y]!+i/3;if(!prev)continue;while(j<prev.length&&prev[j+1]!<=row[i]!)j+=3;for(let k=j;k<prev.length&&prev[k]!<row[i+1]!;k+=3){const a=root(offsets[y]!+i/3),b=root(offsets[y-1]!+k/3);if(a!==b)parent[a]=b;}}}
 const target=selected<0?-1:root(selected);return runSelection(state.width,state.height,y=>{const row=rows[y]!,out:number[]=[];for(let i=0;i<row.length;i+=3)if(root(offsets[y]!+i/3)===target)out.push(row[i]!,row[i+1]!,255);return out;});
}
