export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;

export function readNumber(input: HTMLInputElement | null, fallback: number): number {
  if (!input) return fallback;
  if (input.value.trim() === '') return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}
