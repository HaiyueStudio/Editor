/** Shadow DOM retargets focus to the custom-element host. */
export function isControlFocused(): boolean {
  const active = document.activeElement;
  return Boolean(active?.matches('input, textarea, select, hy-input, hy-select, hy-checkbox, hy-range, hy-split, [contenteditable="true"]'));
}
