import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const inspector = readFileSync(new URL('../src/authoring/Inspector.ts', import.meta.url), 'utf8');

test('browser shell contains every statically queried element', () => {
  const ids = [...main.matchAll(/query(?:<[^;]+?>)?\(['"]#([^'"]+)['"]\)/g)].map(match => match[1]);
  assert.ok(ids.length >= 20, 'expected the application shell to query its declared regions');
  for (const id of new Set(ids)) {
    assert.match(html, new RegExp(`\\bid=["']${escapeRegExp(id)}["']`), `missing #${id} in index.html`);
  }
});

test('browser shell declares the complete stage-2 workspace and production bundle entry', () => {
  for (const marker of [
    'assets-panel',
    'hierarchy-panel',
    'viewport-panel',
    'inspector-panel',
    'bottom-panel',
  ]) assert.match(html, new RegExp(`\\b${marker}\\b`));
  assert.match(html, /<ge-tabs[\s\S]+slot="timeline"[\s\S]+slot="state-machine"/);
  assert.match(html, /<script type="module" src="\.\/dist\/main\.js"><\/script>/);
});

test('browser shell exposes the stage-3 project lifecycle with shared UI components', () => {
  for (const id of [
    'open-project', 'save-project', 'save-as-project', 'close-project',
    'recent-projects-menu', 'project-file-input', 'confirm-dialog',
    'recovery-dialog', 'error-dialog', 'drop-import-overlay',
  ]) assert.match(html, new RegExp(`\\bid=["']${id}["']`));
  assert.match(html, /<ge-dropdown id="recent-projects-menu"/);
  assert.ok((html.match(/<ge-dialog\b/g) ?? []).length >= 4);
  assert.doesNotMatch(main, /window\.confirm\(/);
});

test('browser shell exposes stage-4 compilation, export and runtime preview controls', () => {
  for (const id of ['export-hya', 'preview-canvas', 'preview-title', 'preview-detail', 'preview-stats']) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`));
  }
  assert.doesNotMatch(html, /id="export-hya"[^>]*disabled/);
  assert.match(main, /compileAnimationEditorProject/);
  assert.match(main, /downloadHyaFile/);
  assert.match(main, /new AnimationEditorRuntimePreview/);
});

test('browser shell exposes stage-5 assets, shared hierarchy and inspector authoring', () => {
  for (const id of [
    'import-asset', 'delete-asset', 'asset-file-input',
    'add-node-menu', 'add-node', 'delete-node', 'hierarchy-tree',
  ]) assert.match(html, new RegExp(`\\bid=["']${id}["']`));
  assert.match(html, /<ge-tree id="hierarchy-tree"[^>]*allow-drag/);
  assert.match(html, /<ge-dropdown id="add-node-menu"/);
  assert.match(main, /createAnimationEditorAssetFromFile/);
  assert.match(main, /renderAnimationEditorInspector/);
  assert.match(main, /applyAnimationNodeHierarchy/);
  assert.doesNotMatch(html, /资源导入将在第五步提供|添加测试节点/);
});

test('browser shell exposes stage-6 track, keyframe, clip and timeline navigation authoring', () => {
  for (const id of [
    'add-track-menu', 'add-track', 'add-keyframe', 'add-clip',
    'timeline-ruler', 'timeline-lanes', 'timeline-zoom-out', 'timeline-zoom-in',
  ]) assert.match(html, new RegExp(`\\bid=["']${id}["']`));
  assert.match(html, /<ge-dropdown id="add-track-menu"/);
  assert.match(main, /createCoreTransformTrack/);
  assert.match(main, /createTimelineKeyframe/);
  assert.match(main, /installKeyframeDrag/);
  assert.match(main, /laneSurface\.addEventListener\('dblclick'/);
  assert.match(html, /id=["']show-composition-settings["']/);
  assert.match(inspector, /总时长（秒）/);
  assert.doesNotMatch(html, /轨道编辑将在第六步提供/);
});

test('browser shell composes resizable shared split regions and persists ratios outside project data', () => {
  for (const id of [
    'workspace-rows', 'workspace-columns', 'left-panel-split',
    'content-columns', 'timeline-columns', 'state-machine-columns',
  ]) assert.match(html, new RegExp(`\\bid=["']${id}["']`));
  assert.equal((html.match(/data-layout-key=/g) ?? []).length, 6);
  assert.match(main, /initializeSplitLayout/);
  assert.match(main, /haiyue-animation-editor:split-layout@1/);
});

test('browser shell exposes stage-7 state graph, layers, parameters and runtime controls', () => {
  for (const id of [
    'create-state-machine', 'add-parameter-menu', 'add-parameter',
    'add-state-layer', 'state-layer-list', 'add-state', 'add-transition',
    'reset-state-runtime', 'state-transition-layer', 'state-graph',
  ]) assert.match(html, new RegExp(`\\bid=["']${id}["']`));
  assert.match(html, /<ge-dropdown id="add-parameter-menu"/);
  assert.match(main, /createAnimationEditorStateMachine/);
  assert.match(main, /renderStateMachineInspector/);
  assert.match(main, /setStateMachineParameter/);
  assert.doesNotMatch(html, /状态图编辑将在第七步提供/);
});

test('browser shell exposes stage-8 advanced nodes, effects, composites and typed tracks', () => {
  assert.match(main, /value: 'vector'/);
  assert.match(main, /value: 'particle'/);
  assert.match(main, /value: 'audio'/);
  assert.match(main, /availableAdvancedPropertyBindings/);
  assert.match(main, /createAdvancedPropertyTrack/);
  assert.match(inspector, /createAdvancedEffect/);
  assert.match(inspector, /createCompositeLayer/);
  assert.match(inspector, /记录文本 Document/);
  assert.match(inspector, /生成整张图集动画/);
  assert.match(main, /generateSpriteSheetAnimation/);
});

test('browser shell exposes stage-9 deterministic delivery packaging', () => {
  assert.match(html, /\bid="export-package"/);
  assert.match(main, /downloadHyaPackage/);
  assert.match(main, /artifact\.bundledAssetCount/);
});

test('browser shell exposes Chinese-first localization and icon-first primary actions', () => {
  for (const id of ['editor-settings', 'editor-settings-dialog', 'editor-language', 'close-editor-settings']) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`));
  }
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /id="editor-language"[\s\S]*value="zh-CN"[\s\S]*value="en-US"/);
  for (const id of ['new-project', 'open-project', 'save-project', 'undo-command', 'redo-command', 'editor-settings']) {
    assert.match(html, new RegExp(`id=["']${id}["'][^>]*\\bicon-only\\b`));
  }
  assert.match(main, /initializeAnimationEditorLocalization/);
  assert.match(main, /animation-editor-locale-change/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
