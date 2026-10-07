import { allLayers, type ImageState } from './document.js';
export function psdExportWarnings(state:ImageState):string[] {
 const layers=allLayers(state.layers),warnings:string[]=[];
 if(layers.some(l=>l.kind==='adjustment'))warnings.push('调整图层暂不能写为 Photoshop 调整对象：此 PSD 将合并为一张像素图层，保留当前可见画面。');
 else {const names=layers.filter(l=>l.content).map(l=>l.name);if(names.length)warnings.push('以下文字／形状将作为像素图层导出，PSD 中无法继续修改文字与形状参数：'+names.join('、'));}
 if(warnings.length)warnings.push('请保存 .hyimage 工程以保留全部可编辑内容。');return warnings;
}
