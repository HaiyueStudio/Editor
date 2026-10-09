import { allLayers, type ImageState } from './document.js';
import { nativeWritable } from './layerFeatures.js';
export function psdExportWarnings(state:ImageState):string[] {
 const unsupported=allLayers(state.layers).filter(l=>l.content&&!nativeWritable(l.content)||l.smartFilters!==undefined||l.filterMask!==undefined);
 return unsupported.length?['以下内容尚未实现可靠的 PSD 原生映射（智能滤镜／滤镜蒙版／部分调整／富文本／换行布局／末尾空行文字／大于 32 MiB 的智能源），此副本将合并为像素：'+unsupported.map(l=>l.name).join('、'),'请保存 .hyimage 工程以保留全部可编辑内容。']:[];
}

export function psdMetadataWarnings(state:ImageState):string[]{return state.channels?.length||state.actions?.length||state.layout?['PSD 副本不保存命名 Alpha 通道、参考线／吸附设置和参数化动作；请保存 .hyimage 工程。']:[];}
