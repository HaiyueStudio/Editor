import type { Bitmap, ImageLayer, ImageState } from './document.js';
import { concatBytes, resourceBlocks } from './psdResources.js';
export type ColorPreset='srgb'|'display-p3'|'adobe-rgb';
export interface RgbProfile { name:string;matrix:readonly number[];curves:readonly Float64Array[] }
const srgb=[.4360747,.3850649,.1430804,.2225045,.7168786,.0606169,.0139322,.0971045,.7141733];
const d50=[1.0479297925,.0229468706,-.0501922663,.0296278088,.9904344268,-.0170737991,-.0092430582,.0150551449,.7518742814];
const multiply=(a:readonly number[],b:readonly number[])=>Array.from({length:9},(_,i)=>[0,1,2].reduce((n,k)=>n+a[Math.floor(i/3)*3+k]!*b[k*3+i%3]!,0));
function inverse(m:readonly number[]){const [a,b,c,d,e,f,g,h,i]=m as number[],det=a!*(e!*i!-f!*h!)-b!*(d!*i!-f!*g!)+c!*(d!*h!-e!*g!);if(Math.abs(det)<1e-8)throw new Error('ICC 色彩矩阵不可逆。');return [e!*i!-f!*h!,c!*h!-b!*i!,b!*f!-c!*e!,f!*g!-d!*i!,a!*i!-c!*g!,c!*d!-a!*f!,d!*h!-e!*g!,b!*g!-a!*h!,a!*e!-b!*d!].map(v=>v/det);}
const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4,encoded=(v:number)=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
export function builtinProfile(name:ColorPreset,samples=256):RgbProfile {
 if(!['srgb','display-p3','adobe-rgb'].includes(name))throw new Error('未知 RGB 色彩空间。');
 const matrix=name==='srgb'?srgb:multiply(d50,name==='display-p3'?[.4865709486,.2656676932,.1982172852,.2289745641,.6917385218,.0792869141,0,.0451133819,1.043944369]:[.5766690429,.1855582379,.1882286462,.2973449753,.6273635663,.0752914585,.0270313614,.0706888525,.9913375368]);
 const lut=Float64Array.from({length:samples},(_,v)=>name==='adobe-rgb'?(v/(samples-1))**(563/256):linear(v/(samples-1)));return {name,matrix,curves:[lut,lut,lut]};
}
/** RGB matrix/TRC ICC v2/v4 only; LUT, device-link, CMYK/Lab, malformed and nonmonotone profiles reject. */
export function parseRgbProfile(bytes:Uint8Array,samples=256):RgbProfile {
 if(bytes.length<132||bytes.length>4*1024*1024)throw new Error('ICC 文件应为 132 B–4 MiB。');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),str=(p:number)=>String.fromCharCode(...bytes.subarray(p,p+4)),need=(p:number,n:number)=>{if(p<0||p+n>bytes.length)throw new Error('ICC 标签截断。');};
 if(v.getUint32(0)!==bytes.length||str(36)!=='acsp'||str(16)!=='RGB '||str(20)!=='XYZ '||![2,4].includes(bytes[8]!)||!['mntr','scnr','spac'].includes(str(12)))throw new Error('仅支持 RGB / XYZ 的 ICC v2/v4 矩阵配置。');
 if([.9642,1,.8249].some((n,i)=>Math.abs(v.getInt32(68+i*4)/65536-n)>.001))throw new Error('ICC PCS 白点必须是 D50。');
 const count=v.getUint32(128);if(count>256)throw new Error('ICC 标签过多。');need(132,count*12);const tags=new Map<string,{offset:number;size:number}>();
 for(let i=0;i<count;i++){const p=132+i*12,name=str(p),offset=v.getUint32(p+4),size=v.getUint32(p+8);if(tags.has(name)||offset<132+count*12||offset%4||size<8)throw new Error('ICC 标签索引无效。');need(offset,size);tags.set(name,{offset,size});}
 if([...tags.keys()].some(k=>/^(A2B|B2A|D2B|B2D)/.test(k)))throw new Error('暂不支持 ICC LUT／感知映射配置；不能当作矩阵配置转换。');
 const tag=(name:string)=>{const t=tags.get(name);if(!t)throw new Error('ICC 缺少 '+name);return t;},fixed=(p:number)=>v.getInt32(p)/65536;
 const columns=['rXYZ','gXYZ','bXYZ'].map(name=>{const t=tag(name);if(str(t.offset)!=='XYZ '||t.size<20)throw new Error('ICC 色度标签无效。');return [8,12,16].map(n=>fixed(t.offset+n));}),matrix=Array.from({length:9},(_,i)=>columns[i%3]![Math.floor(i/3)]!);if(matrix.some(n=>!Number.isFinite(n)||Math.abs(n)>4))throw new Error('ICC 色度范围无效。');inverse(matrix);
 const curves=['rTRC','gTRC','bTRC'].map(name=>{const t=tag(name),p=t.offset,type=str(p);let curve:(x:number)=>number;
  if(type==='curv'){if(t.size<12)throw new Error('ICC 曲线截断。');const count=v.getUint32(p+8);if(count>4096||12+count*2>t.size)throw new Error('ICC 曲线长度无效。');if(count===0)curve=x=>x;else if(count===1){const gamma=v.getUint16(p+12)/256;if(gamma<=0||gamma>10)throw new Error('ICC gamma 无效。');curve=x=>x**gamma;}else{const table=Array.from({length:count},(_,i)=>v.getUint16(p+12+i*2)/65535);if(table.some((n,i)=>i>0&&n<table[i-1]!))throw new Error('ICC 曲线必须单调。');curve=x=>{const pos=x*(count-1),i=Math.floor(pos),f=pos-i;return table[i]!*(1-f)+table[Math.min(count-1,i+1)]!*f;};}}
  else if(type==='para'){if(t.size<16)throw new Error('ICC 参数曲线截断。');const type=v.getUint16(p+8),count=[1,3,4,5,7][type];if(count===undefined||12+count*4>t.size)throw new Error('ICC 参数曲线类型无效。');const q=Array.from({length:count},(_,i)=>fixed(p+12+i*4)),[g,a,b,c,d,e,f]=q;if(g!<=0||g!>10||type>0&&a!<=0)throw new Error('ICC 参数曲线无效。');curve=x=>type===0?x**g!:type===1?(x>=-b!/a!?(a!*x+b!)**g!:0):type===2?(x>=-b!/a!?(a!*x+b!)**g!+c!:c!):type===3?(x>=d!?(a!*x+b!)**g!:c!*x):(x>=d!?(a!*x+b!)**g!+e!:c!*x+f!);}
  else throw new Error('不支持的 ICC TRC 类型。');
  const lut=Float64Array.from({length:samples},(_,i)=>curve(i/(samples-1)));if(lut.some((n,i)=>!Number.isFinite(n)||n<0||n>2||i>0&&n+1e-8<lut[i-1]!))throw new Error('ICC 曲线值无效。');return lut;
 });return {name:'embedded RGB ICC',matrix,curves};
}
export function rgbToSrgb(profile:RgbProfile):(r:number,g:number,b:number)=>readonly [number,number,number] {
 const m=multiply(inverse(srgb),profile.matrix);return (r,g,b)=>{const values=[profile.curves[0]![r]!,profile.curves[1]![g]!,profile.curves[2]![b]!];return [0,1,2].map(row=>Math.round(Math.max(0,Math.min(1,encoded(m[row*3]!*values[0]!+m[row*3+1]!*values[1]!+m[row*3+2]!*values[2]!)))*255)) as [number,number,number];};
}
export function convertBitmapToSrgb(bitmap:Bitmap,profile:RgbProfile):Bitmap {const convert=rgbToSrgb(profile),data=bitmap.data.slice();for(let i=0;i<data.length;i+=4){const rgb=convert(data[i]!,data[i+1]!,data[i+2]!);data.set(rgb,i);}return {...bitmap,data};}
/** A small valid v4 matrix/TRC profile for explicit sRGB output. No embedded executable or external resources. */
export function srgbProfileBytes():Uint8Array {
 const blocks:{name:string;data:Uint8Array}[]=[],block=(name:string,type:string,size:number)=>{const data=new Uint8Array(size);data.set(new TextEncoder().encode(type));blocks.push({name,data});return new DataView(data.buffer);},write=(v:DataView,p:number,n:number)=>v.setInt32(p,Math.round(n*65536));
 for(const [i,name] of ['rXYZ','gXYZ','bXYZ'].entries()){const v=block(name,'XYZ ',20);for(let j=0;j<3;j++)write(v,8+j*4,srgb[j*3+i]!);}
 for(const name of ['rTRC','gTRC','bTRC']){const v=block(name,'para',40);v.setUint16(8,4);[2.4,1/1.055,.055/1.055,1/12.92,.04045,0,0].forEach((n,i)=>write(v,12+i*4,n));}
 const white=block('wtpt','XYZ ',20);[.9642,1,.8249].forEach((n,i)=>write(white,8+i*4,n));const adaptation=block('chad','sf32',44);d50.forEach((n,i)=>write(adaptation,8+i*4,n));
 for(const [name,text] of [['desc','Haiyue sRGB'],['cprt','Public domain color parameters']]){const v=block(name!,'mluc',28+text!.length*2);v.setUint32(8,1);v.setUint32(12,12);v.setUint16(16,0x656e);v.setUint16(18,0x5553);v.setUint32(20,text!.length*2);v.setUint32(24,28);for(let i=0;i<text!.length;i++)v.setUint16(28+i*2,text!.charCodeAt(i));}
 const header=new Uint8Array(132+blocks.length*12),v=new DataView(header.buffer);header.set([4,0x30,0,0],8);for(const [p,s] of [[12,'mntr'],[16,'RGB '],[20,'XYZ '],[36,'acsp'],[80,'HYUE']] as const)header.set(new TextEncoder().encode(s),p);[2026,1,1,0,0,0].forEach((n,i)=>v.setUint16(24+i*2,n));v.setUint32(64,1);[.9642,1,.8249].forEach((n,i)=>write(v,68+i*4,n));v.setUint32(128,blocks.length);let offset=header.length;const parts:Uint8Array[]=[header];blocks.forEach((b,i)=>{header.set(new TextEncoder().encode(b.name),132+i*12);v.setUint32(136+i*12,offset);v.setUint32(140+i*12,b.data.length);const padding=new Uint8Array((4-b.data.length%4)%4);parts.push(b.data,padding);offset+=b.data.length+padding.length;});v.setUint32(0,offset);return concatBytes(parts);
}
export function embeddedProfile(state:ImageState):Uint8Array|undefined {const block=resourceBlocks(state.psdOrigin?.resources??new Uint8Array()).find(b=>b.id===1039)?.bytes;if(!block)return;const name=block[6]!+1,p=6+name+name%2,n=new DataView(block.buffer,block.byteOffset).getUint32(p);return block.slice(p+4,p+4+n);}
export function profileResource(bytes:Uint8Array):Uint8Array {const out=new Uint8Array(12+bytes.length+bytes.length%2),v=new DataView(out.buffer);v.setUint32(0,0x3842494d);v.setUint16(4,1039);v.setUint32(8,bytes.length);out.set(bytes,12);return out;}
export function convertedLayers(state:ImageState,profile:RgbProfile):readonly ImageLayer[]{
 const convert=rgbToSrgb(profile),hex=(s:string)=>'#'+convert(parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)).map(n=>n.toString(16).padStart(2,'0')).join('');
 const visit=(layers:readonly ImageLayer[]):ImageLayer[]=>layers.map(layer=>{const c=layer.content;if(c?.type==='smart'&&c.sourcePsd)throw new Error('请先打开多层智能源，在源文档中转换颜色后回写。');if(c?.type==='adjustment'||layer.smartFilters?.length||layer.blendIf?.enabled)throw new Error('颜色转换前请将含调整层／智能滤镜／Blend If 的合成图打开为像素副本，避免改变调整语义。');const content=c?.type==='text'?{...c,color:hex(c.color),...(c.runs?{runs:c.runs.map(r=>({...r,...(r.color?{color:hex(r.color)}:{})}))}:{})}:c?.type==='shape'||c?.type==='path'?{...c,fill:c.fill?hex(c.fill):c.fill,stroke:hex(c.stroke)}:c?.type==='smart'?{...c,source:convertBitmapToSrgb(c.source,profile)}:c;
  const styles=layer.styles?{...layer.styles,...Object.fromEntries(['overlay','stroke','shadow'].flatMap(k=>{const effect=layer.styles![k as 'overlay'];return effect?[[k,{...effect,color:hex(effect.color)}]]:[];}))}:undefined;
  return {...layer,...(content?{content:content as NonNullable<ImageLayer['content']>}:{}),...(styles?{styles}:{}),bitmap:layer.bitmap?convertBitmapToSrgb(layer.bitmap,profile):null,children:visit(layer.children)};
 });return visit(state.layers);
}

