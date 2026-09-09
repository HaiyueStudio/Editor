import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ADVANCED_AUTHORING_API_VERSION, mountAdvancedAuthoring, parseAdvancedAuthoringView } from '@haiyue/editor-shell/advanced-authoring';

test('advanced public subpath and its packaged CSS resolve without loading a browser panel', async () => {
  assert.equal(ADVANCED_AUTHORING_API_VERSION, 1);
  assert.equal(typeof mountAdvancedAuthoring, 'function');
  assert.throws(() => parseAdvancedAuthoringView({ schemaVersion: 999 }));
  const css = await readFile(new URL(import.meta.resolve('@haiyue/editor-shell/advanced-authoring.css')), 'utf8');
  assert.match(css, /advanced/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(mountAdvancedAuthoring({}, controller.signal), /mount-cancelled/);
});
