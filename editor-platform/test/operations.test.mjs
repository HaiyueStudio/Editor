import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorPlatform} from '../dist/index.js';
import {editorServiceTokens,defineEditorPlugin,defineEditorProduct} from '@haiyue/editor-plugin-sdk';
const gate=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function document(id='a'){
 const listeners=new Set();return {identity:{id,kind:'sample.project',name:id},revision:1,savedRevision:1,value:0,
 serialize(){return {value:this.value};},markSaved(){this.savedRevision=this.revision;},subscribe(fn){listeners.add(fn);return{dispose(){listeners.delete(fn);}};},dispose(){},change(value){this.value=value;this.revision++;for(const fn of listeners)fn();}};
}
function setup(options){const platform=new EditorPlatform(options),a=document();platform.documents.attach(a);return {platform,a};}
const descriptor=(patch={})=>({id:'sample.add',version:1,title:'Add',target:'document',access:'write',documentKinds:['sample.project'],input:{type:'object',properties:{value:{type:'integer'}},required:['value']},output:{type:'integer'},...patch});
const request=(id,revision=1,patch={})=>({apiVersion:'1',requestId:id,operation:'sample.add',documentId:'a',expectedRevision:revision,params:{value:1},...patch});
function register(platform,overrides={}){
 return platform.operations.register({ownerId:'sample.core',descriptor:descriptor(),prepare(params,ctx){const d=platform.documents.get(ctx.document.id);return {value:params.value,before:d.value,revision:d.revision};},commit(prepared,ctx){const d=platform.documents.get(ctx.document.id);d.change(d.value+prepared.value);return d.value;},rollback(prepared,ctx){if(ctx.commitStarted&&prepared){const d=platform.documents.get(ctx.document.id);d.value=prepared.before;d.revision=prepared.revision;}},...overrides});
}
test('platform exposes typed operation service and owned discovery without changing existing registries',async()=>{
 const {platform}=setup();assert.equal(platform.services.get(editorServiceTokens.operations),platform.operations);
 const definition=descriptor();const registration=register(platform,{descriptor:definition});definition.title='mutated';assert.equal(platform.operations.list()[0].descriptor.title,'Add');assert(Object.isFrozen(platform.operations.list()[0].descriptor.input.properties));
 assert.throws(()=>register(platform),/already registered/);assert.throws(()=>register(platform,{descriptor:descriptor({id:'sample.missing'}),rollback:undefined}),/rollback/);
 await registration.dispose();await registration.dispose();assert.deepEqual(platform.operations.list(),[]);await platform.dispose();
});
test('request failures are structured, correlated and do not execute domain code',async()=>{
 const {platform,a}=setup();register(platform);
 for(const [patch,code] of [[{apiVersion:'2'},'UNSUPPORTED_VERSION'],[{operation:'missing'},'OPERATION_NOT_FOUND'],[{documentId:'missing'},'DOCUMENT_NOT_FOUND'],[{expectedRevision:0},'REVISION_CONFLICT'],[{expectedRevision:undefined},'INVALID_REQUEST'],[{params:{value:'bad'}},'INVALID_PARAMS'],[{extra:1},'INVALID_REQUEST']]){
  const value=request('bad',1,patch);if(patch.expectedRevision===undefined&&Object.hasOwn(patch,'expectedRevision'))delete value.expectedRevision;
  const result=await platform.operations.execute(value);assert.equal(result.status,'failed');assert.equal(result.error.code,code);assert.equal(result.requestId,'bad');
 }
 a.identity.kind='other';assert.equal((await platform.operations.execute(request('kind'))).error.code,'DOCUMENT_KIND_MISMATCH');assert.equal(a.value,0);await platform.dispose();
});
test('same-document FIFO checks revisions when dequeuing, owns params, and never supersedes an active write',async()=>{
 const {platform,a}=setup(),hold=gate(),order=[];register(platform,{async prepare(params,ctx){order.push(ctx.requestId);if(ctx.requestId==='first')await hold.promise;return {value:params.value,before:a.value,revision:a.revision};}});
 const first=platform.operations.execute(request('first'));const params={value:5};const second=platform.operations.execute(request('second',2,{params}));params.value=99;
 const stale=platform.operations.execute(request('stale',1));assert.deepEqual(order,['first']);hold.resolve();
 assert.equal((await first).value,1);assert.equal((await second).value,6);assert.equal((await stale).error.code,'REVISION_CONFLICT');assert.deepEqual(order,['first','second']);assert.equal(a.value,6);await platform.dispose();
});
test('different documents run concurrently; read operations queue behind writes',async()=>{
 const {platform}=setup(),b=document('b');platform.documents.attach(b);const hold=gate(),events=[];
 register(platform,{async prepare(params,ctx){events.push(ctx.document.id);if(ctx.document.id==='a')await hold.promise;return {value:params.value,before:0,revision:1};}});
 register(platform,{descriptor:descriptor({id:'sample.read',access:'read',input:{type:'null'}}),prepare(_params,ctx){return platform.documents.get(ctx.document.id).value;},commit:value=>value,rollback:undefined});
 const first=platform.operations.execute(request('a'));const read=platform.operations.execute({apiVersion:'1',requestId:'read',operation:'sample.read',documentId:'a',params:null});
 assert.equal((await platform.operations.execute(request('b',1,{documentId:'b'}))).value,1);assert.deepEqual(events,['a','b']);hold.resolve();await first;assert.equal((await read).value,1);await platform.dispose();
});
test('queued cancellation settles immediately without invoking prepare, and AbortSignal cancels active preparation',async()=>{
 const {platform,a}=setup(),hold=gate(),prepared=[];register(platform,{async prepare(params,ctx){prepared.push(ctx.requestId);await hold.promise;return {value:params.value,before:0,revision:1};}});
 const controller=new AbortController(),first=platform.operations.execute(request('active'),{signal:controller.signal});const second=platform.operations.execute(request('queued',2));
 assert.equal(platform.operations.cancel('queued'),true);assert.equal((await second).status,'cancelled');assert.equal(platform.operations.cancel('queued'),false);
 controller.abort();hold.resolve();assert.equal((await first).status,'cancelled');assert.deepEqual(prepared,['active']);assert.equal(a.value,0);await platform.dispose();
});
test('live edits during prepare reject commit and cleanup cannot mistake preparation for a committed mutation',async()=>{
 const {platform,a}=setup(),hold=gate(),rollback=[];register(platform,{async prepare(){await hold.promise;return 1;},commit(){throw Error('must not commit');},rollback(_prepared,ctx,error){rollback.push([ctx.commitStarted,error.code]);}});
 const run=platform.operations.execute(request('race'));a.change(42);hold.resolve();const result=await run;assert.equal(result.error.code,'REVISION_CONFLICT');assert.equal(a.value,42);assert.deepEqual(rollback,[[false,'REVISION_CONFLICT']]);await platform.dispose();
});
test('failed commit or invalid output rolls back before the next queued operation',async()=>{
 const {platform,a}=setup(),phases=[];platform.operations.subscribe(e=>phases.push(e.phase));
 register(platform,{commit(prepared){a.change(prepared.value);throw Error('projection failed');},async rollback(prepared,ctx){assert(ctx.commitStarted);await tick();a.value=prepared.before;a.revision=prepared.revision;}});
 const failed=await platform.operations.execute(request('broken'));assert.equal(failed.error.code,'EXECUTION_FAILED');assert.equal(a.value,0);assert.equal(a.revision,1);assert.deepEqual(phases,['queued','preparing','committing','rolling-back','failed']);
 register(platform,{descriptor:descriptor({id:'sample.invalid-output'}),commit(){a.change(8);return {bad:'result'};}});
 assert.equal((await platform.operations.execute(request('invalid',1,{operation:'sample.invalid-output'}))).error.code,'INVALID_RESULT');assert.equal(a.value,0);await platform.dispose();
});
test('rollback failure is explicit and cannot be reported as cancellation or success',async()=>{
 const {platform}=setup();register(platform,{commit(){throw Error('bad');},rollback(){throw Error('restore failed');}});
 const result=await platform.operations.execute(request('broken'));assert.equal(result.status,'failed');assert.equal(result.error.code,'ROLLBACK_FAILED');await platform.dispose();
});
test('closing and reattaching the same adapter invalidates old queued and active calls',async()=>{
 const {platform,a}=setup(),hold=gate();register(platform,{async prepare(){await hold.promise;return {value:7,before:0,revision:1};}});
 const oldGeneration=platform.documents.generation('a');const first=platform.operations.execute(request('old'));const second=platform.operations.execute(request('old-queued',2));
 await platform.documents.close('a');platform.documents.attach(a);assert.notEqual(platform.documents.generation('a'),oldGeneration);hold.resolve();
 for(const result of await Promise.all([first,second]))assert.equal(result.error.code,'DOCUMENT_NOT_FOUND');assert.equal(a.value,0);await platform.dispose();
});
test('owner disposal waits for cleanup, cancels its work, and permits later registration',async()=>{
 const {platform,a}=setup(),hold=gate();let cleaned=false;const owner=register(platform,{async prepare(){await hold.promise;return null;},rollback(){cleaned=true;}});
 const run=platform.operations.execute(request('active'));let disposed=false;const disposing=Promise.resolve(owner.dispose()).then(()=>disposed=true);await tick();assert.equal(disposed,false);assert.equal(platform.operations.list().length,0);hold.resolve();
 await disposing;assert(cleaned);assert.equal((await run).status,'cancelled');assert.equal(a.value,0);register(platform);assert.equal((await platform.operations.execute(request('new'))).status,'completed');await platform.dispose();
});
test('failed plugin activation releases operation registrations through its lifecycle scope',async()=>{
 const platform=new EditorPlatform();const d=descriptor({target:'workspace'});delete d.documentKinds;
 const fixed=defineEditorPlugin({id:'broken',version:'0.1.0',apiVersion:'1',activate({services,scope}){scope.own(services.get(editorServiceTokens.operations).register({ownerId:'broken',descriptor:d,prepare:()=>1,commit:value=>value,rollback(){}}));throw Error('activation failed');}});
 await assert.rejects(platform.start(defineEditorProduct({id:'test',version:'0.1.0',schemaVersion:1,displayName:'Test',requiredPlugins:[fixed]})));assert.deepEqual(platform.operations.list(),[]);await platform.dispose();
});
test('observer failures are isolated; progress and results are immutable JSON',async()=>{
 const diagnostics=[],{platform}=setup({diagnostic:d=>diagnostics.push(d)});platform.operations.subscribe(()=>{throw Error('observer');});const events=[];platform.operations.subscribe(e=>events.push(e));
 register(platform,{prepare(params,ctx){ctx.report({current:1,total:2,message:'preparing'});return {value:params.value,before:0,revision:1};}});
 const result=await platform.operations.execute(request('observed'));assert.equal(result.status,'completed');assert(Object.isFrozen(result));assert(events.some(e=>e.progress?.current===1));assert(Object.isFrozen(events[1]));assert(diagnostics.length>0);await platform.dispose();
});
test('duplicate requests and queue bounds do not replace pending work; shutdown waits for rollback',async()=>{
 const {platform,a}=setup({operations:{maxPending:1}}),hold=gate();register(platform,{async prepare(){await hold.promise;return null;}});
 const active=platform.operations.execute(request('one'));assert.equal((await platform.operations.execute(request('one'))).error.code,'DUPLICATE_REQUEST');assert.equal((await platform.operations.execute(request('two'))).error.code,'QUEUE_FULL');
 const disposal=platform.dispose();hold.resolve();await disposal;assert.equal((await active).status,'cancelled');assert.equal(a.value,0);assert.equal((await platform.operations.execute(request('after'))).error.code,'DISPOSED');assert.equal(platform.tasks.activeCount,0);
});
test('workspace operations need no document, but reject document targeting',async()=>{
 const platform=new EditorPlatform();const d=descriptor({target:'workspace',access:'read'});delete d.documentKinds;
 platform.operations.register({ownerId:'sample.core',descriptor:d,prepare:params=>params.value,commit:value=>value});
 const valid={apiVersion:'1',requestId:'workspace',operation:'sample.add',params:{value:4}};assert.equal((await platform.operations.execute(valid)).value,4);
 assert.equal((await platform.operations.execute({...valid,documentId:'a'})).error.code,'INVALID_REQUEST');await platform.dispose();
});

