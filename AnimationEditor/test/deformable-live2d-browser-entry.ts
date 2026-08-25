export * from '../src/import/deformable-animation/Live2DImportWorkflow';
export * from '../src/authoring/deformable-animation/Live2DImportSession';
export * from '../src/authoring/deformable-animation/Live2DAuthoringPanel';
export * from '../src/authoring/deformable-animation/Live2DExactPreviewSession';

import { encodeAnimationBinary } from '@haiyue/animation-spec';
import type { OfflineConversionDiagnostic } from '@haiyue/animation-spec/conversion';
import { createDeformableMesh2DFormatRegistry } from '@haiyue/animation-spec/deformable2d';
import { convertCubismCaptureToHya } from '@haiyue/animation-spec/live2d';
import type { Live2DConversionOutput } from '../src/import/deformable-animation/Live2DImportWorkflow';

export function createBrowserDeformableFixtureOutput(
  textureBytes: Uint8Array,
  diagnostics: readonly OfflineConversionDiagnostic[] = [],
  offset = 0,
): Live2DConversionOutput {
  const drawable = (time: number) => ({
    id: 'mesh', textureIndex: 0, renderOrder: 0, opacity: 1, blendMode: 'normal' as const, culling: false, masks: [],
    positions: [64 + offset + time * 8, 64, 192 + offset + time * 8, 64, 64 + offset + time * 8, 192],
    uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2],
    multiplyColor: [1, 1, 1, 1] as const, screenColor: [0, 0, 0, 0] as const,
  });
  const converted = convertCubismCaptureToHya({
    format: 'live2d-cubism-drawable-capture', version: 1,
    canvas: { width: 256, height: 256, pixelsPerUnit: 1, coordinateSystem: 'model-y-up' as const },
    duration: 1, frameRate: 1, textures: [{ id: 'texture', uri: 'texture.png' }],
    frames: [{ time: 0, drawables: [drawable(0)] }, { time: 1, drawables: [drawable(1)] }],
  }, { dataUri: 'model.hydm', strict: true });
  return Object.freeze({
    hya: new Uint8Array(encodeAnimationBinary(converted.document, { extensions: createDeformableMesh2DFormatRegistry() })),
    sidecars: Object.freeze([
      Object.freeze({ path: 'model.hydm', bytes: new Uint8Array(converted.data), mimeType: 'application/vnd.haiyue.deformable-mesh-2d' }),
      Object.freeze({ path: 'texture.png', bytes: new Uint8Array(textureBytes), mimeType: 'image/png' }),
    ]),
    diagnostics: Object.freeze(diagnostics.map(item => Object.freeze({ ...item }))),
    sourceVersion: `fixture-source-${offset}`,
    evaluatorVersion: 'source-neutral-browser-evaluator@1',
  });
}
