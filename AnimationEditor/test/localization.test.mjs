import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANIMATION_EDITOR_LOCALES,
  ANIMATION_EDITOR_LOCALE_STORAGE_KEY,
  localizeLiteral,
  normalizeAnimationEditorLocale,
  translate,
} from '../dist-test/testing.js';

test('animation editor localization defaults to Chinese and offers an English catalog', () => {
  assert.deepEqual(ANIMATION_EDITOR_LOCALES, ['zh-CN', 'en-US']);
  assert.equal(ANIMATION_EDITOR_LOCALE_STORAGE_KEY, 'haiyue.animation-editor.locale');
  assert.equal(translate('toolbar.new'), '新建工程');
  assert.equal(translate('toolbar.new', {}, 'en-US'), 'New project');
  assert.equal(translate('status.stats', { nodes: 2, tracks: 3, assets: 1 }), '2 个节点 · 3 条轨道 · 1 个资源');
  assert.equal(translate('status.stats', { nodes: 2, tracks: 3, assets: 1 }, 'en-US'), '2 nodes · 3 tracks · 1 assets');
});

test('animation editor localization normalizes supported locale variants and inspector labels', () => {
  assert.equal(normalizeAnimationEditorLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(normalizeAnimationEditorLocale('en-GB'), 'en-US');
  assert.equal(normalizeAnimationEditorLocale('fr-FR'), null);
  assert.equal(localizeLiteral('Timeline Track'), '时间轴轨道');
  assert.equal(localizeLiteral('图集列数', 'en-US'), 'Sprite Sheet Columns');
  assert.equal(localizeLiteral('＋ Blur'), '＋ 模糊');
});
