import { concatBytes, psdSections } from './psdResources.js';
/** ag-psd 31 writes 63 legacy records without the required Lvls extension header.
 * Canonicalize our generated RGB8 levl blocks to the specified 29-record v2 layout.
 * This only touches codec output, never repairs or accepts an arbitrary input file.
 */
export function normalizeExportedLevels(input:Uint8Array):Uint8Array {
 const section=psdSections(input).layers;if(section.end===section.data)return input;
 let bytes=input,v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const cuts:{start:number;end:number}[]=[];
 const need=(p:number,n:number,end:number)=>{if(p<0||p+n>end)throw new Error('PSD 色阶导出布局无效。');};
 const infoSize=v.getUint32(section.data),infoEnd=section.data+4+infoSize;let p=section.data+4;need(p,infoSize,section.end);if(!infoSize)return input;
 const count=Math.abs(v.getInt16(p));p+=2;
 for(let i=0;i<count;i++){
  need(p,18,infoEnd);const channels=v.getUint16(p+16);p+=18+channels*6+12;need(p,4,infoEnd);
  const sizeAt=p,size=v.getUint32(p),end=p+4+size;p+=4;need(p,size,infoEnd);let removed=0;
  for(let j=0;j<2;j++){need(p,4,end);const n=v.getUint32(p);p+=4;need(p,n,end);p+=n;}
  need(p,1,end);const name=bytes[p]!+1;p+=name+(4-name%4)%4;
  while(p+12<=end){
   while(p<end&&bytes[p]===0)p++;if(p===end)break;need(p,12,end);
   if(v.getUint32(p)!==0x3842494d)throw new Error('PSD 色阶导出附加信息签名无效。');
   const n=v.getUint32(p+8),data=p+12;need(data,n+n%2,end);
   if(v.getUint32(p+4)===0x6c65766c){
    if(n!==632||v.getUint16(data)!==2)throw new Error('PSD 编解码器色阶布局已改变，请重新验证适配器。');
    // RGB composite and R/G/B occupy records 0–3; all extra channels remain identity.
    for(let c=4;c<63;c++)for(let j=0;j<5;j++)if(v.getUint16(data+2+c*10+j*2)!==[0,255,0,255,100][j])throw new Error('PSD 色阶包含意外的额外通道。');
    if(bytes===input){bytes=input.slice();v=new DataView(bytes.buffer);}
    bytes.fill(0,data+2+27*10,data+292);v.setUint32(p+8,292);cuts.push({start:data+292,end:data+n});removed+=n-292;
   }p=data+n+n%2;
  }
  v.setUint32(sizeAt,size-removed);p=end;
 }
 if(!cuts.length)return input;
 const removed=cuts.reduce((sum,c)=>sum+c.end-c.start,0);v.setUint32(section.data,infoSize-removed);v.setUint32(section.start,section.end-section.data-removed);
 const parts:Uint8Array[]=[];p=0;for(const c of cuts){parts.push(bytes.subarray(p,c.start));p=c.end;}parts.push(bytes.subarray(p));return concatBytes(parts);
}
