import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { ADVANCED_AUTHORING_API_VERSION, mountAdvancedAuthoring } from '../../dist/advanced-authoring/index.js';

test('neutral leaf has no product/AI/runtime owner imports; lazy entry is safe without a DOM',async()=>{
  const directory=new URL('../../src/advanced-authoring/',import.meta.url);
  for(const file of await readdir(directory)) if(file.endsWith('.ts')) {
    const source=await readFile(new URL(file,directory),'utf8');
    for(const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) assert.ok(match[1].startsWith('./') || match[1]==='@haiyue/editor-plugin-sdk',`${file}: ${match[1]}`);
    assert.doesNotMatch(source,/new\s+(?:EditorHistoryService|EditorSelectionService|World|Worker)\b/);
  }
  assert.equal(ADVANCED_AUTHORING_API_VERSION,1);
  await assert.rejects(mountAdvancedAuthoring({},AbortSignal.abort()),/mount-cancelled/);
  const entry=await readFile(new URL('../../dist/advanced-authoring/index.js',import.meta.url),'utf8');assert.match(entry,/await import\('\.\/panel\.js'\)/);
});
