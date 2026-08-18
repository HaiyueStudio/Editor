import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'src');
const engineEntry = fileURLToPath(import.meta.resolve('@haiyue/engine'));
const enginePackage = JSON.parse(readFileSync(resolve(dirname(engineEntry), '../package.json'), 'utf8'));
const allowedEnginePackageImports = new Set(Object.keys(enginePackage.exports).map(subpath => (
  subpath === '.' ? enginePackage.name : `${enginePackage.name}/${subpath.slice(2)}`
)));
const experimentalEngineImport = `${enginePackage.name}/experimental`;
const shaderLanguagePackage = '@haiyue/shader-language';
const violations = [];
const forbiddenEngineMemberAccess = [
  {
    pattern: /\.worldMatrixDirty\b/,
    message: 'Use public transform dirtying APIs such as markDirty(), setMatrix(), setTranslation(), or setPosition(); do not write Transform3D.worldMatrixDirty from editor code.',
  },
  {
    pattern: /\.localMatrix\s*\[/,
    message: 'Use public Transform3D mutation APIs such as setMatrix() or setTranslation(); do not mutate localMatrix elements from editor code.',
  },
];

scanDir(srcRoot);

if (violations.length > 0) {
  console.error('[editor-boundary] Editor must use reviewed engine and authoring-compiler adapter boundaries.');
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.message}`);
  }
  process.exit(1);
}

function scanDir(dir) {
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    const stat = statSync(file);
    if (stat.isDirectory()) {
      if (entry === 'dist' || entry === 'dist-test' || entry === 'node_modules') continue;
      scanDir(file);
      continue;
    }
    if (!file.endsWith('.ts')) continue;
    scanFile(file);
  }
}

function scanFile(file) {
  const source = readFileSync(file, 'utf8');
  const normalizedFile = file.replaceAll('\\', '/');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const specifier of collectModuleSpecifiers(sourceFile)) {
    if ((specifier === shaderLanguagePackage || specifier.startsWith(`${shaderLanguagePackage}/`))
      && !normalizedFile.endsWith('/infra/content/materialGraphCompiler.worker.ts')) {
      violations.push({
        file: relative(root, file),
        message: `shader compiler import "${specifier}" is only allowed in the Material Graph compiler Worker adapter`,
      });
      continue;
    }
    if (specifier === experimentalEngineImport && !isEngineAdapterFile(file)) {
      violations.push({
        file: relative(root, file),
        message: `experimental engine import "${specifier}" is only allowed in src/engine-adapter`,
      });
      continue;
    }
    if (allowedEnginePackageImports.has(specifier)) continue;
    if (!isPrivateEngineImport(specifier) && !specifier.startsWith(`${enginePackage.name}/`)) continue;
    violations.push({
      file: relative(root, file),
      message: `private or unexported engine import "${specifier}"`,
    });
  }
  for (const rule of forbiddenEngineMemberAccess) {
    if (!rule.pattern.test(source)) continue;
    violations.push({
      file: relative(root, file),
      message: rule.message,
    });
  }
}

function collectModuleSpecifiers(sourceFile) {
  const specifiers = [];
  visit(sourceFile);
  return specifiers;

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
}

function isEngineAdapterFile(file) {
  return relative(srcRoot, file).split(/[\\/]/)[0] === 'engine-adapter';
}

function isPrivateEngineImport(specifier) {
  return specifier.includes('/engine/src/')
    || specifier.startsWith('../engine/')
    || specifier.startsWith('../../engine/')
    || specifier.startsWith('../../../engine/')
    || specifier.startsWith('../../../../engine/');
}
