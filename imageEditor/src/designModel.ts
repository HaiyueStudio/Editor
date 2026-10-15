import type { ImageLayer } from './document.js';
import { isDesignAdjustment } from './designAdjustments.js';
export function designLayer(l:ImageLayer){const c=l.content;return c?.type==='smart'&&!!(c.link||c.transform.mesh)||c?.type==='adjustment'&&isDesignAdjustment(c.filter);}
