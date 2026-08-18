import type { SerializedTypedArray } from '../../export/runtimeScene';

type SupportedTypedArray = Float32Array | Uint16Array | Uint32Array;

const CHUNK_SIZE = 0x8000;

export function encodeTypedArray(array: SupportedTypedArray): SerializedTypedArray {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return {
    encoding: 'base64',
    componentType: array instanceof Float32Array ? 'float32' : array instanceof Uint32Array ? 'uint32' : 'uint16',
    length: array.length,
    data: btoa(binary),
  };
}

export function decodeFloat32Array(value: number[] | SerializedTypedArray): Float32Array {
  if (Array.isArray(value)) return new Float32Array(value);
  return decodeTypedArray(value, 'float32') as Float32Array;
}

export function decodeIndexArray(value: number[] | SerializedTypedArray, indexType: 'uint16' | 'uint32' | null): Uint16Array | Uint32Array {
  if (Array.isArray(value)) return indexType === 'uint32' ? new Uint32Array(value) : new Uint16Array(value);
  return decodeTypedArray(value, indexType === 'uint32' ? 'uint32' : 'uint16') as Uint16Array | Uint32Array;
}

function decodeTypedArray(value: SerializedTypedArray, expectedType: SerializedTypedArray['componentType']): SupportedTypedArray {
  if (value.encoding !== 'base64' || value.componentType !== expectedType) {
    throw new Error(`Invalid serialized typed array. Expected ${expectedType}.`);
  }
  const binary = atob(value.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (value.componentType === 'float32') return new Float32Array(buffer, 0, value.length);
  if (value.componentType === 'uint32') return new Uint32Array(buffer, 0, value.length);
  return new Uint16Array(buffer, 0, value.length);
}
