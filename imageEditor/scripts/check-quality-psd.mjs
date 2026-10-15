import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ImageDocument,makeLayer} from '../dist/document.js';
import {exportPsd} from '../dist/psdAdapter.js';
import {compositeState} from '../dist/compositor.js';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'imageEditor/artifacts/quality');mkdirSync(out,{recursive:true});
if(!process.env.PSD_NATIVE_PYTHON)throw Error('Set PSD_NATIVE_PYTHON to an existing psd-tools environment for independent validation.');
const hash=b=>createHash('sha256').update(b).digest('hex'),neutral={black:0,white:255,gamma:1,outputBlack:0,outputWhite:255},line=[{input:0,output:0},{input:255,output:255}],cases=[];
for(const filter of ['levels','curves']){
 const d=ImageDocument.create(filter,16,16);d.addLayer(makeLayer('pixels',{width:16,height:16,data:Uint8ClampedArray.from({length:1024},(_,i)=>i%4===3?255:(i*31)%256)}));
 const content=filter==='levels'?{type:'adjustment',filter,amount:100,levels:{...neutral,gamma:1.1},channels:{red:{levels:{...neutral,black:20,gamma:1.25}},green:{levels:{...neutral,outputBlack:12,outputWhite:230}},blue:{levels:{...neutral,white:240}}}}:{type:'adjustment',filter,amount:100,curves:line,channels:{red:{curves:[{input:0,output:0},{input:128,output:180},{input:255,output:255}]},blue:{curves:[{input:0,output:255},{input:255,output:0}]}}};
 d.addLayer({...makeLayer(filter),kind:'adjustment',content},false);const bytes=exportPsd(d.state).bytes;writeFileSync(resolve(out,filter+'.psd'),bytes);writeFileSync(resolve(out,filter+'.rgba'),compositeState(d.state).data);cases.push({filter,content,sha256:hash(bytes)});d.dispose();
}
const build=JSON.parse(readFileSync(resolve(root,'imageEditor/app-dist/app-manifest.json')));const input={schemaVersion:1,generatedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:true,buildHash:build.buildHash,runner:{node:process.version,platform:process.platform,arch:process.arch},cases,sourceFingerprints:Object.fromEntries([...readdirSync(resolve(root,'imageEditor/src')).map(f=>'imageEditor/src/'+f),'imageEditor/scripts/check-quality-psd.mjs','imageEditor/scripts/independent-quality.py'].map(f=>[f,hash(readFileSync(resolve(root,f)))]))};writeFileSync(resolve(out,'psd-input.json'),JSON.stringify(input,null,2));
execFileSync(process.env.PSD_NATIVE_PYTHON,[resolve(root,'imageEditor/scripts/independent-quality.py'),out],{stdio:'inherit'});
