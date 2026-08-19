import test from 'node:test';
import assert from 'node:assert/strict';
import { runEditorPluginConformance } from '../dist/conformance.js';

test('public conformance kit exercises dependency activation and reverse disposal', async () => {
  const result = await runEditorPluginConformance();
  assert.deepEqual(result.disposed, ['consumer', 'provider']);
});
