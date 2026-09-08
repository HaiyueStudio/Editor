import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile,readdir,mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=new URL('./test-output/',import.meta.url);
const digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
async function binding() {
  const files=[];
  async function walk(relative) { for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})) { const name=`${relative}/${entry.name}`; if(entry.name==='test-output')continue;if(entry.isDirectory())await walk(name);else if(entry.isFile())files.push(name); } }
  for(const directory of ['editor-shell/src','editor-shell/test/advanced-authoring','editor-plugin-sdk/src','editor-platform/src'])await walk(directory);
  files.push('package-lock.json','editor-shell/package.json','editor-shell/tsconfig.json','editor-platform/package.json','editor-plugin-sdk/package.json');files.sort();
  const sources=[];for(const file of files)sources.push({path:file,digest:digest(await readFile(path.join(root,file)))});
  return {digest:digest(JSON.stringify(sources)),sources};
}
await mkdir(output,{recursive:true});const before=await binding(),checks=[];
const groups=[
  ['build',['node_modules/typescript/bin/tsc','-p','editor-shell/tsconfig.json']],
  ['typecheck',['node_modules/typescript/bin/tsc','-p','editor-shell/tsconfig.json','--noEmit']],
  ['leaf',['--test','--test-reporter=tap','editor-shell/test/advanced-authoring/*.test.mjs']],
  ['existing-shell',['--test','--test-reporter=tap','editor-shell/test/*.test.mjs']],
  ['existing-platform',['--test','--test-reporter=tap','editor-platform/test/*.test.mjs']],
  ['repository-boundaries',['scripts/check-repository-boundaries.mjs']],
  ['scene-boundaries',['scripts/check-boundaries.mjs']],
  ['public-api',['scripts/check-platform-api.mjs']],
  ['compatibility',['scripts/check-dependency-compatibility.mjs']],
];
for(const [id,args] of groups) {
  const started=performance.now();const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:id==='scene-boundaries'?path.join(root,'editor'):root,windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>text+=b);const deadline=setTimeout(()=>child.kill(),110000);child.once('error',reject);child.once('close',code=>{clearTimeout(deadline);resolve({code,text});});});
  await writeFile(new URL(`${id}.txt`,output),result.text);assert.equal(result.code,0,result.text);
  const count=key=>Number(result.text.match(new RegExp(`^# ${key} (\\d+)$`,'m'))?.[1]);
  if(args.includes('--test'))for(const key of ['fail','skipped','cancelled'])assert.equal(count(key),0,`${id}: ${key}`);
  checks.push({id,args,exitCode:result.code,passed:args.includes('--test')?count('pass'):null,durationMs:Math.round(performance.now()-started),outputDigest:digest(result.text)});console.log(`[advanced-editor] ${id} passed`);
}
let projection=null;
if(process.argv[2]==='--projection-file') {
  assert.ok(path.isAbsolute(process.argv[3]));const bytes=await readFile(process.argv[3]);
  const {parseAdvancedAuthoringView}=await import('../../dist/advanced-authoring/index.js');const view=parseAdvancedAuthoringView(JSON.parse(bytes));
  projection={mode:'JSON fixture compatibility only; no cross-repository runtime import or candidate consumption',digest:digest(bytes),hierarchy:view.hierarchy.length,sections:view.sections.length};
}
assert.equal((await binding()).digest,before.digest,'Editor sources changed during verification');
await writeFile(new URL('checks.json',output),JSON.stringify({schemaVersion:1,status:'passed',productIntegrated:false,verifiedAt:new Date().toISOString(),inputDigest:before.digest,sources:before.sources,checks,projection},null,2)+'\n');
