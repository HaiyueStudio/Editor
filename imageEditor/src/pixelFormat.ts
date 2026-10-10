import { isPaged, hydrateBitmap, validatePages } from './pagedPixels.js';
import { validateMask } from './maskEffects.js';
import type { LayerMask } from './layerFeatures.js';
import type { Bitmap, ImageLayer, ImageState } from './document.js';
export type BitDepth=8|16|32;
export type PixelArray=Uint8ClampedArray|Float32Array;
export interface DisplaySettings {output?:'auto'|'sdr'|'hdr';exposure:number;operator:'clip'|'reinhard'|'aces'}
export const decodeSrgb=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
export const encodeSrgb=(v:number)=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;
export const depthOf=(b:Bitmap|undefined|null):BitDepth=>b?.depth??8;
export const pixelArray=(length:number,source?:Bitmap|BitDepth):PixelArray=>(typeof source==='number'?source:depthOf(source))===8?new Uint8ClampedArray(length):new Float32Array(length);
export const withPixels=(width:number,height:number,data:PixelArray,source?:Bitmap|BitDepth):Bitmap=>{const depth=typeof source==='number'?source:depthOf(source);return {width,height,data,...(depth!==8?{depth}: {})};};
export function pixelColor(rgb:readonly number[],depth:BitDepth){return rgb.map(v=>depth===32?decodeSrgb(v/255)*255:v);}
export function validateBitmap(b:Bitmap){
 if(isPaged(b)){validatePages(b);return;}
 const depth=depthOf(b);if(![8,16,32].includes(depth)||b.data.length!==b.width*b.height*4||!(depth===8?b.data instanceof Uint8ClampedArray:b.data instanceof Float32Array))throw new Error('像素数据不完整或格式与位深不一致。');
 if(depth!==8)for(let i=0;i<b.data.length;i++){const n=b.data[i]!;if(!Number.isFinite(n)||Math.abs(n)>255*65504||(i%4===3&&(n<0||n>255))||(depth===16&&(n<0||n>255)))throw new Error('高位深像素值无效。');}
}
export function convertDepth(b:Bitmap,depth:BitDepth):Bitmap {
 if(depthOf(b)===depth)return b;
 validateBitmap(b);
 const old=depthOf(b),data=pixelArray(b.data.length,depth);for(let i=0;i<data.length;i++){let n=b.data[i]!;if(i%4!==3){if(old===32&&depth!==32)n=encodeSrgb(Math.max(0,n/255))*255;else if(old!==32&&depth===32)n=decodeSrgb(n/255)*255;}data[i]=depth===16?Math.round(Math.max(0,Math.min(255,n))*257)/257:n;}
 return {...withPixels(b.width,b.height,data,depth),...(b.cmyk?{cmyk:Float32Array.from(b.cmyk,v=>Math.round(v/100*(depth===8?255:65535))/(depth===8?255:65535)*100)}:{})};
}
const bounded=new WeakMap<Bitmap,Bitmap>();
function bound16(b:Bitmap):Bitmap {if(depthOf(b)!==16||b.pages?.kind==='disk')return b;const cached=bounded.get(b);if(cached)return cached;if(b.data.some(n=>!Number.isFinite(n)))throw Error('高位深像素值无效。');let out=b;for(let i=0;i<b.data.length;i++){const n=b.data[i]!;if(!Number.isFinite(n))throw Error('高位深像素值无效。');if(n<0||n>255){const data=b.data.slice();for(let j=0;j<data.length;j++)data[j]=Math.max(0,Math.min(255,data[j]!));out={...b,data};break;}}bounded.set(b,out);return out;}
export function normalizeLayers(layers:readonly ImageLayer[],depth:BitDepth):readonly ImageLayer[]{let changed=false;const next=layers.map(l=>{const mask=l.mask?normalizeMask(l.mask,depth):undefined,filterMask=l.filterMask?normalizeMask(l.filterMask,depth):undefined;const bitmap=l.bitmap?bound16(convertDepth(hydrateBitmap(l.bitmap),depth)):null,c=l.content,source=c?.type==='smart'?bound16(convertDepth(c.source,depth)):undefined,content=c?.type==='smart'&&source!==c.source?{...c,source:source!}:c,children=normalizeLayers(l.children,depth);if(mask===l.mask&&filterMask===l.filterMask&&bitmap===l.bitmap&&content===c&&children===l.children)return l;changed=true;return {...l,...(mask?{mask}:{}),...(filterMask?{filterMask}:{}),bitmap,...(content?{content}:{}),children};});return changed?next:layers;}
export function displayBitmap(b:Bitmap,settings:DisplaySettings={exposure:0,operator:'clip'}):Bitmap {
 if(depthOf(b)===8)return b;const data=new Uint8ClampedArray(b.data.length),gain=2**settings.exposure;
 for(let i=0;i<data.length;i++){let n=b.data[i]!/255;if(i%4!==3&&depthOf(b)===32){n=Math.max(0,n*gain);if(settings.operator==='reinhard')n=n/(1+n);else if(settings.operator==='aces')n=(n*(2.51*n+.03))/(n*(2.43*n+.59)+.14);n=encodeSrgb(n);}data[i]=n*255;}return {width:b.width,height:b.height,data};
}
/** Portable little-endian samples; internal float samples retain the established 0..255 unit convention. */
export function pixelBytesView(b:Bitmap):Uint8Array {
 if(depthOf(b)===8)return new Uint8Array(b.data.buffer,b.data.byteOffset,b.data.byteLength);
 const data=new Uint8Array(b.data.length*4),v=new DataView(data.buffer);for(let i=0;i<b.data.length;i++)v.setFloat32(i*4,b.data[i]!,true);return data;
}
export function pixelsFromBytes(bytes:Uint8Array,depth:BitDepth):PixelArray {
 if(depth===8)return new Uint8ClampedArray(bytes);if(bytes.length%4)throw new Error('浮点像素字节长度无效。');const data=new Float32Array(bytes.length/4),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=0;i<data.length;i++)data[i]=v.getFloat32(i*4,true);return data;
}

