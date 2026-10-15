import type {Layer,LayerTextData,TextStyle} from 'ag-psd';
import type {TextContent,TextRun} from './layerFeatures.js';
import {validateContent} from './layerFeatures.js';
import {textStyles,compressRuns} from './richText.js';
const family=(name:string):TextContent['family']=>/Times|Serif/i.test(name)?'serif':/Courier|Mono/i.test(name)?'monospace':'sans-serif';
const hex=(c:TextStyle['fillColor'])=>{if(c&&(!('r' in c)||'a' in c&&c.a!==1))throw Error('文字颜色需要不透明 RGB。');return '#'+(c&&'r' in c?[c.r,c.g,c.b]:[0,0,0]).map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');};
function style(s:TextStyle):Omit<TextRun,'start'|'end'> {
 if(s.baselineShift||s.strokeFlag||s.strikethrough||s.horizontalScale&&s.horizontalScale!==1||s.verticalScale&&s.verticalScale!==1)throw Error('此文字样式尚未支持。');
 const name=s.font?.name??'ArialMT';return {fontName:name,family:family(name),size:s.fontSize??12,bold:!!s.fauxBold||/Bold/i.test(name),italic:!!s.fauxItalic||/Italic|Oblique/i.test(name),color:hex(s.fillColor),...(s.underline?{underline:true}:{})};
}
export function readEditableText(t:LayerTextData,l:Layer):TextContent {
 const m=t.transform??[1,0,0,1,0,0],s=t.style??{},base=style(s),path=t.textPath as {data?:{textRange?:number[]}}|undefined,box=t.shapeType==='box'?t.boxBounds:undefined;
 if(t.orientation==='vertical'||t.warp?.style&&t.warp.style!=='none'||m.length!==6||!m.every(Number.isFinite)||Math.abs(m[0]!*m[3]!-m[1]!*m[2]!)<1e-6||t.paragraphStyleRuns?.some(r=>Object.keys(r.style).length)||path&&!['[-1,-1]','[-2,-2]'].includes(JSON.stringify(path.data?.textRange)))throw Error('此文字方向／变形／段落或沿路径排版尚未支持。');
 if(t.shapeType==='box'&&(!box||box.length!==4||box.some(n=>!Number.isFinite(n))||box[2]!<=box[0]!||box[3]!<=box[1]!))throw Error('文字框无效。');
 const align=t.paragraphStyle?.justification??'left';if(!['left','center','right'].includes(align))throw Error('此文字对齐方式尚未支持。');
 const advanced=!!box||Math.abs(m[1]!)>.0001||Math.abs(m[2]!)>.0001||m[0]!<=0||m[3]!<=0;
 const c:TextContent={type:'text',text:t.text,size:base.size!,family:base.family!,fontName:base.fontName!,bold:base.bold!,italic:base.italic!,align:align as TextContent['align'],color:base.color!,layout:{x:m[4]!-(l.left??0),y:m[5]!-(l.top??0),leading:s.autoLeading!==false?(s.fontSize??12)*(t.paragraphStyle?.autoLeading??1.2):s.leading??(s.fontSize??12)*1.4,width:(l.right??0)-(l.left??0),height:(l.bottom??0)-(l.top??0),...(advanced?{transform:[m[0]!,m[1]!,m[2]!,m[3]!]}:{...(m[0]!==1?{scaleX:m[0]}:{}),...(m[3]!==1?{scaleY:m[3]}:{})}),...(box?{box:[...box]}:{}),...(s.tracking?{tracking:s.tracking}:{}),...Object.fromEntries(['firstLineIndent','startIndent','endIndent','spaceBefore','spaceAfter'].map(k=>[k,(t.paragraphStyle as Record<string,unknown>|undefined)?.[k]??0]))}};
 let at=0;const runs:TextRun[]=[];for(const r of t.styleRuns??[]){if(!Number.isInteger(r.length)||r.length<0)throw Error('文字样式长度无效。');const end=Math.min(t.text.length,at+r.length);if(end>at)runs.push({start:at,end,...style({...s,...r.style})});at+=r.length;}if(runs.length)c.runs=compressRuns(textStyles({...c,runs}));validateContent(c);return c;
}
export function writeEditableText(c:TextContent,t:LayerTextData,x:number,y:number):LayerTextData {
 if(t.style){t.style.fauxBold=c.bold&&!/Bold/i.test(c.fontName??'');t.style.fauxItalic=c.italic&&!/Italic|Oblique/i.test(c.fontName??'');}
 const l=c.layout!;t.transform=[...(l.transform??[l.scaleX??1,0,0,l.scaleY??1]),x+l.x,y+l.y];
 if(l.box){t.shapeType='box';t.boxBounds=[...l.box];delete t.pointBase;}
 t.paragraphStyle={...t.paragraphStyle,firstLineIndent:l.firstLineIndent??0,startIndent:l.startIndent??0,endIndent:l.endIndent??0,spaceBefore:l.spaceBefore??0,spaceAfter:l.spaceAfter??0};
 if(c.runs?.length){const styles=textStyles(c),runs:NonNullable<LayerTextData['styleRuns']>=[];for(let at=0;at<c.text.length;){let end=at+1;while(end<c.text.length&&JSON.stringify(styles[at])===JSON.stringify(styles[end]))end++;const s={...c,...styles[at]},color=s.color;t.styleRuns??=[];runs.push({length:end-at,style:{font:{name:s.fontName??(s.family==='serif'?'TimesNewRomanPSMT':s.family==='monospace'?'CourierNewPSMT':'ArialMT')},fontSize:s.size,fauxBold:s.bold&&!/Bold/i.test(s.fontName??''),fauxItalic:s.italic&&!/Italic|Oblique/i.test(s.fontName??''),underline:!!s.underline,fillColor:{r:parseInt(color.slice(1,3),16),g:parseInt(color.slice(3,5),16),b:parseInt(color.slice(5,7),16)}}});at=end;}t.styleRuns=runs;}
 return t;
}
