import type { PsdImportResult } from './psdAdapter.js';
import { textDiagnosticMessage, type TextLayerDiagnostic } from './textDiagnostics.js';
export type FontAvailability='available'|'unavailable'|'unknown';
/** Probe explicit PSD font names with CSS local sources, without enumerating installed fonts or prompting. */
export class TextFontProbe {
 private cache=new Map<string,Promise<FontAvailability>>();
 constructor(private load:(name:string)=>Promise<FontAvailability>=loadLocalFont,private capacity=256){}
 check(name:string){let p=this.cache.get(name);if(p)return p;if(this.cache.size>=this.capacity)this.cache.delete(this.cache.keys().next().value!);p=this.load(name).catch(()=> 'unknown' as const);this.cache.set(name,p);return p;}
 async inspect(input:readonly TextLayerDiagnostic[]){const names=[...new Set(input.flatMap(d=>d.fontNames))],status=new Map<string,FontAvailability>();let index=0;await Promise.all(Array.from({length:Math.min(8,names.length)},async()=>{while(index<names.length){const name=names[index++]!;status.set(name,await this.check(name));}}));return input.map(d=>{
  const missing=d.fontNames.filter(n=>status.get(n)==='unavailable'),issues=d.issues.filter(i=>i.code!=='font-unavailable');if(missing.length)issues.push({code:'font-unavailable',detail:`浏览器无法加载字体 ${missing.join('、')}，修改后会使用替代字体`});
  return {...d,issues,fontCheck:d.fontNames.some(n=>status.get(n)==='unknown')?'unavailable' as const:'checked' as const};
 });}
}
const faces=new Map<string,FontFace>();
async function loadLocalFont(name:string):Promise<FontAvailability>{
 if(typeof FontFace==='undefined'||typeof document==='undefined'||!document.fonts)return 'unknown';
 if(faces.has(name))return 'available';if(faces.size>=256)return 'unknown';
 // JSON quoting is valid CSS string quoting for these validated font names; no remote URLs are accepted.
 const face=new FontFace(name,`local(${JSON.stringify(name)})`,{style:/Italic|Oblique/i.test(name)?'italic':'normal',weight:/Bold/i.test(name)?'700':'400'});let timer:ReturnType<typeof setTimeout>|undefined;
 try {const result=await Promise.race([face.load().then(()=>true,()=>false),new Promise<undefined>(r=>{timer=setTimeout(()=>r(undefined),2500);})]);if(result===undefined)return 'unknown';if(!result)return 'unavailable';if(faces.size>=256)return 'unknown';document.fonts.add(face);faces.set(name,face);return 'available';}finally{clearTimeout(timer);}
}
export const textFontProbe=new TextFontProbe();
export async function checkImportTextFonts(result:PsdImportResult){
 if(!result.textDiagnostics?.length)return result;const old=new Set(result.textDiagnostics.filter(d=>d.issues.length).map(textDiagnosticMessage)),textDiagnostics=await textFontProbe.inspect(result.textDiagnostics);
 const warnings=[...result.warnings.filter(w=>!old.has(w)),...textDiagnostics.filter(d=>d.issues.length).map(textDiagnosticMessage)];
 const notes=[...result.notes];if(textDiagnostics.some(d=>d.fontCheck==='unavailable'))notes.push('当前环境无法完成部分字体检测；未将未检测字体判定为缺失。');
 return {...result,textDiagnostics,warnings,notes};
}
