import type { ImageState } from './document.js';
import { compositeRegionAsync } from './diskCompositor.js';
import { colorDisplay } from './iccEngine.js';
import { srgbProfileBytes } from './colorManagement.js';
import type { ByteSink } from './streamingPng.js';
// Baseline sequential DCT, T.81 Annexes A/B/C/F. Independent encoder, 4:4:4 sampling.
const zigzag:number[]=[];for(let sum=0;sum<=14;sum++){const line:number[]=[];for(let y=0;y<8;y++){const x=sum-y;if(x>=0&&x<8)line.push(y*8+x);}zigzag.push(...(sum%2?line:line.reverse()));}
const basis=Float64Array.from({length:64},(_,i)=>.5*(i<8?Math.SQRT1_2:1)*Math.cos((2*(i%8)+1)*Math.floor(i/8)*Math.PI/16));
const symbols=[0,240];for(let run=0;run<16;run++)for(let size=1;size<=10;size++)symbols.push(run*16+size);
const acCodes=new Map(symbols.map((s,i)=>[s,i]));
const word=(n:number)=>[n>>>8,n&255];
/** Output chunks respect backpressure; at most eight source rows and one MCU are decoded. */
export async function streamJpeg(state:ImageState,sink:ByteSink,quality=.92,embedProfile=true,signal?:AbortSignal){
 if(!Number.isFinite(quality)||quality<.01||quality>1)throw Error('JPEG 质量应为 0.01–1。');if(state.width>65535||state.height>65535)throw Error('JPEG 尺寸超过 65535。');signal?.throwIfAborted();
 const output={...state,...(state.icc?{icc:{intent:state.icc.intent,bpc:state.icc.bpc,proofIntent:1 as const,gamutWarning:false}}:{})},q=Float64Array.from({length:64},(_,i)=>Math.max(1,Math.min(255,Math.round((1+Math.floor(i/8)+i%8)*(1-quality)*24))));
 const marker=async(id:number,data:number[]|Uint8Array)=>{const out=new Uint8Array(data.length+4);out.set([255,id,...word(data.length+2)]);out.set(data,4);signal?.throwIfAborted();await sink(out);};
 await sink(new Uint8Array([255,216]));await marker(224,[74,70,73,70,0,1,1,0,0,1,0,1,0,0]);
 if(embedProfile){const profile=srgbProfileBytes(),size=65519,count=Math.ceil(profile.length/size);for(let i=0;i<count;i++){const part=profile.subarray(i*size,(i+1)*size),data=new Uint8Array(14+part.length);data.set(new TextEncoder().encode('ICC_PROFILE\0'));data[12]=i+1;data[13]=count;data.set(part,14);await marker(226,data);}}
 await marker(219,[0,...zigzag.map(i=>q[i]!)]);
 await marker(192,[8,...word(state.height),...word(state.width),3,1,17,0,2,17,0,3,17,0]);
 const dcCounts=Array(16).fill(0),acCounts=Array(16).fill(0);dcCounts[3]=12;acCounts[7]=symbols.length;
 await marker(196,[0,...dcCounts,...Array.from({length:12},(_,i)=>i),16,...acCounts,...symbols]);
 await marker(218,[3,1,0,2,0,3,0,0,63,0]);
 let byte=0,bits=0,buffer=new Uint8Array(65536),at=0;const queued:Uint8Array[]=[];
 const emit=(n:number)=>{buffer[at++]=n;if(at===buffer.length){queued.push(buffer);buffer=new Uint8Array(65536);at=0;}};
 const put=(value:number,count:number)=>{for(let i=count-1;i>=0;i--){byte=(byte<<1)|((value>>>i)&1);if(++bits===8){emit(byte);if(byte===255)emit(0);byte=bits=0;}}};
 const magnitude=(v:number)=>v?Math.floor(Math.log2(Math.abs(v)))+1:0,amplitude=(v:number,n:number)=>{if(n)put(v<0?v+(1<<n)-1:v,n);};
 const tmp=new Float64Array(64),coeff=new Int32Array(64),block=new Float64Array(64),previous=[0,0,0];
 const encode=(channel:number)=>{for(let y=0;y<8;y++)for(let u=0;u<8;u++){let sum=0;for(let x=0;x<8;x++)sum+=block[y*8+x]!*basis[u*8+x]!;tmp[y*8+u]=sum;}for(let v=0;v<8;v++)for(let u=0;u<8;u++){let sum=0;for(let y=0;y<8;y++)sum+=tmp[y*8+u]!*basis[v*8+y]!;coeff[v*8+u]=Math.round(sum/q[v*8+u]!);}
  const delta=coeff[0]!-previous[channel]!,n=magnitude(delta);previous[channel]=coeff[0]!;put(n,4);amplitude(delta,n);let zeros=0;for(let k=1;k<64;k++){const v=coeff[zigzag[k]!]!;if(!v){zeros++;continue;}while(zeros>=16){put(acCodes.get(240)!,8);zeros-=16;}const n=magnitude(v);put(acCodes.get(zeros*16+n)!,8);amplitude(v,n);zeros=0;}if(zeros)put(acCodes.get(0)!,8);
 };
 const flush=async()=>{for(const b of queued){signal?.throwIfAborted();await sink(b);}queued.length=0;};
 for(let top=0;top<state.height;top+=8){signal?.throwIfAborted();const h=Math.min(8,state.height-top),b=colorDisplay(await compositeRegionAsync(state,{x:0,y:top,width:state.width,height:h},signal),output);
  for(let left=0;left<state.width;left+=8){for(let c=0;c<3;c++){for(let y=0;y<8;y++)for(let x=0;x<8;x++){const i=(Math.min(y,h-1)*b.width+Math.min(left+x,b.width-1))*4,a=b.data[i+3]!/255,r=b.data[i]!*a+255*(1-a),g=b.data[i+1]!*a+255*(1-a),blue=b.data[i+2]!*a+255*(1-a);block[y*8+x]=c===0?.299*r+.587*g+.114*blue-128:c===1?-.168736*r-.331264*g+.5*blue:.5*r-.418688*g-.081312*blue;}encode(c);}if(queued.length)await flush();}
  await flush();await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 if(bits)put((1<<(8-bits))-1,8-bits);await flush();if(at)await sink(buffer.slice(0,at));signal?.throwIfAborted();await sink(new Uint8Array([255,217]));
}