/** External resources use conventional unsigned 16-bit or normalized float samples. */
export function exportPixelResource(b:Bitmap){if(b.cmyk){const bytes=new Uint8Array(b.width*b.height*20),v=new DataView(bytes.buffer);for(let i=0;i<b.width*b.height;i++){for(let c=0;c<4;c++)v.setFloat32((i*5+c)*4,b.cmyk[i*4+c]!,true);v.setFloat32((i*5+4)*4,b.data[i*4+3]!/255,true);}return {bytes,format:"cmyka32fle"};}const depth=depthOf(b),bytes=new Uint8Array(b.data.length*depth/8),v=new DataView(bytes.buffer);for(let i=0;i<b.data.length;i++){if(depth===8)bytes[i]=b.data[i]!;else if(depth===16)v.setUint16(i*2,Math.round(b.data[i]!*257),true);else v.setFloat32(i*4,b.data[i]!/255,true);}return {bytes,format:depth===8?'rgba8':depth===16?'rgba16le':'rgba32fle'};}
export function importPixelResource(bytes:Uint8Array,width:number,height:number,format:string):Bitmap{if(format==='cmyka32fle'){if(bytes.length!==width*height*20)throw Error('CMYKA32FLE 资源尺寸不符。');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),data=new Float32Array(width*height*4),cmyk=new Float32Array(data.length);for(let i=0;i<width*height;i++){for(let c=0;c<4;c++){const n=v.getFloat32((i*5+c)*4,true);if(!Number.isFinite(n)||n<0||n>100)throw Error('油墨必须为 0–100%。');cmyk[i*4+c]=n;}const a=v.getFloat32((i*5+4)*4,true);if(!Number.isFinite(a)||a<0||a>1)throw Error('透明度必须为 0–1。');for(let c=0;c<3;c++)data[i*4+c]=(1-cmyk[i*4+c]!/100)*(1-cmyk[i*4+3]!/100)*255;data[i*4+3]=a*255;}return {width,height,depth:16,data,cmyk};}if(!['rgba8','rgba16le','rgba32fle'].includes(format))throw Error('未知像素格式。');const depth:BitDepth=format==='rgba8'?8:format==='rgba16le'?16:32;if(bytes.length!==width*height*4*depth/8)throw Error('像素资源长度不匹配。');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),data=depth===8?new Uint8ClampedArray(bytes):Float32Array.from({length:width*height*4},(_,i)=>depth===16?v.getUint16(i*2,true)/257:v.getFloat32(i*4,true)*255),b=withPixels(width,height,data,depth);validateBitmap(b);return b;}

function normalizeMask(mask:LayerMask,depth:BitDepth):LayerMask {validateMask(mask);if(depth===8&&mask.data instanceof Float32Array){const {precision,...rest}=mask;return {...rest,data:Uint8Array.from(mask.data,v=>Math.round(v))};}if(depth!==8&&mask.data instanceof Uint8Array)return {...mask,precision:'float32',data:Float32Array.from(mask.data)};return mask.data instanceof Float32Array&&mask.precision!=='float32'?{...mask,precision:'float32'}:mask;}
export function maskBytes(data:Uint8Array|Float32Array):Uint8Array {if(data instanceof Uint8Array)return data;return pixelBytesView(withPixels(data.length,1,data,16));}
export function decodeMaskBytes(data:Uint8Array,float:boolean):Uint8Array|Float32Array {return float?pixelsFromBytes(data,16) as Float32Array:data;}

export function sampleHex(rgba:readonly number[],state:Pick<ImageState,'bitDepth'|'display'>):string{const depth=state.bitDepth??8,data=pixelArray(4,depth);data.set(rgba);return '#'+Array.from(displayBitmap(withPixels(1,1,data,depth),state.display).data.slice(0,3)).map(v=>v.toString(16).padStart(2,'0')).join('');}
