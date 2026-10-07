import test from 'node:test';import assert from 'node:assert/strict';import {PsdJobs} from '../dist/psdJobs.js';
test('PSD job cancellation terminates worker, clears busy and permits retry',async()=>{
  const original=globalThis.Worker;let current;const status=[];
  class Worker{constructor(){current=this;}postMessage(){}terminate(){this.terminated=true;}}
  globalThis.Worker=Worker;
  try{const jobs=new PsdJobs(busy=>status.push(busy)),first=jobs.import(new Uint8Array(),'first.psd');const worker=current;
    await assert.rejects(jobs.import(new Uint8Array(),'second.psd'),/另一项/);jobs.cancel();await assert.rejects(first,/取消/);assert(worker.terminated);
    const second=jobs.import(new Uint8Array(),'retry.psd');current.onmessage({data:{ok:true,value:{layered:null}}});assert.deepEqual(await second,{layered:null});assert(current.terminated);assert.deepEqual(status,[true,false,true,false]);
  }finally{globalThis.Worker=original;}
});
test('PSD worker parse error never resolves as success',async()=>{
  const original=globalThis.Worker;let current;
  globalThis.Worker=class{constructor(){current=this;}postMessage(){}terminate(){this.stopped=true;}};
  try{const jobs=new PsdJobs(()=>{}),pending=jobs.import(new Uint8Array(),'broken.psd');current.onmessage({data:{ok:false,error:'截断'}});await assert.rejects(pending,/截断/);assert(current.stopped);}
  finally{globalThis.Worker=original;}
});
