import type {RasterSource} from './rasterSource.js';
/** TIFF 6.0 MSB-first LZW with the TIFF early-change code-width convention. */
export async function tiffLzw(source:RasterSource,offset:number,length:number,expected:number,output:(b:Uint8Array)=>Promise<void>,signal?:AbortSignal){
 const prefix=new Int16Array(4096),suffix=new Uint8Array(4096),stack=new Uint8Array(4097);for(let i=0;i<256;i++)suffix[i]=i;let width=9,next=258,previous=-1,first=0,bits=0,acc=0,position=0,chunk:Uint8Array=new Uint8Array(),at=0,total=0,pending=new Uint8Array(65536),used=0,ended=false;
 // Await only bounded I/O, never individual codes or samples.
 while(!ended){signal?.throwIfAborted();while(bits<width){if(at===chunk.length){if(position>=length)throw Error('TIFF LZW 截断。');const n=Math.min(65536,length-position);chunk=await source.read(offset+position,n,signal);if(chunk.length!==n)throw Error('TIFF LZW 截断。');position+=n;at=0;}acc=acc*256+chunk[at++]!;bits+=8;}bits-=width;const code=Math.floor(acc/2**bits);acc%=2**bits;
 if(code===256){width=9;next=258;previous=-1;continue;}if(code===257){ended=true;break;}if(code>next||code===next&&previous<0||code>=4096)throw Error('TIFF LZW 字典无效。');let current=code,n=0;if(code===next){stack[n++]=first;current=previous;}while(current>=258){if(n>=4096||current>=next)throw Error('TIFF LZW 字典循环。');stack[n++]=suffix[current]!;current=prefix[current]!;}if(current>255||current<0)throw Error('TIFF LZW 样本无效。');first=current;stack[n++]=first;if(total+n>expected)throw Error('TIFF LZW 解压超过条带尺寸。');total+=n;while(n){pending[used++]=stack[--n]!;if(used===pending.length){await output(pending);signal?.throwIfAborted();pending=new Uint8Array(65536);used=0;}}
 if(previous>=0&&next<4096){prefix[next]=previous;suffix[next]=first;next++;if(width<12&&next===(1<<width)-1)width++;}previous=code;
 }if(used)await output(pending.subarray(0,used));if(total!==expected)throw Error('TIFF LZW 长度错误。');
}
