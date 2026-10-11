import type { Bitmap } from './document.js';
import { bitmapRegion } from './pagedPixels.js';
import { filterBitmap, validateFilterSettings, type FilterSettings } from './filters.js';
import type { CompositeRect } from './compositor.js';
import type { SmartFilter } from './liveEffects.js';

export function filterSupport(settings:FilterSettings){validateFilterSettings(settings);switch(settings.kind){case 'blur':return settings.amount;case 'gaussian':return Math.ceil(3*settings.amount);case 'usm':return settings.amount?Math.ceil(3*(settings.radius??2)):0;case 'emboss':case 'sharpen':return 1;case 'pixelate':return settings.amount-1;default:return 0;}}
/** Pixelation is aligned to the original layer, never to the requested tile. */
export function filterInputRect(width:number,height:number,settings:FilterSettings,r:CompositeRect):CompositeRect {
 const halo=filterSupport(settings),block=settings.kind==='pixelate'?settings.amount:1;
 const x=Math.max(0,Math.floor((r.x-(block===1?halo:0))/block)*block),y=Math.max(0,Math.floor((r.y-(block===1?halo:0))/block)*block),right=Math.min(width,Math.ceil((r.x+r.width+(block===1?halo:0))/block)*block),bottom=Math.min(height,Math.ceil((r.y+r.height+(block===1?halo:0))/block)*block);
 return {x,y,width:right-x,height:bottom-y};
}
export function cropFiltered(b:Bitmap,input:CompositeRect,output:CompositeRect){return bitmapRegion(b,output.x-input.x,output.y-input.y,output.width,output.height);}
export function filterRegion(source:Bitmap,settings:FilterSettings,r:CompositeRect):Bitmap {const input=filterInputRect(source.width,source.height,settings,r);return cropFiltered(filterBitmap(bitmapRegion(source,input.x,input.y,input.width,input.height),settings),input,r);}
export function stackInputRect(width:number,height:number,filters:readonly SmartFilter[],rect:CompositeRect){let r=rect;for(let i=filters.length-1;i>=0;i--){const f=filters[i]!;if(f.enabled&&f.opacity)r=filterInputRect(width,height,f.settings,r);}return r;}
