import { isCompressedTextureSource } from '@haiyue/engine/assets';
import type { MaterialTextureSource } from '@haiyue/engine/material';
import type { ModelResourceItem, TextureResourceItem, TextureSource } from '../types';

/** Identity index for editor resources; ownership and lifecycle stay in ResourcePool. */
export class ResourceLookupIndex {
  private texturesByObject = new WeakMap<object, TextureResourceItem>();
  private readonly texturesByString = new Map<string, TextureResourceItem>();
  private readonly texturesByCompressedSource = new Map<string, TextureResourceItem>();
  private readonly modelsBySrc = new Map<string, ModelResourceItem>();

  findTexture(resource: TextureSource | MaterialTextureSource): TextureResourceItem | null {
    if (!resource) return null;
    if (typeof resource === 'string') return this.texturesByString.get(resource) ?? null;
    if (isCompressedTextureSource(resource)) return this.texturesByCompressedSource.get(compressedTextureKey(resource)) ?? null;
    if (isSampleableTextureSource(resource)) return null;
    return this.texturesByObject.get(resource) ?? null;
  }

  indexTexture(item: TextureResourceItem): void {
    if (typeof item.resource === 'string') this.texturesByString.set(item.resource, item);
    else if (isCompressedTextureSource(item.resource)) this.texturesByCompressedSource.set(compressedTextureKey(item.resource), item);
    else this.texturesByObject.set(item.resource, item);
  }

  unindexTexture(item: TextureResourceItem): void {
    if (typeof item.resource === 'string') {
      if (this.texturesByString.get(item.resource) === item) this.texturesByString.delete(item.resource);
    } else if (isCompressedTextureSource(item.resource)) {
      const key = compressedTextureKey(item.resource);
      if (this.texturesByCompressedSource.get(key) === item) this.texturesByCompressedSource.delete(key);
    } else {
      this.texturesByObject.delete(item.resource);
    }
  }

  findModel(src: string): ModelResourceItem | null {
    return this.modelsBySrc.get(src) ?? null;
  }

  indexModel(item: ModelResourceItem): void {
    if (!this.modelsBySrc.has(item.src)) this.modelsBySrc.set(item.src, item);
  }

  unindexModel(item: ModelResourceItem, models: Iterable<ModelResourceItem>): void {
    if (this.modelsBySrc.get(item.src) !== item) return;
    this.modelsBySrc.delete(item.src);
    for (const candidate of models) {
      if (candidate !== item && candidate.src === item.src) {
        this.modelsBySrc.set(candidate.src, candidate);
        break;
      }
    }
  }

  clear(): void {
    this.texturesByObject = new WeakMap();
    this.texturesByString.clear();
    this.texturesByCompressedSource.clear();
    this.modelsBySrc.clear();
  }
}

function compressedTextureKey(resource: import('@haiyue/engine/assets').CompressedTextureSourceDescriptor): string {
  return `${resource.type}:${resource.src}`;
}

function isSampleableTextureSource(resource: Exclude<MaterialTextureSource, string | null>): boolean {
  const texture = (resource as { texture?: unknown }).texture;
  return typeof texture === 'object'
    && texture !== null
    && typeof (texture as { createView?: unknown }).createView === 'function';
}
