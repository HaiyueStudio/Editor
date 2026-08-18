import type { RuntimeExportManifest, RuntimeScene } from './RuntimeSceneContract';
import { decodeFloat32Array, decodeIndexArray } from '../domain/scene/typedArraySerialization';

export interface RuntimePrecompileResult {
  sceneModule: string;
  binaryAsset: Uint8Array | null;
  manifestPatch: NonNullable<RuntimeExportManifest['precompile']>;
  metrics: RuntimePrecompileMetrics;
}

export interface RuntimePrecompileMetrics {
  readonly appendCount: number;
  readonly reallocations: number;
  readonly payloadBytes: number;
  readonly copiedBytes: number;
  readonly peakWorkingBytes: number;
}

export interface RuntimePrecompileContext {
  readonly signal?: AbortSignal;
  readonly sourceJsonBytes?: number;
  readonly onProgress?: (current: number, total: number) => void;
}

interface GeometryBufferView {
  byteOffset: number;
  byteLength: number;
  componentType: 'float32' | 'uint16' | 'uint32';
  count: number;
}

interface PrecompiledGeometryBuffers {
  positions?: GeometryBufferView;
  normals?: GeometryBufferView;
  textureCoordinates?: Record<number, GeometryBufferView>;
  indices?: GeometryBufferView;
}

export function precompileRuntimeScene(scene: RuntimeScene, context: RuntimePrecompileContext = {}): RuntimePrecompileResult {
  context.signal?.throwIfAborted();
  const writer = new BinaryWriter();
  const precompiledScene = {
    ...scene,
    resources: {
      ...scene.resources,
      geometries: scene.resources.geometries.map(geometry => ({
        ...geometry,
        textureCoordinates: geometry.textureCoordinates.map(entry => ({ ...entry })),
      })),
    },
  } as RuntimeScene & {
    precompiled?: {
      binaryAsset: string;
      geometries: Record<number, PrecompiledGeometryBuffers>;
    };
  };
  const geometryBuffers: Record<number, PrecompiledGeometryBuffers> = {};

  for (let geometryIndex = 0; geometryIndex < precompiledScene.resources.geometries.length; geometryIndex++) {
    context.signal?.throwIfAborted();
    const geometry = precompiledScene.resources.geometries[geometryIndex]!;
    const buffers: PrecompiledGeometryBuffers = {};
    const positions = geometry.positions ? decodeFloat32Array(geometry.positions) : null;
    if (positions?.length) {
      buffers.positions = writer.appendTypedArray(positions, 'float32');
      geometry.positions = [];
    }
    if (geometry.normals) {
      const normals = decodeFloat32Array(geometry.normals);
      buffers.normals = writer.appendTypedArray(normals, 'float32');
      geometry.normals = [];
    }
    const textureCoordinates: Record<number, GeometryBufferView> = {};
    for (const entry of geometry.textureCoordinates) {
      const data = decodeFloat32Array(entry.data);
      textureCoordinates[entry.set] = writer.appendTypedArray(data, 'float32');
      entry.data = [];
    }
    if (Object.keys(textureCoordinates).length > 0) buffers.textureCoordinates = textureCoordinates;
    if (geometry.indices) {
      const indices = decodeIndexArray(geometry.indices, geometry.indexType);
      buffers.indices = writer.appendTypedArray(indices, geometry.indexType === 'uint32' ? 'uint32' : 'uint16');
      geometry.indices = [];
    }
    if (Object.keys(buffers).length > 0) geometryBuffers[geometry.id] = buffers;
    context.onProgress?.(geometryIndex + 1, precompiledScene.resources.geometries.length);
  }

  const binaryAsset = writer.length > 0 ? writer.finish() : null;
  if (binaryAsset) {
    precompiledScene.precompiled = {
      binaryAsset: '../assets/scene.buffers.bin',
      geometries: geometryBuffers,
    };
  }

  const json = stableStringify(precompiledScene);
  const binaryUrlAssignment = binaryAsset
    ? "\nconst mutableScene = scene as unknown as { precompiled: { binaryAssetUrl?: string } };\nmutableScene.precompiled.binaryAssetUrl = new URL('../assets/scene.buffers.bin', import.meta.url).href;\n"
    : '';
  return {
    sceneModule: `const scene = ${json} as const;\n${binaryUrlAssignment}\nexport default scene;\n`,
    binaryAsset,
    manifestPatch: {
      enabled: true,
      sceneModule: 'src/scene.runtime.ts',
      debugJson: 'src/scene.runtime.json',
      binaryAsset: binaryAsset ? 'assets/scene.buffers.bin' : null,
      geometryBufferCount: Object.keys(geometryBuffers).length,
      binaryBytes: binaryAsset?.byteLength ?? 0,
      jsonBytes: context.sourceJsonBytes ?? utf8ByteLength(JSON.stringify(scene)),
      moduleBytes: utf8ByteLength(json),
    },
    metrics: writer.metrics,
  };
}

export class BinaryWriter {
  private _buffer: Uint8Array;
  private _length = 0;
  private _appendCount = 0;
  private _reallocations = 0;
  private _payloadBytes = 0;
  private _copiedBytes = 0;
  private _peakWorkingBytes: number;

  constructor(initialCapacity = 64 * 1024) {
    this._buffer = new Uint8Array(Math.max(16, Math.trunc(initialCapacity)));
    this._peakWorkingBytes = this._buffer.byteLength;
  }

  get length(): number { return this._length; }
  get capacity(): number { return this._buffer.byteLength; }
  get metrics(): RuntimePrecompileMetrics {
    return Object.freeze({
      appendCount: this._appendCount,
      reallocations: this._reallocations,
      payloadBytes: this._payloadBytes,
      copiedBytes: this._copiedBytes,
      peakWorkingBytes: this._peakWorkingBytes,
    });
  }

  appendTypedArray(
    array: Float32Array | Uint16Array | Uint32Array,
    componentType: GeometryBufferView['componentType'],
  ): GeometryBufferView {
    const alignment = array.BYTES_PER_ELEMENT;
    const padding = (alignment - (this._length % alignment)) % alignment;
    const byteOffset = this._length + padding;
    this._ensureCapacity(byteOffset + array.byteLength);
    if (padding > 0) this._buffer.fill(0, this._length, byteOffset);
    this._buffer.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), byteOffset);
    this._length = byteOffset + array.byteLength;
    this._appendCount++;
    this._payloadBytes += array.byteLength;
    this._copiedBytes += array.byteLength;
    return { byteOffset, byteLength: array.byteLength, componentType, count: array.length };
  }

  finish(): Uint8Array {
    const result = this._buffer.slice(0, this._length);
    this._copiedBytes += result.byteLength;
    this._peakWorkingBytes = Math.max(this._peakWorkingBytes, this._buffer.byteLength + result.byteLength);
    return result;
  }

  private _ensureCapacity(required: number): void {
    if (required <= this._buffer.byteLength) return;
    let capacity = this._buffer.byteLength;
    while (capacity < required) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this._buffer.subarray(0, this._length));
    this._copiedBytes += this._length;
    this._peakWorkingBytes = Math.max(this._peakWorkingBytes, this._buffer.byteLength + next.byteLength);
    this._buffer = next;
    this._reallocations++;
  }
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function stableStringify(value: unknown): string {
  const keys = new Set<string>();
  collectJsonKeys(value, keys);
  return JSON.stringify(value, [...keys].sort(), 2);
}

function collectJsonKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonKeys(item, keys);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectJsonKeys(child, keys);
  }
}
