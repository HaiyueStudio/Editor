import typescript from 'typescript';

/** Test-only isolated transpilation; package typechecks remain the authoritative diagnostic gate. */
export function native3dTypescript() {
  return {
    name: 'g06-native-3d-typescript',
    transform(source, id) {
      if (!id.endsWith('.ts')) return null;
      const result = typescript.transpileModule(source, {
        fileName: id,
        compilerOptions: {
          target: typescript.ScriptTarget.ESNext,
          module: typescript.ModuleKind.ESNext,
          moduleResolution: typescript.ModuleResolutionKind.Bundler,
          isolatedModules: true,
          sourceMap: false,
        },
      });
      return { code: result.outputText, map: null };
    },
  };
}
