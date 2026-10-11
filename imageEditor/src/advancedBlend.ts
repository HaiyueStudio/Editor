import type {Layer} from 'ag-psd';
import type {ImageLayer} from './document.js';
export interface AdvancedBlend {blendClipped?:boolean;blendInterior?:boolean;maskHidesEffects?:boolean;knockout?:boolean}
export function validateAdvancedBlend(layer:Pick<ImageLayer,'fillOpacity'|'advancedBlend'>){
 if(layer.fillOpacity!==undefined&&(!Number.isFinite(layer.fillOpacity)||layer.fillOpacity<0||layer.fillOpacity>1))throw Error('填充不透明度应为 0–1。');
 const b=layer.advancedBlend;if(b&&(!Object.keys(b).every(k=>['blendClipped','blendInterior','maskHidesEffects','knockout'].includes(k))||Object.values(b).some(v=>typeof v!=='boolean')))throw Error('高级混合选项无效。');
}
export function readAdvancedBlend(l:Layer):Pick<ImageLayer,'fillOpacity'|'advancedBlend'> {
 if(l.transparencyShapesLayer===false)throw Error('关闭“透明形状图层”尚未支持。');
 const b:AdvancedBlend={};if(l.blendClippendElements===false)b.blendClipped=l.blendClippendElements;if(l.blendInteriorElements===true)b.blendInterior=l.blendInteriorElements;if(l.layerMaskAsGlobalMask===true)b.maskHidesEffects=l.layerMaskAsGlobalMask;if(l.knockout===true)b.knockout=l.knockout;
 const result={...(l.fillOpacity!==undefined&&l.fillOpacity!==1?{fillOpacity:l.fillOpacity}:{}),...(Object.keys(b).length?{advancedBlend:b}:{})};validateAdvancedBlend(result);return result;
}
export function writeAdvancedBlend(l:ImageLayer):Partial<Layer>{const b=l.advancedBlend;return {fillOpacity:l.fillOpacity??1,blendClippendElements:b?.blendClipped??true,blendInteriorElements:b?.blendInterior??false,layerMaskAsGlobalMask:b?.maskHidesEffects??false,knockout:b?.knockout??false};}
export function modernComposite(l:ImageLayer):boolean{return l.fillOpacity!==undefined||l.advancedBlend!==undefined||!['normal','multiply','screen','overlay','darken','lighten','hard-light','difference','exclusion'].includes(l.blend)||!!l.styles&&(!!l.styles.innerShadow||!!l.styles.outerGlow||!!l.styles.gradient||!!l.styles.bevel||!!l.styles.satin||!!l.styles.extraShadows||!!l.styles.extraStrokes||Object.entries(l.styles).some(([k,v])=>v&&typeof v==='object'&&('enabled' in v||'blend' in v&&(k!=='innerGlow'||!['normal','screen'].includes(String(v.blend)))||'position' in v||'contour' in v||'spread' in v)));}
