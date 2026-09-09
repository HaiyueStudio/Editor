import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import electron from 'electron';

test('real Electron advanced authoring panel and native Gizmo lifecycle', {timeout:90000}, async()=>{
  const output = process.env.HAIYUE_ADVANCED_TEST_OUTPUT
    ? pathToFileURL(path.resolve(process.env.HAIYUE_ADVANCED_TEST_OUTPUT) + path.sep)
    : new URL('./test-output/',import.meta.url); await mkdir(output,{recursive:true});
  await copyFile(new URL('../../src/advanced-authoring/advanced-authoring.css', import.meta.url), new URL('advanced-authoring.css', output));
  const bundle = await rollup({input:fileURLToPath(new URL('./browser-fixture.mjs',import.meta.url)),plugins:[nodeResolve({browser:true})]});
  await bundle.write({dir:fileURLToPath(output),format:'es',entryFileNames:'browser.js'}); await bundle.close();
  await writeFile(new URL('browser.html',output),'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="advanced-authoring.css"><style>body{margin:0;background:#111b28}#layout{display:grid;grid-template-columns:minmax(0,1fr) 420px}#viewport{height:460px;background:#243140;position:sticky;top:0}@media(max-width:700px){#layout{grid-template-columns:1fr}#viewport{grid-row:1;height:280px}}</style></head><body><div id="layout"><main id="panel"></main><div id="viewport" tabindex="0" aria-label="Viewport"></div></div><script type="module" src="browser.js"></script></body></html>');
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const result = await new Promise((resolve,reject)=>{const child=spawn(electron,[fileURLToPath(new URL('./browser-main.mjs',import.meta.url))],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);const timer=setTimeout(()=>child.kill(),75000);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,log});});});
  assert.equal(result.code,0,result.log);
});
