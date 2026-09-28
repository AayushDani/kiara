import {randomUUID} from 'node:crypto';
import {canRead,readRecord,requireRole} from './authority';
import {factCurrentlyConfirmed} from './fact-validity';
import {memoryEntityCurrent} from './company-memory-validity';
import {currentEvidenceLineage} from './source-lifecycle';
import {withinConversationAudience} from './retrieval';
import {sourceDependencyHash} from './tasks';
import {scopeAudienceHash} from './integrations/slack-scope';
import {digest,timestamp} from './store';
import {V2Error,type ActorContext,type Approval,type Conversation,type DocumentRecord,type FactAssertion,type Matter,type Proposal,type RecordBase,type WorkspaceState} from './contracts';
import type {MemoryEntity} from './company-memory';

/** A historical, attributed decision. It is never a standing policy or legal clearance. */
export interface ScopedPrecedent extends RecordBase {
 counterpartyEntityId:string;
 originMatterId:string;
 originProposalId:string;
 originProposalHash:string;
 businessApprovalId:string;
 businessApprovalHash:string;
 legalApprovalId:string;
 legalApprovalHash:string;
 documentId:string;
 documentRevision:number;
 documentContentHash:string;
 clause:{start:number;end:number;quote:string};
 context:{jurisdiction:string;transaction:string;effectiveFrom:string;reuseUntil:string;productEntityIds:string[];factIds:string[];factHashes:Record<string,string>};
 permittedAudienceHash:string;
 ownerId:string;
 legalReviewerId:string|null;
 legalReviewerMembershipVersion:number|null;
 legalReviewedAt:string|null;
 businessAdoptedBy:string|null;
 businessAdoptionMembershipVersion:number|null;
 businessAdoptedAt:string|null;
 status:'proposed'|'legal_reviewed'|'adopted'|'withdrawn';
 withdrawnAt:string|null;
 withdrawalReason:string|null;
}
/** Owner-confirmed target context; it is evidence for matching only, never legal clearance. */
export interface PrecedentTargetContext extends RecordBase {
 matterId:string;matterVersion:number;matterHash:string;ownerId:string;ownerMembershipVersion:number;
 counterpartyEntityId:string;counterpartyHash:string;jurisdiction:string;transaction:string;asOfDate:string;
 productEntityIds:string[];productHashes:Record<string,string>;factIds:string[];factHashes:Record<string,string>;
 sourceProofHash:string;permittedAudienceHash:string;status:'active'|'superseded';
}
export type PrecedentState=WorkspaceState&{scopedPrecedents?:ScopedPrecedent[];precedentTargets?:PrecedentTargetContext[];memoryEntities?:MemoryEntity[]};
export type ScopedPrecedentCommand=
 |{type:'precedent.target.set';inspectedVersion:number;matterId:string;expectedMatterVersion:number;counterpartyEntityId:string;jurisdiction:string;transaction:string;asOfDate:string;productEntityIds:string[];factIds:string[]}
 |{type:'precedent.propose';inspectedVersion:number;originMatterId:string;originProposalId:string;businessApprovalId:string;legalApprovalId:string;documentId:string;counterpartyEntityId:string;clause:{start:number;end:number;quote:string};context:{jurisdiction:string;transaction:string;effectiveFrom:string;reuseUntil:string;productEntityIds:string[];factIds:string[]}}
 |{type:'precedent.legal_review';precedentId:string;expectedRecordVersion:number;basisHash:string}
 |{type:'precedent.adopt';precedentId:string;expectedRecordVersion:number;basisHash:string}
 |{type:'precedent.withdraw';precedentId:string;expectedRecordVersion:number;reason:string};
