/** Weak roots follow the actual lifetime of immutable pages, including history and in-flight work. */
const roots=new Set<WeakRef<{key:string}>>(),known=new WeakSet<object>();
export function trackPage(ref:{key:string}){if(!known.has(ref)){known.add(ref);roots.add(new WeakRef(ref));}}
export function livePageKeys(){const keys=new Set<string>();for(const root of roots){const ref=root.deref();if(ref)keys.add(ref.key);else roots.delete(root);}return keys;}
export type CollectionResult={status:'collected'|'busy'|'unavailable';deletedPages:number;deletedBytes:number;retainedPages:number}
export const skippedCollection=(status:'busy'|'unavailable'):CollectionResult=>({status,deletedPages:0,deletedBytes:0,retainedPages:0});
/** Each browser realm holds a shared lock for its lifetime. Sweep only when no other realm is live, without ever releasing our lifetime lock.
 * A suspended tab keeps its lock; no heartbeat timeout can turn its pages into garbage. */
class PageAccess {
 private ready:Promise<void>|undefined;private held:Promise<unknown>|undefined;private sweeping:Promise<unknown>|undefined;
 private get locks(){return typeof navigator==='undefined'?undefined:navigator.locks;}
 private acquire(){if(!this.locks)return Promise.resolve();if(!this.ready){
  // Join under the shared sweep gate. A collector cannot race a new realm into the live set.
  this.ready=this.locks.request('haiyue.image.pages.sweep',{mode:'shared'},()=>new Promise<void>((resolve,reject)=>{this.held=this.locks!.request('haiyue.image.pages.live',{mode:'shared'},()=>{resolve();return new Promise<void>(()=>{});});void this.held.catch(reject);})).then(()=>{});
  void this.ready!.catch(()=>{this.ready=undefined;});
 }return this.ready;}
 async enter(){if(this.sweeping)await this.sweeping;await this.acquire();}
 async collect(run:()=>Promise<CollectionResult>){if(!this.locks)return skippedCollection('unavailable');if(this.sweeping)return skippedCollection('busy');await this.acquire();if(this.sweeping)return skippedCollection('busy');let finish!:()=>void;this.sweeping=new Promise<void>(r=>finish=r);
  try{return await this.locks.request('haiyue.image.pages.sweep',{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock)return skippedCollection('busy');const snapshot=await this.locks!.query();if(snapshot.held?.filter(l=>l.name==='haiyue.image.pages.live').length!==1)return skippedCollection('busy');return run();});}
  finally{this.sweeping=undefined;finish();}
 }
}
export const pageAccess=new PageAccess();
export function idleTimer(run:()=>void,delay=60000){const timer=setTimeout(run,delay);(timer as unknown as {unref?():void}).unref?.();return timer;}
