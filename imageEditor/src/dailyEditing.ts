import { pixelColor, pixelArray, withPixels, type PixelArray } from './pixelFormat.js';
import { allLayers, checkSize, findLayer, ImageDocument, layerLocked, makeLayer, type Bitmap, type ImageLayer, type ImageState } from './document.js';
import { compositeState, compositeRegion } from './compositor.js';
import { parentOffset, PixelStroke, replacePixel, type Color, type Point, type Rect } from './pixelTools.js';
import { selectionWeight } from './selection.js';
import { embeddedProfile,srgbProfileBytes } from './colorManagement.js';
import { workingProfile,transformBitmapIcc,iccTransform,profileInfo } from './iccEngine.js';
import { cmykBitmap } from './cmyk.js';

export function sampleState(state: ImageState, layerId?: string): ImageState {
  if (!layerId) return state;
  const layer = findLayer(state.layers, layerId); if (!layer || layer.kind === 'adjustment') throw new Error('请选择含图像的图层。');
  const parent = parentOffset(state.layers, layerId)!;
  return { ...state, layers: [{ ...layer, clipping: false, visible: true, x: layer.x + parent.x, y: layer.y + parent.y }] };
}
export function sampleBitmap(state:ImageState,layerId?:string):Bitmap{return compositeState(sampleState(state,layerId));}
export function sampleColor(state: ImageState, x: number, y: number, layerId?: string): [number, number, number, number] {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.width || y >= state.height) throw new Error('取色坐标超出画布。');
  const image = compositeRegion(sampleState(state, layerId),{x,y,width:1,height:1}), offset = 0;
  return Array.from(image.data.subarray(offset, offset + 4)) as [number, number, number, number];
}
export interface PixelCopy { bitmap: Bitmap; x: number; y: number; profile?:Uint8Array }
export function copyPixels(state: ImageState, layerId?: string): PixelCopy {
  const rect = state.selection ?? { x: 0, y: 0, width: state.width, height: state.height }, source = sampleBitmap(state, layerId);
  const data = pixelArray(rect.width * rect.height * 4,source), ink=source.cmyk?new Float32Array(data.length):undefined; let visible = false;
  for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
    const i = (y * rect.width + x) * 4, p = ((y + rect.y) * source.width + x + rect.x) * 4;
    data.set(source.data.subarray(p, p + 4), i); if(ink)ink.set(source.cmyk!.subarray(p,p+4),i); data[i + 3] = data[i + 3]! * selectionWeight(state.selection, x + rect.x, y + rect.y); visible ||= data[i + 3]! > 0;
  }
  if (!visible) throw new Error('复制范围内没有可见像素。');
  return { bitmap: {...withPixels(rect.width,rect.height,data,source),...(ink?{cmyk:ink}:{})}, x: rect.x, y: rect.y,profile:state.colorMode==='cmyk'?srgbProfileBytes():workingProfile(state) };
}
export function pastePixels(doc: ImageDocument, copy: PixelCopy, name = '粘贴像素'): string {
  checkSize(copy.bitmap.width, copy.bitmap.height);
  let bitmap=doc.state.colorMode==='cmyk'?copy.bitmap:withPixels(copy.bitmap.width,copy.bitmap.height,copy.bitmap.data.slice(),copy.bitmap);
  if(copy.profile&&!(doc.state.colorMode==='cmyk'&&bitmap.cmyk)){
    const target=doc.state.colorMode==='cmyk'?embeddedProfile(doc.state):workingProfile(doc.state);
    if(!target)throw Error('跨配置粘贴前请先指定目标 CMYK ICC。');
    if(target.length!==copy.profile.length||target.some((v,i)=>v!==copy.profile![i])){
      if(profileInfo(copy.profile).space!=='RGB')throw Error('RGBA 剪贴板需要 RGB 源 ICC。');
      const settings={intent:doc.state.icc?.intent??1,bpc:doc.state.icc?.bpc??true};
      if(doc.state.colorMode==='cmyk'){
        const rgb=Float32Array.from({length:bitmap.width*bitmap.height*3},(_,i)=>bitmap.data[Math.floor(i/3)*4+i%3]!/255),inks=iccTransform(rgb,copy.profile,target,settings).data;
        bitmap=cmykBitmap(bitmap.width,bitmap.height,Float32Array.from(inks,v=>Math.max(0,Math.min(100,v))),Float32Array.from({length:bitmap.width*bitmap.height},(_,i)=>bitmap.data[i*4+3]!),(doc.state.bitDepth??8) as 8|16,target);
      }else bitmap=transformBitmapIcc(withPixels(bitmap.width,bitmap.height,Float32Array.from(bitmap.data),doc.state.bitDepth===32?32:16),copy.profile,target,settings);
    }
    if(doc.state.colorMode!=='cmyk'){const depth=doc.state.bitDepth??8,data=pixelArray(bitmap.data.length,depth);data.set(bitmap.data);bitmap=withPixels(bitmap.width,bitmap.height,data,depth);}
  }
  const layer = { ...makeLayer(name, bitmap), x: copy.x, y: copy.y }; doc.addLayer(layer, false); return layer.id;
}
export function gradientPixels(state: ImageState, layerId: string, start: Point, end: Point, from: Color, to: Color, kind: 'linear' | 'radial', opacity = 1): ImageLayer {
  if ([...from, ...to].some(v => !Number.isFinite(v) || v < 0 || v > 255)) throw new Error('渐变颜色无效。');
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite) || !['linear', 'radial'].includes(kind)) throw new Error('渐变参数无效。');
  from=pixelColor(from,state.bitDepth??8) as unknown as Color;to=pixelColor(to,state.bitDepth??8) as unknown as Color;
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy); if (length < 0.5) throw new Error('请拖出一段渐变距离。');
  const layer = new PixelStroke(state, layerId, 1, opacity, from).layer, image = layer.bitmap!, parent = parentOffset(state.layers, layerId)!;
  const bounds = state.selection ?? { x: 0, y: 0, width: state.width, height: state.height };
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    const weight = selectionWeight(state.selection, x, y) * opacity; if (!weight) continue;
    const t = Math.max(0, Math.min(1, kind === 'radial' ? Math.hypot(x + 0.5 - start.x, y + 0.5 - start.y) / length : ((x + 0.5 - start.x) * dx + (y + 0.5 - start.y) * dy) / (length * length)));
    const i = ((y - layer.y - parent.y) * image.width + x - layer.x - parent.x) * 4, alpha = image.data[i + 3]! / 255, out = weight + alpha * (1 - weight);
    if(layerLocked(state.layers,layerId,'transparency')){if(!alpha)continue;for(let c=0;c<3;c++)image.data[i+c]=(from[c]!*(1-t)+to[c]!*t)*weight+image.data[i+c]!*(1-weight);continue;}
    for (let c = 0; c < 3; c++) image.data[i + c] = ((from[c]! * (1 - t) + to[c]! * t) * weight + image.data[i + c]! * alpha * (1 - weight)) / out;
    image.data[i + 3] = out * 255;
  }
  return layer;
}
export function selectedRoots(state: ImageState, ids: readonly string[]): ImageLayer[] {
  if (!ids.length || ids.length > 128 || new Set(ids).size !== ids.length || ids.some(id => !findLayer(state.layers, id))) throw new Error('请选择有效图层。');
  const selected = new Set(ids), roots: ImageLayer[] = [];
  const walk = (layers: readonly ImageLayer[]) => { for (const layer of layers) { if (selected.has(layer.id)) roots.push(layer); else walk(layer.children); } }; walk(state.layers); return roots;
}
export function layerBounds(state: ImageState, layer: ImageLayer): Rect {
  const parent = parentOffset(state.layers, layer.id)!;
  if (layer.kind === 'group') {
    const children = allLayers(layer.children).filter(item => item.bitmap);
    if (!children.length) throw new Error('空图层组没有边界。');
    return union(children.map(item => layerBounds(state, item)));
  }
  if (!layer.bitmap) throw new Error('空图层或调整图层没有可变换边界。');
  return { x: parent.x + layer.x, y: parent.y + layer.y, width: layer.bitmap.width, height: layer.bitmap.height };
}
function union(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
}
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export function alignLayers(doc: ImageDocument, ids: readonly string[], alignment: Alignment, relativeTo: 'selection' | 'canvas' = 'selection') {
  const state = doc.state, roots = selectedRoots(state, ids), bounds = roots.map(layer => layerBounds(state, layer));
  if (!['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(alignment) || !['selection', 'canvas'].includes(relativeTo)) throw new Error('对齐方式无效。');
  const target = relativeTo === 'canvas' ? { x: 0, y: 0, width: state.width, height: state.height } : union(bounds);
  let layers = state.layers;
  roots.forEach((layer, i) => { const b = bounds[i]!;
    const x = alignment === 'left' ? target.x - b.x : alignment === 'center' ? target.x + target.width / 2 - b.x - b.width / 2 : alignment === 'right' ? target.x + target.width - b.x - b.width : 0;
    const y = alignment === 'top' ? target.y - b.y : alignment === 'middle' ? target.y + target.height / 2 - b.y - b.height / 2 : alignment === 'bottom' ? target.y + target.height - b.y - b.height : 0;
    layers = replacePixel(layers, layer.id, { ...layer, x: layer.x + Math.round(x), y: layer.y + Math.round(y) });
  });
  doc.commitLayers('对齐图层', layers, roots.map(l => l.id), ids);
}
export function moveLayers(doc: ImageDocument, ids: readonly string[], x: number, y: number) {
  if (![x, y].every(Number.isInteger)) throw new Error('移动距离必须是整数。');
  if (x === 0 && y === 0) return;
  const roots = selectedRoots(doc.state, ids); let layers = doc.state.layers;
  for (const layer of roots) layers = replacePixel(layers, layer.id, { ...layer, x: layer.x + x, y: layer.y + y });
  doc.commitLayers('移动图层', layers, roots.map(l => l.id), ids);
}
export function mergeLayers(doc: ImageDocument, ids: readonly string[]): string {
  const state = doc.state, roots = selectedRoots(state, ids); if (roots.length < 2) throw new Error('请至少选择两个图层。');
  let siblings: readonly ImageLayer[] | undefined;
  const walk = (layers: readonly ImageLayer[]) => { if (layers.some(layer => layer.id === roots[0]!.id)) siblings = layers; else for (const layer of layers) walk(layer.children); }; walk(state.layers);
  const positions = roots.map(layer => siblings!.indexOf(layer)).sort((a, b) => a - b);
  if (positions.some((p, i) => p < 0 || p !== positions[0]! + i)) throw new Error('请合并同一组内连续的图层，避免改变未选图层的叠放关系。');
  if (siblings![positions.at(-1)!+1]?.clipping)throw new Error('合并范围包含未选剪贴层的基底，请先释放剪贴关系。');
  if (roots.some(layer => layer.kind === 'adjustment' || layer.blend !== 'normal' || layer.clipping || layer.styles?.enabled || layer.blendIf?.enabled)) throw new Error('合并的顶层图层需使用正常混合模式；调整层请保留或先导出合并副本。');
  const affected = allLayers(roots).map(l => l.id); if (affected.some(id => layerLocked(state.layers, id))) throw new Error('所选图层或子图层已锁定。');
  if (roots.some(layer => !layer.visible)) throw new Error('请先显示要合并的图层，或取消选择隐藏图层。');
  const visible = roots.filter(layer => layer.visible); if (!visible.length) throw new Error('所选图层均不可见。');
  const bounds = union(visible.map(layer => layerBounds(state, layer))), parent = parentOffset(state.layers, roots[0]!.id)!;
  checkSize(bounds.width, bounds.height);
  const bitmap = compositeState({ ...state, width: bounds.width, height: bounds.height, selection: null, layers: roots.map(l => ({ ...l, x: l.x + parent.x - bounds.x, y: l.y + parent.y - bounds.y })) });
  const merged = { ...makeLayer('合并图层', bitmap), x: bounds.x - parent.x, y: bounds.y - parent.y }, selected = new Set(roots.map(l => l.id));
  const replace = (layers: readonly ImageLayer[]): readonly ImageLayer[] => layers === siblings ? layers.flatMap((layer, i) => i === positions[0] ? [merged] : selected.has(layer.id) ? [] : [layer]) : layers.map(l => l.children.length ? { ...l, children: replace(l.children) } : l);
  doc.commitLayers('合并图层', replace(state.layers), affected, [merged.id]); return merged.id;
}
