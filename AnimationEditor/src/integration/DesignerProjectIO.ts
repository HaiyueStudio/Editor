import { type ParsedAnimation } from '@haiyue/animation-spec';
import { cloneAnimationEditorProject, freezeAnimationEditorProject, type AnimationEditorProject } from '../domain/AnimationEditorProject';
import { compileAnimationEditorProject, type AnimationEditorCompilation } from '../compiler/AnimationEditorCompiler';
import { createHyaFileArtifact, type HyaFileArtifact } from '../compiler/HyaFileIO';
import { createHyaPackageArtifact, type HyaPackageArtifact } from '../compiler/HyaPackageIO';
import { createNative3dHyaPackageArtifact, type Native3dHyaPackageArtifact } from '../compiler/Native3dHyaPackageIO';
import { createAnimationEditorAssetFromFile } from '../persistence/AssetImport';
import { createProjectFileArtifact, parseAnimationEditorProject, serializeAnimationEditorProject, type ProjectFileArtifact } from '../persistence/ProjectCodec';
import { compileNative3dProject, createNative3dHyaArtifact, type Native3dCompilation, type Native3dHyaArtifact } from '../domain/native3d/Native3dCompiler';
import { type Native3dProject } from '../domain/native3d/Native3dProject';
import { native3dProjectFileName, parseNative3dProject, serializeNative3dProject } from '../domain/native3d/Native3dProjectCodec';
import { designerProjectFamily, type DesignerProject, type DesignerProjectFamily } from './DesignerTemplates';

export interface Native3dProjectFileArtifact {
  readonly fileName: string;
  readonly mimeType: 'application/vnd.haiyue.animation-project+json';
  readonly text: string;
  readonly bytes: number;
}

export type DesignerProjectFileArtifact = ProjectFileArtifact | Native3dProjectFileArtifact;
export type DesignerCompilation = AnimationEditorCompilation | Native3dCompilation;
export type DesignerHyaArtifact = HyaFileArtifact | Native3dHyaArtifact;
export type DesignerPackageArtifact = HyaPackageArtifact | Native3dHyaPackageArtifact;

export function detectDesignerProjectFamily(value: string | unknown): DesignerProjectFamily {
  let decoded: unknown = value;
  if (typeof value === 'string') {
    try { decoded = JSON.parse(value) as unknown; }
    catch { throw new TypeError('工程文件不是有效 JSON。'); }
  }
  if (!decoded || typeof decoded !== 'object') throw new TypeError('工程根节点必须是对象。');
  const record = decoded as Readonly<Record<string, unknown>>;
  if (record.format === 'haiyue-animation-editor-project-3d@1' || record.mode === '3d') return '3d';
  if (record.format === 'haiyue-animation-editor-project@1') return '2d';
  throw new TypeError(`无法识别工程格式“${String(record.format ?? 'missing')}”。`);
}

export function parseDesignerProject(value: string | unknown): DesignerProject {
  return detectDesignerProjectFamily(value) === '3d'
    ? parseNative3dProject(value)
    : parseAnimationEditorProject(value);
}

export function serializeDesignerProject(project: DesignerProject): string {
  return designerProjectFamily(project) === '3d'
    ? serializeNative3dProject(project as Native3dProject)
    : serializeAnimationEditorProject(project as AnimationEditorProject);
}

export function createDesignerProjectFileArtifact(project: DesignerProject): DesignerProjectFileArtifact {
  if (designerProjectFamily(project) === '2d') return createProjectFileArtifact(project as AnimationEditorProject);
  const native = parseNative3dProject(project);
  const text = serializeNative3dProject(native);
  return Object.freeze({
    fileName: native3dProjectFileName(native.name),
    mimeType: 'application/vnd.haiyue.animation-project+json' as const,
    text,
    bytes: new TextEncoder().encode(text).byteLength,
  });
}

export function compileDesignerProject(project: DesignerProject): DesignerCompilation {
  return designerProjectFamily(project) === '3d'
    ? compileNative3dProject(project as Native3dProject)
    : compileAnimationEditorProject(project as AnimationEditorProject);
}

export function createDesignerHyaArtifact(project: DesignerProject): DesignerHyaArtifact {
  return designerProjectFamily(project) === '3d'
    ? createNative3dHyaArtifact(project as Native3dProject)
    : createHyaFileArtifact(project as AnimationEditorProject);
}

export function createDesignerPackageArtifact(project: DesignerProject): Promise<DesignerPackageArtifact> {
  return designerProjectFamily(project) === '3d'
    ? createNative3dHyaPackageArtifact(project as Native3dProject)
    : createHyaPackageArtifact(project as AnimationEditorProject);
}

export function designerCompilationParsed(compilation: DesignerCompilation): ParsedAnimation {
  return compilation.parsed;
}

/** Replaces bytes and metadata while preserving every authored reference to the asset id. */
export async function relinkAnimationEditorAsset(
  project: AnimationEditorProject,
  assetId: string,
  file: File,
): Promise<AnimationEditorProject> {
  const index = project.assets.findIndex(asset => asset.id === assetId);
  if (index < 0) throw new RangeError(`Unknown asset "${assetId}".`);
  const existing = project.assets[index]!;
  const budgetProject = cloneAnimationEditorProject(project);
  budgetProject.assets.splice(index, 1);
  const replacement = await createAnimationEditorAssetFromFile(file, budgetProject as AnimationEditorProject);
  if (replacement.type !== existing.type) {
    throw new TypeError(`资源类型不匹配：${existing.type} 不能重链接为 ${replacement.type}。`);
  }
  replacement.id = existing.id;
  const result = cloneAnimationEditorProject(project);
  result.assets[index] = replacement;
  return freezeAnimationEditorProject(result as AnimationEditorProject);
}
