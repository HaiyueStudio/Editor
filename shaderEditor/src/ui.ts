import { defineSelectComponents, defineSplitComponents, defineCheckboxComponents, type GESplit } from '@haiyue/ui';

/** Use the installed UI package's public components and theme tokens. */
export function initializeUI(): () => void {
  defineSelectComponents(); defineSplitComponents(); defineCheckboxComponents();
  const key = 'haiyue.shader-editor.layout.v1';
  const ratios: Record<string, number> = {};
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [name, ratio] of Object.entries(saved)) {
        if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) ratios[name] = ratio;
      }
    }
  } catch { /* Layout preferences are optional when storage is unavailable. */ }
  const outer = document.getElementById('workspace-split') as GESplit;
  const splits = [...document.querySelectorAll<GESplit>('ge-split')];
  const mobile = matchMedia('(max-width: 800px)');
  const layoutKey = (split: GESplit) => `${split.id}.${split.direction}`;
  const updateDirection = () => {
    outer.direction = mobile.matches ? 'vertical' : 'horizontal';
    outer.minFirst = mobile.matches ? 460 : 340;
    outer.minSecond = mobile.matches ? 420 : 360;
    outer.ratio = ratios[layoutKey(outer)] ?? (mobile.matches ? 0.5 : 0.49);
  };
  updateDirection(); mobile.addEventListener('change', updateDirection);
  const remember = (event: Event) => {
    if (event.target !== event.currentTarget) return;
    const split = event.target as GESplit;
    ratios[layoutKey(split)] = split.ratio;
    try { localStorage.setItem(key, JSON.stringify(ratios)); } catch { /* Keep the current layout in memory. */ }
  };
  for (const split of splits) {
    split.ratio = ratios[layoutKey(split)] ?? split.ratio;
    split.addEventListener('ratio-change', remember);
  }
  return () => {
    mobile.removeEventListener('change', updateDirection);
    for (const split of splits) split.removeEventListener('ratio-change', remember);
  };
}
