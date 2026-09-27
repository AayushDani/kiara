import {canRead, membership, readRecord} from './authority';
import {V2Error, type ActorContext, type Conversation, type RecordBase, type WorkspaceState} from './contracts';
import {digest} from './store';
import {authorityCurrent,coverageViews} from './coverage';

export interface EvidenceItem {id:string;kind:'document'|'source'|'fact';title:string;quote:string;sourceId:string|null;factId:string|null;anchor:string;authority:string;practice:string|null;observedAt?:string;effectiveAt?:string|null;externalRevision?:string|null}
export interface EvidenceReference {kind:'source'|'document'|'fact'|'message'|'scenario'|'conversation'|'authority'|'coverage';id:string;hash:string}
export interface EvidencePacket {
 version:'v2-exact-keyword-1';question:string;history:{role:'user';text:string}[];
 evidence:EvidenceItem[];references:EvidenceReference[];sourceIds:string[];factIds:string[];
 hypotheses:string[];agreementInventory:{documentId:string;title:string;authority:string;amendsDocumentId:string|null}[];
 inventoryStatement:string;limitations:string[];coverage:{domain:string;jurisdiction:string;status:string;limitations:string[];qualification:string|null;reviewDueAt:string|null}[];
}
function failure(){return new V2Error('EVIDENCE_CHANGED','Authorized evidence changed. Send a new message after reviewing the current records.');}
function fingerprint(record:RecordBase){return digest(record);}
function reference(kind:EvidenceReference['kind'],record:RecordBase):EvidenceReference{return {kind,id:record.id,hash:fingerprint(record)};}
function records(s:WorkspaceState,kind:EvidenceReference['kind']):RecordBase[]{switch(kind){case 'source':return s.sources;case 'document':return s.documents;case 'fact':return s.facts;case 'message':return s.messages;case 'scenario':return s.scenarios;case 'conversation':return s.conversations;case 'authority':return s.legalAuthorities;case 'coverage':return s.coverage;}}
const coveragePacket=(s:WorkspaceState,a:ActorContext)=>coverageViews(s,a).map(c=>({domain:c.domain,jurisdiction:c.jurisdiction,status:c.status,limitations:c.limitations,qualification:c.qualification||null,reviewDueAt:c.reviewDueAt}));
/** Tenant, membership and current lineage are checked on every retrieval; no vector/index fallback. */
export function retrieveConversationEvidence(s:WorkspaceState,a:ActorContext,conversation:Conversation,userMessageId:string):EvidencePacket {
 membership(s,a);readRecord(s,a,s.conversations,conversation.id);const message=readRecord(s,a,s.messages,userMessageId);
 if(message.conversationId!==conversation.id||message.role!=='user'||!message.voiceConfirmed)throw failure();
 const terms=[...new Set(message.text.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu)||[])];
 const score=(title:string,body:string)=>terms.reduce((n,t)=>n+(title.toLowerCase().includes(t)?5:0)+(body.toLowerCase().includes(t)?1:0),0);
 const eligible=s.documents.filter(d=>canRead(s,a,d)&&d.status!=='superseded'&&s.sources.some(x=>x.id===d.sourceId&&x.status==='active'));
 const evidence:EvidenceItem[]=[],refs:EvidenceReference[]=[reference('message',message)];
 const sourceIds=new Set<string>(),factIds=new Set<string>();
 const traversed=new Set<string>();
 const addDependencies=(record:RecordBase)=>{if(traversed.has(record.id))return;traversed.add(record.id);for(const id of record.provenance.sourceIds){const source=readRecord(s,a,s.sources,id);sourceIds.add(id);refs.push(reference('source',source));addDependencies(source);}for(const id of record.provenance.factIds||[]){const fact=readRecord(s,a,s.facts,id);factIds.add(id);refs.push(reference('fact',fact));addDependencies(fact);}};
 const ranked=eligible.map(d=>({d,score:score(d.title,d.body)})).sort((x,y)=>y.score-x.score||x.d.id.localeCompare(y.d.id));
 const selected=ranked.some(x=>x.score>0)?ranked.filter(x=>x.score>0).slice(0,6):ranked.length===1?ranked:[];
 for(const {d} of selected){
  const source=readRecord(s,a,s.sources,d.sourceId);sourceIds.add(source.id);refs.push(reference('source',source),reference('document',d));addDependencies(d);
  // Rank contiguous source chunks; retain byte-for-byte quotes and offsets, including surrounding context.
  const chunks=Array.from({length:Math.max(1,Math.ceil(d.body.length/1800))},(_,i)=>({offset:i*1800,text:d.body.slice(i*1800,i*1800+2400)}));
  for(const chunk of chunks.sort((x,y)=>score(d.title,y.text)-score(d.title,x.text)||x.offset-y.offset).slice(0,2))evidence.push({id:`document:${d.id}:${chunk.offset}`,kind:'document',title:d.title,quote:chunk.text,sourceId:source.id,factId:null,anchor:`document:${d.id}:chars:${chunk.offset}-${chunk.offset+chunk.text.length}`,authority:d.authority,practice:null});
 }
 for(const source of s.sources.filter(x=>canRead(s,a,x)&&!eligible.some(d=>d.sourceId===x.id)).map(source=>({source,score:score(source.title,source.text)})).filter(x=>x.score>0).sort((x,y)=>y.score-x.score||x.source.id.localeCompare(y.source.id)).slice(0,4).map(x=>x.source)){
  sourceIds.add(source.id);refs.push(reference('source',source));addDependencies(source);evidence.push({id:`source:${source.id}:0`,kind:'source',title:source.title,quote:source.text.slice(0,2400),sourceId:source.id,factId:null,anchor:`source:${source.id}:chars:0-${Math.min(2400,source.text.length)}`,authority:source.authority,practice:null,observedAt:source.observedAt,effectiveAt:source.effectiveAt,externalRevision:source.externalRevision});
 }
 for(const fact of s.facts.filter(f=>f.status==='confirmed'&&f.reuse==='company'&&f.entityId===conversation.entityId&&canRead(s,a,f)&&(!f.validUntil||Date.parse(f.validUntil)>Date.now())&&(!f.validFrom||Date.parse(f.validFrom)<=Date.now())).sort((x,y)=>score(y.predicate,JSON.stringify(y.value))-score(x.predicate,JSON.stringify(x.value))||x.id.localeCompare(y.id)).slice(0,12)){
  factIds.add(fact.id);refs.push(reference('fact',fact));addDependencies(fact);evidence.push({id:`fact:${fact.id}`,kind:'fact',title:fact.predicate,quote:JSON.stringify({predicate:fact.predicate,value:fact.value,practice:fact.practice,confirmedAt:fact.confirmedAt}),sourceId:null,factId:fact.id,anchor:`fact:${fact.id}`,authority:'confirmed_company_assertion',practice:fact.practice});
 }
 const scenario=conversation.scenarioId?s.scenarios.find(x=>x.id===conversation.scenarioId&&canRead(s,a,x)):undefined;
 if(scenario){refs.push(reference('scenario',scenario));addDependencies(scenario);}
 const history=s.messages.filter(x=>x.conversationId===conversation.id&&x.role==='user'&&canRead(s,a,x)&&x.voiceConfirmed).slice(-6);
 for(const item of history){refs.push(reference('message',item));addDependencies(item);}
 // Inventory enumerates every currently authorized executed agreement in this workspace; it
 // does not establish that all customer contracts were uploaded, indexed or selected.
 const inventory=eligible.filter(d=>d.kind==='agreement'&&d.authority==='executed');
 for(const d of inventory){refs.push(reference('document',d),reference('source',readRecord(s,a,s.sources,d.sourceId)));sourceIds.add(d.sourceId);addDependencies(d);}
 for(const authority of s.legalAuthorities.filter(x=>canRead(s,a,x))){const linked=evidence.filter(e=>e.sourceId===authority.sourceId);if(linked.length){refs.push(reference('authority',authority));addDependencies(authority);for(const e of linked)e.authority+=`; registered ${authority.authorityType} for ${authority.domain}/${authority.jurisdiction}; named source review ${authorityCurrent(s,a,authority)?'current':'unverified or stale'}`;}}
 for(const entry of s.coverage.filter(x=>canRead(s,a,x))){refs.push(reference('coverage',entry));addDependencies(entry);}
 if(inventory.length>100)throw new V2Error('INVENTORY_TOO_LARGE','Narrow the authorized scope before requesting an agreement inventory.');
 return {version:'v2-exact-keyword-1',coverage:coveragePacket(s,a),question:message.text,history:history.map(x=>({role:'user',text:x.text})),evidence,references:[...new Map(refs.map(r=>[`${r.kind}:${r.id}`,r])).values()],sourceIds:[...sourceIds],factIds:[...factIds],hypotheses:scenario?.assumptions||[],agreementInventory:inventory.map(d=>({documentId:d.id,title:d.title,authority:d.authority,amendsDocumentId:d.amendsDocumentId})),inventoryStatement:'Complete enumeration of currently authorized executed agreement records in this workspace only. Upload completeness, customer applicability, amendments and external inventories remain unverified.',limitations:['Exact and keyword retrieval only; semantic/vector retrieval is not deployed.','Quotes are bounded excerpts. Definitions, exceptions and amendments can occur outside selected passages.','Provider observations retain effective and observed times; later arrival is not evidence that an older revision is current. Conflicting revisions require review.','Company assertions and exploratory hypotheses are not legal authority. No jurisdiction-specific legal coverage is certified.']};
}
/** Rechecks every referenced record and its current ACL, not just cached search results. */
export function recheckEvidence(s:WorkspaceState,a:ActorContext,conversationId:string,packet:EvidencePacket){
 membership(s,a);readRecord(s,a,s.conversations,conversationId);if(digest(packet.coverage)!==digest(coveragePacket(s,a)))throw failure();
 for(const ref of packet.references){const record=records(s,ref.kind).find(x=>x.id===ref.id);if(!record||!canRead(s,a,record)||fingerprint(record)!==ref.hash)throw failure();}
 for(const id of packet.factIds){const fact=readRecord(s,a,s.facts,id);if(fact.status!=='confirmed'||(fact.validUntil&&Date.parse(fact.validUntil)<=Date.now()))throw failure();}
}
