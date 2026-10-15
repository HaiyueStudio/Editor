import {spawnSync,execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {compositeReference,compositeState} from '../dist/compositor.js';
const hash=b=>createHash('sha256').update(b).digest('hex'),root=resolve(import.meta.dirname,'../..');
if(process.argv[2]){
 const bitmap={width:512,height:512,data:Uint8ClampedArray.from({length:512*512*4},(_,i)=>i%4===3?180:i%251)},layer=(id,x,y)=>({id,name:id,kind:'pixel',x,y,visible:true,locked:false,opacity:.85,blend:'normal',bitmap,children:[]});
 const group=(id,children)=>({...layer(id,17,-9),kind:'group',bitmap:null,children});const state={id:'tile-benchmark',name:'tile-benchmark',width:1536,height:1536,revision:1,selectedId:null,layers:[layer('base',0,0),group('outer',[layer('a',400,300),group('middle',[layer('b',700,600),group('inner',[layer('c',900,900),layer('d',950,950)])])])]};
 global.gc?.();const start=performance.now(),image=process.argv[2]==='reference'?compositeReference(state):compositeState(state),elapsed=performance.now()-start;console.log(JSON.stringify({mode:process.argv[2],milliseconds:elapsed,maxRssKiB:process.resourceUsage().maxRSS,sha256:hash(image.data),width:state.width,height:state.height,groups:3,pixelLayers:5}));
}else{
 const samples=[];for(let i=0;i<3;i++)for(const mode of ['reference','tiled']){const run=spawnSync(process.execPath,['--expose-gc',import.meta.filename,mode],{encoding:'utf8',timeout:120000});if(run.status!==0)throw Error(run.stderr);samples.push(JSON.parse(run.stdout));}if(new Set(samples.map(s=>s.sha256)).size!==1)throw Error('Tiled output differs from full reference.');
 const report={schemaVersion:1,status:'passed',classification:'local-diagnostic-not-release-evidence',generatedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:true,buildHash:JSON.parse(readFileSync(resolve(root,'imageEditor/app-dist/app-manifest.json'))).buildHash,runner:{node:process.version,platform:process.platform,arch:process.arch},samples,sourceFingerprints:Object.fromEntries(['imageEditor/src/compositor.ts','imageEditor/scripts/check-tile-performance.mjs'].map(f=>[f,hash(readFileSync(resolve(root,f)))]))};const out=resolve(root,'imageEditor/artifacts/foundations');mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'tile-diagnostic.json'),JSON.stringify(report,null,2));console.log(report);
}
