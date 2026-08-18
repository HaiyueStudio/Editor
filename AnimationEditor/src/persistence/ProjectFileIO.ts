import type { AnimationEditorProject } from '../domain/AnimationEditorProject';
import {
  ANIMATION_EDITOR_PROJECT_FILE_SUFFIX,
  MAX_PROJECT_FILE_BYTES,
  createProjectFileArtifact,
  decodeAnimationEditorProject,
  projectFileName,
  type ProjectDecodeResult,
  type ProjectFileArtifact,
} from './ProjectCodec';

export async function readAnimationEditorProjectFile(file: File): Promise<ProjectDecodeResult> {
  if (!file.name.toLowerCase().endsWith(ANIMATION_EDITOR_PROJECT_FILE_SUFFIX)) {
    throw new TypeError(`请选择 ${ANIMATION_EDITOR_PROJECT_FILE_SUFFIX} 工程文件。`);
  }
  if (file.size > MAX_PROJECT_FILE_BYTES) {
    throw new RangeError(`工程文件不能超过 ${Math.floor(MAX_PROJECT_FILE_BYTES / 1024 / 1024)} MiB。`);
  }
  return decodeAnimationEditorProject(await file.text());
}

export function downloadAnimationEditorProject(project: AnimationEditorProject, fileName?: string): ProjectFileArtifact {
  const generated = createProjectFileArtifact(project);
  const artifact = fileName === undefined ? generated : { ...generated, fileName: projectFileName(fileName) };
  const blob = new Blob([artifact.text], { type: artifact.mimeType });
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
