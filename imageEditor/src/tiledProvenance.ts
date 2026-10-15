import type { Bitmap } from './document.js';
import type { Rect } from './pixelTools.js';
// Weak predecessors let history eviction release obsolete page directories.
export const tiledAlphaSources = new WeakMap<Bitmap,WeakRef<Bitmap>>();
export const tiledChanges = new WeakMap<Bitmap,{source:WeakRef<Bitmap>;rect:Rect}>();
