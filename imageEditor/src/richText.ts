import type { TextContent, TextRun } from './layerFeatures.js';
export type RunStyle=Omit<TextRun,'start'|'end'>;
const same=(a:RunStyle,b:RunStyle)=>a===b||JSON.stringify(a)===JSON.stringify(b);
const graphemeSegmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'}),wordSegmenter=new Intl.Segmenter(undefined,{granularity:'word'});
export function textStyles(content:TextContent):RunStyle[]{const styles:RunStyle[]=Array(content.text.length).fill({});for(const r of content.runs??[]){const {start,end,...style}=r;for(let i=start;i<end;i++)styles[i]=style;}return styles;}
export function compressRuns(styles:readonly RunStyle[]):TextRun[]{const runs:TextRun[]=[];for(let i=0;i<styles.length;){let end=i+1;while(end<styles.length&&same(styles[i]!,styles[end]!))end++;if(Object.keys(styles[i]!).length)runs.push({start:i,end,...styles[i]!});i=end;}if(runs.length>128)throw new Error('富文本最多包含 128 个样式片段。');return runs;}
export function formatRange(content:TextContent,start:number,end:number,style:RunStyle):TextRun[]{if(start<0||end>content.text.length||start>=end)throw new Error('请先选中文字范围。');const styles=textStyles(content);for(let i=start;i<end;i++)styles[i]={...styles[i],...style};return compressRuns(styles);}
export function rebaseRuns(content:TextContent,next:string):TextRun[]{const old=content.text,styles=textStyles(content);let a=0;while(a<old.length&&a<next.length&&old[a]===next[a])a++;let b=old.length,c=next.length;while(b>a&&c>a&&old[b-1]===next[c-1]){b--;c--;}const inherit=styles[a]??styles[a-1]??{};return compressRuns([...styles.slice(0,a),...Array.from({length:c-a},()=>inherit),...styles.slice(b)]);}
/** Grapheme-aware layout keeps style ranges as UTF-16 offsets, like textarea selection. */
export function rasterRichText(canvas:HTMLCanvasElement,content:TextContent){
 const ctx=canvas.getContext('2d')!,styles=textStyles(content),padding=Math.ceil(content.size*.5),limit=content.wrapWidth??8192-padding*2;
 type Glyph={text:string;style:TextContent&RunStyle;width:number;key:string};const lines:{glyphs:Glyph[];width:number;size:number}[]=[{glyphs:[],width:0,size:content.size}];
 const font=(s:TextContent&RunStyle)=>`${s.italic?'italic ':''}${s.bold?'bold ':''}${s.size}px ${s.fontName?'"'+s.fontName+'", ':''}${s.family}`;
 const segments=graphemeSegmenter.segment(content.text);
 for(const part of segments){const run=styles[part.index]!,style={...content,...run},text=part.segment;if(run.family&&run.family!==content.family&&!run.fontName)delete style.fontName;if(text==='\n'||text==='\r\n'){lines.push({glyphs:[],width:0,size:content.size});continue;}ctx.font=font(style);const key=ctx.font+'|'+style.color+'|'+Boolean(style.underline);let line=lines.at(-1)!,last=line.glyphs.at(-1),width=last?.key===key?ctx.measureText(last.text+text).width-last.width:ctx.measureText(text).width;if(line.glyphs.length&&line.width+width>limit){line={glyphs:[],width:0,size:content.size};lines.push(line);last=undefined;width=ctx.measureText(text).width;}if(last?.key===key){last.text+=text;last.width+=width;}else line.glyphs.push({text,style,width,key});line.width+=width;line.size=Math.max(line.size,style.size);}
 const width=Math.max(1,Math.ceil(content.wrapWidth??Math.max(...lines.map(l=>l.width)))+padding*2),height=Math.ceil(lines.reduce((n,l)=>n+l.size*1.4,0)+padding*2);
 if(width>8192||height>8192||width*height>16777216)throw new Error('富文本渲染尺寸超出限制。');canvas.width=width;canvas.height=height;ctx.textBaseline='alphabetic';let y=padding;
 for(const line of lines){let x=content.align==='left'?padding:content.align==='right'?width-padding-line.width:(width-line.width)/2;for(const glyph of line.glyphs){const s=glyph.style;ctx.font=font(s);ctx.fillStyle=s.color;ctx.fillText(glyph.text,x,y+line.size);if(s.underline)ctx.fillRect(x,y+line.size+Math.max(1,s.size*.08),glyph.width,Math.max(1,s.size*.06));x+=glyph.width;}y+=line.size*1.4;}
}

