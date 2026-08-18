declare module 'pako' {
  export function deflateRaw(
    data: Uint8Array,
    options?: { level?: number },
  ): Uint8Array;
}
