import type {
  AnimationEditorAsset,
  AnimationEditorProject,
  DeepMutable,
} from '../domain/AnimationEditorProject';

export const ANIMATION_EDITOR_ASSET_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const ANIMATION_EDITOR_ASSET_IMPORT_MAX_TOTAL_BYTES = 5 * 1024 * 1024;

export type AnimationEditorImportedAssetType = AnimationEditorAsset['type'];

export class AnimationEditorAssetImportError extends Error {
  readonly name = 'AnimationEditorAssetImportError';

  constructor(
    readonly code: 'E_ASSET_EMPTY' | 'E_ASSET_TOO_LARGE' | 'E_ASSET_TOTAL_TOO_LARGE' | 'E_ASSET_IMAGE_DECODE',
    message: string,
  ) {
    super(message);
  }
}

export async function createAnimationEditorAssetFromFile(
  file: File,
  project: AnimationEditorProject,
): Promise<DeepMutable<AnimationEditorAsset>> {
  if (file.size <= 0) throw new AnimationEditorAssetImportError('E_ASSET_EMPTY', `“${file.name}”是空文件。`);
  if (file.size > ANIMATION_EDITOR_ASSET_IMPORT_MAX_BYTES) {
    throw new AnimationEditorAssetImportError(
      'E_ASSET_TOO_LARGE',
      `“${file.name}”超过单个资源 5 MiB 的导入上限。`,
    );
  }
  const embeddedBytes = project.assets.reduce((sum, asset) => (
    sum + (asset.source.kind === 'embedded' ? Math.floor(asset.source.data.length * 0.75) : 0)
  ), 0);
  if (embeddedBytes + file.size > ANIMATION_EDITOR_ASSET_IMPORT_MAX_TOTAL_BYTES) {
    throw new AnimationEditorAssetImportError(
      'E_ASSET_TOTAL_TOO_LARGE',
      '工程内嵌资源超过 5 MiB。请删除未使用资源；完成编辑后可用“导出交付包”生成外置资源。',
    );
  }

  const type = classifyAnimationAssetFile(file.name, file.type);
  const mimeType = normalizedMimeType(file.name, file.type, type);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = bytesToBase64(bytes);
  const deliveryUri = `data:${mimeType};base64,${base64}`;
  const dimensions = type === 'image' ? await readImageDimensions(file, deliveryUri) : null;
  return {
    id: animationAssetIdForFile(file.name, new Set(project.assets.map(asset => asset.id))),
    name: file.name,
    type,
    source: {
      kind: 'embedded',
      fileName: file.name,
      mimeType,
      encoding: 'base64',
      data: base64,
    },
    delivery: {
      uri: deliveryUri,
      mimeType,
      ...(dimensions ? { width: dimensions.width, height: dimensions.height, colorSpace: 'srgb' as const } : {}),
    },
  };
}

export function classifyAnimationAssetFile(
  fileName: string,
  mimeType: string,
): AnimationEditorImportedAssetType {
  const mime = mimeType.trim().toLowerCase();
  if (mime.startsWith('image/') || /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/iu.test(fileName)) return 'image';
  if (mime.startsWith('audio/') || /\.(?:aac|flac|m4a|mp3|oga|ogg|wav|weba)$/iu.test(fileName)) return 'audio';
  return 'binary';
}

export function animationAssetIdForFile(fileName: string, existing: ReadonlySet<string>): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/u, '');
  const base = withoutExtension
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '') || 'asset';
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}

function normalizedMimeType(
  fileName: string,
  mimeType: string,
  type: AnimationEditorImportedAssetType,
): string {
  const explicit = mimeType.trim().toLowerCase();
  if (explicit) return explicit;
  const extension = /\.([^.]+)$/u.exec(fileName)?.[1]?.toLowerCase();
  const known = new Map([
    ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'],
    ['gif', 'image/gif'], ['svg', 'image/svg+xml'], ['avif', 'image/avif'],
    ['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['ogg', 'audio/ogg'], ['m4a', 'audio/mp4'],
  ]);
  return known.get(extension ?? '') ?? (type === 'image'
    ? 'image/png'
    : type === 'audio' ? 'audio/mpeg' : 'application/octet-stream');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function readImageDimensions(
  file: File,
  deliveryUri: string,
): Promise<{ readonly width: number; readonly height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (dimensions.width > 0 && dimensions.height > 0) return dimensions;
    } catch {
      // SVG and a few browser codecs require the HTMLImageElement fallback.
    }
  }
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = deliveryUri;
    await image.decode();
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      return { width: image.naturalWidth, height: image.naturalHeight };
    }
  } catch {
    // Normalized below.
  }
  throw new AnimationEditorAssetImportError(
    'E_ASSET_IMAGE_DECODE',
    `浏览器无法解码图片“${file.name}”。`,
  );
}
