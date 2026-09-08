import type { AdvancedAuthoringMount, AdvancedAuthoringOptions } from './types.js';
import { AdvancedAuthoringError } from './validation.js';
export * from './types.js';
export { parseAdvancedAuthoringView, AdvancedAuthoringError } from './validation.js';
export const ADVANCED_AUTHORING_API_VERSION = 1 as const;

/** Real dynamic import: browser presentation stays outside the initial module closure. */
export async function mountAdvancedAuthoring(options: AdvancedAuthoringOptions, signal?: AbortSignal): Promise<AdvancedAuthoringMount> {
  if (signal?.aborted) throw new AdvancedAuthoringError('mount-cancelled');
  const { AdvancedAuthoringPanel } = await import('./panel.js');
  if (signal?.aborted) throw new AdvancedAuthoringError('mount-cancelled');
  const panel = new AdvancedAuthoringPanel(options);
  if (signal?.aborted) { panel.dispose(); throw new AdvancedAuthoringError('mount-cancelled'); }
  const dispose = () => { signal?.removeEventListener('abort',dispose); panel.dispose(); };
  signal?.addEventListener('abort',dispose,{once:true});
  return Object.freeze({ update: panel.update.bind(panel), reveal: panel.reveal.bind(panel), cancel: panel.cancel.bind(panel), dispose });
}
