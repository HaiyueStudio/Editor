import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEditorBrowserScenario } from './browserDriver.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const editorEntry = resolve(root, 'editor/index.html');
const editorBundle = resolve(root, 'editor/dist/editor.js');
const artifactPath = resolve(
  root,
  process.env.EDITOR_E2E_OUTPUT ?? 'artifacts/editor-e2e/tetris-starter-play.json',
);
const failureScreenshotPath = resolve(
  root,
  process.env.EDITOR_E2E_SCREENSHOT ?? 'artifacts/editor-e2e/tetris-starter-play-failure.png',
);
const downloadDirectory = mkdtempSync(resolve(tmpdir(), 'haiyue-editor-e2e-downloads-'));
const missingTilemapWarning = 'Tetris Starter Kit requires Tetris Board with Tilemap2DComponent.';
const startedAt = Date.now();

for (const required of [editorEntry, editorBundle]) {
  if (!existsSync(required)) {
    throw new Error(`Editor E2E requires ${relative(root, required)}; build the editor first.`);
  }
}
if (existsSync(failureScreenshotPath)) unlinkSync(failureScreenshotPath);

try {
  const result = await runEditorBrowserScenario({
    root,
    route: 'editor/index.html',
    downloadDirectory,
    failureScreenshotPath,
    timeoutMs: 90_000,
    async scenario(driver) {
      const contributionRequested = await driver.evaluate(`
        (() => {
          const dropdown = document.querySelector('#starter-kit-dropdown');
          if (!dropdown) return false;
          dropdown.dispatchEvent(new PointerEvent('pointerenter', {
            bubbles: true,
            composed: true,
          }));
          return true;
        })()
      `);
      if (!contributionRequested) throw new Error('Could not warm the Starter Kit contribution.');

      await driver.waitFor(
        () => driver.evaluate(`
          document.querySelector('#starter-kit-dropdown')?.items
            ?.some(item => item.value === 'Tetris Starter Kit') === true
        `),
        'Tetris Starter Kit contribution',
      );
      const kitApplied = await driver.evaluate(`
        (() => {
          const dropdown = document.querySelector('#starter-kit-dropdown');
          if (!dropdown) return false;
          dropdown.dispatchEvent(new CustomEvent('item-select', {
            bubbles: true,
            composed: true,
            detail: { value: 'Tetris Starter Kit' },
          }));
          return true;
        })()
      `);
      if (!kitApplied) throw new Error('Could not apply the Tetris Starter Kit.');

      await driver.waitFor(
        () => driver.evaluate(`
          (() => {
            const names = [];
            const visit = nodes => {
              for (const node of nodes ?? []) {
                names.push(node.label);
                visit(node.children);
              }
            };
            visit(document.querySelector('#hierarchy-tree')?.data);
            return names.includes('Tetris Board') && names.includes('Tetris GameManager');
          })()
        `),
        'Tetris scene entities',
      );
      await driver.click(`
        [...(document.querySelector('#hierarchy-tree')?.shadowRoot?.querySelectorAll('.row') ?? [])]
          .find(row => row.querySelector('[label="Tetris Board"]'))
      `, { label: 'Tetris Board hierarchy row' });
      await driver.waitFor(
        () => driver.evaluate(`
          document.querySelector('#hierarchy-tree')?.shadowRoot
            ?.querySelector('.row.selected [label="Tetris Board"]') !== null
        `),
        'Tetris Board selection',
      );

      const playStartedAt = Date.now();
      await driver.click('document.querySelector("#play-button")', { label: 'Play button' });
      const playState = await driver.waitFor(
        () => driver.evaluate(`
          (() => {
            const overlay = document.querySelector('#play-overlay');
            const frame = document.querySelector('#play-frame');
            const output = document.querySelector('#play-output');
            const lines = [...(output?.querySelectorAll('.play-output-line') ?? [])]
              .map(line => line.textContent ?? '');
            const lifecycleStarted = lines.some(line =>
              line.includes('lifecycle') && line.includes('started'));
            const ready = lines.some(line => line.includes('Tetris Starter Kit ready.'));
            const missingTilemap = lines.find(line => line.includes(${JSON.stringify(missingTilemapWarning)})) ?? '';
            const runtimeError = lines.find(line => line.includes(' error')) ?? '';
            const frameCanvas = frame?.contentDocument?.querySelector('#player-canvas');
            if (missingTilemap || runtimeError || (lifecycleStarted && ready && frameCanvas?.tagName === 'CANVAS')) {
              return {
                lifecycleStarted,
                ready,
                missingTilemap,
                runtimeError,
                overlayVisible: overlay?.hidden === false,
                canvas: frameCanvas?.tagName === 'CANVAS'
                  ? { width: frameCanvas.width, height: frameCanvas.height }
                  : null,
              };
            }
            return null;
          })()
        `),
        'Tetris Player readiness or failure',
      );
      if (playState.missingTilemap) throw new Error(playState.missingTilemap);
      if (playState.runtimeError) throw new Error(playState.runtimeError);
      if (!playState.lifecycleStarted || !playState.ready || !playState.canvas || !playState.overlayVisible) {
        throw new Error(`Tetris Player did not reach ready state: ${JSON.stringify(playState)}`);
      }

      await driver.waitFor(
        () => driver.evaluate(`
          (() => {
            const inspector = document.querySelector('#play-runtime-inspector')?.textContent ?? '';
            return inspector.includes('Tetris Board') && inspector.includes('Tilemap2DComponent');
          })()
        `),
        'Tetris Board Tilemap in runtime inspector',
      );
      driver.assertNoBrowserErrors();

      return {
        schemaVersion: 1,
        scenario: 'editor-tetris-starter-play',
        status: 'passed',
        scene: {
          starterKit: 'Tetris Starter Kit',
          containsBoard: true,
          containsGameManager: true,
        },
        play: {
          durationMs: Date.now() - playStartedAt,
          ...playState,
          runtimeInspectorContainsTilemap: true,
        },
        environment: {
          url: driver.url,
          chromePath: driver.chrome,
          angleBackend: driver.angleBackend,
        },
        durationMs: Date.now() - startedAt,
      };
    },
  });

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `[editor-e2e] passed Tetris Starter Kit play in ${result.durationMs}ms; `
    + `player=${result.play.canvas.width}x${result.play.canvas.height}.`,
  );
  console.log(`[editor-e2e] Wrote ${relative(root, artifactPath)}.`);
} catch (error) {
  mkdirSync(dirname(artifactPath), { recursive: true });
  const failure = {
    schemaVersion: 1,
    scenario: 'editor-tetris-starter-play',
    status: 'failed',
    durationMs: Date.now() - startedAt,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: 'Error', message: String(error) },
  };
  writeFileSync(artifactPath, `${JSON.stringify(failure, null, 2)}\n`);
  throw error;
} finally {
  rmSync(downloadDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
