import {factCurrentlyConfirmed} from './fact-validity';
import {memoryRecordCurrent} from './company-memory-validity';
import {V2Error,type RecordBase,type Source,type WorkspaceState} from './contracts';
import {digest,timestamp} from './store';

export interface SourceObservation {objectKey:string;state:'current'|'historical'|'conflicting';basis:'first_observation'|'provider_revision'|'verified_provider_read'|'unordered_conflict'}
interface ObjectHistory {objectKey:string;currentSourceId:string|null;sourceIds:string[];withdrawn:boolean}
type ObservedSource=Source&{observation?:SourceObservation};
const providers=['github','slack','drive'];
const key=(source:Pick<Source,'kind'|'installationGrant'|'externalId'>)=>digest({provider:source.kind,installationId:source.installationGrant?.installationId,externalId:source.externalId});
const receiptKey=(objectKey:string)=>`source-object:${objectKey}`;
const touch=(source:Source)=>{source.version++;source.updatedAt=timestamp();};
function stateOf(s:WorkspaceState,objectKey:string){return s.receipts[receiptKey(objectKey)]?.result.object as ObjectHistory|undefined;}
function save(s:WorkspaceState,value:ObjectHistory){s.receipts[receiptKey(value.objectKey)]={hash:digest({objectKey:value.objectKey}),result:{object:value}};}
function fingerprint(source:Source){return digest({kind:source.kind,title:source.title,text:source.text,authority:source.authority,url:source.url});}
/** Only documented provider revision identities are ordered. Wall-clock arrival/effective time is not truth. */
function order(source:Source):bigint|null {
 const revision=source.externalRevision||'';
 if(source.kind==='drive'&&/^\d{1,30}$/.test(revision))return BigInt(revision);
 if(source.kind==='slack'&&/:message:\d+\.\d+$/.test(source.externalId||'')&&/^\d{1,15}\.\d{1,10}$/.test(revision)){const [seconds,fraction]=revision.split('.');return BigInt(seconds)*10000000000n+BigInt(fraction.padEnd(10,'0'));}
 return null;
}
function classify(source:ObservedSource,objectKey:string,state:SourceObservation['state'],basis:SourceObservation['basis']){
 if(source.observation?.objectKey===objectKey&&source.observation.state===state&&source.observation.basis===basis)return;
 source.observation={objectKey,state,basis};touch(source);
}
/** Aggregate Slack snapshots cannot reintroduce a message whose exact provider identity was withdrawn. */
export function slackSnapshotHasWithdrawnMessage(s:WorkspaceState,source:Source):boolean {
 if(source.kind!=='slack'||!source.externalId?.includes(':thread:'))return false;
 try{const installationId=source.installationGrant?.installationId;if(!installationId||!source.externalId.startsWith(`${installationId}:`))return true;const parts=source.externalId.slice(installationId.length+1).match(/^([^:]+):thread:(\d+\.\d+)$/),body=JSON.parse(source.text);if(!parts||body.channel!==parts[1]||body.threadTs!==parts[2]||!Array.isArray(body.messages))return true;return body.messages.some((message:{ts?:string})=>typeof message.ts!=='string'||stateOf(s,key({...source,externalId:`${installationId}:${parts[1]}:message:${message.ts}`}))?.withdrawn===true);}catch{return true;}
}
/** Historical source access stays in canRead; this predicate is only for admitting current evidence. */
export function currentSourceEvidence(s:WorkspaceState,source:Source):boolean {
 if(source.status!=='active'||s.tombstones.some(t=>t.sourceId===source.id)||slackSnapshotHasWithdrawnMessage(s,source))return false;
 if(source.kind==='email'&&source.emailIntake?.status!=='accepted')return false;
 if(!providers.includes(source.kind))return true;
 const observation=(source as ObservedSource).observation;if(!observation||observation.state!=='current')return false;
 const object=stateOf(s,observation.objectKey);return !!object&&!object.withdrawn&&object.currentSourceId===source.id;
}
export function currentEvidenceLineage(s:WorkspaceState,record:RecordBase):boolean {
 const seen=new Set<string>();const visit=(r:RecordBase):boolean=>{if(seen.has(r.id))return true;seen.add(r.id);if(!memoryRecordCurrent(s,r)||'externalRevision' in r&&!currentSourceEvidence(s,r as Source))return false;return r.provenance.sourceIds.every(id=>{const source=s.sources.find(x=>x.id===id);return !!source&&visit(source);})&&(r.provenance.factIds||[]).every(id=>{const fact=s.facts.find(x=>x.id===id);return !!fact&&factCurrentlyConfirmed(fact)&&visit(fact);});};return visit(record);
}
/** Same transaction as ingestion. Caller pushes a returned new Source and invalidates only returned IDs. */
export function recordSourceObservation(s:WorkspaceState,incoming:Source,options:{confirmedCurrent?:boolean}={}):{source:Source;duplicate:boolean;invalidatedSourceIds:string[];state:SourceObservation['state'];becameCurrent:boolean} {
 if(!providers.includes(incoming.kind))return {source:incoming,duplicate:false,invalidatedSourceIds:[],state:'current',becameCurrent:true};
 if(!incoming.externalId||!incoming.externalRevision||!incoming.installationGrant)throw new V2Error('SOURCE_IDENTITY_REQUIRED','Provider observations require an installed object and revision identity.',403);
 if(slackSnapshotHasWithdrawnMessage(s,incoming))throw new V2Error('SOURCE_CHILD_WITHDRAWN','A complete Slack snapshot includes a withdrawn message or invalid identity; reread the current provider thread.',409);
 const objectKey=key(incoming),existing=s.sources.filter(x=>(x as ObservedSource).observation?.objectKey===objectKey||x.kind===incoming.kind&&x.externalId===incoming.externalId&&x.installationGrant?.installationId===incoming.installationGrant!.installationId),retained=stateOf(s,objectKey),object:ObjectHistory=retained||{objectKey,currentSourceId:existing.length===1?existing[0].id:null,sourceIds:existing.map(x=>x.id),withdrawn:false};
 if(object.withdrawn)throw new V2Error('SOURCE_OBJECT_WITHDRAWN','This object was withdrawn; a later event cannot restore its evidence.',409);
 const sameRevision=existing.filter(x=>x.externalRevision===incoming.externalRevision);
 if(sameRevision.some(x=>fingerprint(x)!==fingerprint(incoming)))throw new V2Error('SOURCE_REVISION_CONFLICT','The same provider revision was observed with conflicting content.',409);
 const duplicate=sameRevision.find(x=>digest(x.scope)===digest(incoming.scope)&&digest(x.installationGrant)===digest(incoming.installationGrant));
 const source=duplicate||incoming;
 if(!object.sourceIds.includes(source.id))object.sourceIds.push(source.id);
 const previousCurrentId=object.currentSourceId,current=s.sources.find(x=>x.id===object.currentSourceId),all=[...existing.filter(x=>x.id!==source.id),source],invalidated=new Set<string>();
 const change=(item:Source,state:SourceObservation['state'],basis:SourceObservation['basis'])=>{if(item.id!==source.id&&((item as ObservedSource).observation?.state==='current'||object.currentSourceId===item.id))invalidated.add(item.id);classify(item,objectKey,state,basis);};
 if(options.confirmedCurrent){
  const currentOrder=order(source);if(currentOrder!==null&&all.some(item=>order(item)!==null&&order(item)!>currentOrder))throw new V2Error('PROVIDER_REVISION_REGRESSION','A current provider read returned an older ordered revision.',409);
  for(const prior of all.filter(x=>x.id!==source.id))change(prior,'historical','verified_provider_read');
  if(previousCurrentId!==source.id||!source.observation)classify(source,objectKey,'current','verified_provider_read');object.currentSourceId=source.id;
 }else if(duplicate&&retained){
  // Replayed observations do not promote a historical or conflicted revision back to current.
 }else if(all.length===1){classify(source,objectKey,'current','first_observation');object.currentSourceId=source.id;}
 else {
  const orders=all.map(x=>({source:x,order:order(x)}));
  if(orders.every(x=>x.order!==null)){
   const max=orders.reduce((n,x)=>x.order!>n?x.order!:n,orders[0].order!),latest=orders.filter(x=>x.order===max),winner=latest.find(x=>x.source.id===source.id)?.source||latest[0].source;
   // Equal revision with a newly authenticated configuration retains original scoped history.
   for(const prior of all)if(prior.id!==winner.id)change(prior,'historical','provider_revision');
   const wasCurrent=current?.id===winner.id;classify(winner,objectKey,'current',wasCurrent?(winner as ObservedSource).observation?.basis||'provider_revision':'provider_revision');object.currentSourceId=winner.id;
  }else{
   for(const item of all)change(item,'conflicting','unordered_conflict');object.currentSourceId=null;
  }
 }
 // Imported pre-lifecycle history is never silently eligible beside a newly selected observation.
 for(const item of existing)if(!(item as ObservedSource).observation)classify(item,objectKey,item.id===object.currentSourceId?'current':'historical','first_observation');
 save(s,object);return {source,duplicate:!!duplicate,invalidatedSourceIds:[...invalidated],state:(source as ObservedSource).observation!.state,becameCurrent:object.currentSourceId===source.id&&previousCurrentId!==source.id};
}
/** Never fall back to an older revision or resurrect removed content through a late delivery. */
export function withdrawSourceObservation(s:WorkspaceState,source:Source){
 if(!providers.includes(source.kind))return;
 const objectKey=(source as ObservedSource).observation?.objectKey||(source.externalId?key(source):null);if(!objectKey)return;
 const object=stateOf(s,objectKey)||{objectKey,currentSourceId:source.id,sourceIds:[source.id],withdrawn:false};
 if(object.currentSourceId===source.id||object.currentSourceId===null){object.withdrawn=true;object.currentSourceId=null;save(s,object);}
}

