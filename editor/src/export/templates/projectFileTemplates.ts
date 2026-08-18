import type { RuntimeProjectMode } from '../projectTemplate';

export function createIndexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      html, body, #app {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #0b0d12;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
        outline: none;
      }

      .runtime-message {
        position: fixed;
        left: 16px;
        bottom: 16px;
        max-width: min(560px, calc(100vw - 32px));
        color: #f8fafc;
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid rgba(148, 163, 184, 0.35);
        padding: 10px 12px;
        font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        display: none;
      }
    </style>
  </head>
  <body>
    <div id="app">
      <canvas id="game-canvas" tabindex="0"></canvas>
      <div id="runtime-message" class="runtime-message"></div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;
}

export function createMainTs(precompiled: boolean): string {
  return `import scene from './scene.runtime${precompiled ? '' : '.json'}';
	import { HaiyueEngine } from '@haiyue/engine/core';
	import { runRuntimeScene } from './runtime-player';
	import type { RuntimeScene } from './runtime-deserialization';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const message = document.getElementById('runtime-message') as HTMLElement | null;
const webGpuCompatibility = HaiyueEngine.webGpuCompatibility;

function showMessage(text: string): void {
  if (!message) return;
  message.textContent = text;
  message.style.display = 'block';
}

if (!canvas) {
  showMessage('Missing game canvas.');
} else {
  void runRuntimeScene({
    canvas,
	    scene: scene as unknown as RuntimeScene,
    devicePixelRatio: () => Math.min(window.devicePixelRatio || 1, 2),
  }).then((runtime) => {
    if (!message) return;
    webGpuCompatibility.renderPage(
      message,
      webGpuCompatibility.report(runtime.engine.capabilities),
      { productName: 'Haiyue Export Runtime' },
    );
  }).catch((error) => {
    console.error('Failed to run exported scene.', error);
    const compatibility = webGpuCompatibility.classifyError(error);
    if (compatibility && message) {
      webGpuCompatibility.renderPage(message, compatibility, {
        productName: 'Haiyue Export Runtime',
      });
    } else {
      showMessage(error instanceof Error ? error.message : String(error));
    }
  });
}
`;
}

export function createPackageJson(projectName: string): Record<string, unknown> {
  return {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      'export:build': 'vite build && node scripts/export-zip.mjs',
      'export:zip': 'node scripts/export-zip.mjs',
      preview: 'vite preview',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      '@haiyue/extensions': '>=0.1.0 <0.2.0',
      '@haiyue/engine': '>=0.1.0 <0.2.0',
      'wgpu-matrix': '^3.0.0',
    },
    devDependencies: {
      '@webgpu/types': '^0.1.40',
      esbuild: '^0.28.1',
      jszip: '^3.10.1',
      typescript: '^5.2.0',
      vite: '^8.0.16',
    },
  };
}

export function createStaticPackageJson(projectName: string): Record<string, unknown> {
  return {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
  };
}

export function createViteConfig(sourcemap: boolean): string {
  return `import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

function runtimeBundleReportPlugin() {
  let report = null;
  return {
    name: 'runtime-bundle-report',
    generateBundle(_, bundle) {
      const files = Object.entries(bundle).map(([fileName, item]) => {
        const source = item.type === 'chunk' ? item.code : item.source;
        const bytes = Buffer.byteLength(typeof source === 'string' ? source : source);
        const gzipBytes = gzipSync(typeof source === 'string' ? source : Buffer.from(source)).byteLength;
        return {
          fileName,
          type: item.type,
          bytes,
          gzipBytes,
        };
      }).sort((a, b) => a.fileName.localeCompare(b.fileName));

      report = {
        generatedAt: new Date().toISOString(),
        minified: true,
        sourcemap: ${sourcemap ? 'true' : 'false'},
        files,
        totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
        totalGzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
      };

      this.emitFile({
        type: 'asset',
        fileName: 'export-report.json',
        source: JSON.stringify(report, null, 2) + '\\n',
      });
    },
    closeBundle() {
      if (!report) return;
      const manifestPath = join(process.cwd(), 'dist', 'export-manifest.json');
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        manifest.build = {
          mode: 'static',
          tool: 'vite',
          minified: true,
          sourcemap: ${sourcemap ? 'true' : 'false'},
          assetHashing: true,
          report,
        };
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n');
      } catch (error) {
        console.warn('Failed to update dist/export-manifest.json with build report.', error);
      }
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    minify: 'esbuild',
    sourcemap: ${sourcemap ? 'true' : 'false'},
    target: 'es2022',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.[hash].js',
        chunkFileNames: 'assets/chunk.[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
  plugins: [runtimeBundleReportPlugin()],
  server: {
    host: '127.0.0.1',
  },
});
`;
}

export function createTsConfig(): Record<string, unknown> {
  return {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      types: ['@webgpu/types'],
    },
    include: ['src/**/*'],
  };
}

export function createExportZipScript(projectName: string): string {
  return `import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, posix, relative } from 'node:path';
import JSZip from 'jszip';

const distDir = join(process.cwd(), 'dist');
const zipName = '${escapeJavaScriptString(projectName)}-dist.zip';
const zipPath = join(process.cwd(), zipName);

if (!existsSync(distDir)) {
  console.error('Missing dist directory. Run npm run build before npm run export:zip.');
  process.exit(1);
}

const zip = new JSZip();
const files = await collectFiles(distDir);
for (const filePath of files) {
  const zipEntry = posix.join('${escapeJavaScriptString(projectName)}', normalizeZipPath(relative(distDir, filePath)));
  zip.file(zipEntry, await readFile(filePath));
}

const bytes = await zip.generateAsync({
  type: 'uint8array',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});

await writeFile(zipPath, bytes);
console.log(\`Exported \${zipName} (\${bytes.byteLength} bytes)\`);

async function collectFiles(directory) {
  const result = [];
  const entries = await readdir(directory);
  entries.sort((a, b) => a.localeCompare(b));
  for (const entry of entries) {
    const path = join(directory, entry);
    const info = await stat(path);
    if (info.isDirectory()) result.push(...await collectFiles(path));
    else if (info.isFile()) result.push(path);
  }
  return result;
}

function normalizeZipPath(path) {
  return path
    .replace(/\\\\/g, '/')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .join('/');
}
`;
}

export function createReadme(projectName: string, mode: RuntimeProjectMode): string {
  const run = mode === 'project'
    ? `## Run

\`\`\`sh
npm install
npm run dev
\`\`\`

## Build

\`\`\`sh
npm run export:build
\`\`\`

This writes the minified static site to \`dist/\`, emits \`dist/export-report.json\`,
updates \`dist/export-manifest.json\` with build size data, and creates
\`${projectName}-dist.zip\`.
`
    : `## Run

Serve this folder with a local HTTP server, then open \`index.html\`.

\`\`\`sh
python3 -m http.server 8080
\`\`\`
`;

  return `# ${projectName}

Generated by Haiyue Editor runtime export.

${run}
The runtime scene is stored in \`src/scene.runtime.json\`.
Export diagnostics are stored in \`public/export-manifest.json\`.
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJavaScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