/** Matrix/TRC source -> D50 PCS -> target, with inverse monotone TRC and explicit gamut clipping. */
export function profileTransform(source:RgbProfile,target:RgbProfile,exposure=0){
 const m=multiply(inverse(target.matrix),source.matrix),gain=2**exposure;
 const sample=(lut:Float64Array,v:number)=>{const x=v*(lut.length-1),i=Math.floor(x),f=x-i;return lut[i]!*(1-f)+lut[Math.min(i+1,lut.length-1)]!*f;};
 const encode=(lut:Float64Array,v:number)=>{if(v<=lut[0]!)return 0;if(v>=lut.at(-1)!)return 1;let lo=0,hi=lut.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(lut[mid]!<v)lo=mid;else hi=mid;}return (lo+(v-lut[lo]!)/(lut[hi]!-lut[lo]!))/(lut.length-1);};
 return (r:number,g:number,b:number)=>{const v=[r,g,b].map((n,i)=>sample(source.curves[i]!,n)*gain),linear=[0,1,2].map(i=>m[i*3]!*v[0]!+m[i*3+1]!*v[1]!+m[i*3+2]!*v[2]!);return {clipped:linear.some((v,i)=>v<target.curves[i]![0]!-1e-7||v>target.curves[i]!.at(-1)!+1e-7),values:linear.map((v,i)=>encode(target.curves[i]!,v))};};
}
