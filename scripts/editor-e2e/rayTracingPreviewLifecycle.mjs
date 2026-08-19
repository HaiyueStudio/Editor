import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runEditorBrowserScenario } from './browserDriver.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifactPath = resolve(root, process.env.EDITOR_RAY_E2E_OUTPUT ?? 'artifacts/editor-e2e/ray-tracing-preview-lifecycle.json');
const screenshotPath = resolve(root, process.env.EDITOR_RAY_E2E_SCREENSHOT ?? 'artifacts/editor-e2e/ray-tracing-preview-lifecycle-failure.png');
const downloads = mkdtempSync(resolve(tmpdir(), 'haiyue-ray-editor-e2e-'));
const startedAt = Date.now();
if (!existsSync(resolve(root, 'editor/dist/editor.js'))) throw new Error('Build the Scene Editor before running ray tracing E2E.');

try {
  const result = await runEditorBrowserScenario({
    root,
    route: 'editor/index.html',
    downloadDirectory: downloads,
    failureScreenshotPath: screenshotPath,
    timeoutMs: 120_000,
    async scenario(driver) {
      const listenersBefore = await driver.evaluate('window.__editorE2EListenerCount?.() ?? -1');
      await driver.click('document.querySelector("#ray-tracing-preview-button")', { label: 'Ray Trace lazy-load button' });
      await driver.waitFor(() => driver.evaluate('document.querySelector("#ray-tracing-preview-panel")?.dataset.rayTracingPanel === "active"'), 'ray tracing panel mount');
      await selectUnsupportedMode(driver);
      await driver.waitFor(() => driver.evaluate('document.querySelector("#ray-tracing-preview-panel")?.dataset.rayTracingStatus === "unsupported"'), 'classified hybrid diagnostic');

      await driver.click('document.querySelector("#save-button")', { label: 'save while ray preview active' });
      const scenePath = await waitForDownload(downloads, '.json', 'saved Scene document');
      const saved = JSON.parse(readFileSync(scenePath, 'utf8'));
      if (!Array.isArray(saved.entities) || !saved.resources) throw new Error('Saved Scene document is incomplete.');

      await driver.setFileInputFiles('#open-file-input', [scenePath]);
      await driver.waitFor(() => driver.evaluate(`
        !document.querySelector('#save-button')?.hasAttribute('data-dirty')
          && document.querySelector('#ray-tracing-preview-panel')?.dataset.rayTracingStatus === 'unsupported'
      `), 'reopened project and rebuilt classified preview state');

      await driver.click('document.querySelector("#play-button")', { label: 'Play with ray preview active' });
      await driver.waitFor(() => driver.evaluate(`
        (() => {
          const overlay = document.querySelector('#play-overlay');
          const frameCanvas = document.querySelector('#play-frame')?.contentDocument?.querySelector('#player-canvas');
          return overlay?.hidden === false && frameCanvas?.tagName === 'CANVAS';
        })()
      `), 'play session startup');
      await driver.click('document.querySelector("#play-close-button")', { label: 'close Play session' });
      await driver.waitFor(() => driver.evaluate('document.querySelector("#play-overlay")?.hidden === true'), 'play session teardown');

      await driver.click('document.querySelector("#ray-tracing-preview-panel [data-ray-disable]")', { label: 'unload ray tracing preview' });
      await driver.waitFor(() => driver.evaluate('!document.querySelector("#ray-tracing-preview-panel")'), 'ray tracing panel unload');
      await driver.click('document.querySelector("#ray-tracing-preview-button")', { label: 'reload ray tracing preview' });
      await driver.waitFor(() => driver.evaluate('Boolean(document.querySelector("#ray-tracing-preview-panel"))'), 'ray tracing panel reload');
      await selectUnsupportedMode(driver);
      await driver.waitFor(() => driver.evaluate('document.querySelector("#ray-tracing-preview-panel")?.dataset.rayTracingStatus === "unsupported"'), 'reloaded preview classified state');

      await driver.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide"))');
      await driver.waitFor(() => driver.evaluate('!document.querySelector("#ray-tracing-preview-panel")'), 'pagehide ray tracing teardown');
      const listenersAfter = await driver.evaluate('window.__editorE2EListenerCount?.() ?? -1');
      driver.assertNoBrowserErrors();
      return Object.freeze({
        schemaVersion: 1,
        scenario: 'editor-ray-tracing-preview-lifecycle',
        status: 'passed',
        coverage: Object.freeze({ enable: true, disable: true, projectReplacement: true, save: true, reopen: true, play: true, teardown: true, reload: true }),
        save: Object.freeze({ bytes: statSync(scenePath).size, entityCount: saved.entities.length }),
        lifecycle: Object.freeze({ listenersBefore, listenersAfter }),
        environment: Object.freeze({ url: driver.url, chromePath: driver.chrome, angleBackend: driver.angleBackend }),
        durationMs: Date.now() - startedAt,
        unclassifiedFailureCount: 0,
      });
    },
  });
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[editor-ray-e2e] passed enable → save/reopen → play → unload/reload → teardown in ${result.durationMs}ms.`);
  console.log(`[editor-ray-e2e] wrote ${relative(root, artifactPath)}.`);
} finally {
  rmSync(downloads, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function selectUnsupportedMode(driver) {
  const changed = await driver.evaluate(`
    (() => {
      const panel = document.querySelector('#ray-tracing-preview-panel');
      const mode = panel?.querySelector('[data-ray-control="mode"]');
      const effect = panel?.querySelector('[data-ray-control="effect"]');
      if (!(mode instanceof HTMLSelectElement) || !(effect instanceof HTMLSelectElement)) return false;
      mode.value = 'hybrid'; mode.dispatchEvent(new Event('change', { bubbles: true }));
      effect.value = 'shadows'; effect.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
  if (!changed) throw new Error('Could not configure the ray tracing diagnostic mode.');
}

async function waitForDownload(directory, extension, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let previous = null; let previousSize = -1;
  while (Date.now() < deadline) {
    const candidate = readdirSync(directory)
      .filter(name => extname(name).toLowerCase() === extension && !name.endsWith('.crdownload'))
      .map(name => resolve(directory, name))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] ?? null;
    if (candidate) {
      const size = statSync(candidate).size;
      if (candidate === previous && size > 0 && size === previousSize) return candidate;
      previous = candidate; previousSize = size;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
