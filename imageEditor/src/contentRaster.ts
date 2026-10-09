import { rasterRichText } from './richText.js';
import { checkSize, type Bitmap } from './document.js';
import { validateContent, type TextContent, type PathContent, type ShapeContent } from './layerFeatures.js';
export function rasterContent(content:TextContent|ShapeContent|PathContent):Bitmap {
 validateContent(content);const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
 if(content.type==='path'){
  checkSize(content.width,content.height);canvas.width=content.width;canvas.height=content.height;const p=content.nodes;ctx.beginPath();ctx.moveTo(p[0]!.x,p[0]!.y);for(let i=1;i<p.length;i++){const a=p[i-1]!,b=p[i]!;ctx.bezierCurveTo(a.outX,a.outY,b.inX,b.inY,b.x,b.y);}if(content.closed){const a=p.at(-1)!,b=p[0]!;ctx.bezierCurveTo(a.outX,a.outY,b.inX,b.inY,b.x,b.y);ctx.closePath();}if(content.fill){ctx.fillStyle=content.fill;ctx.fill(content.fillRule);}if(content.strokeWidth){ctx.strokeStyle=content.stroke;ctx.lineWidth=content.strokeWidth;ctx.stroke();}
 }else if(content.type==='text'&&(content.runs?.length||content.wrapWidth)){rasterRichText(canvas,content);
 }else if(content.type==='text'){
  const font=`${content.italic?'italic ':''}${content.bold?'bold ':''}${content.size}px ${content.fontName?'"'+content.fontName+'", ':''}${content.family}`,lines=content.text.split('\n'),padding=Math.ceil(content.size*.5);
  ctx.font=font;const width=Math.max(1,Math.ceil(Math.max(...lines.map(line=>ctx.measureText(line).width)))+padding*2),height=Math.ceil(lines.length*content.size*1.4+padding*2);checkSize(width,height);
  canvas.width=width;canvas.height=height;ctx.font=font;ctx.textBaseline='top';ctx.textAlign=content.align;ctx.fillStyle=content.color;
  const x=content.align==='left'?padding:content.align==='right'?width-padding:width/2;lines.forEach((line,i)=>ctx.fillText(line,x,padding+i*content.size*1.4));
 }else{
  checkSize(content.width,content.height);canvas.width=content.width;canvas.height=content.height;const pad=Math.min(content.strokeWidth/2,content.width/2,content.height/2),w=content.width-pad*2,h=content.height-pad*2;
  ctx.fillStyle=content.fill;ctx.strokeStyle=content.stroke;ctx.lineWidth=content.strokeWidth;ctx.beginPath();
  if(content.shape==='ellipse')ctx.ellipse(content.width/2,content.height/2,w/2,h/2,0,0,Math.PI*2);
  else if(content.shape==='line'){ctx.moveTo(pad,pad);ctx.lineTo(content.width-pad,content.height-pad);}
  else ctx.roundRect(pad,pad,w,h,Math.min(content.radius,w/2,h/2));
  if(content.shape!=='line')ctx.fill();if(content.strokeWidth)ctx.stroke();
 }
 const result={width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};canvas.width=canvas.height=1;return result;
}
