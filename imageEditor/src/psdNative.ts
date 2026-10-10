import { writeHighPsd } from './highDepthPsd.js';
import { readSmartSource } from './smartSource.js';
import { concatBytes, psdSections, rawCompositeData } from './psdResources.js';
import { readPsd, writePsdUint8Array, type Layer, type Psd, type Color, type BezierKnot, type LayerEffectsInfo, type LinkedFile } from 'ag-psd';
import { checkSize, uid, type ImageLayer } from './document.js';
import { validateContent, validateStyles, type LayerContent, type ShapeContent, type PathContent, type LayerStyles, type SmartContent, type Levels, type AdjustmentContent } from './layerFeatures.js';
const units=(value:number)=>({units:'Pixels' as const,value});
const rgb=(hex:string)=>({r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16)});
function hex(c:Color|undefined):string {if(!c||!('r' in c)||'a' in c&&c.a!==1)throw new Error('仅支持不透明 RGB 颜色。');return '#'+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');}
const near=(a:number,b:number)=>Math.abs(a-b)<.02;
export function shapeKnots(c:ShapeContent,x:number,y:number):BezierKnot[] {
 const pad=Math.min(c.strokeWidth/2,c.width/2,c.height/2),l=x+pad,t=y+pad,r=x+c.width-pad,b=y+c.height-pad,k=.5522847498307936;
 const knot=(ax:number,ay:number,ix=ax,iy=ay,ox=ax,oy=ay):BezierKnot=>({linked:true,points:[ix,iy,ax,ay,ox,oy]});
 if(c.shape==='line')return [knot(l,t),knot(r,b)];
 if(c.shape==='ellipse'){const cx=(l+r)/2,cy=(t+b)/2,rx=(r-l)/2,ry=(b-t)/2;return [knot(cx,t,cx-rx*k,t,cx+rx*k,t),knot(r,cy,r,cy-ry*k,r,cy+ry*k),knot(cx,b,cx+rx*k,b,cx-rx*k,b),knot(l,cy,l,cy+ry*k,l,cy-ry*k)];}
 const radius=Math.min(c.radius,(r-l)/2,(b-t)/2);if(!radius)return [knot(l,t),knot(r,t),knot(r,b),knot(l,b)];
 const a=radius*(1-k);return [knot(l+radius,t,l+a,t),knot(r-radius,t,r-radius,t,r-a,t),knot(r,t+radius,r,t+a),knot(r,b-radius,r,b-radius,r,b-a),knot(r-radius,b,r-a,b),knot(l+radius,b,l+radius,b,l+a,b),knot(l,b-radius,l,b-a),knot(l,t+radius,l,t+radius,l,t+a)];
}
function effects(styles:LayerStyles):LayerEffectsInfo {
 const s=styles.shadow;return {disabled:!styles.enabled,scale:1,
 ...(styles.overlay?{solidFill:[{enabled:true,present:true,blendMode:'normal',color:rgb(styles.overlay.color),opacity:styles.overlay.opacity}]}:{}),
 ...(styles.stroke?{stroke:[{enabled:true,present:true,fillType:'color',position:'outside',size:units(styles.stroke.size),color:rgb(styles.stroke.color),opacity:styles.stroke.opacity,blendMode:'normal'}]}:{}),
 ...(s?{dropShadow:[{enabled:true,present:true,blendMode:'normal',color:rgb(s.color),opacity:s.opacity,size:units(s.blur),distance:units(Math.hypot(s.dx,s.dy)),angle:Math.atan2(-s.dy,-s.dx)*180/Math.PI,useGlobalLight:false,choke:units(0),layerConceals:true}]}:{})};
}
export function readStyles(e:LayerEffectsInfo):LayerStyles {
 if(Object.keys(e).some(k=>!['disabled','scale','solidFill','stroke','dropShadow'].includes(k))||e.scale!==undefined&&!near(e.scale,1))throw new Error('仅支持颜色叠加、外描边和普通投影。');
 const result:LayerStyles={enabled:!e.disabled};
 for(const list of [e.solidFill,e.stroke,e.dropShadow])if(list&&(list.length!==1||list[0]!.blendMode&&list[0]!.blendMode!=='normal'||list[0]!.enabled===false))throw new Error('暂不支持多重、停用的单项或非正常混合样式。');
 if(e.solidFill){const f=e.solidFill[0]!;result.overlay={color:hex(f.color),opacity:f.opacity??1};}
 if(e.stroke){const f=e.stroke[0]!;if(f.position!=='outside'||f.fillType!=='color'||f.size?.units!=='Pixels'||!Number.isInteger(f.size.value))throw new Error('暂仅支持像素宽度的纯色外描边。');result.stroke={color:hex(f.color),opacity:f.opacity??1,size:Math.round(f.size.value)};}
 if(e.dropShadow){const f=e.dropShadow[0]!;if(f.useGlobalLight||f.choke?.value||(f as unknown as Record<string,unknown>).noise||f.antialiased||f.layerConceals===false||f.contour?.curve.length&&!(f.contour.curve.length===2&&f.contour.curve[0]?.x===0&&f.contour.curve[0]?.y===0&&f.contour.curve[1]?.x===255&&f.contour.curve[1]?.y===255)||f.size?.units!=='Pixels'||f.distance?.units!=='Pixels')throw new Error('暂不支持全局光、扩展或自定义轮廓投影。');const angle=(f.angle??0)*Math.PI/180,d=f.distance.value;if(!Number.isInteger(f.size.value)||!near(-Math.cos(angle)*d,Math.round(-Math.cos(angle)*d))||!near(-Math.sin(angle)*d,Math.round(-Math.sin(angle)*d)))throw new Error('投影需要整数像素偏移和模糊半径。');result.shadow={color:hex(f.color),opacity:f.opacity??1,blur:Math.round(f.size.value),dx:Math.round(-Math.cos(angle)*d),dy:Math.round(-Math.sin(angle)*d)};}
 validateStyles(result);return result;
}

export function nativeFields(layer:ImageLayer,x:number,y:number,linked:LinkedFile[]):Partial<Layer> {
 const c=layer.content,result:Partial<Layer>={clipping:Boolean(layer.clipping),...(layer.styles?{effects:effects(layer.styles)}:{})};
 if(!c)return result;
 if(c.type==='text'){
  const pad=Math.ceil(c.size*.5),anchor=c.align==='left'?pad:c.align==='right'?layer.bitmap!.width-pad:layer.bitmap!.width/2;
  result.text={text:c.text,transform:[1,0,0,1,x+anchor,y+pad+c.size*.8],left:0,top:0,right:layer.bitmap!.width,bottom:layer.bitmap!.height,orientation:'horizontal',shapeType:'point',pointBase:[0,0],antiAlias:'smooth',style:{font:{name:c.fontName??(c.family==='serif'?'TimesNewRomanPSMT':c.family==='monospace'?'CourierNewPSMT':'ArialMT')},fontSize:c.size,fauxBold:c.bold,fauxItalic:c.italic,fillColor:rgb(c.color),autoLeading:false,leading:c.size*1.4},paragraphStyle:{justification:c.align}};
 }else if(c.type==='path'){
  result.vectorFill={type:'color',color:rgb(c.fill??'#000000')};result.vectorMask={paths:[{open:!c.closed,operation:'combine',fillRule:c.fillRule==='evenodd'?'even-odd':'non-zero',knots:c.nodes.map(n=>({linked:false,points:[x+n.inX,y+n.inY,x+n.x,y+n.y,x+n.outX,y+n.outY]}))}]};result.vectorStroke={strokeEnabled:c.strokeWidth>0,fillEnabled:!!c.fill,lineWidth:units(c.strokeWidth),lineAlignment:'center',lineCapType:'butt',lineJoinType:'miter',opacity:1,blendMode:'normal',content:{type:'color',color:rgb(c.stroke)}};
 }else if(c.type==='shape'){
  result.vectorFill={type:'color',color:rgb(c.fill)};result.vectorMask={paths:[{open:c.shape==='line',operation:'combine',fillRule:'non-zero',knots:shapeKnots(c,x,y)}]};
  result.vectorStroke={strokeEnabled:c.strokeWidth>0,fillEnabled:c.shape!=='line',lineWidth:units(c.strokeWidth),lineAlignment:'center',lineCapType:'butt',lineJoinType:'miter',opacity:1,blendMode:'normal',content:{type:'color',color:rgb(c.stroke)}};
 }else if(c.type==='adjustment'){
  if(c.filter==='levels'){const record=(l:Levels)=>({shadowInput:l.black,highlightInput:l.white,midtoneInput:l.gamma,shadowOutput:l.outputBlack,highlightOutput:l.outputWhite});result.adjustment={type:'levels',rgb:record(c.levels!),...Object.fromEntries(Object.entries(c.channels??{}).map(([k,v])=>[k,record(v.levels!)]))};}
  else if(c.filter==='curves')result.adjustment={type:'curves',rgb:c.curves!.map(p=>({...p})),...Object.fromEntries(Object.entries(c.channels??{}).map(([k,v])=>[k,v.curves!.map(p=>({...p}))]))};
  else if(c.filter==='invert'&&c.amount===100)result.adjustment={type:'invert'};
 }else{
  const t=c.transform,angle=t.angle*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),cx=x+layer.bitmap!.width/2,cy=y+layer.bitmap!.height/2;
  const corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].flatMap(([a,b])=>{const dx=a!*t.width*(t.flipX?-1:1),dy=b!*t.height*(t.flipY?-1:1);return [cx+dx*cos-dy*sin,cy+dx*sin+dy*cos];});
  // Each placed instance receives its own ID; duplicated sources may be independently replaced.
  const placedId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(layer.id)?layer.id:uid();
  result.placedLayer={id:placedId,type:'raster',warp:{style:'none'},width:c.source.width,height:c.source.height,transform:corners,resolution:{units:'Density',value:72}};
  const sourcePsd={width:c.source.width,height:c.source.height,children:[{name:c.name,imageData:c.source}],imageData:c.source};
  const embedded=c.sourcePsd??((c.source.depth??8)!==8?writeHighPsd(sourcePsd,c.source.depth as 16|32):writePsdUint8Array({width:c.source.width,height:c.source.height,children:[{name:c.name,imageData:c.source}],imageData:c.source},{noBackground:true,compress:true}));
  linked.push({id:placedId,name:c.name+'.psd',type:'8BPS',data:c.sourcePsd?(readSmartSource(c.sourcePsd,c.name),embedded):c.source.depth?embedded:concatBytes([embedded.subarray(0,psdSections(embedded).composite),rawCompositeData(embedded,c.source)])});
 }
 return result;
}
export function readNativeContent(layer:Layer,psd:Psd):LayerContent|undefined {
 let result:LayerContent|undefined;
 const present=[layer.text,layer.vectorMask||layer.vectorFill||layer.vectorStroke,layer.adjustment,layer.placedLayer].filter(Boolean);if(present.length>1)throw new Error('同一层包含多种原生内容，暂不能编辑。');
 if(layer.adjustment){const a=layer.adjustment;
  if(a.type==='invert')result={type:'adjustment',filter:'invert',amount:100};
  else if(a.type==='levels'||a.type==='curves'){
   const neutral={black:0,white:255,gamma:1,outputBlack:0,outputWhite:255},line=[{input:0,output:0},{input:255,output:255}];
   const levels=(l:{shadowInput:number;highlightInput:number;midtoneInput:number;shadowOutput:number;highlightOutput:number}|undefined):Levels=>l?{black:l.shadowInput,white:l.highlightInput,gamma:l.midtoneInput,outputBlack:l.shadowOutput,outputWhite:l.highlightOutput}:neutral;
   const channels:NonNullable<AdjustmentContent['channels']>={};
   if(a.type==='levels'){result={type:'adjustment',filter:'levels',amount:100,levels:levels(a.rgb)};for(const k of ['red','green','blue'] as const){const l=levels(a[k]);if(JSON.stringify(l)!==JSON.stringify(neutral))channels[k]={levels:l};}}
   else {result={type:'adjustment',filter:'curves',amount:100,curves:a.rgb??line};for(const k of ['red','green','blue'] as const)if(a[k]&&JSON.stringify(a[k])!==JSON.stringify(line))channels[k]={curves:a[k]!};}
   if(Object.keys(channels).length)result.channels=channels;
  }else throw new Error('此 Photoshop 调整类型暂未实现原生合成。');
 }else if(layer.text){const t=layer.text,s=t.style??{},matrix=t.transform??[1,0,0,1,0,0];
  if(t.textPath||t.orientation==='vertical'||t.shapeType==='box'||t.warp?.style&&t.warp.style!=='none'||!matrix.slice(0,4).every((v,i)=>near(v,[1,0,0,1][i]!))||t.styleRuns?.some(r=>Object.keys(r.style).length)||t.paragraphStyleRuns?.some(r=>Object.keys(r.style).length))throw new Error('当前仅支持未变形的统一样式点文字。');
  if(s.underline||s.strikethrough||s.tracking||s.baselineShift||s.strokeFlag||s.horizontalScale&&s.horizontalScale!==1||s.verticalScale&&s.verticalScale!==1)throw new Error('文字包含尚未支持的排版样式。');
  const size=s.fontSize??12,pad=Math.ceil(size*.5),align=t.paragraphStyle?.justification??'left',anchor=align==='left'?pad:align==='right'?(layer.imageData?.width??0)-pad:(layer.imageData?.width??0)/2;
  if(!near(matrix[4]!, (layer.left??0)+anchor)||!near(matrix[5]!, (layer.top??0)+pad+size*.8)||s.autoLeading!==false||!near(s.leading??0,size*1.4)||['firstLineIndent','startIndent','endIndent','spaceBefore','spaceAfter'].some(k=>Boolean((t.paragraphStyle as Record<string,unknown>|undefined)?.[k])))throw new Error('文字使用自定义原点／行距／段落缩进，暂不转换为基础点文字。');
  const name=s.font?.name??'ArialMT';result={type:'text',text:t.text,size:s.fontSize??12,family:/Times|Serif/i.test(name)?'serif':/Courier|Mono/i.test(name)?'monospace':'sans-serif',fontName:name,bold:s.fauxBold??false,italic:s.fauxItalic??false,align:(t.paragraphStyle?.justification??'left') as 'left',color:hex(s.fillColor??{r:0,g:0,b:0})};
 }else if(layer.vectorMask||layer.vectorFill||layer.vectorStroke){
  const paths=layer.vectorMask?.paths,stroke=layer.vectorStroke;
  if(!paths||paths.length!==1||layer.vectorMask?.disable||layer.vectorMask?.invert||layer.vectorMask?.fillStartsWithAllPixels||layer.vectorFill?.type!=='color'||stroke?.lineDashSet?.length||stroke?.lineCapType&&stroke.lineCapType!=='butt'||stroke?.lineJoinType&&stroke.lineJoinType!=='miter'||stroke?.lineAlignment&&stroke.lineAlignment!=='center'||stroke?.opacity!==undefined&&stroke.opacity!==1||stroke?.blendMode&&stroke.blendMode!=='normal')throw new Error('当前仅支持纯色基础形状路径。');
  const path=paths[0]!,b=layer.imageData;if(!b||path.operation&&path.operation!=='combine')throw new Error('形状缺少像素缓存或含复合路径。');
  const size=stroke?.strokeEnabled?stroke.lineWidth?.value??0:0,x=layer.left??0,y=layer.top??0;
  if(stroke?.lineWidth&&stroke.lineWidth.units!=='Pixels')throw new Error('描边必须使用像素单位。');
  const candidate:ShapeContent={type:'shape',shape:path.open?'line':path.knots.length===8?'rectangle':path.knots.some(k=>!near(k.points[0]!,k.points[2]!)||!near(k.points[1]!,k.points[3]!))?'ellipse':'rectangle',width:b.width,height:b.height,radius:0,fill:hex(layer.vectorFill.color),stroke:stroke?.content?.type==='color'?hex(stroke.content.color):'#000000',strokeWidth:size};
  if(path.knots.length===8)candidate.radius=path.knots[0]!.points[2]!-x-Math.min(size/2,b.width/2,b.height/2);
  const expected=shapeKnots(candidate,x,y);if(path.knots.some(k=>!k.linked)||expected.length!==path.knots.length||expected.some((k,i)=>k.points.some((n,j)=>!near(n,path.knots[i]!.points[j]!)))){result={type:'path',width:b.width,height:b.height,closed:!path.open,fill:stroke?.fillEnabled===false?null:hex(layer.vectorFill.color),stroke:candidate.stroke,strokeWidth:size,fillRule:path.fillRule==='even-odd'?'evenodd':'nonzero',nodes:path.knots.map(k=>({inX:k.points[0]!-x,inY:k.points[1]!-y,x:k.points[2]!-x,y:k.points[3]!-y,outX:k.points[4]!-x,outY:k.points[5]!-y}))} as PathContent;}else result=candidate;
 }else if(layer.placedLayer){const p=layer.placedLayer,file=psd.linkedFiles?.find(f=>f.id===p.id);
  if(p.type!=='raster'||p.filter||p.nonAffineTransform||p.warp?.style&&p.warp.style!=='none'||!file?.data||file.linkedFile||file.data.byteLength>64*1024*1024)throw new Error('仅支持无滤镜／透视的嵌入式像素 PSD 智能对象。');
  const embeddedState=readSmartSource(file.data,file.name),source=embeddedState.bitmap;
  const q=p.transform;if(q.length!==8||!q.every(Number.isFinite))throw new Error('智能对象变换无效。');const ax=q[2]!-q[0]!,ay=q[3]!-q[1]!,bx=q[6]!-q[0]!,by=q[7]!-q[1]!,width=Math.round(Math.hypot(ax,ay)),height=Math.round(Math.hypot(bx,by));
  if(!near(q[4]!,q[0]!+ax+bx)||!near(q[5]!,q[1]!+ay+by)||Math.abs(ax*bx+ay*by)>.02)throw new Error('智能对象透视／斜切暂不支持。');
  result={type:'smart',sourceId:p.id,name:file.name.replace(/\.psd$/i,'').slice(0,160),source:{...source,data:source.data.slice()},...(embeddedState.simple?{}:{sourcePsd:file.data.slice()}),transform:{width,height,angle:Math.atan2(ay,ax)*180/Math.PI,flipX:false,flipY:ax*by-ay*bx<0}};
 }
 if(result)validateContent(result);return result;
}
