import {retrievalStrategyBoost} from './strategies';
import {assertSlackChannelGrant,slackAudienceEligible,scopeAudienceHash} from './integrations/slack-scope';
import {currentEvidenceLineage,currentSourceEvidence} from './source-lifecycle';
import {expandSourceContext,rankSourceChunks,structuredSourceChunks,type SourceChunk} from './source-structure';
import {documentHeads} from './document-lifecycle';
import {factCurrentlyConfirmed} from './fact-validity';
import {canRead, membership, readRecord} from './authority';
import {V2Error, type ActorContext, type Conversation, type DocumentFocus, type DocumentRecord, type RecordBase, type WorkspaceState} from './contracts';
import {digest} from './store';
import {authorityCurrent,coverageViews,legalSourceAnswerEligible} from './coverage';

export interface EvidenceItem {id:string;kind:'document'|'source'|'fact';title:string;quote:string;sourceId:string|null;factId:string|null;anchor:string;authority:string;practice:string|null;observedAt?:string;effectiveAt?:string|null;externalRevision?:string|null;structure?:{version:string;kind:SourceChunk['kind'];label:string|null;parentAnchor:string|null}}
export interface EvidenceReference {kind:'source'|'document'|'fact'|'message'|'scenario'|'conversation'|'authority'|'coverage';id:string;hash:string}
export interface EvidencePacket {
 audienceScopeHash?:string;
 focusDocument?:DocumentFocus;
 userMessageId?:string;
 version:'v2-exact-keyword-1'|'v2-atlas-hybrid-1';question:string;history:{role:'user';text:string}[];
 evidence:EvidenceItem[];references:EvidenceReference[];sourceIds:string[];factIds:string[];
 hypotheses:string[];agreementInventory:{documentId:string;title:string;authority:string;amendsDocumentId:string|null}[];
 inventoryStatement:string;limitations:string[];coverage:{domain:string;jurisdiction:string;status:string;limitations:string[];qualification:string|null;reviewDueAt:string|null}[];
}
function failure(){return new V2Error('EVIDENCE_CHANGED','Authorized evidence changed. Send a new message after reviewing the current records.');}
const FOCUSED_INVENTORY_STATEMENT='Only the inspected document is included in this answer. Other agreements and external inventories were not reviewed.';
const INVENTORY_STATEMENT='Complete enumeration of currently authorized executed agreement records in this workspace only. Upload completeness, customer applicability, amendments and external inventories remain unverified.';
function focusedLimitations(version:EvidencePacket['version']):string[]{return [version==='v2-atlas-hybrid-1'?'Atlas full-text and vector retrieval selected excerpts only from the inspected current document.':'Exact and keyword retrieval selected excerpts only from the inspected current document.', 'Excerpts may omit definitions, exceptions, tables or amendments. Review the complete document and its applicability before relying on an isolated passage.', 'No other agreement, company assertion, scenario hypothesis or legal coverage was reviewed for this answer. Legal interpretation remains subject to qualified review.'];}
function unfocusedLimitations(version:EvidencePacket['version']):string[]{return [version==='v2-atlas-hybrid-1'?'Atlas full-text and vector retrieval with exact matches, reciprocal rank fusion and authoritative record hydration. No learned reranker.':'Exact and keyword retrieval; a current scoped strategy may boost exact clause references. Semantic/vector retrieval is not enabled for this run.','Structure-aware exact excerpts include detected parent headings, definitions, cross-references and exception context. Additional detected context may be omitted by the excerpt bound. Parsing is heuristic; unselected definitions, exceptions, tables or amendments may change the interpretation. Complete agreement review is still required.','Provider observations retain effective and observed times; later arrival is not evidence that an older revision is current. Conflicting revisions require review.','Company assertions and exploratory hypotheses are not legal authority. No jurisdiction-specific legal coverage is certified.'];}
function fingerprint(record:RecordBase){return digest(record);}
function reference(kind:EvidenceReference['kind'],record:RecordBase):EvidenceReference{return {kind,id:record.id,hash:fingerprint(record)};}
function records(s:WorkspaceState,kind:EvidenceReference['kind']):RecordBase[]{switch(kind){case 'source':return s.sources;case 'document':return s.documents;case 'fact':return s.facts;case 'message':return s.messages;case 'scenario':return s.scenarios;case 'conversation':return s.conversations;case 'authority':return s.legalAuthorities;case 'coverage':return s.coverage;}}
export function withinConversationAudience(s:WorkspaceState,c:Conversation,r:RecordBase,seen=new Set<string>()):boolean {if(seen.has(r.id))return true;seen.add(r.id);return scopeAudienceHash(r.scope)===scopeAudienceHash(c.scope)&&r.provenance.sourceIds.every(id=>{const source=s.sources.find(x=>x.id===id);return !!source&&withinConversationAudience(s,c,source,seen);})&&(r.provenance.factIds||[]).every(id=>{const fact=s.facts.find(x=>x.id===id);return !!fact&&withinConversationAudience(s,c,fact,seen);});}
export function conversationEvidenceAudience(s:WorkspaceState,c:Conversation,r:RecordBase):boolean {return slackAudienceEligible(s,c,r)&&(c.scope.kind==='private'||withinConversationAudience(s,c,r));}
/** Bind an inspected revision to its current head, source, audience, and exact content. */
export function resolveFocusedDocument(s:WorkspaceState,a:ActorContext,c:Conversation,focus:DocumentFocus):DocumentRecord {
 if(!focus||typeof focus!=='object'||Array.isArray(focus)||Object.keys(focus).sort().join(',')!=='contentHash,documentId,expectedVersion'||typeof focus.documentId!=='string'||!focus.documentId||!Number.isSafeInteger(focus.expectedVersion)||focus.expectedVersion<1||typeof focus.contentHash!=='string'||!/^\p{ASCII_Hex_Digit}{64}$/u.test(focus.contentHash))throw new V2Error('INVALID_DOCUMENT_FOCUS','Inspect one current document before asking about it.',400);
 membership(s,a);readRecord(s,a,s.conversations,c.id);const document=readRecord(s,a,s.documents,focus.documentId);
 if(document.version!==focus.expectedVersion||document.contentHash!==focus.contentHash||!documentHeads(s.documents).some(d=>d.id===document.id)||!currentEvidenceLineage(s,document))throw new V2Error('FOCUS_DOCUMENT_CHANGED','The inspected document changed. Open its current revision and try again.');
 const source=readRecord(s,a,s.sources,document.sourceId);
 if(!currentSourceEvidence(s,source)||!legalSourceAnswerEligible(s,a,source)||!slackAudienceEligible(s,c,document)||!slackAudienceEligible(s,c,source)||c.scope.kind!=='private'&&(!withinConversationAudience(s,c,document)||!withinConversationAudience(s,c,source)))throw new V2Error('FOCUS_DOCUMENT_CHANGED','The inspected document or its source is no longer available in this conversation.');
 return document;
}
export const coveragePacket=(s:WorkspaceState,a:ActorContext,c:Conversation,exactScope?:string)=>coverageViews(s,a).filter(r=>conversationEvidenceAudience(s,c,r)&&(!exactScope||scopeAudienceHash(c.scope)===exactScope&&withinConversationAudience(s,c,r))).map(c=>({domain:c.domain,jurisdiction:c.jurisdiction,status:c.status,limitations:c.limitations,qualification:c.qualification||null,reviewDueAt:c.reviewDueAt}));
function eligibleConversationDocuments(s:WorkspaceState,a:ActorContext,c:Conversation){return documentHeads(s.documents).filter(d=>canRead(s,a,d)&&conversationEvidenceAudience(s,c,d)&&d.status!=='superseded'&&currentEvidenceLineage(s,d)&&s.sources.some(x=>x.id===d.sourceId&&conversationEvidenceAudience(s,c,x)&&currentSourceEvidence(s,x)&&legalSourceAnswerEligible(s,a,x)));}
function conversationHistoryThrough(s:WorkspaceState,a:ActorContext,c:Conversation,userMessageId:string){const end=s.messages.findIndex(message=>message.id===userMessageId);if(end<0)throw failure();return s.messages.slice(0,end+1).filter(x=>x.conversationId===c.id&&x.role==='user'&&canRead(s,a,x)&&conversationEvidenceAudience(s,c,x)&&x.voiceConfirmed&&currentEvidenceLineage(s,x)).slice(-6);}
function currentConversationScenario(s:WorkspaceState,a:ActorContext,c:Conversation){return c.scenarioId?s.scenarios.find(x=>x.id===c.scenarioId&&canRead(s,a,x)&&conversationEvidenceAudience(s,c,x)&&currentEvidenceLineage(s,x)):undefined;}
/** Tenant, membership and current lineage are checked on every retrieval; no vector/index fallback. */
export function retrieveConversationEvidence(s:WorkspaceState,a:ActorContext,conversation:Conversation,userMessageId:string,selection?:{chunks:{kind:'document'|'source'|'fact';id:string;offset:number}[];hybrid:boolean}):EvidencePacket {
 membership(s,a);readRecord(s,a,s.conversations,conversation.id);if(conversation.channelGrant)assertSlackChannelGrant(s,conversation);const message=readRecord(s,a,s.messages,userMessageId);
 if(message.conversationId!==conversation.id||message.role!=='user'||!message.voiceConfirmed||!conversationEvidenceAudience(s,conversation,message)||!currentEvidenceLineage(s,message))throw failure();
 const focused=message.focusDocument?resolveFocusedDocument(s,a,conversation,message.focusDocument):null;
 const terms=[...new Set(message.text.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu)||[])];
 const score=(title:string,body:string)=>terms.reduce((n,t)=>n+(title.toLowerCase().includes(t)?5:0)+(body.toLowerCase().includes(t)?1:0),0)+(selection?.hybrid?0:retrievalStrategyBoost(s,a,conversation,{title,body},message.text));
 const eligible=eligibleConversationDocuments(s,a,conversation);
 const evidence:EvidenceItem[]=[],refs:EvidenceReference[]=[reference('message',message)];
 const sourceIds=new Set<string>(),factIds=new Set<string>();
 const excerpt=(body:string,kind:'document'|'source',id:string)=>{const offsets=selection?.chunks.filter(c=>c.kind===kind&&c.id===id).map(c=>c.offset);return (offsets?.length?expandSourceContext(structuredSourceChunks(body),offsets):rankSourceChunks(body,message.text)).chunks;};
 const structure=(chunk:SourceChunk,kind:'document'|'source',id:string):EvidenceItem['structure']=>({version:chunk.structureVersion,kind:chunk.kind,label:chunk.label,parentAnchor:chunk.parentOffset===null?null:`${kind}:${id}:chars:${chunk.parentOffset}`});
 const traversed=new Set<string>();
 const addDependencies=(record:RecordBase)=>{if(traversed.has(record.id))return;traversed.add(record.id);for(const id of record.provenance.sourceIds){const source=readRecord(s,a,s.sources,id);sourceIds.add(id);refs.push(reference('source',source));addDependencies(source);}for(const id of record.provenance.factIds||[]){const fact=readRecord(s,a,s.facts,id);factIds.add(id);refs.push(reference('fact',fact));addDependencies(fact);}};
 addDependencies(message);
 const ranked=eligible.map(d=>({d,score:score(d.title,d.body)})).sort((x,y)=>y.score-x.score||x.d.id.localeCompare(y.d.id));
 const selected=focused?ranked.filter(x=>x.d.id===focused.id):selection?ranked.filter(x=>selection.chunks.some(c=>c.kind==='document'&&c.id===x.d.id)):ranked.some(x=>x.score>0)?ranked.filter(x=>x.score>0).slice(0,6):ranked.length===1?ranked:[];
 if(focused&&!selected.length)throw failure();
 if(focused&&selection&&!selection.chunks.some(c=>c.kind==='document'&&c.id===focused.id))throw new V2Error('FOCUS_DOCUMENT_NOT_RETRIEVED','The inspected document was not selected by retrieval. Send a new message after reviewing its current revision.');
 for(const {d} of selected){
  const source=readRecord(s,a,s.sources,d.sourceId);sourceIds.add(source.id);refs.push(reference('source',source),reference('document',d));addDependencies(d);
  for(const chunk of excerpt(d.body,'document',d.id))evidence.push({id:`document:${d.id}:${chunk.offset}`,kind:'document',title:d.title,quote:chunk.text,sourceId:source.id,factId:null,anchor:`document:${d.id}:chars:${chunk.offset}-${chunk.end}`,authority:d.authority,practice:null,structure:structure(chunk,'document',d.id)});
 }
 for(const source of (focused?[]:s.sources.filter(x=>canRead(s,a,x)&&conversationEvidenceAudience(s,conversation,x)&&currentEvidenceLineage(s,x)&&legalSourceAnswerEligible(s,a,x)&&!s.documents.some(d=>d.sourceId===x.id)).map(source=>({source,score:score(source.title,source.text)})).filter(x=>selection?selection.chunks.some(c=>c.kind==='source'&&c.id===x.source.id):x.score>0).sort((x,y)=>y.score-x.score||x.source.id.localeCompare(y.source.id)).slice(0,selection?16:4).map(x=>x.source))){
  sourceIds.add(source.id);refs.push(reference('source',source));addDependencies(source);for(const chunk of excerpt(source.text,'source',source.id))evidence.push({id:`source:${source.id}:${chunk.offset}`,kind:'source',title:source.title,quote:chunk.text,sourceId:source.id,factId:null,anchor:`source:${source.id}:chars:${chunk.offset}-${chunk.end}`,authority:source.authority,practice:null,observedAt:source.observedAt,effectiveAt:source.effectiveAt,externalRevision:source.externalRevision,structure:structure(chunk,'source',source.id)});
 }
 for(const fact of (focused?[]:s.facts.filter(f=>(!selection||selection.chunks.some(c=>c.kind==='fact'&&c.id===f.id))&&factCurrentlyConfirmed(f)&&currentEvidenceLineage(s,f)&&f.reuse==='company'&&f.entityId===conversation.entityId&&(f.subjectEntityId||s.entityId)===(conversation.subjectEntityId||s.entityId)&&canRead(s,a,f)&&conversationEvidenceAudience(s,conversation,f)).sort((x,y)=>score(y.predicate,JSON.stringify(y.value))-score(x.predicate,JSON.stringify(x.value))||x.id.localeCompare(y.id)).slice(0,12))){
  factIds.add(fact.id);refs.push(reference('fact',fact));addDependencies(fact);evidence.push({id:`fact:${fact.id}`,kind:'fact',title:fact.predicate,quote:JSON.stringify({predicate:fact.predicate,value:fact.value,practice:fact.practice,confirmedAt:fact.confirmedAt}),sourceId:null,factId:fact.id,anchor:`fact:${fact.id}`,authority:'confirmed_company_assertion',practice:fact.practice});
 }
 if(selection){const order=new Map(selection.chunks.map((c,i)=>[c.kind==='fact'?`fact:${c.id}`:`${c.kind}:${c.id}:${c.offset}`,i]));evidence.sort((a,b)=>(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER));}
 const scenario=currentConversationScenario(s,a,conversation);
 if(scenario&&!focused){refs.push(reference('scenario',scenario));addDependencies(scenario);}
 const history=conversationHistoryThrough(s,a,conversation,message.id);
 if(!focused)for(const item of history){refs.push(reference('message',item));addDependencies(item);}
 // Inventory enumerates every currently authorized executed agreement in this workspace; it
 // does not establish that all customer contracts were uploaded, indexed or selected.
 const inventory=eligible.filter(d=>d.kind==='agreement'&&d.authority==='executed'&&(!focused||d.id===focused.id));
 for(const d of inventory){refs.push(reference('document',d),reference('source',readRecord(s,a,s.sources,d.sourceId)));sourceIds.add(d.sourceId);addDependencies(d);}
 for(const authority of s.legalAuthorities.filter(x=>canRead(s,a,x)&&conversationEvidenceAudience(s,conversation,x)&&currentEvidenceLineage(s,x))){const linked=evidence.filter(e=>e.sourceId===authority.sourceId);if(linked.length){refs.push(reference('authority',authority));addDependencies(authority);for(const e of linked)e.authority+=`; registered ${authority.authorityType} for ${authority.domain}/${authority.jurisdiction}; named source review ${authorityCurrent(s,a,authority)?'current':'unverified or stale'}`;}}
 if(!focused)for(const entry of s.coverage.filter(x=>canRead(s,a,x)&&conversationEvidenceAudience(s,conversation,x)&&currentEvidenceLineage(s,x))){refs.push(reference('coverage',entry));addDependencies(entry);}
 if(inventory.length>100)throw new V2Error('INVENTORY_TOO_LARGE','Narrow the authorized scope before requesting an agreement inventory.');
 let used=0;const boundedEvidence=evidence.filter((item,index)=>{if(index>=24||used+item.quote.length>40000)return false;used+=item.quote.length;return true;});
 return {version:selection?.hybrid?'v2-atlas-hybrid-1':'v2-exact-keyword-1',userMessageId:message.id,...(conversation.scope.kind==='private'?{}:{audienceScopeHash:scopeAudienceHash(conversation.scope)}),...(focused?{focusDocument:structuredClone(message.focusDocument!)}:{}),coverage:focused?[]:coveragePacket(s,a,conversation),question:message.text,history:focused?[]:history.map(x=>({role:'user',text:x.text})),evidence:boundedEvidence,references:[...new Map(refs.map(r=>[`${r.kind}:${r.id}`,r])).values()],sourceIds:[...sourceIds],factIds:[...factIds],hypotheses:focused?[]:scenario?.assumptions||[],agreementInventory:inventory.map(d=>({documentId:d.id,title:d.title,authority:d.authority,amendsDocumentId:d.amendsDocumentId})),inventoryStatement:focused?FOCUSED_INVENTORY_STATEMENT:INVENTORY_STATEMENT,limitations:focused?focusedLimitations(selection?.hybrid?'v2-atlas-hybrid-1':'v2-exact-keyword-1'):unfocusedLimitations(selection?.hybrid?'v2-atlas-hybrid-1':'v2-exact-keyword-1')};
}
/** Rechecks every referenced record and its current ACL, not just cached search results. */
function rehydrateEvidenceItem(s:WorkspaceState,a:ActorContext,c:Conversation,packet:EvidencePacket,item:EvidenceItem):EvidenceItem {
 const parts=typeof item.id==='string'?item.id.split(':'):[];
 const referenced=(kind:EvidenceReference['kind'],id:string)=>packet.references.some(ref=>ref.kind===kind&&ref.id===id);
 const structure=(chunk:SourceChunk,kind:'document'|'source',id:string):EvidenceItem['structure']=>({version:chunk.structureVersion,kind:chunk.kind,label:chunk.label,parentAnchor:chunk.parentOffset===null?null:`${kind}:${id}:chars:${chunk.parentOffset}`});
 let expected:EvidenceItem;let draftBasis=false;
 if(item.kind==='document'){
  draftBasis=parts[2]==='draft-basis';if(parts.length!==3||parts[0]!=='document'||!draftBasis&&!/^\d+$/.test(parts[2])||!referenced('document',parts[1]))throw failure();
  const document=s.documents.find(d=>d.id===parts[1]),offset=Number(parts[2]);if(!document||!canRead(s,a,document)||!conversationEvidenceAudience(s,c,document)||!documentHeads(s.documents).some(d=>d.id===document.id)||!currentEvidenceLineage(s,document)||!referenced('source',document.sourceId)||!packet.sourceIds.includes(document.sourceId))throw failure();
  const source=s.sources.find(x=>x.id===document.sourceId),chunk=draftBasis?null:structuredSourceChunks(document.body).find(x=>x.offset===offset);if(!source||!draftBasis&&!chunk||!canRead(s,a,source)||!conversationEvidenceAudience(s,c,source)||!currentSourceEvidence(s,source)||!legalSourceAnswerEligible(s,a,source))throw failure();
  if(draftBasis){const user=packet.userMessageId?s.messages.find(m=>m.id===packet.userMessageId):null;if(!user||user.intent!=='instruction'||c.activeDocumentId!==document.id||document.body.length>24000)throw failure();expected={id:`document:${document.id}:draft-basis`,kind:'document',title:document.title,quote:document.body,sourceId:source.id,factId:null,anchor:`document:${document.id}:chars:0-${document.body.length}`,authority:document.authority,practice:null};}
  else expected={id:`document:${document.id}:${chunk!.offset}`,kind:'document',title:document.title,quote:chunk!.text,sourceId:source.id,factId:null,anchor:`document:${document.id}:chars:${chunk!.offset}-${chunk!.end}`,authority:document.authority,practice:null,structure:structure(chunk!,'document',document.id)};
 }else if(item.kind==='source'){
  if(parts.length!==3||parts[0]!=='source'||!/^\d+$/.test(parts[2])||!referenced('source',parts[1])||!packet.sourceIds.includes(parts[1]))throw failure();
  const source=s.sources.find(x=>x.id===parts[1]),offset=Number(parts[2]);if(!source||!canRead(s,a,source)||!conversationEvidenceAudience(s,c,source)||!currentEvidenceLineage(s,source)||!legalSourceAnswerEligible(s,a,source)||s.documents.some(d=>d.sourceId===source.id))throw failure();
  const chunk=structuredSourceChunks(source.text).find(x=>x.offset===offset);if(!chunk)throw failure();
  expected={id:`source:${source.id}:${chunk.offset}`,kind:'source',title:source.title,quote:chunk.text,sourceId:source.id,factId:null,anchor:`source:${source.id}:chars:${chunk.offset}-${chunk.end}`,authority:source.authority,practice:null,observedAt:source.observedAt,effectiveAt:source.effectiveAt,externalRevision:source.externalRevision,structure:structure(chunk,'source',source.id)};
 }else if(item.kind==='fact'){
  if(parts.length!==2||parts[0]!=='fact'||!referenced('fact',parts[1])||!packet.factIds.includes(parts[1]))throw failure();
  const fact=s.facts.find(x=>x.id===parts[1]);if(!fact||!canRead(s,a,fact)||!conversationEvidenceAudience(s,c,fact)||!factCurrentlyConfirmed(fact)||!currentEvidenceLineage(s,fact)||fact.reuse!=='company'||fact.entityId!==c.entityId||(fact.subjectEntityId||s.entityId)!==(c.subjectEntityId||s.entityId))throw failure();
  expected={id:`fact:${fact.id}`,kind:'fact',title:fact.predicate,quote:JSON.stringify({predicate:fact.predicate,value:fact.value,practice:fact.practice,confirmedAt:fact.confirmedAt}),sourceId:null,factId:fact.id,anchor:`fact:${fact.id}`,authority:'confirmed_company_assertion',practice:fact.practice};
 }else throw failure();
 if(expected.sourceId&&!draftBasis)for(const authority of s.legalAuthorities.filter(x=>x.sourceId===expected.sourceId&&referenced('authority',x.id)))expected.authority+=`; registered ${authority.authorityType} for ${authority.domain}/${authority.jurisdiction}; named source review ${authorityCurrent(s,a,authority)?'current':'unverified or stale'}`;
 return expected;
}
export function recheckEvidence(s:WorkspaceState,a:ActorContext,conversationId:string,packet:EvidencePacket,expectedUserMessageId?:string,metadataMode:'ordinary'|'other'='other'){
 membership(s,a);const conversation=readRecord(s,a,s.conversations,conversationId);if(conversation.channelGrant)assertSlackChannelGrant(s,conversation);if(expectedUserMessageId&&packet.userMessageId!==expectedUserMessageId)throw failure();const userReference=packet.references.find(ref=>ref.kind==='message'),userMessage=packet.userMessageId?s.messages.find(x=>x.id===packet.userMessageId):undefined;if(packet.userMessageId&&(!userReference||userReference.id!==packet.userMessageId||!userMessage||userMessage.conversationId!==conversation.id||userMessage.role!=='user'))throw failure();if(userMessage&&packet.question!==userMessage.text)throw failure();if(conversation.scope.kind!=='private'&&packet.userMessageId&&packet.audienceScopeHash!==scopeAudienceHash(conversation.scope))throw failure();if(packet.focusDocument&&packet.history.length)throw failure();if(packet.focusDocument||userMessage?.focusDocument){if(!userMessage||digest(userMessage.focusDocument||null)!==digest(packet.focusDocument||null))throw failure();resolveFocusedDocument(s,a,conversation,packet.focusDocument!);}if(packet.audienceScopeHash&&packet.audienceScopeHash!==scopeAudienceHash(conversation.scope))throw failure();if(digest(packet.coverage)!==digest(packet.focusDocument?[]:coveragePacket(s,a,conversation,packet.audienceScopeHash)))throw failure();
 if(packet.focusDocument){
  const document=resolveFocusedDocument(s,a,conversation,packet.focusDocument);
  const expectedInventory=document.kind==='agreement'&&document.authority==='executed'?[{documentId:document.id,title:document.title,authority:document.authority,amendsDocumentId:document.amendsDocumentId}]:[];
  if(!['v2-exact-keyword-1','v2-atlas-hybrid-1'].includes(packet.version)||digest(packet.agreementInventory)!==digest(expectedInventory)||digest(packet.hypotheses)!==digest([])||packet.inventoryStatement!==FOCUSED_INVENTORY_STATEMENT||digest(packet.limitations)!==digest(focusedLimitations(packet.version)))throw failure();
 }
 if(metadataMode==='ordinary'&&!packet.focusDocument){
  if(!userMessage||!['v2-exact-keyword-1','v2-atlas-hybrid-1'].includes(packet.version))throw failure();
  const history=conversationHistoryThrough(s,a,conversation,userMessage.id).map(message=>({role:'user' as const,text:message.text}));
  const scenario=currentConversationScenario(s,a,conversation);
  const inventory=eligibleConversationDocuments(s,a,conversation).filter(document=>document.kind==='agreement'&&document.authority==='executed').map(document=>({documentId:document.id,title:document.title,authority:document.authority,amendsDocumentId:document.amendsDocumentId}));
  if(inventory.length>100||digest(packet.history)!==digest(history)||digest(packet.hypotheses)!==digest(scenario?.assumptions||[])||digest(packet.agreementInventory)!==digest(inventory)||packet.inventoryStatement!==INVENTORY_STATEMENT||digest(packet.limitations)!==digest(unfocusedLimitations(packet.version)))throw failure();
 }
 for(const ref of packet.references){const record=records(s,ref.kind).find(x=>x.id===ref.id);if(!record||!canRead(s,a,record)||packet.audienceScopeHash&&!withinConversationAudience(s,conversation,record)||!conversationEvidenceAudience(s,conversation,record)||!currentEvidenceLineage(s,record)||fingerprint(record)!==ref.hash||ref.kind==='document'&&!documentHeads(s.documents).some(d=>d.id===ref.id))throw failure();if(ref.kind==='source'&&!legalSourceAnswerEligible(s,a,record as WorkspaceState['sources'][number]))throw failure();if(ref.kind==='document'){const source=s.sources.find(x=>x.id===(record as WorkspaceState['documents'][number]).sourceId);if(!source||!legalSourceAnswerEligible(s,a,source))throw failure();}}
 const hasDraftBasis=Array.isArray(packet.evidence)&&packet.evidence.some(item=>item?.kind==='document'&&typeof item.id==='string'&&item.id.endsWith(':draft-basis'));
 if(!Array.isArray(packet.evidence)||packet.evidence.length>(hasDraftBasis?25:24)||packet.evidence.reduce((count,item)=>count+(typeof item?.quote==='string'?item.quote.length:64001),0)>(hasDraftBasis?64000:40000)||new Set(packet.evidence.map(item=>item?.id)).size!==packet.evidence.length)throw failure();
 if(packet.focusDocument&&(!packet.evidence.length||packet.evidence.some(item=>item.kind!=='document'||item.id.split(':')[1]!==packet.focusDocument!.documentId)))throw failure();
 for(const item of packet.evidence)if(!item||digest(item)!==digest(rehydrateEvidenceItem(s,a,conversation,packet,item)))throw failure();
 for(const id of packet.factIds){const fact=readRecord(s,a,s.facts,id);if(!factCurrentlyConfirmed(fact))throw failure();}
}
