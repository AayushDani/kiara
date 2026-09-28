import {randomUUID} from 'node:crypto';
import {canRead,readRecord,requireRole} from './authority';
import {documentHeads} from './document-lifecycle';
import {factCurrentlyConfirmed} from './fact-validity';
import {inventoryCurrent,type AgreementInventory} from './inventory';
import {scopeAudienceHash} from './integrations/slack-scope';
import {memoryEntityCurrent} from './company-memory-validity';
import {withinConversationAudience} from './retrieval';
import {currentEvidenceLineage} from './source-lifecycle';
import {digest,timestamp} from './store';
import {V2Error,type ActorContext,type Conversation,type DocumentRecord,type Proposal,type RecordBase,type WorkspaceState} from './contracts';

export interface AgreementApplicability extends RecordBase {
 matterId:string;
 inventoryId:string;
 inventoryHash:string;
 reviewerId:string;
 reviewerMembershipVersion:number;
 status:'current'|'withdrawn';
 target:{transaction:string;jurisdiction:string;counterpartyEntityId:string|null;counterpartyHash:string|null;productEntityIds:string[];productHashes:Record<string,string>;factIds:string[];factHashes:Record<string,string>;matterContextHash:string;matterFactHashes:Record<string,string>;matterSourceVersions:Record<string,number>};
 rows:{documentId:string;documentHash:string;assessment:'notice_required'|'no_notice'|'unknown';clause:{start:number;end:number;quote:string}|null;reason:string;notice:{trigger:string;recipients:string[];channel:string;timing:string}|null}[];
 withdrawalReason:string|null;
}
export type ApplicabilityState=WorkspaceState&{applicabilityAssessments?:AgreementApplicability[]};
export type ApplicabilityCommand=
 |{type:'applicability.record';inspectedVersion:number;inventoryId:string;target:{transaction:string;jurisdiction:string;counterpartyEntityId:string|null;productEntityIds:string[];factIds:string[]};rows:{documentId:string;assessment:'notice_required'|'no_notice'|'unknown';clause:{start:number;end:number;quote:string}|null;reason:string;notice?:{trigger:string;recipients:string[];channel:string;timing:string}|null}[]}
 |{type:'applicability.withdraw';assessmentId:string;expectedRecordVersion:number;reason:string};
