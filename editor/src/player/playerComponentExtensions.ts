import type { Component } from '@haiyue/engine';
import {
  GltfModelComponent,
  type GltfModelComponentOptions,
} from '@haiyue/extensions/gltf';
import type { SerializedComponent } from '../export/RuntimeSceneContract';
import type { ComponentDeserializationExtension } from '../types';

/** Component codecs required by the editor's embedded player runtime. */
export const playerComponentExtensions: readonly ComponentDeserializationExtension[] = Object.freeze([
  Object.freeze({
    deserializeComponent(data: SerializedComponent): Component | null {
      if (data.type !== 'GltfModelComponent') return null;
      const value = data as GltfModelComponentOptions & {
        type?: unknown;
        scene?: number | null;
      };
      return new GltfModelComponent({
        ...value,
        ...(typeof value.scene === 'number' ? { scene: value.scene } : {}),
      });
    },
  }),
]);
