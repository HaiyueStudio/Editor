import type { Layer } from 'ag-psd';
import { validateBlendIf, type BlendIf, type SplitRange } from './liveEffects.js';
const neutral=()=>[0,0,255,255];
export function writeBlendIf(rule:BlendIf|undefined):Partial<Layer>{
 if(!rule?.enabled)return {};const ranges=Array.from({length:3},()=>({sourceRange:neutral(),destRange:neutral()})),gray=rule.channel==='gray';
 if(!gray)ranges[['red','green','blue'].indexOf(rule.channel)]={sourceRange:[...rule.source],destRange:[...rule.underlying]};
 return {blendingRanges:{compositeGrayBlendSource:gray?[...rule.source]:neutral(),compositeGraphBlendDestinationRange:gray?[...rule.underlying]:neutral(),ranges}};
}
export function readBlendIf(layer:Layer):BlendIf|undefined {
 const b=layer.blendingRanges;if(!b)return;
 const records=[{sourceRange:b.compositeGrayBlendSource,destRange:b.compositeGraphBlendDestinationRange},...b.ranges],active=records.map((r,i)=>({r,i})).filter(({r})=>[r.sourceRange,r.destRange].some(v=>v.join(',')!=='0,0,255,255'));
 if(!active.length)return;if(active.length!==1||active[0]!.i>3)throw new Error('当前 Blend If 仅支持灰色或一个 RGB 通道；不能丢弃其他颜色带。');
 const {r,i}=active[0]!,result:BlendIf={enabled:true,channel:['gray','red','green','blue'][i] as BlendIf['channel'],source:r.sourceRange as unknown as SplitRange,underlying:r.destRange as unknown as SplitRange};validateBlendIf(result);return result;
}
