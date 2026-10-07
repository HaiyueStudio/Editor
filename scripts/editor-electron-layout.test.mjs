import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { packagedElectronPath } from './editor-electron-layout.mjs';
const base={packageRoot:resolve('/tmp/product'),outputDirectory:'release/candidate',productName:'Image Editor',appName:'image-editor'};
test('native candidate paths support macOS, Windows and Linux layouts',()=>{
 for(const [platform,arch,suffix] of [['darwin','x64','mac/Image Editor.app/Contents/MacOS/Image Editor'],['darwin','arm64','mac-arm64/Image Editor.app/Contents/MacOS/Image Editor'],['win32','x64','win-unpacked/Image Editor.exe'],['win32','arm64','win-arm64-unpacked/Image Editor.exe'],['linux','x64','linux-unpacked/image-editor']])assert.equal(packagedElectronPath({...base,platform,arch}),resolve(base.packageRoot,base.outputDirectory,suffix));
});
test('candidate paths reject traversal, external roots, invalid names and unknown platforms',()=>{
 for(const patch of [{outputDirectory:'../escape'},{outputDirectory:'/outside'},{outputDirectory:'.'},{productName:'../evil'},{productName:'x/y'},{platform:'unknown'},{arch:'other'}])assert.throws(()=>packagedElectronPath({...base,...patch}));
});
