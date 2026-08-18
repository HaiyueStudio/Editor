import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  analyzeCapabilityBudgets,
  analyzeEditorBundle,
  calculateBudgetHeadroom,
  collectStaticClosureForModules,
  findOptionalRuntimeModulesInStartup,
} from '../scripts/bundle-report-lib.mjs';
import {
  editorBundleChunkFileName,
  editorBundleManualChunk,
} from '../scripts/bundle-chunk-policy.mjs';

test('bundle report follows static dependencies from entry and eager startup imports only', () => {
  const entries = [
    entry('editor.js', 100, 10),
    entry('chunks/shared.js', 200, 20),
    entry('chunks/plugin.js', 300, 30),
    entry('chunks/plugin-runtime.js', 400, 40),
    entry('chunks/lazy-inspector.js', 500, 50),
    entry('player.js', 600, 60),
  ];
  const graph = {
    schemaVersion: 1,
    chunks: [
      chunk('editor.js', ['chunks/shared.js'], ['chunks/plugin.js', 'chunks/lazy-inspector.js'], ['src/main.ts']),
      chunk('chunks/shared.js', [], [], ['src/shared.ts']),
      chunk('chunks/plugin.js', ['chunks/plugin-runtime.js', 'chunks/shared.js'], [], ['../extensions/src/plugin.ts']),
      chunk('chunks/plugin-runtime.js', [], [], ['../extensions/src/plugin-runtime.ts']),
      chunk('chunks/lazy-inspector.js', ['chunks/shared.js'], [], ['src/inspector.ts']),
      chunk('player.js', ['chunks/shared.js'], [], ['src/player.ts']),
    ],
  };
  const topology = {
    schemaVersion: 1,
    initialEntries: ['editor.js'],
    secondaryEntries: ['player.js'],
    eagerDynamicModules: ['../extensions/src/plugin.ts'],
  };

  const result = analyzeEditorBundle(entries, graph, topology);

  assert.deepEqual(result.startupFiles, [
    'chunks/plugin-runtime.js',
    'chunks/plugin.js',
    'chunks/shared.js',
    'editor.js',
  ]);
  assert.equal(result.totals.entryGzipBytes, 10);
  assert.equal(result.totals.startupClosureGzipBytes, 100);
  assert.equal(result.totals.asyncGzipBytes, 50);
  assert.equal(result.totals.secondaryGzipBytes, 60);
  assert.equal(result.entries.find(item => item.file === 'chunks/plugin.js').type, 'startup-dependency');
  assert.equal(result.entries.find(item => item.file === 'chunks/lazy-inspector.js').type, 'chunk');
});

test('bundle headroom uses the unchanged budget as its denominator', () => {
  assert.deepEqual(calculateBudgetHeadroom(1_029_478, 1_150_000), {
    bytes: 120_522,
    ratio: 120_522 / 1_150_000,
  });
  assert.throws(() => calculateBudgetHeadroom(1, 0), /positive limit/);
});

test('bundle report rejects stale startup module declarations', () => {
  assert.throws(
    () => analyzeEditorBundle(
      [entry('editor.js', 1, 1)],
      {
        schemaVersion: 1,
        chunks: [chunk('editor.js', [], [], ['src/main.ts'])],
      },
      {
        schemaVersion: 1,
        initialEntries: ['editor.js'],
        secondaryEntries: [],
        eagerDynamicModules: ['../extensions/src/missing.ts'],
      },
    ),
    /Startup module is absent/,
  );
});

test('bundle report detects optional heavy runtimes in the static startup closure', () => {
  const graph = {
    schemaVersion: 1,
    chunks: [
      chunk(
        'editor.js',
        ['chunks/shared.js'],
        ['chunks/lazy.js'],
        ['src/main.ts'],
      ),
      chunk('chunks/shared.js', [], [], [
        '../extensions/src/gltf/GltfModelSystem.ts',
        '../extensions/src/tween/Tween2DSystem.ts',
      ]),
      chunk('chunks/lazy.js', [], [], [
        '../extensions/src/spine/Spine2DRenderSystem.ts',
      ]),
    ],
  };

  assert.deepEqual(
    findOptionalRuntimeModulesInStartup(
      graph,
      ['editor.js', 'chunks/shared.js'],
    ),
    [
      '../extensions/src/gltf/GltfModelSystem.ts',
      '../extensions/src/tween/Tween2DSystem.ts',
    ],
  );
});

test('bundle report can audit the post-paint empty-project static closure', () => {
  const graph = {
    schemaVersion: 1,
    chunks: [
      chunk('editor.js', [], ['chunks/main.js'], ['src/main.ts']),
      chunk(
        'chunks/main.js',
        ['chunks/core.js'],
        ['chunks/gltf.js'],
        ['src/infra/app/mainEditorApp.ts'],
      ),
      chunk('chunks/core.js', [], [], ['src/core.ts']),
      chunk('chunks/gltf.js', [], [], [
        '../extensions/src/gltf/GltfModelSystem.ts',
      ]),
    ],
  };

  const emptyProjectFiles = collectStaticClosureForModules(
    graph,
    ['src/infra/app/mainEditorApp.ts'],
  );
  assert.deepEqual(emptyProjectFiles, ['chunks/core.js', 'chunks/main.js']);
  assert.deepEqual(
    findOptionalRuntimeModulesInStartup(graph, emptyProjectFiles),
    [],
  );
});

