import {makeLayer} from '../dist/document.js';
import {BLEND_MODES} from '../dist/layerFeatures.js';
export function cases(){
 const bitmap=(color)=>({width:8,height:8,data:Uint8ClampedArray.from({length:256},(_,i)=>color[i%4])});
 return Object.keys(BLEND_MODES).map(blend=>({id:'p5-'+blend,state:{id:'p5',name:'P5',width:8,height:8,selectedId:null,revision:0,layers:[makeLayer('背景',bitmap([60,140,220,255])),{...makeLayer('灰度蒙版',bitmap([190,80,120,255])),blend,mask:{width:8,height:8,x:0,y:0,data:Uint8Array.from({length:64},(_,i)=>(i%4)*85),disabled:false,defaultColor:0}}]}}));
}
