import { isAbsolute, relative } from 'node:path';

export function bundleGraphPlugin(root = process.cwd()) {
  return {
    name: 'haiyue-editor-bundle-graph',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter(output => output.type === 'chunk')
        .map(chunk => ({
          fileName: chunk.fileName,
          name: chunk.name,
          isEntry: chunk.isEntry,
          facadeModuleId: normalizeModuleId(chunk.facadeModuleId, root),
          imports: [...chunk.imports],
          dynamicImports: [...chunk.dynamicImports],
          moduleIds: chunk.moduleIds.map(id => normalizeModuleId(id, root)),
        }))
        .sort((a, b) => a.fileName.localeCompare(b.fileName));
      this.emitFile({
        type: 'asset',
        fileName: 'bundle-graph.json',
        source: `${JSON.stringify({ schemaVersion: 1, chunks }, null, 2)}\n`,
      });
    },
  };
}

function normalizeModuleId(id, root) {
  if (typeof id !== 'string') return null;
  const normalized = isAbsolute(id) ? relative(root, id) : id;
  return normalized.replaceAll('\\', '/');
}