test('capability budgets measure static and shell-incremental gzip without hiding foreign runtimes', () => {
  const entries = [
    entry('chunks/core.js', 1000, 100),
    entry('chunks/shell.js', 2000, 200),
    entry('chunks/gltf.js', 3000, 300),
    entry('chunks/spine.js', 4000, 400),
  ];
  const graph = {
    schemaVersion: 1,
    chunks: [
      chunk('chunks/core.js', [], [], ['../engine/src/core/Engine.ts']),
      chunk('chunks/shell.js', ['chunks/core.js'], [], ['src/infra/app/mainEditorApp.ts']),
      chunk('chunks/gltf.js', ['chunks/core.js', 'chunks/spine.js'], [], [
        '../extensions/src/gltf.ts',
        '../extensions/src/gltf/GltfModelSystem.ts',
      ]),
      chunk('chunks/spine.js', ['chunks/core.js'], [], [
        '../extensions/src/spine/Spine2DRenderSystem.ts',
      ]),
    ],
  };
  const capabilities = analyzeCapabilityBudgets(entries, graph, {
    'editor-shell': {
      rootModules: ['src/infra/app/mainEditorApp.ts'],
      allowedOptionalRuntimes: [],
      maxStaticClosureGzipBytes: 500,
    },
    gltf: {
      rootModules: ['../extensions/src/gltf.ts'],
      allowedOptionalRuntimes: ['gltf'],
      incrementalFrom: 'editor-shell',
      maxStaticClosureGzipBytes: 1000,
      maxIncrementalGzipBytes: 800,
    },
  });

  const shell = capabilities.find(capability => capability.id === 'editor-shell');
  const gltf = capabilities.find(capability => capability.id === 'gltf');
  assert.equal(shell.gzipBytes, 300);
  assert.equal(gltf.gzipBytes, 800);
  assert.equal(gltf.incrementalGzipBytes, 700);
  assert.deepEqual(gltf.incrementalFiles, ['chunks/gltf.js', 'chunks/spine.js']);
  assert.deepEqual(gltf.unexpectedOptionalRuntimeModules, [{
    capability: 'spine',
    moduleId: '../extensions/src/spine/Spine2DRenderSystem.ts',
  }]);
});

test('capability report proves deferred modules leave static closure through a dynamic edge', () => {
  const entries = [
    entry('worker.js', 100, 10),
    entry('chunks/shared.js', 200, 20),
    entry('chunks/texture.js', 300, 30),
    entry('chunks/archive.js', 400, 40),
  ];
  const graph = {
    schemaVersion: 1,
    chunks: [
      chunk('worker.js', ['chunks/shared.js'], ['chunks/texture.js'], [
        'src/export/exportWorkerEntry.ts',
        'src/export/accidentallyEager.ts',
      ]),
      chunk('chunks/shared.js', [], [], ['src/export/shared.ts']),
      chunk('chunks/texture.js', [], ['chunks/archive.js'], ['src/export/texturePipeline.ts']),
      chunk('chunks/archive.js', [], [], ['src/export/projectZip.ts']),
    ],
  };
  const [capability] = analyzeCapabilityBudgets(entries, graph, {
    'import-export': {
      rootModules: ['src/export/exportWorkerEntry.ts'],
      allowedOptionalRuntimes: [],
      deferredModules: {
        texture: ['src/export/texturePipeline.ts'],
        archive: ['src/export/projectZip.ts'],
        invalid: ['src/export/accidentallyEager.ts'],
      },
      maxStaticClosureGzipBytes: 100,
    },
  });

  assert.deepEqual(capability.deferredModules, [
    {
      stage: 'texture',
      moduleIds: ['src/export/texturePipeline.ts'],
      ownerFiles: ['chunks/texture.js'],
      excludedFromStaticClosure: true,
      dynamicallyReachable: true,
    },
    {
      stage: 'archive',
      moduleIds: ['src/export/projectZip.ts'],
      ownerFiles: ['chunks/archive.js'],
      excludedFromStaticClosure: true,
      dynamicallyReachable: true,
    },
    {
      stage: 'invalid',
      moduleIds: ['src/export/accidentallyEager.ts'],
      ownerFiles: ['worker.js'],
      excludedFromStaticClosure: false,
      dynamicallyReachable: false,
    },
  ]);
});

