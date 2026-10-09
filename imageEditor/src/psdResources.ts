export const MAX_PSD_RESOURCES = 16 * 1024 * 1024;
export interface ResourceBlock { id: number; bytes: Uint8Array }
export function resourceBlocks(bytes: Uint8Array): ResourceBlock[] {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_PSD_RESOURCES) throw new Error('PSD 资源超过 16 MiB 限制。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result: ResourceBlock[] = [];
  let p = 0;
  const require = (n: number) => { if (p + n > bytes.length) throw new Error('PSD 资源块截断。'); };
  while (p < bytes.length) {
    const start = p; require(7);
    if (view.getUint32(p) !== 0x3842494d) throw new Error('PSD 资源签名无效。');
    const id = view.getUint16(p + 4), name = bytes[p + 6]! + 1; p += 6 + name + name % 2;
    require(4); const size = view.getUint32(p); p += 4; require(size + size % 2); p += size + size % 2;
    result.push({ id, bytes: bytes.subarray(start, p) });
  }
  return result;
}
export function concatBytes(parts: readonly Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; } return out;
}
export function psdSections(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 26;
  const section = () => {
    if (p + 4 > bytes.length) throw new Error('PSD 区段截断。');
    const size = view.getUint32(p), start = p; p += 4 + size;
    if (p > bytes.length) throw new Error('PSD 区段长度无效。'); return { start, data: start + 4, end: p };
  };
  const color = section(), resources = section(), layers = section();
  if (p + 2 > bytes.length) throw new Error('PSD 缺少合成数据。');
  return { color, resources, layers, composite: p };
}
// Thumbnails and document/layer-index-dependent records must be regenerated, not copied stale.
export const DERIVED_RESOURCE_IDS = new Set([1024, 1026, 1033, 1036, 1045, 1053, 1062, 1065, 1069, 1072, 1077]);

/** Inspect extra-information keys independently: unimplemented codec keys must not disappear silently. */
export function additionalInfoKeys(bytes: Uint8Array): string[] {
  const section=psdSections(bytes).layers, view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), keys=new Set<string>();
  const string=(p:number)=>String.fromCharCode(...bytes.subarray(p,p+4));
  const need=(p:number,n:number,end:number)=>{if(p+n>end)throw new Error('PSD 图层附加区段截断。');};
  const info=(from:number,end:number)=>{
    let p=from;
    while(p+12<=end){
      while(p<end&&bytes[p]===0)p++;
      if(p===end)break;
      need(p,12,end);
      const signature=string(p);if(signature!=='8BIM'&&signature!=='8B64')throw new Error('PSD 附加信息签名无效。');
      keys.add(string(p+4)); const header=signature==='8B64'?16:12; need(p,header,end);
      const size=signature==='8B64'?Number(view.getBigUint64(p+8)):view.getUint32(p+8);need(p+header,size,end);p+=header+size+size%2;
    }
  };
  if(section.end===section.data)return [];
  let p=section.data;need(p,4,section.end);const length=view.getUint32(p);p+=4;const layerEnd=p+length;need(p,length,section.end);
  if(length){need(p,2,layerEnd);const count=Math.abs(view.getInt16(p));p+=2;
    for(let i=0;i<count;i++){
      need(p,18,layerEnd);const channels=view.getUint16(p+16);p+=18;need(p,channels*6+16,layerEnd);p+=channels*6+12;
      const extraLength=view.getUint32(p);p+=4;const end=p+extraLength;need(p,extraLength,layerEnd);
      for(let j=0;j<2;j++){need(p,4,end);const size=view.getUint32(p);p+=4;need(p,size,end);p+=size;}
      need(p,1,end);const nameLength=bytes[p]!+1;p+=nameLength+(4-nameLength%4)%4;need(p,0,end);info(p,end);p=end;
    }
  }
  p=layerEnd;if(p===section.end)return [...keys];need(p,4,section.end);const maskSize=view.getUint32(p);p+=4;need(p,maskSize,section.end);p+=maskSize;info(p,section.end);
  return [...keys];
}

export function validateCompositeBytes(bytes: Uint8Array) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), start=psdSections(bytes).composite;
  const channels=v.getUint16(12),height=v.getUint32(14),width=v.getUint32(18),compression=v.getUint16(start);
  if(compression===0){if(start+2+channels*width*height>bytes.length)throw new Error('PSD 合成像素截断。');return;}
  if(compression!==1)throw new Error('暂不支持此 PSD 合成压缩方式。');
  const rows=channels*height,table=start+2;let p=table+rows*2;
  if(p>bytes.length)throw new Error('PSD 合成行表截断。');
  for(let row=0;row<rows;row++){
    const end=p+v.getUint16(table+row*2);if(end>bytes.length)throw new Error('PSD 合成行截断。');let decoded=0;
    while(p<end){const n=bytes[p++]!;if(n<128){p+=n+1;decoded+=n+1;}else if(n>128){p++;decoded+=257-n;}if(p>end||decoded>width)throw new Error('PSD 合成行编码无效。');}
    if(decoded!==width)throw new Error('PSD 合成行像素不完整。');
  }
}

/** PSD raw planar composite, with the specified white matte for partial RGB alpha. */
export function rawCompositeData(encoded:Uint8Array,image:{width:number;height:number;data:Uint8ClampedArray}):Uint8Array {
 const channels=new DataView(encoded.buffer,encoded.byteOffset,encoded.byteLength).getUint16(12),n=image.width*image.height,raw=new Uint8Array(2+n*channels);
 for(let c=0;c<channels;c++)for(let i=0;i<n;i++){const a=image.data[i*4+3]!,value=image.data[i*4+c]!;raw[2+c*n+i]=c<3&&a>0&&a<255?Math.round(value*a/255+255-a):value;}
 return raw;
}