export const applicabilityCommandFields={'applicability.record':['inspectedVersion','inventoryId','target','rows'],'applicability.withdraw':['assessmentId','expectedRecordVersion','reason']};
function ensure(condition:unknown,code:string,message:string):asserts condition {if(!condition)throw new V2Error(code,message);}
function shortText(value:unknown,max:number){ensure(typeof value==='string'&&value.trim().length>0&&value.length<=max,'APPLICABILITY_REASON','Provide a specific bounded reason.');return (value as string).trim();}
const inMatterAudience=(s:ApplicabilityState,m:WorkspaceState['matters'][number],record:RecordBase)=>withinConversationAudience(s,m as unknown as Conversation,record);
function boundInventory(s:ApplicabilityState,a:ActorContext,i:AgreementInventory){
 ensure(inventoryCurrent(s,i)&&canRead(s,a,i),'APPLICABILITY_INVENTORY_CHANGED','The named supplied agreement register is no longer current or available.');
 const m=readRecord(s,a,s.matters,i.matterId);
 ensure(scopeAudienceHash(m.scope)===scopeAudienceHash(i.scope)&&inMatterAudience(s,m,i),'APPLICABILITY_SCOPE_CHANGED','The matter and all register dependencies need the exact audience.');
 return m;
}
function rowDocument(s:ApplicabilityState,a:ActorContext,i:AgreementInventory,id:string){
 const d=readRecord(s,a,s.documents,id);
 const m=s.matters.find(matter=>matter.id===i.matterId);ensure(m&&inMatterAudience(s,m,d)&&i.documentIds.includes(id)&&i.documentHashes[id]===d.contentHash&&digest(d.body)===d.contentHash&&documentHeads(s.documents).some(head=>head.id===id)&&currentEvidenceLineage(s,d),'APPLICABILITY_DOCUMENT_CHANGED','Review the current agreement or amendment and its exact-audience dependencies in the supplied register.');
 return d;
}
function clauseFor(d:DocumentRecord,input:AgreementApplicability['rows'][number]['clause']){
 ensure(input&&Number.isSafeInteger(input.start)&&Number.isSafeInteger(input.end)&&input.start>=0&&input.end>input.start&&input.end<=d.body.length&&typeof input.quote==='string'&&input.quote.length<=8000&&d.body.slice(input.start,input.end)===input.quote,'APPLICABILITY_CLAUSE','Select an exact clause in the reviewed agreement revision.');
 return structuredClone(input);
}
const matterContextHash=(m:WorkspaceState['matters'][number])=>digest({objective:m.objective,scenarioId:m.scenarioId,factIds:m.factIds,sourceIds:m.sourceIds,eventIds:m.eventIds,scope:m.scope});
function entityFor(s:ApplicabilityState,a:ActorContext,m:WorkspaceState['matters'][number],id:string,kind:'counterparty'|'product'){
 const entity=readRecord(s,a,s.memoryEntities||[],id);
 ensure(entity.kind===kind&&scopeAudienceHash(entity.scope)===scopeAudienceHash(m.scope)&&inMatterAudience(s,m,entity)&&memoryEntityCurrent(s,entity.id),'APPLICABILITY_TARGET_CHANGED','Select a current, exact declared target with the matter audience.');
 return entity;
}
function targetIds(value:unknown,max:number){ensure(Array.isArray(value)&&value.length<=max&&value.every(id=>typeof id==='string'&&id.length>0)&&new Set(value).size===value.length,'APPLICABILITY_TARGET','Select distinct exact target identifiers.');return value as string[];}
export function applicabilityCurrent(s:ApplicabilityState,a:ActorContext,item:AgreementApplicability){
 try{
  if(item.status!=='current'||item.tenantId!==s.tenantId||!canRead(s,a,item))return false;
  const position=s.applicabilityAssessments?.findIndex(candidate=>candidate.id===item.id)??-1;
  if(position<0||s.applicabilityAssessments!.slice(position+1).some(candidate=>candidate.matterId===item.matterId))return false;
  const i=s.inventories?.find(candidate=>candidate.id===item.inventoryId);if(!i||digest(i)!==item.inventoryHash)return false;
  const m=boundInventory(s,a,i),reviewer=s.memberships.find(member=>member.actorId===item.reviewerId);
  if(m.id!==item.matterId||matterContextHash(m)!==item.target.matterContextHash||!reviewer||reviewer.revokedAt||reviewer.expiresAt&&Date.parse(reviewer.expiresAt)<=Date.now()||reviewer.version!==item.reviewerMembershipVersion||!reviewer.roles.includes('legal_reviewer'))return false;
  if(!canRead(s,{...a,actorId:reviewer.actorId},item))return false;
  if(item.target.counterpartyEntityId&&digest(entityFor(s,a,m,item.target.counterpartyEntityId,'counterparty'))!==item.target.counterpartyHash)return false;
  for(const id of item.target.productEntityIds)if(digest(entityFor(s,a,m,id,'product'))!==item.target.productHashes[id])return false;
  for(const id of m.factIds){const fact=readRecord(s,a,s.facts,id);if(!inMatterAudience(s,m,fact)||!factCurrentlyConfirmed(fact)||!currentEvidenceLineage(s,fact)||digest(fact)!==item.target.matterFactHashes[id])return false;}
  for(const id of item.target.factIds){const fact=readRecord(s,a,s.facts,id);if(!m.factIds.includes(id)||!inMatterAudience(s,m,fact)||!factCurrentlyConfirmed(fact)||!currentEvidenceLineage(s,fact)||digest(fact)!==item.target.factHashes[id])return false;}
  for(const [id,version] of Object.entries(item.target.matterSourceVersions)){const source=readRecord(s,a,s.sources,id);if(!inMatterAudience(s,m,source)||source.version!==version||!currentEvidenceLineage(s,source))return false;}
  if(item.rows.length!==i.documentIds.length)return false;
  for(const row of item.rows){const d=rowDocument(s,a,i,row.documentId);if(row.documentHash!==d.contentHash||row.clause&&d.body.slice(row.clause.start,row.clause.end)!==row.clause.quote)return false;if(row.assessment==='notice_required'&&(!row.notice||!row.notice.trigger||!row.notice.channel||!row.notice.timing||!row.notice.recipients.length))return false;}
  return true;
 }catch{return false;}
}
export function applicabilityViews(s:ApplicabilityState,a:ActorContext){return (s.applicabilityAssessments||[]).filter(item=>canRead(s,a,item)).map(item=>({...structuredClone(item),current:applicabilityCurrent(s,a,item),limitation:'Named legal review of the supplied register and exact clause revisions. Unknown rows remain unresolved. It does not certify missing external agreements or authorize notices.'}));}
export function currentApplicability(s:ApplicabilityState,a:ActorContext,matterId:string){return [...s.applicabilityAssessments||[]].reverse().find(item=>item.matterId===matterId&&applicabilityCurrent(s,a,item));}
export function applicabilityBinding(item:AgreementApplicability){return {id:item.id,hash:digest(item),inventoryId:item.inventoryId};}
export function applicabilityMatrix(s:ApplicabilityState,a:ActorContext,matterId:string,documents:DocumentRecord[]){
 const assessment=currentApplicability(s,a,matterId);
 const rows=documents.filter(document=>document.kind==='agreement'||!!document.amendsDocumentId).map(document=>{
  const row=assessment?.rows.find(item=>item.documentId===document.id);
  return {documentId:document.id,title:document.title,documentRevision:document.revision,documentHash:document.contentHash,clause:row?.clause?`${row.clause.quote}\nReviewer basis: ${row.reason}`:row?`Unresolved: ${row.reason}`:'Review this complete supplied agreement and amendments for the exact objective; applicability and notice remain unverified.',clauseOffsets:row?.clause?{start:row.clause.start,end:row.clause.end}:null,reason:row?.reason||null,notice:row?.notice||null,status:row?row.assessment==='unknown'?'unknown' as const:'confirmed' as const:'review_required' as const,...(row?{assessment:row.assessment,reviewerId:assessment!.reviewerId}:{})};
 });
 return {assessment,binding:assessment?applicabilityBinding(assessment):null,rows,unknowns:rows.filter(row=>row.status!=='confirmed').map(row=>`Agreement applicability remains unresolved for ${row.title} (${row.documentId}).`)};
}
export function assertProposalApplicability(s:ApplicabilityState,a:ActorContext,p:Proposal){
 const current=currentApplicability(s,a,p.matterId),bound=p.applicability;
 ensure((current?.id||null)===(bound?.id||null),'APPLICABILITY_CHANGED','A later agreement applicability review requires a new proposal.');
 if(bound)ensure(current&&digest(current)===bound.hash&&current.inventoryId===bound.inventoryId,'APPLICABILITY_CHANGED','The exact reviewed agreement matrix changed; prepare a new proposal.');
}
export function applyApplicabilityCommand(s:ApplicabilityState,a:ActorContext,c:ApplicabilityCommand):Record<string,unknown>{
 s.applicabilityAssessments??=[];
 if(c.type==='applicability.withdraw'){
  const item=readRecord(s,a,s.applicabilityAssessments,c.assessmentId);requireRole(s,a,'legal_reviewer',item);ensure(item.version===c.expectedRecordVersion,'VERSION_CONFLICT','Inspect the current assessment.');ensure(item.status==='current','APPLICABILITY_WITHDRAWN','This assessment is already withdrawn.');item.status='withdrawn';item.withdrawalReason=shortText(c.reason,2000);item.version++;item.updatedAt=timestamp();return {assessmentId:item.id};
 }
 ensure(Number.isSafeInteger(c.inspectedVersion)&&c.inspectedVersion===s.version,'APPLICABILITY_INSPECTION_CHANGED','Review the current supplied register and all agreement revisions.');
 const i=readRecord(s,a,s.inventories||[],c.inventoryId),m=boundInventory(s,a,i),reviewer=requireRole(s,a,'legal_reviewer',m);
 ensure(c.target&&typeof c.target==='object','APPLICABILITY_TARGET','Describe the exact target business change.');const transaction=shortText(c.target.transaction,500),jurisdiction=shortText(c.target.jurisdiction,120),productEntityIds=targetIds(c.target.productEntityIds,20),factIds=targetIds(c.target.factIds,30);
 ensure(c.target.counterpartyEntityId===null||typeof c.target.counterpartyEntityId==='string'&&c.target.counterpartyEntityId.length>0,'APPLICABILITY_TARGET','Select an exact counterparty or leave it explicitly unknown.');
 ensure(transaction===m.objective.trim(),'APPLICABILITY_TARGET_CHANGED','Assess the exact current matter objective as the target transaction.');
 const counterparty=c.target.counterpartyEntityId?entityFor(s,a,m,c.target.counterpartyEntityId,'counterparty'):null,products=productEntityIds.map(id=>entityFor(s,a,m,id,'product'));
 const matterFacts=m.factIds.map(id=>readRecord(s,a,s.facts,id));ensure(matterFacts.every(fact=>inMatterAudience(s,m,fact)&&factCurrentlyConfirmed(fact)&&currentEvidenceLineage(s,fact)),'APPLICABILITY_TARGET_CHANGED','Confirm the exact current matter facts and all same-audience dependencies before legal applicability review.');
 const selectedFacts=factIds.map(id=>readRecord(s,a,s.facts,id));ensure(selectedFacts.every(fact=>m.factIds.includes(fact.id)&&inMatterAudience(s,m,fact)&&factCurrentlyConfirmed(fact)&&currentEvidenceLineage(s,fact)),'APPLICABILITY_TARGET_CHANGED','Select current confirmed facts bound to this matter and audience.');
 const matterSources=m.sourceIds.map(id=>readRecord(s,a,s.sources,id));ensure(matterSources.every(source=>inMatterAudience(s,m,source)&&currentEvidenceLineage(s,source)),'APPLICABILITY_TARGET_CHANGED','The matter source context changed or has another audience.');
 ensure(Array.isArray(c.rows)&&c.rows.length===i.documentIds.length&&c.rows.every(row=>row&&typeof row==='object'&&typeof row.documentId==='string')&&new Set(c.rows.map(row=>row.documentId)).size===c.rows.length&&c.rows.every(row=>i.documentIds.includes(row.documentId)),'APPLICABILITY_SET_CHANGED','Assess every agreement and amendment in the named supplied register exactly once.');
 const rows=c.rows.map(row=>{const d=rowDocument(s,a,i,row.documentId);ensure(['notice_required','no_notice','unknown'].includes(row.assessment),'APPLICABILITY_STATUS','Choose a supported assessment status.');ensure(row.assessment==='unknown'||d.authority==='executed','APPLICABILITY_EXECUTED_REQUIRED','An unsigned or draft record cannot resolve an operative customer notice requirement.');const reason=shortText(row.reason,2000);const clause=row.assessment==='unknown'?(ensure(row.clause===null,'APPLICABILITY_UNKNOWN_CLAUSE','An unknown assessment cannot claim a decisive clause.'),null):clauseFor(d,row.clause);let notice:AgreementApplicability['rows'][number]['notice']=null;if(row.assessment==='notice_required'){ensure(row.notice&&typeof row.notice==='object','APPLICABILITY_NOTICE_DETAIL','Record the exact trigger, recipients, channel and timing for a required notice.');ensure(Array.isArray(row.notice.recipients)&&row.notice.recipients.length>0&&row.notice.recipients.length<=20,'APPLICABILITY_NOTICE_DETAIL','Select bounded recipient descriptions.');const recipients=row.notice.recipients.map(value=>shortText(value,200));ensure(new Set(recipients).size===recipients.length,'APPLICABILITY_NOTICE_DETAIL','Select distinct recipient descriptions.');notice={trigger:shortText(row.notice.trigger,500),recipients,channel:shortText(row.notice.channel,200),timing:shortText(row.notice.timing,300)};}else ensure(!row.notice,'APPLICABILITY_NOTICE_DETAIL','A no-notice or unknown row cannot prescribe notice delivery.');return {documentId:d.id,documentHash:d.contentHash,assessment:row.assessment,clause,reason,notice};}).sort((left,right)=>left.documentId.localeCompare(right.documentId));
 ensure(rows.every(row=>row.assessment==='unknown')||!!counterparty&&factIds.length>0,'APPLICABILITY_TARGET_REQUIRED','A resolved legal conclusion requires an exact declared counterparty and at least one selected confirmed matter fact.');
 const target:AgreementApplicability['target']={transaction,jurisdiction,counterpartyEntityId:counterparty?.id||null,counterpartyHash:counterparty?digest(counterparty):null,productEntityIds,productHashes:Object.fromEntries(products.map(product=>[product.id,digest(product)])),factIds,factHashes:Object.fromEntries(selectedFacts.map(fact=>[fact.id,digest(fact)])),matterContextHash:matterContextHash(m),matterFactHashes:Object.fromEntries(matterFacts.map(fact=>[fact.id,digest(fact)])),matterSourceVersions:Object.fromEntries(matterSources.map(source=>[source.id,source.version]))};
 const now=timestamp(),item:AgreementApplicability={id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(m.scope),provenance:{actorId:a.actorId,sourceIds:[...new Set([...i.provenance.sourceIds,...matterSources.map(source=>source.id),...counterparty?.provenance.sourceIds||[],...products.flatMap(product=>product.provenance.sourceIds),...matterFacts.flatMap(fact=>fact.provenance.sourceIds)])],factIds:matterFacts.map(fact=>fact.id),description:'Named legal reviewer assessment of the exact target, selected confirmed facts and every supplied agreement/amendment; unresolved rows remain explicit.'},matterId:m.id,inventoryId:i.id,inventoryHash:digest(i),reviewerId:a.actorId,reviewerMembershipVersion:reviewer.version,status:'current',target,rows,withdrawalReason:null};
 s.applicabilityAssessments.push(item);return {assessmentId:item.id,unknownCount:rows.filter(row=>row.assessment==='unknown').length};
}