test('commit is synchronous and is past the cancellation boundary once mutation starts',async()=>{
 const {platform,a}=setup();assert.throws(()=>register(platform,{async commit(){a.change(8);return 8;}}),/synchronous/);assert.equal(a.value,0);
 register(platform,{commit(prepared,ctx){assert.equal(platform.operations.cancel(ctx.requestId),false);a.change(prepared.value);return a.value;}});
 assert.equal((await platform.operations.execute(request('commit'))).status,'completed');await platform.dispose();
});

test('a lane remains occupied until rollback completes; later work sees restored state',async()=>{
 const {platform,a}=setup(),cleanup=gate();let readStarted=false;
 register(platform,{commit(){a.change(100);throw Error('failed mutation');},async rollback(p,ctx){assert(ctx.commitStarted);await cleanup.promise;a.value=p.before;a.revision=p.revision;}});
 register(platform,{descriptor:descriptor({id:'sample.read',access:'read',input:{type:'null'}}),prepare(){readStarted=true;return a.value;},commit:value=>value,rollback:undefined});
 const first=platform.operations.execute(request('failed'));const next=platform.operations.execute({apiVersion:'1',requestId:'next',operation:'sample.read',documentId:'a',params:null});await tick();assert.equal(readStarted,false);assert.equal(a.value,100);
 cleanup.resolve();assert.equal((await first).status,'failed');assert.equal((await next).value,0);await platform.dispose();
});
test('reentrant owner disposal cannot remove a replacement registration',async()=>{
 const {platform}=setup(),hold=gate();const blocker=register(platform,{async prepare(){await hold.promise;return {value:1,before:0,revision:1};}});
 const active=platform.operations.execute(request('active'));const queued=platform.operations.execute(request('queued',2));let again;
 platform.operations.subscribe(event=>{if(event.requestId==='queued'&&event.phase==='cancelled'){again=blocker.dispose();register(platform);}});
 const disposing=blocker.dispose();assert.equal(again,disposing);assert.equal(platform.operations.list().length,1);hold.resolve();await Promise.all([disposing,active,queued]);assert.equal((await platform.operations.execute(request('replacement'))).status,'completed');await platform.dispose();
});

test('document close aborts work before awaiting adapter resource disposal', {timeout:2000}, async()=>{
 const {platform,a}=setup(),aborted=gate();a.dispose=()=>aborted.promise;
 register(platform,{prepare(_params,ctx){return new Promise(resolve=>{ctx.signal.addEventListener('abort',()=>{aborted.resolve();resolve(null);},{once:true});});}});
 const run=platform.operations.execute(request('closing'));await platform.documents.close('a');assert.equal((await run).error.code,'DOCUMENT_NOT_FOUND');await platform.dispose();
});

test('invalid cancellation options cannot leak a queued invocation',async()=>{
 const {platform}=setup({operations:{maxPending:1}});register(platform);
 assert.equal((await platform.operations.execute(request('bad'),{signal:{}})).error.code,'INVALID_REQUEST');
 assert.equal((await platform.operations.execute(request('good'))).status,'completed');await platform.dispose();
});
