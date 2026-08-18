import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';
import { runChromeWebGpuFixture } from '../../scripts/webgpu-gate/chrome-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifactPath = resolve(root, 'artifacts/editor-e2e/release-lifecycle-browser-e2e.json');
const downloadDirectory = mkdtempSync(resolve(tmpdir(), 'haiyue-editor-reopen-e2e-'));
const failureScreenshotPath = resolve(root, 'artifacts/editor-e2e/release-lifecycle-browser-e2e-failure.png');
const savedName = 'Scene';
const dirtyName = 'Dirty after save';

try {
  const reopen = await runEditorBrowserScenario({
    root,
    route: 'editor/index.html',
    downloadDirectory,
    failureScreenshotPath,
    timeoutMs: 90_000,
    async scenario(driver) {
      await driver.click('document.querySelector("#save-button")', { label: 'save scene before reopen' });
      const savedScenePath = await waitForDownload(downloadDirectory, '.json', 'saved scene JSON');
      const bytes = readFileSync(savedScenePath);
      const savedScene = JSON.parse(bytes);
      await driver.waitFor(
        () => driver.evaluate('!document.querySelector("#save-button")?.hasAttribute("data-dirty")'),
        'saved baseline before reopen',
      );
      await driver.replaceText('document.querySelector("#entity-name-input")', dirtyName);
      await driver.waitFor(
        () => driver.evaluate(`document.querySelector('#entity-name-input')?.value === ${JSON.stringify(dirtyName)}`),
        'dirty editor mutation',
      );
      await driver.evaluate('window.confirm = () => true');
      await driver.setFileInputFiles('#open-file-input', [savedScenePath]);
      await driver.waitFor(
        () => driver.evaluate(`
          document.querySelector('#entity-name-input')?.value === ${JSON.stringify(savedName)}
            && !document.querySelector('#save-button')?.hasAttribute('data-dirty')
        `),
        'saved scene reopened into a clean document',
      );
      driver.assertNoBrowserErrors();
      return {
        status: 'passed',
        transport: new URL(driver.url).protocol.replace(':', ''),
        savedScene: {
          fileName: savedScenePath.split('/').pop(),
          byteLength: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          format: savedScene.format,
          version: savedScene.version,
        },
        reopenedEntityName: await driver.evaluate('document.querySelector("#entity-name-input")?.value'),
        cleanAfterReopen: true,
        browserErrors: driver.getBrowserErrors(),
        environment: {
          url: driver.url,
          chromePath: driver.chrome,
          angleBackend: driver.angleBackend,
        },
      };
    },
  });

  const lifecycle = await runChromeWebGpuFixture({
    root,
    fixture: 'editor/test/fixtures/release-lifecycle-browser-e2e.html',
    timeoutMs: 45_000,
  });
  if (reopen.transport !== 'http') throw new Error(`Editor reopen fixture used ${reopen.transport}, expected HTTP.`);
  if (lifecycle.teardown?.ownerResidualCount !== 0) throw new Error('Editor lifecycle browser fixture retained owned state.');
  if (lifecycle.gpuValidationErrors !== 0 || lifecycle.unclassifiedFailureCount !== 0) {
    throw new Error('Editor lifecycle browser fixture reported validation or unclassified failures.');
  }

  const report = {
    schemaVersion: 1,
    suite: 'editor.release-candidate.browser-e2e',
    status: 'passed',
    reopen,
    lifecycle,
  };
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `[editor-release-e2e] save/reopen ${reopen.savedScene.byteLength}B; `
    + `optional failure isolated; resource replacement stable; owner residual=0.`,
  );
  console.log(`[editor-release-e2e] Wrote ${relative(root, artifactPath)}.`);
} finally {
  rmSync(downloadDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function waitForDownload(directory, extension, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastCandidate = null;
  let lastSize = -1;
  while (Date.now() < deadline) {
    const candidates = readdirSync(directory)
      .filter(name => extname(name).toLowerCase() === extension && !name.endsWith('.crdownload'))
      .map(name => resolve(directory, name))
      .filter(path => existsSync(path))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
    const candidate = candidates[0] ?? null;
    if (candidate) {
      const size = statSync(candidate).size;
      if (candidate === lastCandidate && size > 0 && size === lastSize) return candidate;
      lastCandidate = candidate;
      lastSize = size;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${label} in ${directory}.`);
}
