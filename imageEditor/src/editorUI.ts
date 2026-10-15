import {bindEditorControls} from './controlBinding.js';
import { defineButtonComponents } from '@haiyue/ui/button';
import { defineInputComponents, type HYInput } from '@haiyue/ui/input';
import { defineSelectComponents, type HYSelect } from '@haiyue/ui/select';
import { defineCheckboxComponents } from '@haiyue/ui/checkbox';
import { defineSplitComponents, type HYSplit } from '@haiyue/ui/split';

const LAYOUT_KEY = 'haiyue.image-editor.workspace-split.v1';

/** Register only the controls used by the workspace; native forms keep browser validation. */
export function initializeEditorUI(signal: AbortSignal): void {
  defineButtonComponents();
  defineInputComponents();
  defineSelectComponents();
  defineCheckboxComponents();
  defineSplitComponents();

  bindEditorControls(document.querySelector('#app')!,signal);

  const split = document.getElementById('workspace-split') as HYSplit;
  const reset = () => { split.ratio = Math.max(0, 1 - 300 / Math.max(1, split.clientWidth - split.barSize)); };
  reset();
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    if (stored !== null) {
      const ratio: unknown = JSON.parse(stored);
      if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio < 1) split.ratio = ratio;
    }
  } catch { /* Storage may be disabled; resizing remains available. */ }
  const separator = split.shadowRoot?.querySelector<HTMLElement>('[role="separator"]');
  separator?.setAttribute('aria-label', '调整画布与导航器宽度；方向键微调，双击恢复默认');
  // Split prevents pointer selection while dragging; explicitly retain keyboard focus.
  separator?.addEventListener('pointerdown', () => separator.focus({ preventScroll: true }), { signal });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => { timer = undefined; try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(split.ratio)); } catch { /* Optional preference. */ } };
  const scheduleSave = () => { clearTimeout(timer); timer = setTimeout(save, 150); };
  split.addEventListener('ratio-change', scheduleSave, { signal });
  split.addEventListener('dblclick', event => {
    if (event.composedPath().some(node => node instanceof Element && node.getAttribute('role') === 'separator')) { reset(); scheduleSave(); }
  }, { signal });
  signal.addEventListener('abort', () => { if (timer) { clearTimeout(timer); save(); } }, { once: true });
}