/** Native PSD point/box layout: keep UTF-16 styles, affine placement and paragraph indents. */
export function rasterNativeText(canvas:HTMLCanvasElement,c:TextContent){
 const l=c.layout!,ctx=canvas.getContext('2d')!,styles=textStyles(c),m=l.transform??[l.scaleX??1,0,0,l.scaleY??1],box=l.box;
 const font=(s:TextContent&RunStyle)=>`${s.italic?'italic ':''}${s.bold?'bold ':''}${s.size}px ${s.fontName?'"'+s.fontName+'", ':''}${s.family}`;
 type Glyph={text:string;style:TextContent&RunStyle;width:number};type Line={glyphs:Glyph[];width:number;size:number;first:boolean;paragraphEnd:boolean};
 const lines:Line[]=[];let line:Line={glyphs:[],width:0,size:c.size,first:true,paragraphEnd:false};
 // Cache within this render only: newly loaded fonts cannot leave stale metrics between edits.
 const resolved=new Map<RunStyle|undefined,{style:TextContent&RunStyle;font:string;spacing:string}>(),measurements=new Map<string,number>();let measuredFont='',measuredSpacing='';
 const resolve=(override:RunStyle|undefined)=>{let r=resolved.get(override);if(!r){const style={...c,...override};if(override?.family&&override.family!==c.family&&!override.fontName)delete style.fontName;r={style,font:font(style),spacing:`${(l.tracking??0)*style.size/1000}px`};resolved.set(override,r);}return r;};
 const measure=(text:string,r:ReturnType<typeof resolve>)=>{const key=r.font+'\0'+r.spacing+'\0'+text;let width=measurements.get(key);if(width===undefined){if(measuredFont!==r.font){ctx.font=r.font;measuredFont=r.font;}if(measuredSpacing!==r.spacing){ctx.letterSpacing=r.spacing;measuredSpacing=r.spacing;}width=ctx.measureText(text).width;measurements.set(key,width);}return width;};
 const available=()=>box?Math.max(1,box[2]!-box[0]!-(l.startIndent??0)-(l.endIndent??0)-(line.first?(l.firstLineIndent??0):0)):8192;
 const next=(paragraph=false)=>{line.paragraphEnd=paragraph;lines.push(line);line={glyphs:[],width:0,size:c.size,first:paragraph,paragraphEnd:false};};
 const push=(glyph:Glyph)=>{line.glyphs.push(glyph);line.width+=glyph.width;line.size=Math.max(line.size,glyph.style.size);};
 for(const word of wordSegmenter.segment(c.text)){
  const glyphs:Glyph[]=[];for(const part of graphemeSegmenter.segment(word.segment)){
   const text=part.segment;if(text==='\n'||text==='\r'||text==='\r\n'){next(true);continue;}
   const r=resolve(styles[word.index+part.index]);glyphs.push({text,style:r.style,width:measure(text,r)});
  }
  const width=glyphs.reduce((n,g)=>n+g.width,0),white=/^\s+$/.test(word.segment);
  if(box&&!white&&line.glyphs.length&&line.width+width>available())next();
  for(const glyph of glyphs){if(box&&!white&&line.glyphs.length&&line.width+glyph.width>available())next();push(glyph);}
 }
 lines.push(line);
 const corners=box?[[box[0]!,box[1]!],[box[2]!,box[1]!],[box[2]!,box[3]!],[box[0]!,box[3]!]]:[];
 const width=Math.max(l.width,...corners.map(([x,y])=>Math.ceil(l.x+m[0]!*x!+m[2]!*y!))),height=Math.max(l.height,...corners.map(([x,y])=>Math.ceil(l.y+m[1]!*x!+m[3]!*y!)));
 if(width>8192||height>8192||width*height>16777216)throw Error('文字框变换超出画布预算。');canvas.width=width;canvas.height=height;
 ctx.setTransform(m[0]!,m[1]!,m[2]!,m[3]!,l.x,l.y);ctx.textBaseline='alphabetic';
 if(box){ctx.beginPath();ctx.rect(box[0]!,box[1]!,box[2]!-box[0]!,box[3]!-box[1]!);ctx.clip();}
 let y=box?box[1]!:0;
 for(const row of lines){if(row.first)y+=l.spaceBefore??0;const leading=Math.max(l.leading,row.size*1.2),start=(box?.[0]??0)+(l.startIndent??0)+(row.first?(l.firstLineIndent??0):0),end=(box?.[2]??0)-(l.endIndent??0);
  let x=c.align==='left'?start:c.align==='right'?end-row.width:box?(start+end-row.width)/2:-row.width/2;
  const baseline=y+(box?row.size*.8:0);
  for(const glyph of row.glyphs){const s=glyph.style;ctx.font=font(s);ctx.letterSpacing=`${(l.tracking??0)*s.size/1000}px`;ctx.fillStyle=s.color;ctx.fillText(glyph.text,x,baseline);if(s.underline)ctx.fillRect(x,baseline+Math.max(1,s.size*.08),glyph.width,Math.max(1,s.size*.06));x+=glyph.width;}
  y+=leading+(row.paragraphEnd?l.spaceAfter??0:0);
 }
}
