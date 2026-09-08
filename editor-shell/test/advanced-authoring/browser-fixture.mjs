import { fixture } from './fixture.mjs';
import { mountAdvancedAuthoring } from '../../dist/advanced-authoring/index.js';

const host = document.querySelector('#panel'), viewportHost = document.querySelector('#viewport');
let f, panel, previews = [], intents = [], held = null, failure = false;
const pause = () => new Promise(resolve => requestAnimationFrame(resolve));
const update = () => panel.update(f.view());
async function reset(count = 1000) {
  panel?.dispose(); f?.close(); f = fixture(count); previews = []; intents = []; failure = false;
  panel = await mountAdvancedAuthoring({ host, viewportHost, initial: f.view(), preview(value) { previews.push(value); }, async dispatch(intent, signal) {
    intents.push(intent); if (held) await held.promise; if (signal.aborted) return;
    if (failure) throw Error('injected');
    if (intent.type === 'selection') f.selection.set(intent.references, intent.active);
    if (intent.type === 'transform') f.commit(intent);
    if (intent.type === 'undo') f.history.undo();
    if (intent.type === 'redo') f.history.redo();
    update();
  } });
}
window.advancedTest = {
  reset, update, pause,
  state: () => ({ view:f.view(), previews, intents, roots:host.children.length, overlays:viewportHost.children.length, busy:host.firstElementChild?.getAttribute('aria-busy'), position:viewportHost.style.position }),
  reveal: id => panel.reveal(f.reference(id)),
  changeEpoch: () => { f.setEpoch('open:2'); update(); },
  select: id => { f.selection.set([f.reference(id)]); update(); },
  hold: () => { let resolve; const promise = new Promise(r => resolve = r); held = {promise,resolve}; },
  release: () => { held?.resolve(); held = null; },
  fail: () => failure = true,
  dispose: () => panel.dispose(),
  dense: () => { const view = f.view(); panel.update({ ...view, sections:[{...view.sections[0],fields:Array.from({length:1000},(_,i)=>({...view.sections[0].fields[0],id:`field:${i}`}))}] }); },
  historical: () => { f.setRuntime({ status:'historical',instanceId:'play:previous',documentRevision:0,frame:2,tick:2,diagnostics:[],fields:[{id:'runtime:value',label:'Runtime value',kind:'json',value:{speed:3},readOnly:true}] }); update(); },
  lazyAbort: async () => { const abort = new AbortController(); abort.abort(); let rejected = false; try { await mountAdvancedAuthoring({host,viewportHost,initial:f.view(),dispatch(){},preview(){}},abort.signal); } catch { rejected = true; } return rejected; },
  faultCleanup: async () => { panel.dispose(); const mounted = await mountAdvancedAuthoring({host,viewportHost,initial:f.view(),dispatch(){},preview(){throw Error('host failure');}}); mounted.dispose(); mounted.dispose(); return host.children.length === 0 && viewportHost.children.length === 0; },
};
void reset().then(()=>{window.advancedReady = true;}).catch(error=>console.error(error));
