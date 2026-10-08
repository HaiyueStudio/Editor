import { CUBE_FACES, CUBE_FACE_LABELS, LIMITS, type CubeFace, type RenderPassId } from './model.js';
import type { ShaderWorkspace } from './workspace.js';
import type { FaceUpload } from './textureUpload.js';

export function createCubeUploader(workspace: ShaderWorkspace, onBound: () => Promise<unknown>) {
  const dialog = document.createElement('dialog'); dialog.id = 'cubemap-dialog';
  dialog.setAttribute('aria-labelledby', 'cubemap-title');
  dialog.innerHTML = `<form id="cubemap-form">
    <div class="dialog-heading"><h2 id="cubemap-title">上传立方体贴图</h2><button type="button" id="cubemap-cancel" aria-label="关闭立方体贴图上传">×</button></div>
    <p>分别选择六个面的图片。所有图片必须是尺寸相同的正方形；支持 PNG、JPEG、WebP。</p>
    <label class="cubemap-name">名称<input id="cubemap-name" required maxlength="160" value="环境贴图"></label>
    <div class="cubemap-faces"></div>
    <p id="cubemap-error" role="status" aria-live="polite"></p>
    <div class="dialog-actions"><button type="submit" id="cubemap-submit" class="primary">上传并绑定</button></div>
  </form>`;
  const form = dialog.querySelector('form')!, grid = dialog.querySelector('.cubemap-faces')!;
  const error = dialog.querySelector<HTMLElement>('#cubemap-error')!, submit = dialog.querySelector<HTMLButtonElement>('#cubemap-submit')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('#cubemap-cancel')!, name = dialog.querySelector<HTMLInputElement>('#cubemap-name')!;
  const inputs = new Map<CubeFace, HTMLInputElement>(), urls = new Map<CubeFace, string>();
  let target: { pass: RenderPassId; index: number } | undefined, busy = false;
  const clear = () => { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); grid.querySelectorAll('img').forEach(img => img.removeAttribute('src')); };
  for (const face of CUBE_FACES) {
    const label = document.createElement('label'); label.className = 'cubemap-face';
    const heading = document.createElement('span'); heading.textContent = CUBE_FACE_LABELS[face];
    const preview = new Image(); preview.alt = CUBE_FACE_LABELS[face] + ' 预览';
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.required = true;
    input.id = 'cubemap-' + face; input.setAttribute('aria-label', CUBE_FACE_LABELS[face] + ' 图片');
    input.addEventListener('change', () => {
      const old = urls.get(face); if (old) URL.revokeObjectURL(old);
      preview.removeAttribute('src'); urls.delete(face); error.textContent = '';
      const file = input.files?.[0]; if (file) { const url = URL.createObjectURL(file); urls.set(face, url); preview.src = url; }
    });
    inputs.set(face, input); label.append(heading, preview, input); grid.append(label);
  }
  document.body.append(dialog);
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', clear);
  form.onsubmit = event => {
    event.preventDefault(); if (busy || !target) return;
    const selected = target, revision = workspace.document.revision, documentId = workspace.document.identity.id;
    const files = CUBE_FACES.map(face => ({ face, file: inputs.get(face)!.files?.[0] }));
    const assetName = name.value.trim() || '环境贴图', resources: string[] = [];
    busy = true; submit.disabled = cancel.disabled = true; error.textContent = '正在校验并上传六个面…';
    void (async () => {
      try {
        const faces = {} as Record<CubeFace, FaceUpload>;
        for (const { face, file } of files) {
          if (!file || file.size > LIMITS.imageBytes || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('每个面请选择不超过 8 MB 的 PNG、JPEG 或 WebP。');
          const resource = workspace.api.putResource(new Uint8Array(await file.arrayBuffer()));
          resources.push(resource.resourceId); faces[face] = { resourceId: resource.resourceId, mimeType: file.type };
        }
        const response = await workspace.api.execute({ apiVersion: '1', requestId: crypto.randomUUID(), operation: 'shader.cubemap.upload',
          documentId, expectedRevision: revision, params: { name: assetName, faces } });
        if (response.status !== 'completed') throw new Error(response.error.message);
        workspace.setChannel(selected.pass, selected.index, { kind: 'cubemap', assetId: (response.value as { assetId: string }).assetId });
        dialog.close(); await onBound();
      } catch (cause) {
        if (!dialog.open) dialog.showModal();
        error.textContent = cause instanceof Error ? cause.message : String(cause);
      } finally {
        for (const id of resources) workspace.api.releaseResource(id);
        busy = false; submit.disabled = cancel.disabled = false;
      }
    })();
  };
  return (pass: RenderPassId, index: number) => {
    if (busy) return;
    target = { pass, index }; clear(); form.reset(); error.textContent = '';
    dialog.showModal(); name.focus();
  };
}
