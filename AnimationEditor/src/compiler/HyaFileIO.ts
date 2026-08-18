import { ANIMATION_FILE_EXTENSION, ANIMATION_MIME_TYPE } from '@haiyue/animation-spec';
import type { AnimationEditorProject } from '../domain/AnimationEditorProject';
import {
  compileAnimationEditorProject,
  type AnimationEditorCompilation,
  type AnimationEditorCompileOptions,
} from './AnimationEditorCompiler';

export interface HyaFileArtifact {
  readonly fileName: string;
  readonly mimeType: typeof ANIMATION_MIME_TYPE;
  readonly binary: ArrayBuffer;
  readonly bytes: number;
  readonly compilation: AnimationEditorCompilation;
}

export function createHyaFileArtifact(
  project: AnimationEditorProject,
  options: AnimationEditorCompileOptions = {},
): HyaFileArtifact {
  const compilation = compileAnimationEditorProject(project, options);
  return Object.freeze({
    fileName: hyaFileName(project.name),
    mimeType: ANIMATION_MIME_TYPE,
    binary: compilation.binary,
    bytes: compilation.binary.byteLength,
    compilation,
  });
}

export function downloadHyaFile(project: AnimationEditorProject): HyaFileArtifact {
  const artifact = createHyaFileArtifact(project);
  const blob = new Blob([artifact.binary], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return artifact;
}

export function hyaFileName(name: string): string {
  const stem = name
    .trim()
    .replace(/\.hya$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .trim()
    .replace(/[. ]+$/g, '') || 'untitled-animation';
  return `${stem}${ANIMATION_FILE_EXTENSION}`;
}
