import type {HYSelect} from '@haiyue/ui/select';
const bound=new WeakSet<HTMLElement>();
/** Bind controls created after startup using the same contract as static controls. */
export function bindEditorControls(root:ParentNode,signal?:AbortSignal){
 for(const control of root.querySelectorAll<HTMLElement>('hy-input,hy-select')){
  if(control.localName==='hy-select'&&control.querySelector('option')){const options=[...control.querySelectorAll('option')],select=control as HYSelect,value=select.value;select.options=options.map(o=>({value:o.value,label:o.text,disabled:o.disabled}));select.value=value||options.find(o=>o.selected)?.value||options[0]?.value||'';select.replaceChildren();}
  if(bound.has(control))continue;bound.add(control);const label=control.closest('label');if(!control.hasAttribute('aria-label'))control.setAttribute('aria-label',label?.textContent?.trim()||control.id);
  control.addEventListener('value-change',e=>{if(e.target===control)control.dispatchEvent(new Event('change',{bubbles:true,composed:true}));},signal?{signal}:undefined);
  label?.addEventListener('click',e=>{if(!e.composedPath().includes(control))control.shadowRoot?.querySelector<HTMLElement>('input,select')?.focus();},signal?{signal}:undefined);
 }
}
