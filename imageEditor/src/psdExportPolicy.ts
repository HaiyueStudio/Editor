import {nativeSmartFilters,nativeFilterPlacement} from './psdSmartFilters.js';
import { allLayers, type ImageState } from './document.js';
import { nativeWritable } from './layerFeatures.js';
export function psdExportWarnings(state:ImageState):string[] {
 const unsupported=allLayers(state.layers).flatMap(l=>{const reasons:string[]=[];
 if(l.content&&!nativeWritable(l.content)){const c=l.content;reasons.push(c.type==='text'?/[\r\n]$/.test(c.text)?'末尾空行文字':c.wrapWidth?'自动换行文字':'富文本布局':c.type==='smart'?'大于 32 MiB 的智能源':c.type==='adjustment'?'调整类型：'+c.filter:'原生内容超出支持范围');}
 if(!nativeSmartFilters(l.smartFilters))reasons.push('智能滤镜：'+l.smartFilters!.filter(f=>!nativeSmartFilters([f])).map(f=>f.settings.kind).join('、'));
 if(l.smartFilters?.length&&l.content?.type==='smart'&&l.content.sourcePdf)reasons.push('PDF 矢量源智能滤镜');
 if(l.content?.type==='smart'&&!nativeFilterPlacement(l.content,l.smartFilters))reasons.push('空间智能滤镜与几何变换的运算顺序');
 if(l.filterMask)reasons.push('智能滤镜蒙版');
 return reasons.length?[l.name+'（'+reasons.join('；')+'）']:[];});
 return unsupported.length?['以下内容尚未实现可靠的 PSD 原生映射，此副本将合并为像素：'+unsupported.join('、'),'请保存 .hyimage 工程以保留全部可编辑内容。']:[];
}
export function psdMetadataWarnings(state:ImageState):string[]{return [...(state.artboards?.length||state.spotChannels?.length?['画板区域与专色保存在 .hyimage 工程；PSD 副本不包含这些数据。请使用画板导出和专色分版导出交付。']:[]),...(allLayers(state.layers).some(l=>l.content?.type==='smart'&&l.content.link)?['外链智能对象在 PSD 副本中嵌入缓存源；外链地址保存在 .hyimage 工程。']:[]),...(state.channels?.length||state.actions?.length||state.layout?['PSD 副本不保存命名 Alpha 通道、参考线／吸附设置和参数化动作；请保存 .hyimage 工程。']:[])];}
