import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
import {minesweeperExample} from '../dist/minesweeperExample.js';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/minesweeper');mkdirSync(out,{recursive:true});
function neighbors(id,rows,cols) {
 const out=[],x=id%cols,y=Math.floor(id/cols);
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<cols&&y+dy>=0&&y+dy<rows)out.push((y+dy)*cols+x+dx);
 return out;
}
function validate(state,rows,cols,mines,first) {
 assert.equal(state.cells.reduce((s,c)=>s+c[0],0),mines,'exact mine count');
 assert.equal(state.cells[first][0],0,'first click safe');
 for(let i=0;i<state.cells.length;i++)assert.equal(state.cells[i][1],neighbors(i,rows,cols).reduce((s,j)=>s+state.cells[j][0],0),'neighbor count at '+i);
}
function flood(cells,first,rows,cols) {
 const seen=new Set([first]),queue=[first];
 for(let j=0;j<queue.length;j++)if(cells[queue[j]][1]===0)for(const id of neighbors(queue[j],rows,cols))
  if(!seen.has(id)&&cells[id][0]===0&&cells[id][2]!==2){seen.add(id);queue.push(id);}
 return [...seen].sort((a,b)=>a-b);
}
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#editor',downloadDirectory:out,failureScreenshotPath:resolve(out,'failure.png'),timeoutMs:60000,
readinessExpression:'shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled',
scenario:async({evaluate,click,waitFor,cdp,nextPaint})=>{
 let rows=9,cols=9;
 const call=async(operation,params={})=>{
  const r=await evaluate('(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:"1",requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:'+JSON.stringify(operation)+',params:'+JSON.stringify(params)+'});})()');
  assert.equal(r.status,'completed',JSON.stringify(r));return r.value;
 };
 const step=async(n=3)=>{for(let i=0;i<n;i++)await call('shader.playback.step');await nextPaint();};
 const key=async(type,key,code,vk,repeat=false)=>cdp.call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,autoRepeat:repeat});
 const press=async(k,code,vk)=>{await key('keyDown',k,code,vk);await step(2);await key('keyUp',k,code,vk);await step(2);};
 const pointer=async(type,id,shift=false)=>{
  const point=await evaluate('(()=>{const r=document.getElementById("shader-canvas").getBoundingClientRect(),s=shaderEditor.getStatus(),aspect=s.width/s.height;const size=Math.min(.66/'+rows+',Math.max(.12,aspect-(aspect>1.3?.44:.08))/'+cols+');const left=(aspect-size*'+cols+'-(aspect>1.3?.32:0))*.5;const x='+id+'<0?left:left+('+id+'%'+cols+'+.5)*size,y='+id+'<0?.06:.20+(Math.floor('+id+'/'+cols+')+.5)*size;return {x:r.x+r.width*x/aspect,y:r.y+r.height*y};})()');
  await cdp.call('Input.dispatchMouseEvent',{type,...point,button:type==='mouseMoved'?'none':'left',buttons:type==='mouseReleased'?0:1,clickCount:type==='mouseMoved'?0:1,modifiers:shift?8:0});
 };
 const cellClick=async(id,shift=false)=>{
  if(shift)await key('keyDown','Shift','ShiftLeft',16);
  await pointer('mousePressed',id,shift);await step(2);
  await pointer('mouseReleased',id,shift);await step(2);
  if(shift){await key('keyUp','Shift','ShiftLeft',16);await step(2);}
 };
 const read=async()=>{
  const r=await call('shader.image.read');
  return evaluate('(()=>{const b=haiyueEditor.readResource('+JSON.stringify(r.resourceId)+'),w='+r.width+',h='+r.height+';const at=k=>{const i=((h-1-Math.floor(k/w))*w+k%w)*4;return Array.from(b.slice(i,i+4));};const entries=Array.from({length:'+(rows*cols+2)+'},(_,i)=>{const l=at(i*2),h=at(i*2+1);return l.map((v,j)=>v+256*h[j]);});haiyueEditor.releaseResource('+JSON.stringify(r.resourceId)+');return {cells:entries.slice(0,'+(rows*cols)+'),header:entries['+(rows*cols)+'],counts:entries['+(rows*cols+1)+']};})()');
 };
 const shot=async name=>{await nextPaint();const s=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,name),Buffer.from(s.result.data,'base64'));};
 const settle=async()=>{
  let old=await read();
  for(let i=0;i<100;i++){await step(4);const now=await read();if(JSON.stringify(now)===JSON.stringify(old))return now;old=now;}
  throw Error('flood propagation did not settle');
 };
 const open=async(r=9,c=9,mines=10)=>{
  rows=r;cols=c;const p=minesweeperExample();
  p.common=p.common.replace('MINE_ROWS: i32 = 9','MINE_ROWS: i32 = '+r).replace('MINE_COLUMNS: i32 = 9','MINE_COLUMNS: i32 = '+c).replace('MINE_COUNT: i32 = 10','MINE_COUNT: i32 = '+mines);
  // Read exact 16-bit integer data through a tiny test-only image strip, leaving the production passes intact.
  const image=p.passes.find(p=>p.id==='image');
  image.code=image.code.replace('  return vec4f(color, 1.0);','  let probe = dataIndex(fragCoord);\n  if (probe < (CELLS + 2) * 2) {\n    let raw = dataAt(iChannel0, probe / 2);\n    let high = floor(raw / 256.0);\n    return select(raw - high * 256.0, high, probe % 2 == 1) / 255.0;\n  }\n  return vec4f(color, 1.0);');
  const resource=await evaluate('haiyueEditor.putResource(new TextEncoder().encode('+JSON.stringify(JSON.stringify(p))+'))');
  await call('shader.project.open',{resourceId:resource.resourceId});await evaluate('haiyueEditor.releaseResource('+JSON.stringify(resource.resourceId)+')');
  await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'minesweeper compiles');
  assert.deepEqual((await call('shader.query')).diagnostics.filter(d=>d.severity==='error'),[]);
  await call('shader.playback.set',{playing:false});await step();await cellClick(-1); // focus outside the board
 };
 await open();let state=await read();assert.equal(state.header[0],0);assert.equal(state.header[3],0);assert.ok(state.cells.every(c=>c[0]===0&&c[2]===0));
 await shot('ready.png');
 // Pre-game flags do not plant mines, and normal clicks cannot open a flagged cell.
 await cellClick(0,true);state=await read();assert.equal(state.cells[0][2],2);assert.equal(state.header[0],0);assert.equal(state.counts[0],1);
 await cellClick(0);assert.equal((await read()).header[3],0);
 await key('keyDown','f','KeyF',70);await step();assert.equal((await read()).counts[2],1);
 await key('keyDown','f','KeyF',70,true);await step();assert.equal((await read()).counts[2],1,'OS repeat does not retoggle mode');
 await key('keyUp','f','KeyF',70);await step();await cellClick(0);assert.equal((await read()).cells[0][2],0);
 await press('f','KeyF',70);assert.equal((await read()).counts[2],0);
 await cellClick(-1);assert.equal((await read()).header[3],0,'outside clicks do not start the board');
 await cellClick(40);state=await settle();validate(state,9,9,10,40);
 for(const id of [40,...neighbors(40,9,9)])assert.equal(state.cells[id][0],0,'safe first neighborhood');
 assert.deepEqual(state.cells.flatMap((c,i)=>c[2]===1?[i]:[]),flood(state.cells,40,9,9),'flood matches independent BFS');
 await shot('playing.png');
 const firstBoard=state.cells.map(c=>c[0]),mine=state.cells.findIndex(c=>c[0]===1);
 await cellClick(mine,true);state=await read();assert.equal(state.cells[mine][2],2);assert.equal(state.counts[0],1);
 await cellClick(mine);assert.notEqual((await read()).header[0],3,'flag protects against reveal');
 await cellClick(mine,true);await cellClick(mine);state=await settle();assert.equal(state.header[0],3);assert.equal(state.cells[mine][2],3);
 await shot('lost.png');const lost=state.cells;
 await cellClick(state.cells.findIndex(c=>c[2]===0),true);assert.deepEqual((await read()).cells,lost,'loss freezes cells');
 await press('r','KeyR',82);state=await read();assert.equal(state.header[0],0);assert.equal(state.header[2],1);assert.equal(state.counts[0],0);
 await pointer('mousePressed',40);await step(3);state=await settle();validate(state,9,9,10,40);
 assert.notDeepEqual(state.cells.map(c=>c[0]),firstBoard,'restart uses a new field');
 const dragMine=state.cells.findIndex(c=>c[0]===1);
 await pointer('mouseMoved',dragMine);await step();assert.notEqual((await read()).header[0],3,'dragging while held cannot reveal a second cell');
 await pointer('mouseReleased',dragMine);await step();
 await click('document.querySelector("#code-editor .cm-content")');
 const snapshot=(await read()).cells;await press('r','KeyR',82);assert.deepEqual((await read()).cells,snapshot,'editor typing does not restart');
 // Rectangular geometry: exact counts, coordinate hit-testing and flood boundaries.
 await open(4,7,8);await cellClick(24);state=await settle();validate(state,4,7,8,24);assert.equal(state.header[3],25);
 await shot('rectangular.png');
 // Complete a normal game by revealing every remaining safe cell; flags alone do not win.
 await open(4,4,3);await cellClick(5);state=await settle();validate(state,4,4,3,5);
 for(let i=0;i<16;i++)if(state.cells[i][0]===0&&state.cells[i][2]===0){await cellClick(i);state=await settle();}
 assert.equal(state.header[0],2);assert.equal(state.counts[1],13);assert.equal(state.counts[0],3);assert.ok(state.cells.filter(c=>c[0]===1).every(c=>c[2]===2));await shot('won.png');
 const won=state.cells;await cellClick(state.cells.findIndex(c=>c[0]===1));assert.deepEqual((await read()).cells,won,'win freezes cells');
 // Dense boards retain exact clamped mine counts and protect the only safe first cell.
 await open(2,3,999);await cellClick(4);state=await settle();validate(state,2,3,5,4);assert.equal(state.header[0],2);
 // Largest board, metadata beyond 255 and a complete multi-frame blank expansion.
 await open(20,20,1);await cellClick(399);state=await settle();validate(state,20,20,1,399);
 assert.equal(state.header[3],400);assert.equal(state.counts[1],399);assert.equal(state.header[0],2);
 const saved=await call('shader.project.export');await call('shader.project.open',{resourceId:saved.resourceId});
 await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'reopen');await step();
 assert.match((await call('shader.query')).common,/MINE_ROWS: i32 = 20/);assert.equal((await read()).header[0],0,'project persists settings, starts a fresh board');
 return {status:'passed',checks:['Exact mine counts and all eight-neighbor numbers on 9x9, 4x7, 4x4, dense 2x3 and maximum 20x20 boards','First click and available 3x3 protection; flood matches independent BFS','Shift flags, F mode, no repeats or drag reveals, focus isolation and R restart','Mine hit/loss, complete win and terminal-state locks','High-density count clamp, 399-cell flood and parameters preserved through export/reopen']};
}});
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

