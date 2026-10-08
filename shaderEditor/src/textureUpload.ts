import { CUBE_FACES, LIMITS, type CubeAsset, type CubeFace, type ImageAsset, type VideoAsset } from './model.js';

import { VideoSource } from './videoTexture.js';

export async function uploadVideo(name: string, mimeType: string, bytes: Uint8Array): Promise<VideoAsset> {
  if (!['video/mp4', 'video/webm'].includes(mimeType) || bytes.byteLength > LIMITS.videoBytes) throw new Error('请选择不超过 24 MB 的 MP4 或 WebM 视频。');
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const source = await VideoSource.load(blob); source.dispose();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
  return { id: crypto.randomUUID(), name, kind: 'video', dataUrl };
}

export type FaceUpload = { resourceId: string; mimeType: string };
async function image(bytes: Uint8Array, mimeType: string) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || bytes.byteLength > LIMITS.imageBytes) throw new Error('请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。');
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const bitmap = await createImageBitmap(blob);
  let width: number, height: number;
  try {
    width = bitmap.width; height = bitmap.height;
    if (Math.max(width, height) > LIMITS.dimension) throw new Error('图片尺寸最多 4096。');
  } finally { bitmap.close(); }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
  return { dataUrl, width, height };
}
export async function uploadImage(name: string, mimeType: string, bytes: Uint8Array): Promise<ImageAsset> {
  return { id: crypto.randomUUID(), name, dataUrl: (await image(bytes, mimeType)).dataUrl };
}
/** Validate every face before committing a single asset; failures leave the document intact. */
export async function uploadCubemap(name: string, faces: Record<CubeFace, FaceUpload>, read: (id: string) => Uint8Array): Promise<CubeAsset> {
  if (!faces || Object.keys(faces).length !== 6 || !CUBE_FACES.every(face => faces[face] && typeof faces[face].resourceId === 'string')) throw new Error('请选择六个立方体贴图面。');
  const data = {} as Record<CubeFace, string>; let size = 0, characters = 0;
  for (const face of CUBE_FACES) {
    const input = faces[face], decoded = await image(read(input.resourceId), input.mimeType);
    if (decoded.width !== decoded.height || (size && size !== decoded.width)) throw new Error('立方体贴图的六个面必须是尺寸相同的正方形。');
    size = decoded.width; characters += decoded.dataUrl.length;
    if (size * size * 6 > 16_777_216) throw new Error('立方体贴图的六个面总像素最多 1600 万。');
    if (characters >= LIMITS.projectBytes - 1_000_000) throw new Error('六面图片总量超过工程限制。');
    data[face] = decoded.dataUrl;
  }
  return { id: crypto.randomUUID(), name, kind: 'cubemap', faces: data };
}
