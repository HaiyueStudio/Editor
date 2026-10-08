import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundPlayer} from '../dist/soundPlayer.js';
import {SOUND_RATE,SOUND_BLOCK} from '../dist/sound.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const audio=(start,count)=>({sampleRate:SOUND_RATE,left:Float32Array.from({length:count},(_,i)=>(start+i)%101/101),right:new Float32Array(count)});
function harness(){
 const saved=Object.getOwnPropertyDescriptors(globalThis),timers=new Set(),scheduled=[];
 class Context{
  currentTime=0;state='running';nodes=new Set();
  constructor(){Context.last=this;}
  createGain(){return {gain:{value:0,setTargetAtTime(){}},connect(){}};}
  createBuffer(channels,length,rate){const values=[new Float32Array(length),new Float32Array(length)];return {length,duration:length/rate,getChannelData:i=>values[i]};}
  createBufferSource(){const ctx=this;const node={buffer:null,onended:null,connect(){},disconnect(){},stop(){ctx.nodes.delete(node);},start(at){node.end=at+node.buffer.duration;ctx.nodes.add(node);scheduled.push({at,end:node.end,length:node.buffer.length,first:node.buffer.getChannelData(0)[0]});}};return node;}
  async resume(){this.state='running';}async close(){this.state='closed';}
 }
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userActivation:{isActive:true}}});
 globalThis.AudioContext=Context;globalThis.setInterval=fn=>{timers.add(fn);return fn;};globalThis.clearInterval=fn=>timers.delete(fn);
 return {scheduled,timers,get context(){return Context.last;},async advance(time){const c=Context.last;c.currentTime=time;for(const node of [...c.nodes])if(node.end<=time){c.nodes.delete(node);node.onended?.();}for(const timer of [...timers])timer();await settle();},
 restore(){for(const name of ['AudioContext','navigator','setInterval','clearInterval']){if(saved[name])Object.defineProperty(globalThis,name,saved[name]);else delete globalThis[name];}}};
}
test('rolling playback passes 16/60/120 seconds with exact contiguous samples and bounded scheduled buffers',async()=>{
 const h=harness(),p=new SoundPlayer(),calls=[];let error;
 try{
  p.onError=value=>{error=value;};
  p.load(audio(0,2*SOUND_BLOCK),async(start,count)=>{calls.push(start);return audio(start,count);});
  await p.unlock();p.play(0);await settle();
  for(let t=.25;t<130;t+=.25){await h.advance(t);assert.ok(h.context.nodes.size<=4);}
  assert.equal(error,undefined);assert.equal(p.playing,true);assert.ok(p.position>129);
  let index=0;
  for(let i=0;i<h.scheduled.length;i++){const b=h.scheduled[i];assert.ok(Math.abs(b.first-index%101/101)<1e-6);if(i)assert.ok(Math.abs(b.at-h.scheduled[i-1].end)<1e-9);index+=b.length;}
  assert.equal(calls[0],2*SOUND_BLOCK);assert.equal(new Set(calls).size,calls.length);
  const offset=p.position;p.pause();assert.equal(h.timers.size,0);assert.equal(h.context.nodes.size,0);
  const resumed=calls.length;p.play(offset);await settle();assert.equal(calls[resumed],Math.floor(offset*SOUND_RATE));
  p.mute();assert.equal(p.armed,false);
 }finally{await p.dispose();h.restore();}
});
test('pause/replacement discard pending chunks and underruns retain the next sample',async()=>{
 const h=harness(),p=new SoundPlayer();const pending=[];
 try{
  const produce=(start,count,current)=>new Promise(resolve=>pending.push({start,count,current,resolve}));
  p.load(audio(0,1),produce);await p.unlock();p.play(0);await settle();
  assert.equal(pending[0].start,1);await h.advance(2);assert.ok(p.position<.001);
  pending.shift().resolve(audio(1,SOUND_BLOCK));await settle();
  assert.ok(Math.abs(p.position-1/SOUND_RATE)<1e-8,'late block does not skip source samples');
  const stale=pending.shift();p.pause();const count=h.scheduled.length;assert.equal(stale.current(),false);
  stale.resolve(audio(stale.start,stale.count));await settle();assert.equal(h.scheduled.length,count);
  p.load(audio(0,2*SOUND_BLOCK),async(start,n)=>audio(start,n));p.play(0);await settle();assert.ok(p.position<.001);
  p.mute();assert.equal(h.context.nodes.size,0);assert.equal(h.timers.size,0);
 }finally{await p.dispose();h.restore();}
});

test('a gesture can unlock before synthesis; mute cancels pending authorization',async()=>{
 const h=harness(),p=new SoundPlayer();
 try{
  navigator.userActivation.isActive=false;await assert.rejects(p.unlock(),/点击/);assert.equal(h.context,undefined);
  navigator.userActivation.isActive=true;await p.unlock();assert.equal(p.armed,true);assert.equal(p.playing,false);
  navigator.userActivation.isActive=false;p.load(audio(0,SOUND_BLOCK));p.play(0);await settle();assert.equal(p.playing,true);
  p.mute();h.context.state='suspended';navigator.userActivation.isActive=true;
  const pending=p.unlock();p.mute();await pending;assert.equal(p.armed,false);p.play(0);assert.equal(p.playing,false);
 }finally{await p.dispose();h.restore();}
});
