/** Geometry is independent of decoded working sets and GPU texture dimensions. */
export const DOCUMENT_DIMENSION = 30_000;
export const DENSE_PIXEL_LIMIT = 16_777_216;
export const DENSE_BYTE_LIMIT = 128 * 1024 * 1024;
interface TiledGeometry {width:number;height:number;bitDepth?:number;bitsPerChannel?:number;depth?:number;colorMode?:string|number;layers?:readonly {bitmap?:{width:number;height:number}|null;mask?:{coverage?:unknown;samples?:unknown};filterMask?:{coverage?:unknown;samples?:unknown};children:readonly unknown[]}[]}
export const needsTiledView = (s:TiledGeometry):boolean => s.width>8192 || s.height>8192 || s.width*s.height>DENSE_PIXEL_LIMIT || s.width*s.height*(((s.bitDepth??s.bitsPerChannel??s.depth??8)===8?4:16)+(s.colorMode==='cmyk'?16:0))>DENSE_BYTE_LIMIT || !!s.layers?.some(l=>!!l.bitmap&&needsTiledView(l.bitmap)||!!l.mask?.samples||!!l.filterMask?.samples||!!l.mask?.coverage||!!l.filterMask?.coverage||needsTiledView({width:1,height:1,layers:l.children as NonNullable<TiledGeometry['layers']>}));
export function checkDenseAllocation(width:number,height:number,bytesPerPixel=4){
 if(width*height>DENSE_PIXEL_LIMIT||width*height*bytesPerPixel>DENSE_BYTE_LIMIT)throw Error('此尺寸的操作需要整图像素，超过工作集预算；大图请使用分块区域接口。');
}