/** Authenticated provider removal fences an object even when deletion arrives before its first content event. */
export function withdrawProviderObject(s:WorkspaceState,identity:Pick<Source,'kind'|'installationGrant'|'externalId'>){
 if(!providers.includes(identity.kind)||!identity.installationGrant||!identity.externalId)throw new V2Error('SOURCE_IDENTITY_REQUIRED','Provider removal requires an installed object identity.',403);
 const objectKey=key(identity),object=stateOf(s,objectKey)||{objectKey,currentSourceId:null,sourceIds:[],withdrawn:false};object.currentSourceId=null;object.withdrawn=true;save(s,object);
}

/** Exact deletion relation: historical revisions match bytes/revision; withdrawn objects match every retained snapshot. */
export function slackSnapshotIncludesSource(s:WorkspaceState,snapshot:Source,message:Source):boolean {
 if(snapshot.kind!=='slack'||message.kind!=='slack'||!snapshot.installationGrant||snapshot.installationGrant.installationId!==message.installationGrant?.installationId||!message.externalId||!snapshot.externalId)return false;
 try{const prefix=`${snapshot.installationGrant.installationId}:`,identity=message.externalId.startsWith(prefix)?message.externalId.slice(prefix.length).match(/^([^:]+):message:(\d+\.\d+)$/):null,thread=snapshot.externalId.startsWith(prefix)?snapshot.externalId.slice(prefix.length).match(/^([^:]+):thread:(\d+\.\d+)$/):null,body=JSON.parse(snapshot.text);if(!identity||!thread||identity[1]!==thread[1]||body.channel!==thread[1]||body.threadTs!==thread[2]||!Array.isArray(body.messages))return false;const entry=body.messages.find((candidate:{ts?:string})=>candidate.ts===identity[2]);if(!entry)return false;if(stateOf(s,key(message))?.withdrawn)return true;const content=JSON.parse(message.text);return (entry.edited&&typeof entry.edited==='object'?entry.edited.ts:entry.edited||entry.ts)===message.externalRevision&&typeof content.text==='string'&&entry.text===content.text;}catch{return false;}
}
