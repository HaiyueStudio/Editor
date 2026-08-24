import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('editor-owned text input replaces unsupported Electron prompt calls', async () => {
  const [html, dialog, main, modulePanel, palette, animation] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/controllers/TextInputDialogController.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/controllers/ModulePanelController.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/controllers/PaletteController.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/controllers/AnimationController.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="text-input-dialog"/);
  assert.match(html, /id="text-input-dialog-form"/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /new AbortController\(\)/);
  assert.match(dialog, /returnFocus\?\.focus/);
  assert.match(main, /requestTextInput: textInputDialogController\.request/g);
  for (const source of [modulePanel, palette, animation]) {
    assert.doesNotMatch(source, /\bwindow\.prompt\s*\(/);
  }
});