test('bundle chunk names describe architecture without merging feature modules', () => {
  assert.equal(
    editorBundleChunkFileName({ moduleIds: ['src/infra/app/mainEditorApp.ts'] }),
    'chunks/editor-shell-[hash].js',
  );
  assert.equal(
    editorBundleChunkFileName({ moduleIds: ['../extensions/src/gltf/GltfModelSystem.ts'] }),
    'chunks/gltf-[hash].js',
  );
  assert.equal(
    editorBundleChunkFileName({ moduleIds: [
      '../extensions/src/gltf/GltfModelSystem.ts',
      '../extensions/src/spine/Spine2DRenderSystem.ts',
    ] }),
    'chunks/optional-runtime-shared-[hash].js',
  );
  assert.equal(
    editorBundleManualChunk('/workspace/engine/src/physics/Box2DPhysics2DBackend.ts'),
    'physics',
  );
  assert.equal(
    editorBundleManualChunk('/workspace/engine/src/renderer/BaseRenderer.ts'),
    'runtime-rendering-shared',
  );
  assert.equal(
    editorBundleManualChunk('/workspace/engine/src/systems/worldMatrix.ts'),
    'runtime-rendering-shared',
  );
  assert.equal(
    editorBundleManualChunk('/workspace/extensions/src/gltf/GltfModelSystem.ts'),
    undefined,
  );
  assert.equal(
    editorBundleChunkFileName({ moduleIds: ['/workspace/editor/src/script/scriptEditor.ts'] }),
    'chunks/script-authoring-[hash].js',
  );
  assert.equal(
    editorBundleManualChunk('/workspace/editor/src/script/scriptSyntaxHighlighter.ts'),
    'script-authoring',
  );
  assert.equal(
    editorBundleChunkFileName({ moduleIds: ['/workspace/editor/src/player/PlayerDebugRuntime.ts'] }),
    'chunks/player-debug-[hash].js',
  );
});

test('startup topology stays aligned with the post-paint shell boundary', () => {
  const topology = JSON.parse(readFileSync(new URL('../bundle-startup.json', import.meta.url), 'utf8'));
  const loader = readFileSync(new URL('../src/infra/app/lazyContributionLoader.ts', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../src/infra/app/mainEditorApp.ts', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  assert.deepEqual(topology.eagerDynamicModules, []);
  assert.doesNotMatch(shell, /import\s+\{\s*runMainEditorApp\s*\}/);
  assert.match(shell, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame/);
  assert.match(shell, /import\(['"]\.\/infra\/app\/mainEditorApp['"]\)/);
  assert.doesNotMatch(bootstrap, /await loadEditorComponentPlugins\(\)/);
  for (const name of ['gltf', 'spine', 'tilemap']) {
    assert.match(
      loader,
      new RegExp(`${name}:\\s*\\(\\)\\s*=>\\s*import\\(['"]@haiyue/extensions/${name}['"]\\)`),
    );
  }
  assert.match(loader, /tween:\s*\(\)\s*=>\s*import\(['"]\.\/tweenEditorContribution['"]\)/);
});

test('bundle capability budget keeps every governed architecture root active', () => {
  const budget = JSON.parse(readFileSync(new URL('../bundle-budget.json', import.meta.url), 'utf8'));
  assert.equal(budget.schemaVersion, 2);
  assert.equal(budget.maxTotalGzipBytes, 1_240_000);
  assert.equal(budget.minTotalGzipHeadroomRatio, 0.1);
  assert.equal(budget.capabilities['player-core'].maxStaticClosureGzipBytes, 440_000);
  assert.equal(budget.capabilities['import-export'].maxStaticClosureGzipBytes, 210 * 1024);
  assert.deepEqual(Object.keys(budget.capabilities), [
    'editor-shell',
    'content-authoring',
    'player-core',
    'gltf',
    'spine',
    'tilemap',
    'tween',
    'physics',
    'import-export',
  ]);
  for (const [id, policy] of Object.entries(budget.capabilities)) {
    assert.ok(policy.rootModules.length > 0, `${id} needs a graph root`);
    assert.ok(policy.maxStaticClosureGzipBytes > 0, `${id} needs a gzip budget`);
  }
  assert.deepEqual(Object.keys(budget.capabilities['editor-shell'].deferredModules), [
    'script-authoring',
  ]);
  assert.deepEqual(Object.keys(budget.capabilities['player-core'].deferredModules), [
    'scene-deserialization',
    'debug',
    'shadow',
  ]);
  assert.deepEqual(Object.keys(budget.capabilities['import-export'].deferredModules), [
    'texture',
    'codegen',
    'archive',
  ]);
  assert.deepEqual(budget.capabilities['content-authoring'].rootModules, [
    'src/infra/content/ContentAuthoringPanel.ts',
    'src/infra/content/materialGraphCompiler.worker.ts',
  ]);
  assert.equal(budget.capabilities['content-authoring'].incrementalFrom, 'editor-shell');
  for (const id of ['gltf', 'spine', 'tilemap', 'tween', 'physics']) {
    assert.equal(budget.capabilities[id].incrementalFrom, 'editor-shell');
    assert.ok(budget.capabilities[id].maxIncrementalGzipBytes > 0);
  }
});

function entry(file, bytes, gzipBytes) {
  return { file, bytes, gzipBytes };
}

function chunk(fileName, imports, dynamicImports, moduleIds) {
  return { fileName, imports, dynamicImports, moduleIds };
}
