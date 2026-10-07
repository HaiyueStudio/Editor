import { ImageDocument, makeLayer } from '../dist/document.js';
import { importPsd } from '../dist/psdAdapter.js';
import { readFileSync } from 'node:fs';
export function bitmap(width,height,rgba) { const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4)data.set(rgba,i);return {width,height,data}; }
export function cases() {
  const result=[];
  for(const [width,height] of [[1,1],[1,32],[2,1],[17,9]]) {
    const doc=ImageDocument.create('透明 '+width+'×'+height,width,height);doc.addLayer(makeLayer('半透明',bitmap(width,height,[17,129,230,37])));result.push({id:`alpha-${width}x${height}`,state:doc.state});
  }
  const doc=ImageDocument.create('分组编辑',32,24);doc.addLayer(makeLayer('底色',bitmap(32,24,[50,100,180,255])));
  doc.addLayer({...makeLayer('组 Group',null,'group'),x:3,y:-2,opacity:0.47});doc.addLayer({...makeLayer('半透明 编辑',bitmap(7,6,[220,30,80,128])),x:2,y:5,blend:'multiply',locked:true});
  doc.select(doc.state.layers[1].id);doc.addLayer({...makeLayer('滤色',bitmap(6,5,[80,180,20,200])),x:-2,y:16,blend:'screen'});
  doc.addLayer({...makeLayer('隐藏',bitmap(2,2,[7,8,9,0])),visible:false});result.push({id:'group-edit',state:doc.state});
  for(const name of ['layers','layer-offsets-read']){const imported=importPsd(new Uint8Array(readFileSync(new URL(`./fixtures/${name}.psd`,import.meta.url))),name+'.psd');if(!imported.layered)throw new Error(imported.blockers.join('\n'));const d=new ImageDocument(imported.layered);d.updateLayer(d.selected.id,{name:'编辑后 图层',opacity:0.7});result.push({id:name+'-edited',state:d.state});}
  return result;
}
