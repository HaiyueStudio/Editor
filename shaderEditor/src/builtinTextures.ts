/** Stable IDs keep saved projects small and portable across the packaged web/Electron apps. */
export const BUILTIN_TEXTURES = [
  { id: 'noise-small', name: 'Noise · Small', file: 'noise_small.png' },
  { id: 'noise-medium', name: 'Noise · Medium', file: 'noise_medium.png' },
  { id: 'rgba-noise-small', name: 'RGBA Noise · Small', file: 'rgba_noise_small.png' },
  { id: 'rgba-noise-medium', name: 'RGBA Noise · Medium', file: 'rgba_noise_medium.png' },
  { id: 'blue-noise', name: 'Blue Noise', file: 'blue_noise.png' },
  { id: 'msdf', name: 'MSDF · 字符图集', file: 'msdf.png' },
  { id: 'future-city', name: '未来城市 · 512', file: 'future_city.png' },
  { id: 'webgpu', name: 'WebGPU · 512', file: 'webgpu.png' },
] as const;
export type BuiltinTextureId = typeof BUILTIN_TEXTURES[number]['id'];
export function builtinTexture(id: string) {
  const item = BUILTIN_TEXTURES.find(item => item.id === id);
  if (!item) throw new Error('内置纹理不存在。');
  return { ...item, url: './assets/' + item.file };
}
