import { pixelJob } from './pixelJobs.js';
import { deserializeProject, serializeProject } from './projectFile.js';
import type { SmartContent } from './layerFeatures.js';
import type { ImageWorkspace } from './workspace.js';
import { findLayer, ImageDocument } from './document.js';
import { openSmartSource, prepareSmartSource, applySmartSource } from './smartSource.js';
/** A source tab is an independent document. Applying requires the parent's opening revision. */
export class SmartSourcePanel {
 private links=new Map<string,{parent:ImageDocument;revision:number;layerId:string}>();
 private abort=new AbortController();
 private unsubscribe:()=>void;
 constructor(private workspace:ImageWorkspace,private notify:(text:string,error?:boolean)=>void){
  document.querySelector('.advanced-actions')!.insertAdjacentHTML('beforeend','<button id="smart-source-open">编辑智能源文档</button><button id="smart-source-apply">回写智能源</button>');
  for(const mode of ['open','apply'] as const)document.getElementById('smart-source-'+mode)!.addEventListener('click',()=>{void (mode==='open'?this.open():this.apply()).catch(e=>notify(e instanceof Error?e.message:String(e),true));},{signal:this.abort.signal});
  this.unsubscribe=workspace.subscribe(()=>this.sync());this.sync();
 }
 private async open(){const parent=this.workspace.active,layer=parent?.selected;if(!parent||layer?.content?.type!=='smart')throw new Error('请选择智能对象。');
  const revision=parent.revision,bytes=await pixelJob<Uint8Array>({kind:'smart-read',content:layer.content},this.abort.signal);if(!this.workspace.documents.includes(parent)||parent.revision!==revision)throw new Error('父文档已改变，请重新打开智能源。');const child=new ImageDocument(deserializeProject(new TextDecoder().decode(bytes),true));try{this.workspace.add(child);}catch(e){child.dispose();throw e;}
  this.links.set(child.identity.id,{parent,revision:parent.revision,layerId:layer.id});this.workspace.activate(child.identity.id);this.sync();this.notify('源文档可独立编辑；完成后点击“回写智能源”。');
 }
 private async apply(){const child=this.workspace.active,link=child&&this.links.get(child.identity.id);if(!child||!link)throw new Error('请先打开智能源文档。');
  if(!this.workspace.documents.includes(link.parent)||link.parent.revision!==link.revision)throw new Error('父文档已改变或关闭，请保存源文档后重新打开智能源，避免覆盖新修改。');
  const content=findLayer(link.parent.state.layers,link.layerId)?.content;if(content?.type!=='smart')throw new Error('父图层已不再是智能对象。');
  const revision=child.revision,parentRevision=link.parent.revision,next=await pixelJob<SmartContent>({kind:'smart-prepare',content,bytes:new TextEncoder().encode(serializeProject(child.state)),format:'project'},this.abort.signal);if(!this.workspace.documents.includes(child)||!this.workspace.documents.includes(link.parent)||child.revision!==revision||link.parent.revision!==parentRevision)throw new Error('源文档或父文档已改变，请重新回写。');applySmartSource(link.parent,link.layerId,next);link.revision=link.parent.revision;this.workspace.activate(link.parent.identity.id);this.notify('多层智能源已回写；父文档可一次撤销，源文档仍可独立保存。');
 }
 private sync(){for(const [id,l] of this.links)if(!this.workspace.documents.some(d=>d.identity.id===id)||!this.workspace.documents.includes(l.parent))this.links.delete(id);const d=this.workspace.active;(document.getElementById('smart-source-open') as HTMLButtonElement).disabled=d?.selected?.content?.type!=='smart';(document.getElementById('smart-source-apply') as HTMLButtonElement).disabled=!d||!this.links.has(d.identity.id);}
 dispose(){this.abort.abort();this.unsubscribe();this.links.clear();}
}
