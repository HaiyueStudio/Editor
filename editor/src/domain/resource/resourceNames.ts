export function getUniqueName(baseName: string, existing: Iterable<string>): string {
  const names = new Set(existing);
  if (!names.has(baseName)) return baseName;
  let index = 2;
  while (names.has(`${baseName} ${index}`)) index++;
  return `${baseName} ${index}`;
}
