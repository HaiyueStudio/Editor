import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyEditorTheme,
  applyStoredEditorTheme,
  DEFAULT_EDITOR_THEME,
  EDITOR_THEME_STORAGE_KEY,
  installLegacyButtonThemeBridge,
  normalizeEditorTheme,
  readStoredEditorTheme,
  storeEditorTheme,
} from '../dist-test/testing.js';

test('editor theme normalizes, persists, and applies the supported palettes', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const root = { dataset: {}, style: {} };

  assert.equal(normalizeEditorTheme('light'), 'light');
  assert.equal(normalizeEditorTheme('system'), DEFAULT_EDITOR_THEME);
  assert.equal(readStoredEditorTheme(storage), 'dark');
  assert.equal(storeEditorTheme('light', storage), 'light');
  assert.equal(values.get(EDITOR_THEME_STORAGE_KEY), 'light');
  assert.equal(applyStoredEditorTheme(storage, root), 'light');
  assert.equal(root.dataset.hyTheme, 'light');
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(applyEditorTheme('unsupported', root), 'dark');
  assert.equal(root.dataset.hyTheme, 'dark');
});

test('legacy GE buttons receive one HY-token theme bridge per shadow root', () => {
  const appended = [];
  const shadowRoot = {
    querySelector: () => appended[0] ?? null,
    append: style => appended.push(style),
  };
  const ownerDocument = {
    createElement: () => ({
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); },
      textContent: '',
    }),
  };
  const scope = {
    querySelectorAll: () => [{ shadowRoot, ownerDocument }],
  };

  assert.equal(installLegacyButtonThemeBridge(scope), 1);
  assert.equal(installLegacyButtonThemeBridge(scope), 0);
  assert.match(appended[0].textContent, /var\(--hy-surface-elevated-color/);
  assert.match(appended[0].textContent, /button:not\(:disabled\):hover/);
});

test('scene editor packages the theme sheet and exposes the localized theme setting', async () => {
  const [html, css, descriptorText] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../theme.css', import.meta.url), 'utf8'),
    readFile(new URL('../app/descriptor.json', import.meta.url), 'utf8'),
  ]);
  const descriptor = JSON.parse(descriptorText);

  assert.match(html, /id="editor-theme-select"/);
  assert.match(html, /data-i18n="theme\.light"/);
  assert.match(html, /data-i18n="theme\.dark"/);
  assert.match(css, /:root\[data-hy-theme="light"\]/);
  assert.match(css, /--hy-accent-color:/);
  assert.match(css, /--ge-accent-color:/);
  assert.ok(descriptor.staticFiles.includes('theme.css'));
});

test('theme startup stays isolated from the deferred editor options chunk', async () => {
  const policy = await import('../scripts/bundle-chunk-policy.mjs');
  assert.equal(policy.editorBundleManualChunk('/editor/src/infra/theme/editorTheme.ts'), 'editor-theme');
  assert.equal(policy.editorBundleManualChunk('/editor/src/infra/options/editorOptions.ts'), 'editor-localization');
});
