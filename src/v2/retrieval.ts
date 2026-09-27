import {retrievalStrategyBoost} from './strategies';
import {assertSlackChannelGrant,slackAudienceEligible,scopeAudienceHash} from './integrations/slack-scope';
import {currentEvidenceLineage,currentSourceEvidence} from './source-lifecycle';
import {expandSourceContext,rankSourceChunks,structuredSourceChunks,type SourceChunk} from './source-structure';
import {documentHeads} from './document-lifecycle';
import {factCurrentlyConfirmed} from './fact-validity';
import {canRead, membership, readRecord} from './authority';
import {V2Error, type ActorContext, type Conversation, type RecordBase, type WorkspaceState} from './contracts';
import {digest} from './store';
import {authorityCurrent,coverageViews,legalSourceAnswerEligible} from './coverage';

export interface EvidenceItem {id:string;kind:'document'|'source'|'fact';title:string;quote:string;sourceId:string|null;factId:string|null;anchor:string;authority:string;practice:string|null;observedAt?:string;effectiveAt?:string|null;externalRevision?:string|null;structure?:{version:string;kind:SourceChunk['kind'];label:string|null;parentAnchor:string|null}}
export interface EvidenceReference {kind:'source'|'document'|'fact'|'message'|'scenario'|'conversation'|'authority'|'coverage';id:string;hash:string}
export interface EvidencePacket {
 audienceScopeHash?:string;
 version:'v2-exact-keyword-1'|'v2-atlas-hybrid-1';question:string;history:{role:'user';text:string}[];
 evidence:EvidenceItem[];references:EvidenceReference[];sourceIds:string[];factIds:string[];
 hypotheses:string[];agreementInventory:{documentId:string;title:string;authority:string;amendsDocumentId:string|null}[];
 inventoryStatement:string;limitations:string[];coverage:{domain:string;jurisdiction:string;status:string;limitations:string[];qualification:string|null;reviewDueAt:string|null}[];
}
function failure(){return new V2Error('EVIDENCE_CHANGED','Authorized evidence changed. Send a new message after reviewing the current records.');}
function fingerprint(record:RecordBase){return digest(record);}
function reference(kind:EvidenceReference['kind'],record:RecordBase):EvidenceReference{return {kind,id:record.id,hash:fingerprint(record)};}
function records(s:WorkspaceState,kind:EvidenceReference['kind']):RecordBase[]{switch(kind){case 'source':return s.sources;case 'document':return s.documents;case 'fact':return s.facts;case 'message':return s.messages;case 'scenario':return s.scenarios;case 'conversation':return s.conversations;case 'authority':return s.legalAuthorities;case 'coverage':return s.coverage;}}
export function withinConversationAudience(s:WorkspaceState,c:Conversation,r:RecordBase,seen=new Set<string>()):boolean {if(seen.has(r.id))return true;seen.add(r.id);return scopeAudienceHash(r.scope)===scopeAudienceHash(c.scope)&&r.provenance.sourceIds.every(id=>{const source=s.sources.find(x=>x.id===id);return !!source&&withinConversationAudience(s,c,source,seen);})&&(r.provenance.factIds||[]).every(id=>{const fact=s.facts.find(x=>x.id===id);return !!fact&&withinConversationAudience(s,c,fact,seen);});}
export const coveragePacket=(s:WorkspaceState,a:ActorContext,c:Conversation,exactScope?:string)=>coverageViews(s,a).filter(r=>slackAudienceEligible(s,c,r)&&(!exactScope||scopeAudienceHash(c.scope)===exactScope&&withinConversationAudience(s,c,r))).map(c=>({domain:c.domain,jurisdiction:c.jurisdiction,status:c.status,limitations:c.limitations,qualification:c.qualification||null,reviewDueAt:c.reviewDueAt}));
/** Tenant, membership and current lineage are checked on every retrieval; no vector/index fallback. */
export function retrieveConversationEvidence(s:WorkspaceState,a:ActorContext,conversation:Conversation,userMessageId:string,selection?:{chunks:{kind:'document'|'source'|'fact';id:string;offset:number}[];hybrid:boolean}):EvidencePacket {
 membership(s,a);readRecord(s,a,s.conversations,conversation.id);if(conversation.channelGrant)assertSlackChannelGrant(s,conversation);const message=readRecord(s,a,s.messages,userMessageId);
 if(message.conversationId!==conversation.id||message.role!=='user'||!message.voiceConfirmed||!slackAudienceEligible(s,conversation,message)||!currentEvidenceLineage(s,message))throw failure();
 const terms=[...new Set(message.text.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu)||[])];
 const score=(title:string,body:string)=>terms.reduce((n,t)=>n+(title.toLowerCase().includes(t)?5:0)+(body.toLowerCase().includes(t)?1:0),0)+(selection?.hybrid?0:retrievalStrategyBoost(s,a,conversation,{title,body},message.text));
 const eligible=documentHeads(s.documents).filter(d=>canRead(s,a,d)&&slackAudienceEligible(s,conversation,d)&&d.status!=='superseded'&&currentEvidenceLineage(s,d)&&s.sources.some(x=>x.id===d.sourceId&&currentSourceEvidence(s,x)&&legalSourceAnswerEligible(s,a,x)));
 const evidence:EvidenceItem[]=[],refs:EvidenceReference[]=[reference('message',message)];
 const sourceIds=new Set<string>(),factIds=new Set<string>();let omittedContext=false;
 const excerpt=(body:string,kind:'document'|'source',id:string)=>{const result=selection?expandSourceContext(structuredSourceChunks(body),selection.chunks.filter(c=>c.kind===kind&&c.id===id).map(c=>c.offset)):rankSourceChunks(body,message.text);omittedContext ||= result.omittedContext;return result.chunks;};
 const structure=(chunk:SourceChunk,kind:'document'|'source',id:string):EvidenceItem['structure']=>({version:chunk.structureVersion,kind:chunk.kind,label:chunk.label,parentAnchor:chunk.parentOffset===null?null:`${kind}:${id}:chars:${chunk.parentOffset}`});
 const traversed=new Set<string>();
 const addDependencies=(record:RecordBase)=>{if(traversed.has(record.id))return;traversed.add(record.id);for(const id of record.provenance.sourceIds){const source=readRecord(s,a,s.sources,id);sourceIds.add(id);refs.push(reference('source',source));addDependencies(source);}for(const id of record.provenance.factIds||[]){const fact=readRecord(s,a,s.facts,id);factIds.add(id);refs.push(reference('fact',fact));addDependencies(fact);}};
 addDependencies(message);
 const ranked=eligible.map(d=>({d,score:score(d.title,d.body)})).sort((x,y)=>y.score-x.score||x.d.id.localeCompare(y.d.id));
 const selected=selection?ranked.filter(x=>selection.chunks.some(c=>c.kind==='document'&&c.id===x.d.id)):ranked.some(x=>x.score>0)?ranked.filter(x=>x.score>0).slice(0,6):ranked.length===1?ranked:[];
 for(const {d} of selected){
  const source=readRecord(s,a,s.sources,d.sourceId);sourceIds.add(source.id);refs.push(reference('source',source),reference('document',d));addDependencies(d);
  for(const chunk of excerpt(d.body,'document',d.id))evidence.push({id:`document:${d.id}:${chunk.offset}`,kind:'document',title:d.title,quote:chunk.text,sourceId:source.id,factId:null,anchor:`document:${d.id}:chars:${chunk.offset}-${chunk.end}`,authority:d.authority,practice:null,structure:structure(chunk,'document',d.id)});
 }
 for(const source of s.sources.filter(x=>canRead(s,a,x)&&slackAudienceEligible(s,conversation,x)&&currentEvidenceLineage(s,x)&&legalSourceAnswerEligible(s,a,x)&&!s.documents.some(d=>d.sourceId===x.id)).map(source=>({source,score:score(source.title,source.text)})).filter(x=>selection?selection.chunks.some(c=>c.kind==='source'&&c.id===x.source.id):x.score>0).sort((x,y)=>y.score-x.score||x.source.id.localeCompare(y.source.id)).slice(0,selection?16:4).map(x=>x.source)){
  sourceIds.add(source.id);refs.push(reference('source',source));addDependencies(source);for(const chunk of excerpt(source.text,'source',source.id))evidence.push({id:`source:${source.id}:${chunk.offset}`,kind:'source',title:source.title,quote:chunk.text,sourceId:source.id,factId:null,anchor:`source:${source.id}:chars:${chunk.offset}-${chunk.end}`,authority:source.authority,practice:null,observedAt:source.observedAt,effectiveAt:source.effectiveAt,externalRevision:source.externalRevision,structure:structure(chunk,'source',source.id)});
 }
 for(const fact of s.facts.filter(f=>(!selection||selection.chunks.some(c=>c.kind==='fact'&&c.id===f.id))&&factCurrentlyConfirmed(f)&&currentEvidenceLineage(s,f)&&f.reuse==='company'&&f.entityId===conversation.entityId&&(f.subjectEntityId||s.entityId)===(conversation.subjectEntityId||s.entityId)&&canRead(s,a,f)&&slackAudienceEligible(s,conversation,f)).sort((x,y)=>score(y.predicate,JSON.stringify(y.value))-score(x.predicate,JSON.stringify(x.value))||x.id.localeCompare(y.id)).slice(0,12)){
  factIds.add(fact.id);refs.push(reference('fact',fact));addDependencies(fact);evidence.push({id:`fact:${fact.id}`,kind:'fact',title:fact.predicate,quote:JSON.stringify({predicate:fact.predicate,value:fact.value,practice:fact.practice,confirmedAt:fact.confirmedAt}),sourceId:null,factId:fact.id,anchor:`fact:${fact.id}`,authority:'confirmed_company_assertion',practice:fact.practice});
 }
 if(selection){const order=new Map(selection.chunks.map((c,i)=>[c.kind==='fact'?`fact:${c.id}`:`${c.kind}:${c.id}:${c.offset}`,i]));evidence.sort((a,b)=>(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER));}
 const scenario=conversation.scenarioId?s.scenarios.find(x=>x.id===conversation.scenarioId&&canRead(s,a,x)&&slackAudienceEligible(s,conversation,x)&&currentEvidenceLineage(s,x)):undefined;
 if(scenario){refs.push(reference('scenario',scenario));addDependencies(scenario);}
 const history=s.messages.filter(x=>x.conversationId===conversation.id&&x.role==='user'&&canRead(s,a,x)&&slackAudienceEligible(s,conversation,x)&&x.voiceConfirmed&&currentEvidenceLineage(s,x)).slice(-6);
 for(const item of history){refs.push(reference('message',item));addDependencies(item);}
 // Inventory enumerates every currently authorized executed agreement in this workspace; it
 // does not establish that all customer contracts were uploaded, indexed or selected.
 const inventory=eligible.filter(d=>d.kind==='agreement'&&d.authority==='executed');
 for(const d of inventory){refs.push(reference('document',d),reference('source',readRecord(s,a,s.sources,d.sourceId)));sourceIds.add(d.sourceId);addDependencies(d);}
 for(const authority of s.legalAuthorities.filter(x=>canRead(s,a,x)&&slackAudienceEligible(s,conversation,x)&&currentEvidenceLineage(s,x))){const linked=evidence.filter(e=>e.sourceId===authority.sourceId);if(linked.length){refs.push(reference('authority',authority));addDependencies(authority);for(const e of linked)e.authority+=`; registered ${authority.authorityType} for ${authority.domain}/${authority.jurisdiction}; named source review ${authorityCurrent(s,a,authority)?'current':'unverified or stale'}`;}}
 for(const entry of s.coverage.filter(x=>canRead(s,a,x)&&slackAudienceEligible(s,conversation,x)&&currentEvidenceLineage(s,x))){refs.push(reference('coverage',entry));addDependencies(entry);}
 if(inventory.length>100)throw new V2Error('INVENTORY_TOO_LARGE','Narrow the authorized scope before requesting an agreement inventory.');
 let used=0;const boundedEvidence=evidence.filter((item,index)=>{if(index>=24||used+item.quote.length>40000){omittedContext=true;return false;}used+=item.quote.length;return true;});
 return {version:selection?.hybrid?'v2-atlas-hybrid-1':'v2-exact-keyword-1',coverage:coveragePacket(s,a,conversation),question:message.text,history:history.map(x=>({role:'user',text:x.text})),evidence:boundedEvidence,references:[...new Map(refs.map(r=>[`${r.kind}:${r.id}`,r])).values()],sourceIds:[...sourceIds],factIds:[...factIds],hypotheses:scenario?.assumptions||[],agreementInventory:inventory.map(d=>({documentId:d.id,title:d.title,authority:d.authority,amendsDocumentId:d.amendsDocumentId})),inventoryStatement:'Complete enumeration of currently authorized executed agreement records in this workspace only. Upload completeness, customer applicability, amendments and external inventories remain unverified.',limitations:[selection?.hybrid?'Atlas full-text and vector retrieval with exact matches, reciprocal rank fusion and authoritative record hydration. No learned reranker.':'Exact and keyword retrieval; a current scoped strategy may boost exact clause references. Semantic/vector retrieval is not enabled for this run.',`Structure-aware exact excerpts include detected parent headings, definitions, cross-references and exception context. ${omittedContext?'Additional detected context was omitted by the excerpt bound. ':''}Parsing is heuristic; unselected definitions, exceptions, tables or amendments may change the interpretation. Complete agreement review is still required.`,'Provider observations retain effective and observed times; later arrival is not evidence that an older revision is current. Conflicting revisions require review.','Company assertions and exploratory hypotheses are not legal authority. No jurisdiction-specific legal coverage is certified.']};
}
/** Rechecks every referenced record and its current ACL, not just cached search results. */
export function recheckEvidence(s:WorkspaceState,a:ActorContext,conversationId:string,packet:EvidencePacket){
 membership(s,a);const conversation=readRecord(s,a,s.conversations,conversationId);if(conversation.channelGrant)assertSlackChannelGrant(s,conversation);if(packet.audienceScopeHash&&packet.audienceScopeHash!==scopeAudienceHash(conversation.scope))throw failure();if(digest(packet.coverage)!==digest(coveragePacket(s,a,conversation,packet.audienceScopeHash)))throw failure();
 for(const ref of packet.references){const record=records(s,ref.kind).find(x=>x.id===ref.id);if(!record||!canRead(s,a,record)||packet.audienceScopeHash&&!withinConversationAudience(s,conversation,record)||!slackAudienceEligible(s,conversation,record)||!currentEvidenceLineage(s,record)||fingerprint(record)!==ref.hash||ref.kind==='document'&&!documentHeads(s.documents).some(d=>d.id===ref.id))throw failure();if(ref.kind==='source'&&!legalSourceAnswerEligible(s,a,record as WorkspaceState['sources'][number]))throw failure();if(ref.kind==='document'){const source=s.sources.find(x=>x.id===(record as WorkspaceState['documents'][number]).sourceId);if(!source||!legalSourceAnswerEligible(s,a,source))throw failure();}}
 for(const id of packet.factIds){const fact=readRecord(s,a,s.facts,id);if(!factCurrentlyConfirmed(fact))throw failure();}
}
