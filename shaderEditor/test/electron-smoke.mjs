import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createEditorRpcClient } from '@haiyue/editor-app-kit/node';
import { connectCdp } from '../../scripts/editor-e2e/browserDriver.mjs';
import { createProject, passOf } from '../dist/model.js';

const root = resolve(import.meta.dirname, '..'), parent = resolve(tmpdir());
const profile = await mkdtemp(join(parent, 'haiyue-shader-rpc-'));
const harness = join(profile, 'launch.mjs');
await writeFile(harness, `import { app } from 'electron';
app.setPath('userData', ${JSON.stringify(profile)});
app.on('browser-window-created', (_event, window) => { window.show = () => {}; window.focus = () => {}; window.webContents.setBackgroundThrottling(false); });
await import(${JSON.stringify(pathToFileURL(join(root,'electron/main.mjs')).href)});
`);
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron,[harness,'--remote-debugging-port=0'],{windowsHide:true,env:{...process.env,HAIYUE_EDITOR_RPC:'1',HAIYUE_EDITOR_RPC_PORT:'0',HAIYUE_ELECTRON_SMOKE:'0'},stdio:['ignore','pipe','pipe']});
let logs='', cdp, client; child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
const exited = new Promise(resolveExit=>child.once('exit',resolveExit));
async function wait(read,label) {
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){if(child.exitCode!==null)throw Error(`Electron exited: ${logs}`);const result=await read();if(result)return result;await new Promise(r=>setTimeout(r,100));}
  throw Error(`Timeout: ${label}\n${logs}`);
}
try {
  const endpoint=await wait(()=>/DevTools listening on (ws:\/\/[^\s]+)/.exec(logs)?.[1],'DevTools');
  const target=await wait(async()=>(await fetch(`http://${new URL(endpoint).host}/json/list`).then(r=>r.json())).find(t=>t.type==='page'&&t.url.startsWith('file:')),'renderer');
  cdp=await connectCdp(target.webSocketDebuggerUrl);await cdp.call('Runtime.enable');
  async function evaluate(expression){const response=await cdp.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.result.exceptionDetails)throw Error(JSON.stringify(response.result.exceptionDetails));return response.result.result.value;}
  await wait(()=>evaluate('Boolean(window.haiyueEditor?.listOperations().some(op=>op.descriptor.id==="shader.compile"))'),'operations');
  assert.deepEqual(await evaluate('[typeof require,typeof process,Object.isFrozen(window.haiyueEditorIPC)]'),['undefined','undefined',true]);
  const ipc=await evaluate('window.haiyueEditorIPC.request({jsonrpc:"2.0",id:"native-ipc",method:"operations.list",params:{}})');
  assert.ok(ipc.result.some(op=>op.descriptor.id==='shader.code.set'));
  client=await createEditorRpcClient(JSON.parse(await readFile(join(profile,'editor-rpc.json'),'utf8')));
  const call=async(operation,params={})=>{
    const doc=(await client.request('documents.list')).documents[0];
    const response=await client.execute({apiVersion:'1',requestId:crypto.randomUUID(),operation,documentId:doc.identity.id,expectedRevision:doc.revision,params});
    assert.equal(response.status,'completed',JSON.stringify(response));return response.value;
  };
  const project=createProject('IPC pixel test');passOf(project,'image').code='fn mainImage(p: vec2f) -> vec4f { return vec4f(0.0, 1.0, 0.0, 1.0); }';
  const input=await client.upload(Buffer.from(JSON.stringify(project)));
  await call('shader.project.open',{resourceId:input.resourceId});await client.release(input.resourceId);
  await wait(async()=>(await call('shader.query')).runtime?.ready,'GPU initialized from IPC open');
  assert.equal((await call('shader.compile')).compiled,true);
  await call('shader.playback.step');
  const image=await call('shader.image.read'), pixels=await client.download(image);await client.release(image.resourceId);
  assert.equal(pixels.byteLength,image.width*image.height*4);assert.deepEqual([...pixels.subarray(0,4)],[0,255,0,255]);
  const output=await call('shader.project.export'), bytes=await client.download(output);await client.release(output.resourceId);
  assert.equal(JSON.parse(bytes.toString('utf8')).name,'IPC pixel test');
  console.log('[shader-electron] sandboxed IPC discovery + authenticated local RPC upload/open/compile/step/pixel readback/export passed.');
} finally {
  await client?.close().catch(()=>{});cdp?.close();if(child.exitCode===null)child.kill('SIGKILL');await exited;
  if(dirname(resolve(profile))!==parent||!basename(profile).startsWith('haiyue-shader-rpc-'))throw Error('Unsafe temporary cleanup path.');
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(error=>console.warn(`Temporary profile retained: ${error.message}`));
}
