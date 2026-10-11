import type {EditorDisposable,EditorJsonValue,EditorOperationSchema} from '@haiyue/editor-plugin-sdk';
import type {ImageWorkspace} from './workspace.js';
import type {ImageDocument} from './document.js';
import {patchRegion,contentAware,denoise,remapRetouch,fineSelection,decontaminate,type LiquifyDab,type LensSettings} from './retouchEngine.js';
import {maskFromSelection} from './maskTools.js';
import {refineSchema} from './professionalOperations.js';
import type {RefineSettings} from './refineSelection.js';
import type {Rect} from './pixelTools.js';
export function registerRetouchOperations(w:ImageWorkspace):EditorDisposable {
 const owned:EditorDisposable[]=[],n=(minimum:number,maximum:number)=>({type:'number',minimum,maximum} as const),i=(minimum:number,maximum:number)=>({type:'integer',minimum,maximum} as const),layerId={type:'string',minLength:1,maxLength:160} as const;
 const register=(name:string,properties:Record<string,EditorOperationSchema>,required:string[],prepare:(p:Record<string,EditorJsonValue>,d:ImageDocument,signal:AbortSignal)=>Promise<()=>EditorJsonValue>)=>owned.push(w.registerOperation({ownerId:'image.operations',descriptor:{id:'image.'+name,version:1,title:name,target:'document',documentKinds:['haiyue.image'],access:'write',input:{type:'object',properties:{layerId,...properties},required:['layerId',...required]},output:{type:'json'}},async prepare(params,c){const d=w.documents.find(d=>d.identity.id===c.document?.id);if(!d)throw Error('文档已关闭。');return {d,apply:await prepare(params as Record<string,EditorJsonValue>,d,c.signal)};},commit:({d,apply})=>d.runAtomic(apply),rollback(){}}));
 const pixels=(d:ImageDocument,l:Awaited<ReturnType<typeof denoise>>,label:string)=>()=>{d.replaceLayerPixels(l.id,l,label);return {applied:true};};
 register('retouch.patch',{dx:i(-30000,30000),dy:i(-30000,30000),blend:n(0,1)},['dx','dy'],async(p,d,s)=>pixels(d,await patchRegion(d.state,p.layerId as string,{x:p.dx as number,y:p.dy as number},(p.blend??1) as number,s),'修补'));
 register('retouch.content-aware',{search:i(4,128)},[],async(p,d,s)=>pixels(d,await contentAware(d.state,p.layerId as string,(p.search??64) as number,s),'内容感知填充'));
 register('retouch.denoise',{radius:i(1,5),strength:n(1,100)},['radius','strength'],async(p,d,s)=>pixels(d,await denoise(d.state,p.layerId as string,p.radius as number,p.strength as number,s),'保边降噪'));
 register('retouch.lens',{k1:n(-1,1),k2:n(-1,1),scale:n(.25,4),vignette:n(-1,1),centerX:n(0,1),centerY:n(0,1)},['k1','k2','scale','vignette','centerX','centerY'],async(p,d,s)=>pixels(d,await remapRetouch(d.state,p.layerId as string,p as unknown as LensSettings,s),'镜头校正'));
 register('retouch.liquify',{dabs:{type:'array',maxItems:256,items:{type:'object',properties:{x:n(-30000,30000),y:n(-30000,30000),dx:n(-512,512),dy:n(-512,512),radius:n(1,512),strength:n(0,1),mode:{type:'string',enum:['push','pinch','bloat','twirl']}},required:['x','y','dx','dy','radius','strength','mode']}}},['dabs'],async(p,d,s)=>pixels(d,await remapRetouch(d.state,p.layerId as string,p.dabs as unknown as LiquifyDab[],s),'液化'));
 register('selection.fine',{...refineSchema,output:{type:'string',enum:['selection','mask']},region:{type:'object',properties:{x:i(0,29999),y:i(0,29999),width:i(1,30000),height:i(1,30000)},required:['x','y','width','height']}},['radius','contrast','shift','edgeAware'],async(p,d,s)=>{const selection=await fineSelection(d.state,p.layerId as string,p as unknown as RefineSettings,p.region as unknown as Rect|undefined,s);return ()=>{if(p.output==='mask')d.setMask(p.layerId as string,maskFromSelection({...d.state,selection},p.layerId as string));else d.setSelection(selection);return {applied:true};};});
 register('retouch.decontaminate',{radius:i(1,16),amount:n(0,1)},['radius','amount'],async(p,d,s)=>pixels(d,await decontaminate(d.state,p.layerId as string,p.radius as number,p.amount as number,s),'边缘去色'));
 return {async dispose(){for(const item of owned)await item.dispose();}};
}
