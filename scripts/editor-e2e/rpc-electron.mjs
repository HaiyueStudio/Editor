import { builtinIcc } from '../../imageEditor/dist/iccWorkflow.js';
import { embeddedProfile } from '../../imageEditor/dist/colorManagement.js';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createEditorRpcClient } from '@haiyue/editor-app-kit/node';
import { connectCdp } from './browserDriver.mjs';
import { cmykBitmap } from '../../imageEditor/dist/cmyk.js';
import { ImageDocument, makeLayer } from '../../imageEditor/dist/document.js';
import { serializeProject } from '../../imageEditor/dist/projectFile.js';
import { importPsd } from '../../imageEditor/dist/psdAdapter.js';
import { parseAnimation } from '@haiyue/animation-spec';
import { parseMagicaVoxel } from '../../voxelEditor/dist/vox-importer.js';

const root = resolve(import.meta.dirname, '../..'), electron = createRequire(import.meta.url)('electron');
const selected = process.argv.slice(2);
for (const name of selected) if (!['imageEditor', 'AnimationEditor', 'voxelEditor'].includes(name)) throw Error(`Unknown product: ${name}`);
const image = ImageDocument.create('RPC image', 4, 4, true);
const cases = [
  { product: 'imageEditor', prefix: 'image', source: serializeProject(image.state), format: 'psd' },
  { product: 'AnimationEditor', prefix: 'hya', source: await readFile(resolve(root, 'AnimationEditor/examples/state-machine-multitrack.hya-project.json'), 'utf8'), format: 'hya' },
  { product: 'voxelEditor', prefix: 'voxel', source: JSON.stringify({ format: 'haiyue-voxel', version: 1, size: { x: 8, y: 8, z: 8 }, editor: { currentColor: '#ff0000' }, voxels: [{ x: 1, y: 2, z: 3, color: '#ff0000' }] }), format: 'vox' },
];
image.dispose();
for (const item of cases.filter(item => !selected.length || selected.includes(item.product))) {
  const profile = await mkdtemp(join(tmpdir(), 'haiyue-rpc-electron-'));
  const harness = join(profile, 'launch.mjs');
  await writeFile(harness, `import { app } from 'electron';\napp.setPath('userData', ${JSON.stringify(profile)});\nawait import(${JSON.stringify(pathToFileURL(resolve(root, item.product, 'electron/main.mjs')).href)});\n`);
  const child = spawn(electron, [harness, '--remote-debugging-port=0'], { env: { ...process.env, HAIYUE_EDITOR_RPC: '1', HAIYUE_EDITOR_RPC_PORT: '0', HAIYUE_ELECTRON_SMOKE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '', cdp, client; child.stdout.on('data', chunk => logs += chunk); child.stderr.on('data', chunk => logs += chunk);
  const exited = new Promise(resolve => child.once('exit', resolve));
  async function wait(read, label) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw Error(`Electron exited: ${logs}`);
      const value = await read(); if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`Timed out: ${label}\n${logs}`);
  }
  try {
    const endpoint = await wait(() => /DevTools listening on (ws:\/\/[^\s]+)/.exec(logs)?.[1], 'DevTools');
    const target = await wait(async () => (await fetch(`http://${new URL(endpoint).host}/json/list`).then(r => r.json())).find(t => t.type === 'page' && t.url.startsWith('file:')), 'renderer');
    cdp = await connectCdp(target.webSocketDebuggerUrl); await cdp.call('Runtime.enable');
    const errors = []; cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails?.text));
    async function evaluate(expression) {
      const response = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.result.exceptionDetails) throw Error(JSON.stringify(response.result.exceptionDetails));
      return response.result.result.value;
    }
    await wait(() => evaluate(`Boolean(globalThis.haiyueEditor?.listOperations().some(entry => entry.descriptor.id === '${item.prefix}.history.redo') && (${item.prefix === 'image' ? 'true' : 'globalThis.haiyueEditor.listDocuments().documents.length'}))`), 'platform ready');
    assert.deepEqual(await evaluate('[typeof require,typeof process,Object.isFrozen(window.haiyueEditorIPC)]'), ['undefined', 'undefined', true]);
    const ipc = await evaluate(`window.haiyueEditorIPC.request({jsonrpc:'2.0',id:'native-ipc',method:'operations.list',params:{}})`);
    assert.ok(ipc.result.some(entry => entry.descriptor.id === `${item.prefix}.history.redo`), 'real sandboxed preload IPC discovery');
    const descriptor = JSON.parse(await readFile(join(profile, 'editor-rpc.json'), 'utf8'));
    client = await createEditorRpcClient(descriptor);
    const large = Buffer.alloc(1024 * 1024 + 13, 91), ref = await client.upload(large);
    assert.deepEqual(await client.download(ref), large); await client.release(ref.resourceId);
    let documentId = item.prefix === 'image' ? null : (await client.request('documents.list')).documents[0].identity.id;
    async function call(suffix, params = {}) {
      const doc = documentId ? (await client.request('documents.list')).documents.find(d => d.identity.id === documentId) : null;
      const result = await client.execute({ apiVersion: '1', requestId: randomUUID(), operation: `${item.prefix}.${suffix}`, params,
        ...(doc ? { documentId, expectedRevision: doc.revision } : {}) });
      assert.equal(result.status, 'completed', JSON.stringify(result)); return result.value;
    }
    const input = await client.upload(Buffer.from(item.source));
    const opened = await call('document.open', { resourceId: input.resourceId, ...(item.prefix === 'image' ? { format: 'project', name: 'native.hyimage' } : {}) });
    if (item.prefix === 'image') documentId = opened.documentId;
    await client.release(input.resourceId);
    const before = await call('document.query');
    if (item.prefix === 'image') await call('filter.apply', { layerId: before.layers[0].id, kind: 'invert', amount: 100 });
    else if (item.prefix === 'hya') await call('node.transform', { nodeId: before.nodes[0].id, patch: { x: 123, y: 456, opacity: 0.25 } });
    else await call('cells.patch', { cells: [{ x: 1, y: 2, z: 3, action: 'remove' }, { x: 4, y: 4, z: 4, action: 'set', color: '#123456' }] });
    const changed = await call('document.query');
    async function exported() { const file = await call('document.export', { format: item.format }); const bytes = await client.download(file); await client.release(file.resourceId); return bytes; }
    const edited = await exported(); await call('history.undo');
    const after = await call('document.query'); const content = ({ canRedo, ...rest }) => rest;
    assert.deepEqual(content(after), content(before)); assert.equal(after.canRedo, true);
    const restored = await exported(); assert.notDeepEqual(edited, restored);
    await call('history.redo'); assert.deepEqual(await call('document.query'), changed);
    for (const bytes of [edited, restored]) {
      if (item.prefix === 'image') assert.ok(importPsd(new Uint8Array(bytes), 'out.psd').layered);
      else if (item.prefix === 'hya') assert.ok(parseAnimation(new Uint8Array(bytes).buffer));
      else assert.ok(parseMagicaVoxel(new Uint8Array(bytes)));
    }
    if (item.prefix === 'image') {
      const layerId = before.layers[0].id;
      await call('pixels.gradient', { layerId, start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, from: '#ff0000', to: '#0000ff', kind: 'linear' });
      const sampled = await call('color.sample', { x: 0, y: 0 }); assert.ok(sampled.rgba[0] > sampled.rgba[2]);
      const copy = await call('pixels.copy', { layerId }); assert.equal((await client.download(copy)).length, 64);
      const pasted = await call('pixels.paste', { resourceId: copy.resourceId, width: copy.width, height: copy.height, x: 1, y: 1 }); await client.release(copy.resourceId);
      await call('layers.select', { layerIds: [layerId, pasted.layerId] });
      await call('layers.align', { layerIds: [layerId, pasted.layerId], alignment: 'left', relativeTo: 'canvas' });
      await call('layers.merge', { layerIds: [layerId, pasted.layerId] }); assert.equal((await call('document.query')).layers.length, 1); await call('history.undo');
      const shape = await call('content.create', { name: 'RPC shape', content: { type: 'shape', shape: 'rectangle', width: 2, height: 2, radius: 0, fill: '#00ff00', stroke: '#000000', strokeWidth: 0 } });
      await call('layer.rasterize', { layerId: shape.layerId });
      const png = await call('document.export', { format: 'png' }); assert.deepEqual((await client.download(png)).subarray(0,4), Buffer.from([137,80,78,71])); await client.release(png.resourceId);
      const ipcSample = await evaluate(`window.haiyueEditorIPC.request({jsonrpc:'2.0',id:'sample-ipc',method:'operations.execute',params:{apiVersion:'1',requestId:'sample-ipc',operation:'image.color.sample',documentId:${JSON.stringify(documentId)},params:{x:0,y:0}}})`);
      assert.equal(ipcSample.result.status, 'completed'); assert.deepEqual(ipcSample.result.value.rgba, [0,255,0,255]);
      await call('smart.convert', { layerId: shape.layerId });
      const smartSource = await call('smart.source', { layerId: shape.layerId });
      assert.equal((await client.download(smartSource)).length, 16);
      await call('layer.transform', { layerId: shape.layerId, width: 1, height: 1, resampling:'lanczos' });
      await call('smart.replace', { layerId: shape.layerId, resourceId: smartSource.resourceId, width: 2, height: 2, name: 'RPC source' });
      await call('history.undo'); assert.equal((await call('document.query')).layers.find(l => l.id === shape.layerId).content.name, 'RPC shape');
      await client.release(smartSource.resourceId);
      await call('layer.clipping', { layerId: shape.layerId, enabled: true });
      await call('layer.styles', { layerId: shape.layerId, styles: { enabled: true, overlay: { color: '#ff0000', opacity: 0.5 } } });
      await call('content.create', { name: 'RPC curves', content: { type: 'adjustment', filter: 'curves', amount: 100, curves: [{ input: 0, output: 0 }, { input: 128, output: 170 }, { input: 255, output: 255 }],channels:{red:{curves:[{input:0,output:255},{input:255,output:0}]}} } });
      const native = importPsd(new Uint8Array(await exported()), 'native-rpc.psd'); assert.ok(native.layered, native.blockers.join('\n'));
      assert.ok(native.layered.layers.some(l => l.clipping && l.styles && l.content?.type === 'smart'));
      assert.ok(native.layered.layers.some(l => l.content?.filter === 'curves'));
      await call('history.undo'); // Remove the live adjustment before explicit color conversion.
      const histogram=await call('histogram.query');assert.equal(histogram.red.length,256);assert(histogram.pixels>0);
      const filterBefore=await call('color.sample',{x:0,y:0});await call('filter.apply',{layerId,kind:'gaussian',amount:0.8});await call('history.undo');assert.deepEqual(await call('color.sample',{x:0,y:0}),filterBefore);
      await call('pixels.stroke', { layerId, points: [{ x: 1, y: 1, pressure: 0.6 }], size: 3, hardness: 0.2, pressure: 'both', color: '#112233' });
      await call('retouch.stroke', { layerId, sourceLayerId: layerId, kind: 'clone', offset: { x: -1, y: 0 }, points: [{ x: 2, y: 1 }], size: 2 });
      await call('history.undo');
      await call('selection.set', { shape: 'rectangle', x: 0, y: 0, width: 2, height: 2 });
      await call('selection.refine', { radius: 2, contrast: 10, shift: 0, edgeAware: true });
      await call('history.undo');
      await call('color.convert', { source: 'srgb' });
      assert.equal((await call('color.query')).convertedFrom, 'srgb');
      await call('history.undo');
      const batchInput = await call('document.export', { format: 'project' });
      const batch = await client.execute({ apiVersion: '1', requestId: randomUUID(), operation: 'image.batch.run', params: { inputs: [{ resourceId: batchInput.resourceId, name: 'rpc.hyimage', format: 'project' }], steps: [{ type: 'fit', width: 2, height: 2,resampling:'bicubic' },{type:'filter',kind:'usm',amount:90,radius:1,threshold:3}], format: 'png' } });
      assert.equal(batch.status, 'completed', JSON.stringify(batch));assert(batch.value[0].resourceId);
      assert.deepEqual((await client.download(batch.value[0])).subarray(0,4), Buffer.from([137,80,78,71]));
      await client.release(batch.value[0].resourceId);await client.release(batchInput.resourceId);
      const smartId=shape.layerId,filters=[{id:'rpc-filter',enabled:true,opacity:.7,blend:'normal',settings:{kind:'gaussian',amount:.8}}];
      await call('smart.filters',{layerId:smartId,filters});
      await call('mask.update',{layerId:smartId,target:'filter',action:'fromSelection'});
      await call('mask.settings',{layerId:smartId,target:'filter',density:.6,feather:1.2});
      await call('pixels.fill',{layerId:smartId,target:'filterMask',color:'#000000'});await call('history.undo');
      await call('layer.blend-if',{layerId:smartId,rule:{enabled:true,channel:'red',source:[0,30,240,255],underlying:[0,0,255,255]}});
      const live=(await call('document.query')).layers.find(l=>l.id===smartId);assert.equal(live.filterMask.density,.6);assert.equal(live.smartFilters[0].id,'rpc-filter');assert.equal(live.blendIf.source[1],30);
      const ipcLive=await evaluate(`window.haiyueEditorIPC.request({jsonrpc:'2.0',id:'live-query',method:'operations.execute',params:{apiVersion:'1',requestId:'live-query',operation:'image.document.query',documentId:${JSON.stringify(documentId)},params:{}}})`);
      assert.equal(ipcLive.result.status,'completed');assert.equal(ipcLive.result.value.layers.find(l=>l.id===smartId).filterMask.feather,1.2);
      const liveFile=await call('document.export',{format:'project'});assert.equal(JSON.parse((await client.download(liveFile)).toString()).version,7);await client.release(liveFile.resourceId);
      await call('history.undo');assert.equal((await call('document.query')).layers.find(l=>l.id===smartId).blendIf,null);
      const livePsd=await call('document.export',{format:'psd',allowRasterize:true});assert(importPsd(new Uint8Array(await client.download(livePsd)),'live.psd').layered);await client.release(livePsd.resourceId);
      const alpha=await call('channel.save',{name:'RPC selection',source:'alpha'});await call('channel.load',{id:alpha.channelId,mode:'replace'});const gray=await call('channel.read',{id:alpha.channelId});assert.equal((await client.download(gray)).length,16);await client.release(gray.resourceId);
      await call('layout.set',{layout:{visible:true,snap:true,canvas:false,layers:false,tolerance:6,guides:[{id:'rpc-guide',axis:'x',position:2}]}});
      const recipe={id:'rpc-template',name:'RPC template',parameters:[{name:'opacity',type:'number',default:1}],steps:[{operation:'layer.update',params:{layerId,patch:{opacity:{param:'opacity'}}}}]};await call('action.save',{action:recipe});const previous=(await call('document.query')).layers.find(l=>l.id===layerId).opacity;await call('action.run',{id:recipe.id,values:{opacity:.4}});assert.equal((await call('document.query')).layers.find(l=>l.id===layerId).opacity,.4);await call('history.undo');assert.equal((await call('document.query')).layers.find(l=>l.id===layerId).opacity,previous);
      const variants=await call('template.export',{actionId:recipe.id,rows:[{name:'opaque',values:{opacity:1}},{name:'translucent',values:{opacity:.5}}],format:'project'});assert.equal(variants.length,2);for(const variant of variants){const data=JSON.parse((await client.download(variant)).toString());assert.equal(data.version,8);assert.equal(data.document.channels.length,1);await client.release(variant.resourceId);}
      const sourceRead=await call('smart.source.read',{layerId:smartId});const sourceJson=JSON.parse((await client.download(sourceRead)).toString());sourceJson.document.layers.push({...sourceJson.document.layers[0],id:randomUUID(),name:'RPC second source layer',opacity:.5});const replacement=await client.upload(Buffer.from(JSON.stringify(sourceJson)));await call('smart.source.replace',{layerId:smartId,resourceId:replacement.resourceId,format:'project'});assert.equal((await call('document.query')).layers.find(l=>l.id===smartId).content.multilayer,true);await call('history.undo');assert.equal((await call('document.query')).layers.find(l=>l.id===smartId).content.multilayer,false);await client.release(sourceRead.resourceId);await client.release(replacement.resourceId);
      const high=Buffer.alloc(8);[32767,32768,32769,43210].forEach((v,i)=>high.writeUInt16LE(v,i*2));const highRef=await client.upload(high),highResult=await client.execute({apiVersion:'1',requestId:randomUUID(),operation:'image.color.precision',params:{resourceId:highRef.resourceId,width:1,height:1,input:'rgba16le',output:'rgba16le',source:'srgb',target:'srgb'}});assert.equal(highResult.status,'completed',JSON.stringify(highResult));assert.deepEqual(await client.download(highResult.value),high);await client.release(highRef.resourceId);await client.release(highResult.value.resourceId);
      const productionIpc=await evaluate(`window.haiyueEditorIPC.request({jsonrpc:'2.0',id:'production-query',method:'operations.execute',params:{apiVersion:'1',requestId:'production-query',operation:'image.document.query',documentId:${JSON.stringify(documentId)},params:{}}})`);assert.equal(productionIpc.result.status,'completed');assert.equal(productionIpc.result.value.channels[0].id,alpha.channelId);assert.equal(productionIpc.result.value.actions[0].id,recipe.id);
      const inkLayer=makeLayer('RPC native inks',cmykBitmap(2,1,new Float32Array([0,10,20,80,0,10,20,80]),[255,255],16));
      const inkDoc=new ImageDocument({id:randomUUID(),name:'RPC CMYK',width:2,height:1,colorMode:'cmyk',bitDepth:16,layers:[inkLayer],selectedId:inkLayer.id,revision:1});
      const inkResource=await client.upload(Buffer.from(serializeProject(inkDoc.state)));inkDoc.dispose();
      documentId=null;const inkOpened=await call('document.open',{resourceId:inkResource.resourceId,format:'project',name:'inks.hyimage'});documentId=inkOpened.documentId;await client.release(inkResource.resourceId);
      await call('selection.set',{shape:'rectangle',x:0,y:0,width:1,height:1});
      await call('cmyk.fill',{layerId:inkLayer.id,ink:[90,90,90,40],channels:[3]});
      assert.deepEqual((await call('cmyk.sample',{x:0,y:0})).ink,[0,10,20,40]);assert.deepEqual((await call('cmyk.sample',{x:1,y:0})).ink,[0,10,20,80]);
      const nativeIpc=await evaluate(`window.haiyueEditorIPC.request({jsonrpc:'2.0',id:'native-stroke',method:'operations.execute',params:{apiVersion:'1',requestId:'native-stroke',operation:'image.cmyk.stroke',documentId:${JSON.stringify(documentId)},expectedRevision:haiyueEditor.listDocuments().documents.find(d=>d.identity.id===${JSON.stringify(documentId)}).revision,params:{layerId:${JSON.stringify(inkLayer.id)},ink:[0,0,0,20],channels:[3],size:1,points:[{x:0.5,y:0.5}]}}})`);assert.equal(nativeIpc.result.status,'completed',JSON.stringify(nativeIpc));
      assert.deepEqual((await call('cmyk.sample',{x:0,y:0})).ink,[0,10,20,20]);await call('history.undo');assert.equal((await call('cmyk.sample',{x:0,y:0})).ink[3],40);
      const nativeCopy=await call('pixels.copy',{layerId:inkLayer.id});assert.equal(nativeCopy.format,'cmyka32fle');assert.equal((await client.download(nativeCopy)).length,20);
      await call('pixels.paste',{resourceId:nativeCopy.resourceId,format:nativeCopy.format,width:1,height:1});await client.release(nativeCopy.resourceId);
      const nativePsd=importPsd(new Uint8Array(await exported()),'rpc-cmyk.psd').layered;assert.equal(nativePsd.colorMode,'cmyk');assert.equal(nativePsd.layers.at(-1).bitmap.cmyk[3],40);
      const managed=ImageDocument.create('RPC ICC workflow',2,1,true),managedRef=await client.upload(Buffer.from(serializeProject(managed.state)));managed.dispose();documentId=null;
      const managedOpen=await call('document.open',{resourceId:managedRef.resourceId,format:'project',name:'icc.hyimage',colorPolicy:'assign',preset:'display-p3'});documentId=managedOpen.documentId;await client.release(managedRef.resourceId);
      assert.equal((await call('icc.query')).working.name,'Display P3');const profileRead=await call('icc.read');assert.deepEqual(new Uint8Array(await client.download(profileRead)),builtinIcc('display-p3'));await client.release(profileRead.resourceId);
      const iccIpc=await evaluate(`window.haiyueEditorIPC.request({jsonrpc:'2.0',id:'icc-convert',method:'operations.execute',params:{apiVersion:'1',requestId:'icc-convert',operation:'image.icc.convert',documentId:${JSON.stringify(documentId)},expectedRevision:haiyueEditor.listDocuments().documents.find(d=>d.identity.id===${JSON.stringify(documentId)}).revision,params:{preset:'srgb'}}})`);assert.equal(iccIpc.result.status,'completed',JSON.stringify(iccIpc));assert.equal((await call('icc.query')).working.name,'Haiyue sRGB');await call('history.undo');assert.equal((await call('icc.query')).working.name,'Display P3');
      const proofRef=await client.upload(builtinIcc('srgb'));await call('icc.proof',{proofProfile:proofRef.resourceId,proofIntent:3});await client.release(proofRef.resourceId);await call('icc.proof',{proofEnabled:false});assert.equal((await call('icc.query')).proofEnabled,false);assert.equal((await call('icc.query')).proofIntent,3);
      const withoutIcc=await call('document.export',{format:'psd',embedProfile:false});assert.equal(embeddedProfile(importPsd(new Uint8Array(await client.download(withoutIcc)),'untagged.psd').layered),undefined);await client.release(withoutIcc.resourceId);






    }
    assert.deepEqual(errors, []);
    console.log(`[rpc-electron] ${item.prefix}: IPC + HTTP open/query/domain edit/undo/redo/export + chunked binary passed`);
  } finally {
    await client?.close().catch(() => {}); cdp?.close(); if (child.exitCode === null) child.kill('SIGKILL'); await exited;
    await rm(profile, { recursive: true, force: true });
  }
}
