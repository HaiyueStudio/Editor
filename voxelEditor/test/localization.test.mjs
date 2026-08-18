import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  EDITOR_LOCALE_STORAGE_KEY,
  normalizeEditorLocale,
  translate,
} from '../dist/localization.js';

test('editor locales normalize safely and default content remains Chinese', () => {
  assert.equal(EDITOR_LOCALE_STORAGE_KEY, 'haiyue.voxel-editor.locale');
  assert.equal(normalizeEditorLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(normalizeEditorLocale('en-GB'), 'en-US');
  assert.equal(normalizeEditorLocale('ja-JP'), null);
  assert.equal(translate('paint.replaceTitle', {}, 'zh-CN'), '替换颜色');
  assert.equal(translate('paint.replaceTitle', {}, 'en-US'), 'Replace Color');
  assert.match(translate('hint.mirror', {}, 'zh-CN'), /镜像轴可以组合/);
  assert.match(translate('hint.mirror', {}, 'en-US'), /mirror axes can be combined/);
  assert.equal(
    translate('paint.replaced', { count: '12', color: '#FF0000' }, 'en-US'),
    'Replaced 12 voxels with #FF0000.',
  );
});

test('replace color UI exposes a target swatch and editor language settings', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="editor-settings"/);
  assert.match(html, /id="editor-help"/);
  assert.match(html, /id="editor-help-dialog"/);
  assert.match(html, /id="editor-language"/);
  assert.match(html, /id="replace-target-color"/);
  assert.match(html, /id="scene-background-color"/);
  assert.match(html, /id="scene-background-hex"/);
  assert.match(html, /id="reset-scene-background"/);
  assert.match(html, /id="mirror-help"/);
  assert.match(html, /data-i18n-label="hint\.mirror"/);
  assert.match(html, />替换颜色</);
  assert.match(html, />替换为</);
  assert.doesNotMatch(html, /id="capture-replace-source"/);
  assert.doesNotMatch(html, />Replace Color</);
  assert.doesNotMatch(html, /class="help-card"/);
  assert.doesNotMatch(html, /class="hint"/);
});

test('scene statistics live in the status bar without duplicate project actions', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const voxelCountIndex = html.indexOf('id="voxel-count"');
  const gridStatusIndex = html.indexOf('data-i18n="status.grid"');
  assert.ok(voxelCountIndex >= 0, 'expected the voxel count in the editor shell');
  assert.ok(voxelCountIndex < gridStatusIndex, 'expected voxel count immediately before grid status');
  assert.doesNotMatch(html, /id="(?:import-project|import-image|export-menu)-side"/);
  assert.doesNotMatch(html, /data-i18n="project.panel"/);
  assert.doesNotMatch(html, /data-i18n="stats.title"/);
});

test('every localized panel string references a complete translation catalog entry', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-(?:title|aria-label|placeholder|label))?="([^"]+)"/g)]
    .map(match => match[1]);
  assert.ok(keys.length > 150, 'expected the complete editor surface to be localized');
  for (const key of keys) {
    assert.doesNotThrow(() => translate(key, {}, 'zh-CN'), `missing zh-CN translation: ${key}`);
    assert.doesNotThrow(() => translate(key, {}, 'en-US'), `missing en-US translation: ${key}`);
  }

  for (const match of html.matchAll(/<([^>]+)>([^<>]*[\u3400-\u9fff][^<>]*)</g)) {
    const tag = match[1];
    const isLanguageAutonym = /^option value="zh-CN"/.test(tag);
    assert.ok(isLanguageAutonym || /data-i18n(?:=|-[a-z-]+=)/.test(tag), `unlocalized text: ${match[2].trim()}`);
  }
  for (const match of html.matchAll(/<[^>]+>/g)) {
    for (const attribute of ['title', 'aria-label', 'placeholder', 'label']) {
      const value = match[0].match(new RegExp(`\\s${attribute}="([^"]*[\\u3400-\\u9fff][^"]*)"`));
      assert.ok(!value || match[0].includes(`data-i18n-${attribute}=`), `unlocalized ${attribute}: ${value?.[1]}`);
    }
  }
});

test('runtime-generated panel labels translate variables in both locales', () => {
  assert.equal(translate('viewport.selectCount', { count: 12 }, 'en-US'), 'Select · 12');
  assert.equal(translate('animation.frame', { current: 3, total: 12 }, 'en-US'), 'Frame 3 / 12');
  assert.equal(translate('module.layerSummary', {
    name: 'Gameplay', voxels: 20, instances: 4,
  }, 'en-US'), 'Gameplay (20 voxels · 4 instances)');
  assert.equal(translate('material.usage', { count: 128 }, 'zh-CN'), '128 个定义体素使用此材质');
});
