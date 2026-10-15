import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
import {puzzleExample} from '../dist/puzzleExample.js';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/puzzle');mkdirSync(out,{recursive:true});
const directions=[null,['ArrowLeft','ArrowLeft',37],['ArrowRight','ArrowRight',39],['ArrowUp','ArrowUp',38],['ArrowDown','ArrowDown',40]];
function adjacent(empty,dir,rows,cols) {
 const x=empty%cols,y=Math.floor(empty/cols);
 return dir===1&&x<cols-1?empty+1:dir===2&&x>0?empty-1:dir===3&&y<rows-1?empty+cols:dir===4&&y>0?empty-cols:-1;
}
function valid(board,rows,cols) {
 const n=rows*cols;
 assert.deepEqual([...board].sort((a,b)=>a-b),Array.from({length:n},(_,i)=>i),'every tile exists exactly once');
 let inversions=0;const numbered=board.filter(x=>x!==n-1);
 for(let i=0;i<numbered.length;i++)for(let j=i+1;j<numbered.length;j++)if(numbered[i]>numbered[j])inversions++;
 assert.equal(cols%2?inversions%2:(inversions+rows-Math.floor(board.indexOf(n-1)/cols))%2,cols%2?0:1,'shuffle is solvable');
}
function solution(board,rows,cols) {
 const goal=Array.from({length:board.length},(_,i)=>i).join(','),queue=[[board,[]]],seen=new Set([board.join(',')]);
 for(let i=0;i<queue.length;i++) {
  const [b,path]=queue[i];if(b.join(',')===goal)return path;
  for(let dir=1;dir<=4;dir++) { const blank=b.indexOf(b.length-1),next=adjacent(blank,dir,rows,cols);if(next<0)continue;
   const c=[...b];[c[blank],c[next]]=[c[next],c[blank]];const id=c.join(',');if(!seen.has(id)){seen.add(id);queue.push([c,[...path,dir]]);}
  }
 }
 throw Error('unsolvable board');
}
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#editor',downloadDirectory:out,failureScreenshotPath:resolve(out,'failure.png'),timeoutMs:60000,
readinessExpression:'shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled',
scenario:async({evaluate,click,waitFor,cdp,nextPaint})=>{
 const call=async(operation,params={})=>{
  const r=await evaluate('(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:"1",requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:'+JSON.stringify(operation)+',params:'+JSON.stringify(params)+'});})()');
  assert.equal(r.status,'completed',JSON.stringify(r));return r.value;
 };
 const step=async(n=3)=>{for(let i=0;i<n;i++)await call('shader.playback.step');await nextPaint();};
 const key=async(type,description,repeat=false)=>cdp.call('Input.dispatchKeyEvent',{type,key:description[0],code:description[1],windowsVirtualKeyCode:description[2],autoRepeat:repeat});
 const press=async description=>{await key('keyDown',description);await step();await key('keyUp',description);await step();};
 const shot=async name=>{await nextPaint();const s=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,name),Buffer.from(s.result.data,'base64'));};
 const read=async(rows,cols)=>{
  const r=await call('shader.image.read');
  return evaluate('(()=>{const b=haiyueEditor.readResource('+JSON.stringify(r.resourceId)+'),w='+r.width+',h='+r.height+';const at=(x,y)=>Array.from(b.slice((y*w+x)*4,(y*w+x)*4+4));const state=Array.from({length:'+String(rows*cols+2)+'},(_,i)=>at(i,h-1));const side=Math.min(.68,w/h*.86),left=(w/h-side-(w/h>1.3?.34:0))*.5;const centers=Array.from({length:'+String(rows*cols)+'},(_,i)=>at(Math.floor((left+(i%'+cols+'+.5)/'+cols+'*side)*h),Math.floor((.20+(Math.floor(i/'+cols+')+.5)/'+rows+'*side)*h)));let hash=0;for(let i=0;i<b.length;i+=4)hash=(hash+b[i]*(i+1))%1000000007;haiyueEditor.releaseResource('+JSON.stringify(r.resourceId)+');return {tiles:state.slice(0,'+rows*cols+').map(v=>v[0]),status:state['+rows*cols+'],config:state['+(rows*cols+1)+'],centers,hash};})()');
 };
 const open=async(rows,cols,steps=64,gradient=false)=>{
  const p=puzzleExample();p.common=p.common.replace('PUZZLE_ROWS: i32 = 4','PUZZLE_ROWS: i32 = '+rows).replace('PUZZLE_COLUMNS: i32 = 4','PUZZLE_COLUMNS: i32 = '+cols).replace('PUZZLE_SHUFFLE_STEPS: i32 = 64','PUZZLE_SHUFFLE_STEPS: i32 = '+steps);
  // Encode B into a one-pixel strip in the test fixture, without changing production shaders or their timing.
  p.passes.find(p=>p.id==='image').code=p.passes.find(p=>p.id==='image').code.replace('  return vec4f(color, 1.0);','  if (i32(fragCoord.y) == 0 && i32(fragCoord.x) < COUNT + 2) { return dataAt(iChannel1, i32(fragCoord.x)) / vec4f(255.0, 255.0, 255.0, 1.0); }\n  return vec4f(color, 1.0);');
  if(gradient)p.passes[0].code='fn mainImage(p:vec2f)->vec4f {return vec4f(p/iResolution.xy,0.4,1.0);}';
  const resource=await evaluate('haiyueEditor.putResource(new TextEncoder().encode('+JSON.stringify(JSON.stringify(p))+'))');
  await call('shader.project.open',{resourceId:resource.resourceId});await evaluate('haiyueEditor.releaseResource('+JSON.stringify(resource.resourceId)+')');
  await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'puzzle compiles');
  assert.deepEqual((await call('shader.query')).diagnostics.filter(d=>d.severity==='error'),[]);
  await call('shader.playback.set',{playing:false});await step();await click('document.getElementById("shader-canvas")');await step();
 };
 await open(4,4);let state=await read(4,4);valid(state.tiles,4,4);assert.equal(state.status[1],0);assert.equal(state.status[3],0);
 await shot('sliding-city.png');
 const initial=state,dir=[1,2,3,4].find(d=>adjacent(state.status[0],d,4,4)>=0);
 const neighbor=adjacent(state.status[0],dir,4,4),expected=[...state.tiles];[expected[neighbor],expected[state.status[0]]]=[expected[state.status[0]],expected[neighbor]];
 await key('keyDown',directions[dir]);await step();state=await read(4,4);assert.deepEqual(state.tiles,expected);assert.equal(state.status[1],1);
 await key('keyDown',directions[dir],true);await step(8);assert.deepEqual((await read(4,4)).tiles,state.tiles,'holding and OS repeat cannot replay a command');
 await key('keyUp',directions[dir]);await step();
 // Move the blank to the right edge and verify that Left cannot wrap to another row.
 while(state.status[0]%4<3){await press(directions[1]);state=await read(4,4);}
 await press(directions[1]);let blocked=await read(4,4);assert.deepEqual(blocked.tiles,state.tiles);assert.equal(blocked.status[1],state.status[1]);
 await key('keyDown',[' ','Space',32]);await step();let peek=await read(4,4);assert.deepEqual(peek.tiles,state.tiles);assert.notEqual(peek.hash,state.hash);
 await key('keyUp',[' ','Space',32]);await step();assert.equal((await read(4,4)).hash,blocked.hash);
 await press(['r','KeyR',82]);state=await read(4,4);valid(state.tiles,4,4);assert.equal(state.status[1],0);assert.equal(state.config[2],1);assert.notDeepEqual(state.tiles,initial.tiles);
 await click('document.querySelector("#code-editor .cm-content")');await press(directions[dir]);assert.deepEqual((await read(4,4)).tiles,state.tiles,'editing code does not move tiles');
 // Rectangular boards and exact picture orientation are checked with an analytic UV image.
 await open(3,5,73,true);state=await read(3,5);valid(state.tiles,3,5);
 for(let i=0;i<15;i++){const id=state.tiles[i];if(id===14)continue;const want=[(id%5+.5)/5*255,(1-(Math.floor(id/5)+.5)/3)*255,102];want.forEach((v,c)=>assert.ok(Math.abs(state.centers[i][c]-v)<3,JSON.stringify({i,id,got:state.centers[i],want})));}
 await shot('rectangular.png');
 // An independent breadth-first solver exercises a complete game with real keyboard input.
 await open(2,2,48);state=await read(2,2);valid(state.tiles,2,2);assert.equal(state.status[3],0);
 const path=solution(state.tiles,2,2);assert.ok(path.length);
 for(const move of path)await press(directions[move]);
 state=await read(2,2);assert.deepEqual(state.tiles,[0,1,2,3]);assert.equal(state.status[0],3);assert.equal(state.status[1],path.length);assert.equal(state.status[3],255);
 await shot('solved.png');
 // Zero-step learning mode, WASD, and clamping the largest supported grid.
 await open(3,5,0);state=await read(3,5);assert.equal(state.status[3],255);assert.equal(state.status[0],14);
 await press(['d','KeyD',68]);state=await read(3,5);assert.equal(state.status[0],13);assert.equal(state.status[1],1);
 await open(8,8,256);state=await read(8,8);valid(state.tiles,8,8);assert.equal(state.status[3],0);
 await step(12);assert.deepEqual((await read(8,8)).tiles,state.tiles,'feedback remains stable with no input');
 return {status:'passed',checks:['4x4, rectangular 3x5 and 8x8 shuffles have every tile and correct solvability parity','Real arrow/WASD presses move exactly one adjacent tile, reject row wrapping and ignore repeats/editor focus','R resets move count and creates another solvable board; Space previews without changing state','Analytic UV picture validates tile cropping and top/bottom orientation','Independent solver completes a 2x2 game and verifies blank position, move counter and solved flag']};
}});
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

