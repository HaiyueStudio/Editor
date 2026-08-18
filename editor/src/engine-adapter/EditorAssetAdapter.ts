import type { AssetManager } from '@haiyue/engine/assets';
import type { HaiyueEngine } from '@haiyue/engine';
import type { ResourcePool } from '../resources/ResourcePool';

export interface EditorAssetAdapterOptions {
  resourcePool: ResourcePool;
}

export class EditorAssetAdapter {
  constructor(private readonly _options: EditorAssetAdapterOptions) {}

  attachEngine(engine: HaiyueEngine | null): void {
    this.attachAssetManager(engine?.assetManager ?? null);
  }

  attachAssetManager(assetManager: AssetManager | null): void {
    this._options.resourcePool.attachAssetManager(assetManager);
  }
}
