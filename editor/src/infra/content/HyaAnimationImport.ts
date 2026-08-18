import {
  ANIMATION_MIME_TYPE,
  HYA_STATE_MACHINE_EXTENSION_ID,
  parseAnimation,
} from '@haiyue/animation-spec';
import {
  HYA_AUTHORING_ASSET_FORMAT,
  type HyaAnimationAsset,
} from '../../domain/content/ContentAuthoringStore';

export interface HyaAnimationImportSource {
  readonly name: string;
  readonly type?: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Parses before commit and retains the exact source bytes for lossless scene round-trips. */
export async function prepareHyaAnimationAsset(
  source: HyaAnimationImportSource,
  signal?: AbortSignal,
): Promise<HyaAnimationAsset> {
  validateFileName(source.name, source.type);
  signal?.throwIfAborted();
  const bytes = await source.arrayBuffer();
  signal?.throwIfAborted();
  if (source.size !== undefined && source.size !== bytes.byteLength) {
    throw new TypeError(`HYA file ${source.name} changed while it was being read.`);
  }
  const animation = parseAnimation(bytes);
  signal?.throwIfAborted();
  const hash = hashBytes(new Uint8Array(bytes));
  const baseName = stripExtension(source.name);
  const id = `hya-${slug(baseName)}-${hash.toString(16).padStart(8, '0')}`;
  return Object.freeze({
    format: HYA_AUTHORING_ASSET_FORMAT,
    id,
    name: animation.name?.trim() || baseName,
    fileName: source.name,
    mimeType: ANIMATION_MIME_TYPE,
    byteLength: bytes.byteLength,
    encoding: 'base64',
    data: encodeBase64(new Uint8Array(bytes)),
    metadata: Object.freeze({
      source: animation.source,
      duration: animation.duration,
      ...(animation.frameRate === undefined ? {} : { frameRate: animation.frameRate }),
      endBehavior: animation.endBehavior,
      canvas: Object.freeze({ width: animation.canvas.width, height: animation.canvas.height }),
      nodeCount: animation.nodes.length,
      trackCount: animation.tracks.length,
      resourceCount: animation.resources.length,
      extensionsUsed: Object.freeze([...animation.extensionsUsed]),
      hasStateMachine: animation.extensionsUsed.includes(HYA_STATE_MACHINE_EXTENSION_ID)
        || HYA_STATE_MACHINE_EXTENSION_ID in animation.extensions,
    }),
  });
}

function validateFileName(name: string, mimeType = ''): void {
  if (!name.toLocaleLowerCase().endsWith('.hya') && mimeType !== ANIMATION_MIME_TYPE) {
    throw new TypeError(`Expected a .hya animation file; received ${name || 'an unnamed file'}.`);
  }
}

function stripExtension(name: string): string {
  return name.replace(/\.hya$/i, '').trim() || 'HYA Animation';
}

function slug(value: string): string {
  const result = value.toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return result || 'animation';
}

function hashBytes(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize))));
  }
  return btoa(chunks.join(''));
}
