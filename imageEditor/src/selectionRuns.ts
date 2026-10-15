import type { Selection } from './selection.js';
/** Per-row [start,end,coverage] runs. Coordinates fit the 30,000 px document limit. */
export type SelectionRuns = readonly Uint16Array[];
export const RUN_BUDGET = 32 * 1024 * 1024;
export function runWeight(row: Uint16Array, x: number): number {
 let lo=0,hi=row.length/3;while(lo<hi){const m=(lo+hi)>>>1;if(row[m*3+1]!<=x)lo=m+1;else hi=m;}
 return lo*3<row.length&&row[lo*3]!<=x?row[lo*3+2]!/255:0;
}
export function selectionRow(s:Selection|undefined|null,y:number,left=0,right=30000):number[]{
 if(!s||y<s.y||y>=s.y+s.height)return [];
 const out:number[]=[];const add=(a:number,b:number,v:number)=>{a=Math.max(left,a);b=Math.min(right,b);if(a<b&&v)out.push(a,b,v);};
 if(s.runs){const row=s.runs[y-s.y]!;for(let i=0;i<row.length;i+=3)add(s.x+row[i]!,s.x+row[i+1]!,row[i+2]!);}
 else if(s.mask){const row=(y-s.y)*s.width;let start=0,v=s.mask[row]!;for(let x=1;x<=s.width;x++){const next=x<s.width?s.mask[row+x]!:0;if(next!==v||x===s.width){add(s.x+start,s.x+x,v);start=x;v=next;}}}
 else add(s.x,s.x+s.width,255);return out;
}
export function runSelection(width:number,height:number,read:(y:number)=>readonly number[]):Selection {
 const rows:Uint16Array[]=[];let bytes=0,x0=width,x1=0,y0=height,y1=0;
 for(let y=0;y<height;y++){const row=read(y);bytes+=row.length*2;if(bytes>RUN_BUDGET)throw Error('选区复杂度超过 32 MiB，请缩小范围。');const data=Uint16Array.from(row);rows.push(data);if(row.length){x0=Math.min(x0,row[0]!);x1=Math.max(x1,row[row.length-2]!);y0=Math.min(y0,y);y1=y+1;}}
 if(y1<=y0)return {x:0,y:0,width:1,height:1,mask:new Uint8Array(1)};
 const trimmed=rows.slice(y0,y1).map(row=>{for(let i=0;i<row.length;i+=3){row[i]!-=x0;row[i+1]!-=x0;}return row;});
 if(trimmed.every(r=>r.length===3&&r[0]===0&&r[1]===x1-x0&&r[2]===255))return {x:x0,y:y0,width:x1-x0,height:y1-y0};
 return {x:x0,y:y0,width:x1-x0,height:y1-y0,runs:trimmed};
}
export function combineRows(a:readonly number[],b:readonly number[],kind:'add'|'subtract'|'intersect'):number[]{
 const cuts=[...new Set([...a.filter((_,i)=>i%3!==2),...b.filter((_,i)=>i%3!==2)])].sort((x,y)=>x-y),out:number[]=[];let ai=0,bi=0;
 for(let i=0;i+1<cuts.length;i++){const x=cuts[i]!,end=cuts[i+1]!;while(ai<a.length&&a[ai+1]!<=x)ai+=3;while(bi<b.length&&b[bi+1]!<=x)bi+=3;const av=ai<a.length&&a[ai]!<=x?a[ai+2]!:0,bv=bi<b.length&&b[bi]!<=x?b[bi+2]!:0,v=kind==='add'?Math.max(av,bv):kind==='subtract'?Math.max(0,av-bv):Math.min(av,bv);if(v){if(out.length&&out.at(-2)===x&&out.at(-1)===v)out[out.length-2]=end;else out.push(x,end,v);}}
 return out;
}
export function validateRuns(s:Selection):number {
 if(!s.runs)return 0;if(s.mask||!Array.isArray(s.runs)||s.runs.length!==s.height)throw Error('选区扫描线无效。');let bytes=0;
 for(const row of s.runs){if(!(row instanceof Uint16Array)||row.length%3)throw Error('选区扫描线无效。');bytes+=row.byteLength;let end=0;for(let i=0;i<row.length;i+=3){if(row[i]!<end||row[i]!>=row[i+1]!||row[i+1]!>s.width||row[i+2]!<1||row[i+2]!>255)throw Error('选区扫描线范围无效。');end=row[i+1]!;}}
 if(bytes>RUN_BUDGET)throw Error('选区扫描线超过预算。');return bytes;
}
export function cloneSelection(s:Selection):Selection{return {...s,...(s.mask?{mask:s.mask.slice()}:{}),...(s.runs?{runs:s.runs.map(r=>r.slice())}:{})};}