export const scopedPrecedentCommandFields={
 'precedent.target.set':['inspectedVersion','matterId','expectedMatterVersion','counterpartyEntityId','jurisdiction','transaction','asOfDate','productEntityIds','factIds'],
 'precedent.propose':['inspectedVersion','originMatterId','originProposalId','businessApprovalId','legalApprovalId','documentId','counterpartyEntityId','clause','context'],
 'precedent.legal_review':['precedentId','expectedRecordVersion','basisHash'],
 'precedent.adopt':['precedentId','expectedRecordVersion','basisHash'],
 'precedent.withdraw':['precedentId','expectedRecordVersion','reason'],
};
const fail=(code:string,message:string,status=409):never=>{throw new V2Error(code,message,status);};
function ensure(condition:unknown,code:string,message:string,status=409):asserts condition {if(!condition)fail(code,message,status);}
const sameAudience=(a:RecordBase,b:RecordBase)=>scopeAudienceHash(a.scope)===scopeAudienceHash(b.scope);
const bounded=(value:unknown,max:number,label:string)=>{ensure(typeof value==='string'&&value.trim().length>0&&value.length<=max,'PRECEDENT_INPUT',`Provide ${label} within ${max} characters.`,400);return (value as string).trim();};
function exactDate(value:unknown){ensure(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString().slice(0,10)===value,'PRECEDENT_DATE','Use an exact existing calendar date (YYYY-MM-DD).',400);return value as string;}
const approvalHash=(approval:Approval)=>digest({id:approval.id,actorId:approval.actorId,membershipVersion:approval.membershipVersion,capacity:approval.capacity,proposalId:approval.proposalId,proposalHash:approval.proposalHash,dependencies:approval.dependencies,conditions:approval.conditions,validUntil:approval.validUntil});
const touched=(record:RecordBase)=>{record.version++;record.updatedAt=timestamp();};
function entity(state:PrecedentState,actor:ActorContext,id:string,kind:MemoryEntity['kind']){
 const subject=readRecord(state,actor,state.memoryEntities||[],id);
 ensure(subject.kind===kind&&memoryEntityCurrent(state,subject.id),'PRECEDENT_SUBJECT','Choose a current exact declared subject with a current named owner.');
 return subject;
}
function ids(input:unknown,label:string){ensure(Array.isArray(input)&&input.length<=20&&input.every(id=>typeof id==='string'&&id.length>0)&&new Set(input).size===input.length,'PRECEDENT_INPUT',`Choose distinct exact ${label} identifiers.`,400);return input as string[];}
function targetBasis(state:PrecedentState,actor:ActorContext,matterId:string,counterpartyId:string,productIds:string[],factIds:string[]){
 const matter=readRecord(state,actor,state.matters,matterId);
 ensure(matter.entityId===state.entityId&&!matter.legacyWorkflowId&&!['closed','canceled'].includes(matter.state)&&currentEvidenceLineage(state,matter),'PRECEDENT_TARGET_CHANGED','Choose a current open matter with current evidence.');
 const exact=(record:RecordBase)=>scopeAudienceHash(record.scope)===scopeAudienceHash(matter.scope)&&withinConversationAudience(state,matter as unknown as Conversation,record)&&currentEvidenceLineage(state,record);
 ensure(exact(matter),'PRECEDENT_TARGET_SCOPE','The matter evidence must have one exact current audience.');
 const counterparty=entity(state,actor,counterpartyId,'counterparty');ensure(exact(counterparty),'PRECEDENT_TARGET_SCOPE','The counterparty and its declaration must have the matter audience.');
 const products=productIds.map(id=>entity(state,actor,id,'product'));ensure(products.every(exact),'PRECEDENT_TARGET_SCOPE','Each product and declaration must have the matter audience.');
 ensure(matter.factIds.length<=20&&matter.factIds.length===factIds.length&&matter.factIds.every(id=>factIds.includes(id)),'PRECEDENT_TARGET_FACT_SET','Review every exact fact bound to this matter; omitted or extra facts cannot establish a match.');
 const facts=factIds.map(id=>readRecord(state,actor,state.facts,id));ensure(facts.every(f=>matter.factIds.includes(f.id)&&f.entityId===matter.entityId&&f.reuse==='company'&&factCurrentlyConfirmed(f)&&exact(f)),'PRECEDENT_TARGET_FACT','Choose current confirmed company facts bound to this matter and audience.');
 const documents=matter.documentIds.map(id=>readRecord(state,actor,state.documents,id));ensure(documents.every(exact),'PRECEDENT_TARGET_SCOPE','The matter documents and source graph must have the exact current audience.');
 const sourceIds=[...new Set([...matter.sourceIds,...matter.provenance.sourceIds,...documents.flatMap(d=>[d.sourceId,...d.provenance.sourceIds]),...facts.flatMap(f=>f.provenance.sourceIds),...counterparty.provenance.sourceIds,...products.flatMap(p=>p.provenance.sourceIds)])];
 ensure(sourceIds.every(id=>{const source=readRecord(state,actor,state.sources,id);return exact(source);}), 'PRECEDENT_TARGET_SCOPE','Every source in the target context must have the exact current audience.');
 return {matter,counterparty,products,facts,sourceProofHash:sourceDependencyHash(state,sourceIds)};
}
/** A target is current only while its exact matter, owner, named subjects and recursive evidence remain unchanged. */
export function precedentTargetCurrent(state:PrecedentState,actor:ActorContext,target:PrecedentTargetContext):boolean{
 try{if(target.tenantId!==state.tenantId||target.status!=='active'||!canRead(state,actor,target)||target.permittedAudienceHash!==scopeAudienceHash(target.scope))return false;
  const owner=state.memberships.find(m=>m.actorId===target.ownerId);if(!owner||owner.revokedAt||owner.expiresAt&&Date.parse(owner.expiresAt)<=Date.now()||owner.version!==target.ownerMembershipVersion||!owner.roles.includes('business_owner'))return false;
  const ownerActor={...actor,actorId:target.ownerId};targetBasis(state,ownerActor,target.matterId,target.counterpartyEntityId,target.productEntityIds,target.factIds);
  const basis=targetBasis(state,actor,target.matterId,target.counterpartyEntityId,target.productEntityIds,target.factIds),matter=basis.matter;
  return matter.ownerId===target.ownerId&&matter.version===target.matterVersion&&digest(matter)===target.matterHash&&scopeAudienceHash(matter.scope)===target.permittedAudienceHash&&digest(basis.counterparty)===target.counterpartyHash&&basis.products.every(p=>digest(p)===target.productHashes[p.id])&&basis.facts.every(f=>digest(f)===target.factHashes[f.id])&&basis.sourceProofHash===target.sourceProofHash;
 }catch{return false;}
}
export function precedentTargetBasisHash(target:PrecedentTargetContext){return digest({id:target.id,version:target.version,matterId:target.matterId,matterHash:target.matterHash,ownerMembershipVersion:target.ownerMembershipVersion,counterpartyHash:target.counterpartyHash,productHashes:target.productHashes,factHashes:target.factHashes,sourceProofHash:target.sourceProofHash,permittedAudienceHash:target.permittedAudienceHash,jurisdiction:target.jurisdiction,transaction:target.transaction,asOfDate:target.asOfDate});}
export function precedentTargetView(state:PrecedentState,actor:ActorContext){return (state.precedentTargets||[]).filter(item=>canRead(state,actor,item)).map(item=>({...structuredClone(item),basisHash:precedentTargetBasisHash(item),current:precedentTargetCurrent(state,actor,item),limitation:'Owner-confirmed target context for historical suggestions only; it grants no legal clearance or action authority.'}));}
function boundOrigin(state:PrecedentState,actor:ActorContext,record:ScopedPrecedent){
 const matter=readRecord(state,actor,state.matters,record.originMatterId),proposal=readRecord(state,actor,state.proposals,record.originProposalId),document=readRecord(state,actor,state.documents,record.documentId),business=readRecord(state,actor,state.approvals,record.businessApprovalId),legal=readRecord(state,actor,state.approvals,record.legalApprovalId);
 ensure(matter.id===proposal.matterId&&matter.documentIds.includes(document.id)&&proposal.contentHash===record.originProposalHash,'PRECEDENT_ORIGIN_CHANGED','The historical matter, proposal or selected agreement no longer matches.');
 ensure(document.kind==='agreement'&&document.authority==='executed'&&document.contentHash===record.documentContentHash&&digest(document.body)===document.contentHash&&document.revision===record.documentRevision&&document.body.slice(record.clause.start,record.clause.end)===record.clause.quote,'PRECEDENT_CLAUSE_CHANGED','The exact executed agreement clause is no longer available.');
 ensure(business.proposalId===proposal.id&&legal.proposalId===proposal.id&&business.capacity==='business'&&legal.capacity==='legal'&&business.proposalHash===proposal.contentHash&&legal.proposalHash===proposal.contentHash&&approvalHash(business)===record.businessApprovalHash&&approvalHash(legal)===record.legalApprovalHash&&business.status!=='revoked'&&legal.status!=='revoked','PRECEDENT_AUTHORITY_CHANGED','The exact attributed origin decisions are no longer eligible for reuse.');
 ensure([matter,proposal,document,business,legal].every(item=>sameAudience(record,item)),'PRECEDENT_SCOPE_CHANGED','The historical basis has a different audience.');
 const counterparty=entity(state,actor,record.counterpartyEntityId,'counterparty');ensure(sameAudience(record,counterparty),'PRECEDENT_SCOPE_CHANGED','The counterparty audience changed.');
 for(const id of record.context.productEntityIds){const product=entity(state,actor,id,'product');ensure(sameAudience(record,product),'PRECEDENT_SCOPE_CHANGED','A product audience changed.');}
 for(const id of record.context.factIds){const fact=readRecord(state,actor,state.facts,id);ensure(sameAudience(record,fact)&&digest(fact)===record.context.factHashes[id],'PRECEDENT_FACT_CHANGED','The attributed historical factual context changed.');}
 return {matter,proposal,document,business,legal};
}
/** A superseded agreement revision remains history; revoked/deleted lineage cannot be reused. */
export function precedentAvailable(state:PrecedentState,actor:ActorContext,record:ScopedPrecedent):boolean{
 try{const today=new Date().toISOString().slice(0,10);if(record.status!=='adopted'||record.tenantId!==state.tenantId||!canRead(state,actor,record)||record.permittedAudienceHash!==scopeAudienceHash(record.scope)||today<record.context.effectiveFrom||today>record.context.reuseUntil)return false;
  const reviewer=state.memberships.find(m=>m.actorId===record.legalReviewerId),adopter=state.memberships.find(m=>m.actorId===record.businessAdoptedBy);
  if(!reviewer||!adopter||reviewer.revokedAt||adopter.revokedAt||reviewer.expiresAt&&Date.parse(reviewer.expiresAt)<=Date.now()||adopter.expiresAt&&Date.parse(adopter.expiresAt)<=Date.now()||!reviewer.roles.includes('legal_reviewer')||!adopter.roles.includes('business_owner')||reviewer.version!==record.legalReviewerMembershipVersion||adopter.version!==record.businessAdoptionMembershipVersion)return false;
  if(!canRead(state,{...actor,actorId:reviewer.actorId},record)||!canRead(state,{...actor,actorId:adopter.actorId},record))return false;
  boundOrigin(state,actor,record);return true;}catch{return false;}
}
export function precedentBasisHash(record:ScopedPrecedent){return digest({id:record.id,version:record.version,originProposalHash:record.originProposalHash,businessApprovalHash:record.businessApprovalHash,legalApprovalHash:record.legalApprovalHash,documentId:record.documentId,documentRevision:record.documentRevision,documentContentHash:record.documentContentHash,clause:record.clause,context:record.context,permittedAudienceHash:record.permittedAudienceHash});}
export function scopedPrecedentView(state:PrecedentState,actor:ActorContext){return (state.scopedPrecedents||[]).filter(item=>canRead(state,actor,item)).map(item=>({...structuredClone(item),basisHash:precedentBasisHash(item),reusable:precedentAvailable(state,actor,item),limitation:'Historical, scoped context only. Reuse requires current matter-specific business and legal review; this record grants no standing or external-action authority.'}));}
export type ScopedPrecedentView=ReturnType<typeof scopedPrecedentView>[number];
/** Exploratory query only. Its results explicitly carry no verified target-matter match. */
export function matchingPrecedents(state:PrecedentState,actor:ActorContext,query:{counterpartyEntityId:string;jurisdiction:string;transaction:string;asOfDate:string;productEntityIds:string[];factIds:string[]}){
 const products=ids(query.productEntityIds,'product'),facts=ids(query.factIds,'fact'),asOfDate=exactDate(query.asOfDate);return scopedPrecedentView(state,actor).filter(item=>item.reusable&&item.counterpartyEntityId===query.counterpartyEntityId&&item.context.jurisdiction===query.jurisdiction&&item.context.transaction===query.transaction&&item.context.effectiveFrom<=asOfDate&&asOfDate<=item.context.reuseUntil&&item.context.productEntityIds.length===products.length&&item.context.productEntityIds.every(id=>products.includes(id))&&item.context.factIds.length===facts.length&&item.context.factIds.every(id=>facts.includes(id))).map(item=>({...item,matchStatus:'unverified_query' as const,limitation:'Exploratory historical context only. No target matter was verified; this grants no legal clearance or action authority.'}));
}
/** Server-derived suggestions for one frozen and still-current owner-confirmed matter context. */
export function matchingPrecedentsForMatter(state:PrecedentState,actor:ActorContext,matterId:string){
 const matter=readRecord(state,actor,state.matters,matterId),target=[...state.precedentTargets||[]].reverse().find(item=>item.matterId===matter.id&&item.status==='active');
 if(!target||!precedentTargetCurrent(state,actor,target))return [];
 return scopedPrecedentView(state,actor).filter(item=>item.reusable&&scopeAudienceHash(item.scope)===target.permittedAudienceHash&&item.counterpartyEntityId===target.counterpartyEntityId&&item.context.jurisdiction===target.jurisdiction&&item.context.transaction===target.transaction&&item.context.effectiveFrom<=target.asOfDate&&target.asOfDate<=item.context.reuseUntil&&item.context.productEntityIds.length===target.productEntityIds.length&&item.context.productEntityIds.every(id=>target.productEntityIds.includes(id))&&item.context.factIds.length===target.factIds.length&&item.context.factIds.every(id=>target.factIds.includes(id))).map(item=>({...item,matchStatus:'verified_target_suggestion' as const,targetContextId:target.id,targetContextHash:precedentTargetBasisHash(target),limitation:'Historical clause suggestion for this exact current matter context. It requires fresh matter-specific business and legal review and grants no action authority.'}));
}
export function applyScopedPrecedentCommand(state:PrecedentState,actor:ActorContext,command:ScopedPrecedentCommand):Record<string,unknown>{
 state.scopedPrecedents??=[];
 if(command.type==='precedent.target.set'){
  ensure(Number.isSafeInteger(command.inspectedVersion)&&command.inspectedVersion===state.version,'PRECEDENT_INSPECTION_CHANGED','The workspace changed since target inspection. Review the current matter and evidence.');
  const matter=readRecord(state,actor,state.matters,command.matterId),owner=requireRole(state,actor,'business_owner',matter);
  ensure(matter.ownerId===actor.actorId,'PRECEDENT_TARGET_OWNER','The named matter owner must confirm target context.');
  ensure(matter.version===command.expectedMatterVersion,'PRECEDENT_TARGET_CHANGED','Inspect the current matter before confirming its target context.');
  const productEntityIds=ids(command.productEntityIds,'product'),factIds=ids(command.factIds,'fact'),jurisdiction=bounded(command.jurisdiction,120,'a jurisdiction'),transaction=bounded(command.transaction,160,'a transaction context'),asOfDate=exactDate(command.asOfDate),basis=targetBasis(state,actor,matter.id,command.counterpartyEntityId,productEntityIds,factIds),now=timestamp();
  const target:PrecedentTargetContext={id:randomUUID(),tenantId:state.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(matter.scope),provenance:{actorId:actor.actorId,sourceIds:[...new Set([...matter.sourceIds,...basis.counterparty.provenance.sourceIds,...basis.products.flatMap(p=>p.provenance.sourceIds),...basis.facts.flatMap(f=>f.provenance.sourceIds)])],factIds:[...factIds],description:'Named matter owner confirmed exact target context for historical clause suggestions only. No legal or action authority.'},matterId:matter.id,matterVersion:matter.version,matterHash:digest(matter),ownerId:actor.actorId,ownerMembershipVersion:owner.version,counterpartyEntityId:basis.counterparty.id,counterpartyHash:digest(basis.counterparty),jurisdiction,transaction,asOfDate,productEntityIds:[...productEntityIds],productHashes:Object.fromEntries(basis.products.map(p=>[p.id,digest(p)])),factIds:[...factIds],factHashes:Object.fromEntries(basis.facts.map(f=>[f.id,digest(f)])),sourceProofHash:basis.sourceProofHash,permittedAudienceHash:scopeAudienceHash(matter.scope),status:'active'};
  for(const prior of state.precedentTargets||[])if(prior.matterId===matter.id&&prior.status==='active'){prior.status='superseded';touched(prior);}
  (state.precedentTargets??=[]).push(target);return {targetContextId:target.id,matterId:matter.id,basisHash:precedentTargetBasisHash(target)};
 }
 if(command.type==='precedent.propose'){
  ensure(Number.isSafeInteger(command.inspectedVersion)&&command.inspectedVersion===state.version,'PRECEDENT_INSPECTION_CHANGED','The workspace changed since you inspected this clause and origin. Review the current records before proposing a precedent.');
  requireRole(state,actor,'business_owner');
  const matter=readRecord(state,actor,state.matters,command.originMatterId),proposal=readRecord(state,actor,state.proposals,command.originProposalId),document=readRecord(state,actor,state.documents,command.documentId),business=readRecord(state,actor,state.approvals,command.businessApprovalId),legal=readRecord(state,actor,state.approvals,command.legalApprovalId),counterparty=entity(state,actor,command.counterpartyEntityId,'counterparty');
  ensure(matter.id===proposal.matterId&&matter.documentIds.includes(document.id),'PRECEDENT_ORIGIN','Select an executed agreement retained in the origin matter.');
  ensure(document.kind==='agreement'&&document.authority==='executed','PRECEDENT_EXECUTED_REQUIRED','A scoped negotiated precedent requires an attributed executed agreement.');
  ensure(business.capacity==='business'&&legal.capacity==='legal'&&business.proposalId===proposal.id&&legal.proposalId===proposal.id&&business.proposalHash===proposal.contentHash&&legal.proposalHash===proposal.contentHash&&business.status!=='revoked'&&legal.status!=='revoked','PRECEDENT_DECISIONS_REQUIRED','Select attributed, unrevoked business and legal origin decisions for this proposal. The executed clause needs separate exact retrospective review.');
  ensure([proposal,document,business,legal,counterparty].every(item=>sameAudience(matter,item)),'PRECEDENT_SCOPE','The origin and subject must have the same explicit audience.');
  const clause=command.clause;ensure(clause&&Number.isSafeInteger(clause.start)&&Number.isSafeInteger(clause.end)&&clause.start>=0&&clause.end>clause.start&&clause.end<=document.body.length&&document.body.slice(clause.start,clause.end)===clause.quote&&clause.quote.length<=8000,'PRECEDENT_CLAUSE','Select an exact bounded clause from the executed revision.',400);
  const jurisdiction=bounded(command.context?.jurisdiction,120,'a jurisdiction'),transaction=bounded(command.context?.transaction,160,'a transaction context'),effectiveFrom=exactDate(command.context?.effectiveFrom),reuseUntil=exactDate(command.context?.reuseUntil),productEntityIds=ids(command.context?.productEntityIds,'product'),factIds=ids(command.context?.factIds,'fact');
  ensure(effectiveFrom<=reuseUntil&&Date.parse(reuseUntil)-Date.parse(effectiveFrom)<=366*86400000,'PRECEDENT_PERIOD','Bound this historical context to no more than one year; later reuse requires a newly reviewed precedent.',400);
  for(const id of productEntityIds){const product=entity(state,actor,id,'product');ensure(sameAudience(matter,product),'PRECEDENT_SCOPE','The product must share the origin audience.');}
  const facts=factIds.map(id=>readRecord(state,actor,state.facts,id));ensure(facts.every(f=>sameAudience(matter,f)&&matter.factIds.includes(f.id)&&factCurrentlyConfirmed(f)),'PRECEDENT_FACT_SCOPE','Use exact confirmed attributed facts from the origin matter.');
  const now=timestamp(),item:ScopedPrecedent={id:randomUUID(),tenantId:state.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(matter.scope),provenance:{actorId:actor.actorId,sourceIds:[...new Set([document.sourceId,...matter.sourceIds])],factIds:[...factIds],description:'Historical origin decisions are context; the exact executed clause requires separate retrospective legal review and business adoption. No standing or action authority.'},counterpartyEntityId:counterparty.id,originMatterId:matter.id,originProposalId:proposal.id,originProposalHash:proposal.contentHash,businessApprovalId:business.id,businessApprovalHash:approvalHash(business),legalApprovalId:legal.id,legalApprovalHash:approvalHash(legal),documentId:document.id,documentRevision:document.revision,documentContentHash:document.contentHash,clause:structuredClone(clause),context:{jurisdiction,transaction,effectiveFrom,reuseUntil,productEntityIds:[...productEntityIds],factIds:[...factIds],factHashes:Object.fromEntries(facts.map(f=>[f.id,digest(f)]))},permittedAudienceHash:scopeAudienceHash(matter.scope),ownerId:actor.actorId,legalReviewerId:null,legalReviewerMembershipVersion:null,legalReviewedAt:null,businessAdoptedBy:null,businessAdoptionMembershipVersion:null,businessAdoptedAt:null,status:'proposed',withdrawnAt:null,withdrawalReason:null};
  boundOrigin(state,actor,item);state.scopedPrecedents.push(item);return {precedentId:item.id};
 }
 const item=readRecord(state,actor,state.scopedPrecedents,command.precedentId);ensure(item.version===command.expectedRecordVersion,'VERSION_CONFLICT','Inspect the current precedent before deciding.');
 if(command.type==='precedent.withdraw'){requireRole(state,actor,'business_owner',item);ensure(item.status!=='withdrawn','PRECEDENT_WITHDRAWN','This precedent was already withdrawn.');item.withdrawalReason=bounded(command.reason,2000,'a withdrawal reason');item.withdrawnAt=timestamp();item.status='withdrawn';touched(item);return {precedentId:item.id};}
 ensure(precedentBasisHash(item)===command.basisHash,'PRECEDENT_BASIS_CHANGED','Inspect the exact current precedent basis.');boundOrigin(state,actor,item);
 if(command.type==='precedent.legal_review'){const reviewer=requireRole(state,actor,'legal_reviewer',item);ensure(item.status==='proposed','PRECEDENT_STATE','Legal review applies to a proposed precedent.');item.legalReviewerId=actor.actorId;item.legalReviewerMembershipVersion=reviewer.version;item.legalReviewedAt=timestamp();item.status='legal_reviewed';touched(item);return {precedentId:item.id};}
 const adopter=requireRole(state,actor,'business_owner',item);ensure(item.status==='legal_reviewed'&&item.legalReviewerId&&item.legalReviewedAt,'PRECEDENT_LEGAL_REVIEW_REQUIRED','A named legal reviewer must inspect this exact precedent.');item.businessAdoptedBy=actor.actorId;item.businessAdoptionMembershipVersion=adopter.version;item.businessAdoptedAt=timestamp();item.status='adopted';touched(item);return {precedentId:item.id};
}
