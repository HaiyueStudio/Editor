import type { Bitmap, ImageState } from './document.js';
import { sampleBitmap } from './dailyEditing.js';
import { selectionWeight, type Selection } from './selection.js';
export function bitmapHistogram(bitmap:Bitmap,selection?:Selection|null) {
 const red=Array<number>(256).fill(0),green=red.slice(),blue=red.slice(),luminance=red.slice();let weight=0,pixels=0,sum=0,squares=0;
 for(let y=0;y<bitmap.height;y++)for(let x=0;x<bitmap.width;x++){const i=(y*bitmap.width+x)*4,w=bitmap.data[i+3]!/255*selectionWeight(selection,x,y);if(!w)continue;const r=bitmap.data[i]!,g=bitmap.data[i+1]!,b=bitmap.data[i+2]!,l=Math.round(.2126*r+.7152*g+.0722*b);red[r]!+=w;green[g]!+=w;blue[b]!+=w;luminance[l]!+=w;weight+=w;pixels++;sum+=l*w;squares+=l*l*w;}
 const mean=weight?sum/weight:0;let median=0,total=0;if(weight)for(let i=0;i<256;i++){total+=luminance[i]!;if(total>=weight/2){median=i;break;}}
 return {red,green,blue,luminance,pixels,weight,mean,median,deviation:weight?Math.sqrt(Math.max(0,squares/weight-mean*mean)):0};
}
export type Histogram = ReturnType<typeof bitmapHistogram>;
export function documentHistogram(state:ImageState,layerId?:string,selection=false):Histogram {return bitmapHistogram(sampleBitmap(state,layerId),selection?state.selection:null);}
