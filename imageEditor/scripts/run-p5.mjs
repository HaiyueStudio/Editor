import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';import {resolve} from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {cases} from '../test/p5-cases.mjs';import {exportPsd} from '../dist/psdAdapter.js';import {readPsd} from 'ag-psd';import {compositeState} from '../dist/compositor.js';
const root=resolve(import.meta.dirname,'../..'),output=resolve(root,'imageEditor/artifacts/p5');mkdirSync(output,{recursive:true});
const entries=[];const hash=data=>createHash('sha256').update(data).digest('hex');
for(const item of cases()){
  const result=exportPsd(item.state,true);writeFileSync(resolve(output,item.id+'.psd'),result.bytes);
  const decoded=readPsd(result.bytes,{useImageData:true,skipThumbnail:true}), rendered=compositeState(item.state);
  const layers=items=>(items??[]).map(layer=>({name:layer.name,left:layer.left??0,top:layer.top??0,hidden:layer.hidden??false,opacity:Math.round((layer.opacity??1)*255),blend:layer.blendMode??'normal',
    pixels:layer.imageData?{width:layer.imageData.width,height:layer.imageData.height,sha256:hash(layer.imageData.data)}:null,children:layer.children?layers(layer.children):null}));
  writeFileSync(resolve(output,item.id+'.expected.rgba'),rendered.data);
  entries.push({id:item.id,width:item.state.width,height:item.state.height,layers:layers(decoded.children),sha256:hash(result.bytes),maxStraightError:result.maxStraightError,maxPremultipliedError:result.maxPremultipliedError,resourceIds:result.preservedResourceIds});
}
writeFileSync(resolve(output,'cases.json'),JSON.stringify(entries,null,2)+'\n');
const sources=[...readdirSync(resolve(root,'imageEditor/src')).map(file=>'imageEditor/src/'+file),'imageEditor/scripts/run-p5.mjs','imageEditor/scripts/independent-p3.py','imageEditor/test/psdAdapter.test.mjs','imageEditor/test/p5-cases.mjs','imageEditor/app/descriptor.json','imageEditor/rollup.config.js','package-lock.json'];
let independent={status:'unavailable',reason:'Set PSD_P5_PYTHON to a Python environment containing psd-tools.'};
if(process.env.PSD_P5_PYTHON){const run=spawnSync(process.env.PSD_P5_PYTHON,[resolve(root,'imageEditor/scripts/independent-p3.py'),output],{encoding:'utf8',timeout:120000});if(run.status!==0)throw new Error(run.stderr||run.stdout);independent=JSON.parse(readFileSync(resolve(output,'independent.json')));}
const report={schemaVersion:1,status:independent.status==='passed'?'passed':'pending-independent',generatedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()),runner:{node:process.version,platform:process.platform,arch:process.arch},sourceFingerprints:Object.fromEntries(sources.map(file=>[file,hash(readFileSync(resolve(root,file)))])),cases:entries,independent,photoshop:'pending-manual-acceptance'};
writeFileSync(resolve(output,'codec.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,status:report.status,cases:entries.length,independent:independent.status}));
