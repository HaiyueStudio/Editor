import { readFileSync } from 'node:fs';
import { cleanOutputDirectory, haiyuePlugins } from '../config/rollup.shared.js';
import { fileURLToPath } from 'node:url';

// Keep shared modules beside worker entries: new URL(worker, import.meta.url)
// must resolve consistently after Rollup extracts an API helper into a chunk.
// Use the codec's advertised ESM distribution so Rollup can remove unused exports.
const psdPackage=new URL(import.meta.resolve('ag-psd/package.json'));
const psdModule=fileURLToPath(new URL(JSON.parse(readFileSync(psdPackage,'utf8')).module,psdPackage));

export default {
  input: { main: 'src/main.ts', 'psd-worker': 'src/psdWorker.ts', 'filter-worker': 'src/filterWorker.ts', 'icc-reference-worker':'src/iccReferenceWorker.ts' },
  output: { dir: 'web', format: 'es', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js', sourcemap: false },
  plugins: [cleanOutputDirectory('web'), { name:'icc-runtime', generateBundle(){ const base=new URL(import.meta.resolve('iccdev/package.json'));for(const tool of ['iccApplyNamedCmm','iccDumpProfile']){const dir=tool==='iccApplyNamedCmm'?'IccApplyNamedCmm':'IccDumpProfile';this.emitFile({type:'asset',fileName:tool+'.mjs',source:readFileSync(new URL(dir+'/'+tool+'.js',base),'utf8')+'\nexport default createModule;\n'});this.emitFile({type:'asset',fileName:tool+'.wasm',source:readFileSync(new URL(dir+'/'+tool+'.wasm',base))});}this.emitFile({type:'asset',fileName:'iccDEV-LICENSE.txt',source:readFileSync(new URL('LICENSE',base))}); for(const [fileName,path] of [['lcms.wasm','dist/lcms.wasm'],['lcms-LICENSE.txt','LICENSE.md']]) this.emitFile({type:'asset',fileName,source:readFileSync(new URL(path,new URL(import.meta.resolve('lcms-wasm/package.json'))))}); this.emitFile({type:'asset',fileName:'pako-LICENSE.txt',source:readFileSync(new URL('LICENSE',import.meta.resolve('pako/package.json')))}); } }, ...haiyuePlugins({ tsconfig: './tsconfig.web.json', declaration: false, minify: true, mangle: true, keepFunctionNames: false, keepClassNames: false, minifyModule: true,
    localPackages: { 'ag-psd': psdModule, '@haiyue/ui': fileURLToPath(import.meta.resolve('@haiyue/ui')) },
  })],
};
