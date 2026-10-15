import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ImageDocument,makeLayer} from '../dist/document.js';
import {exportPsd} from '../dist/psdAdapter.js';
import {compositeState} from '../dist/compositor.js';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'imageEditor/artifacts/live-effects');mkdirSync(out,{recursive:true});
if(!process.env.PSD_NATIVE_PYTHON)throw Error('Set PSD_NATIVE_PYTHON to an existing psd-tools environment.');
const hash=b=>createHash('sha256').update(b).digest('hex'),cases=[];
for(const channel of ['gray','red','green','blue']){
 const d=ImageDocument.create(channel,16,16);d.addLayer(makeLayer('pixels',{width:16,height:16,data:Uint8ClampedArray.from({length:1024},(_,i)=>i%4===3?255:(i*31)%256)}));
 const rule={enabled:true,channel,source:[10,40,200,240],underlying:[0,30,240,255]};d.setLiveEffects(d.selected.id,{blendIf:rule});d.setMask(d.selected.id,{width:16,height:16,x:0,y:0,data:Uint8Array.from({length:256},(_,i)=>i),defaultColor:0,disabled:false,density:128/255,feather:1.25});
 const bytes=exportPsd(d.state).bytes;writeFileSync(resolve(out,channel+'.psd'),bytes);writeFileSync(resolve(out,channel+'.rgba'),compositeState(d.state).data);cases.push({channel,rule,sha256:hash(bytes)});d.dispose();
}
const input={schemaVersion:1,generatedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:true,buildHash:JSON.parse(readFileSync(resolve(root,'imageEditor/app-dist/app-manifest.json'))).buildHash,runner:{node:process.version,platform:process.platform,arch:process.arch},cases,sourceFingerprints:Object.fromEntries([...readdirSync(resolve(root,'imageEditor/src')).map(f=>'imageEditor/src/'+f),'imageEditor/scripts/check-live-psd.mjs','imageEditor/scripts/independent-live.py'].map(f=>[f,hash(readFileSync(resolve(root,f)))]))};writeFileSync(resolve(out,'psd-input.json'),JSON.stringify(input,null,2));
execFileSync(process.env.PSD_NATIVE_PYTHON,[resolve(root,'imageEditor/scripts/independent-live.py'),out],{stdio:'inherit'});
