import { inspectTextLayers, textDiagnosticMessage } from './textDiagnostics.js';
import type {Layer,Psd} from 'ag-psd';
import {allLayers,type ImageState} from './document.js';
import {memoryMiB,type PsdMemoryEstimate} from './psdMemory.js';
import {DERIVED_RESOURCE_IDS} from './psdResources.js';
/** Report actual file features after the final import path has been selected. */
export function psdImportReport(psd:Psd,layered:ImageState|null,hasPreview:boolean,memory:PsdMemoryEstimate,ids:readonly number[],keys:readonly string[]){
 const notes=[`文件 ${memoryMiB(memory.fileBytes)} · ${memory.layerCount} 个图层／分组 · 合并图 ${memoryMiB(memory.compositePixelBytes)}。`,'导出会生成新的 PSD 文件，原文件保持不变。'],warnings:string[]=[];
 if(memory.paged)notes.push('已启用按需解码与磁盘分块存储。');
 if(ids.includes(1039))notes.push('保留嵌入 ICC；颜色策略可在下方选择。');
 if(ids.some(id=>DERIVED_RESOURCE_IDS.has(id)))notes.push('导出时重建或移除旧缩略图、图层索引等派生资源。');
 if(ids.some(id=>!DERIVED_RESOURCE_IDS.has(id)))notes.push('其他图像资源按原字节保留，其中历史等元数据不自动更新。');
 if(!hasPreview)notes.push('原件没有可用的合并预览，无法打开合并图副本。');
 if(!layered)return {warnings,notes,textDiagnostics:[]};
 const layers=allLayers(layered.layers),names=(ls:readonly {name?:string}[])=>ls.slice(0,6).map(l=>l.name??'未命名').join('、')+(ls.length>6?` 等 ${ls.length} 层`:'');
 const textDiagnostics=inspectTextLayers(psd,layered);if(textDiagnostics.length){notes.push(`${textDiagnostics.length} 个文字层保留原像素缓存；仅在修改该层文字时重新排版。`);warnings.push(...textDiagnostics.filter(d=>d.issues.length).map(textDiagnosticMessage));}
 const effects=layers.filter(l=>l.styles?.enabled&&(l.styles.shadow||l.styles.stroke||l.styles.innerGlow));if(effects.length)warnings.push(`图层样式：${names(effects)}。投影模糊、描边或内发光使用近似渲染，可能与原软件不同。`);
 const blends=layers.filter(l=>l.blendIf?.enabled);if(blends.length)warnings.push(`混合颜色带：${names(blends)}。编码 RGB／亮度合成尚未完成逐像素对齐。`);
 const feather=layers.filter(l=>l.mask?.feather);if(feather.length)warnings.push(`蒙版羽化：${names(feather)}。当前使用高斯 σ，边缘可能不同。`);
 const raw:Layer[]=[];const walk=(ls:Layer[])=>{for(const l of ls){raw.push(l);walk(l.children??[]);}};walk(psd.children??[]);

 if(!layered.psdArchive){const metadata=raw.filter(l=>l.layerColor&&l.layerColor!=='none'||l.linkGroup);if(metadata.length)warnings.push(`图层标签／链接：${names(metadata)}。此导入路径尚未保留这些元数据。`);if(keys.some(k=>['Patt','Pat2','Pat3'].includes(k)))warnings.push('此文件含图案预设；当前导出路径不保留该预设数据。');}
 return {warnings,notes,textDiagnostics};
}
