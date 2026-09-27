import {randomUUID} from 'node:crypto';
import {canRead,membership,readRecord,requestedScope,requireRole} from './authority';
import {documentHeads} from './document-lifecycle';
import {factCurrentlyConfirmed} from './fact-validity';
import {currentEvidenceLineage} from './source-lifecycle';
import {scopeAudienceHash} from './integrations/slack-scope';
import {digest,timestamp} from './store';
import {V2Error,type ActorContext,type FactAssertion,type RecordBase,type Scope,type Source,type WorkspaceState} from './contracts';
import {memoryBasisCurrent,memoryEntityCurrent} from './company-memory-validity';
export {memoryBasisCurrent,memoryRecordCurrent} from './company-memory-validity';

export type MemoryEntityKind='company'|'product'|'data_practice'|'vendor'|'counterparty';
export type MemoryRelationshipKind='owns_product'|'has_data_practice'|'uses_vendor'|'contracts_with'|'subsidiary_of';
/** Registry identity is a factual subject, never a workspace membership or legal authority. */
export interface MemoryEntity extends RecordBase {entityId:string;kind:MemoryEntityKind;name:string;aliases:string[];ownerId:string;declarationSourceId:string;status:'active'|'archived';declaration:'user_declared';archiveReason:string|null}
export interface MemoryBasis {entityHashes:Record<string,string>;sourceHashes:Record<string,string>;factHashes:Record<string,string>;documentHashes:Record<string,string>}
export interface MemoryRelationship extends RecordBase {entityId:string;fromId:string;toId:string;kind:MemoryRelationshipKind;description:string;practice:FactAssertion['practice'];validFrom:string|null;validUntil:string|null;ownerId:string;status:'candidate'|'confirmed'|'withdrawn';basis:MemoryBasis;factId:string|null;confirmedBy:string|null;confirmedAt:string|null;withdrawalReason:string|null}
export type MemoryState=WorkspaceState&{memoryEntities?:MemoryEntity[];memoryRelationships?:MemoryRelationship[]};
export interface MemoryRelationshipView extends MemoryRelationship {basisHash:string;current:boolean}
export interface CompanyMemoryView {root:{id:string;name:string};entities:(MemoryEntity&{entityHash:string})[];relationships:MemoryRelationshipView[];limitations:string[]}
export type CompanyMemoryCommand=
 |{type:'memory.entity.declare';kind:MemoryEntityKind;name:string;aliases:string[];ownerId:string;scope?:Scope;workspaceCompany?:boolean}
 |{type:'memory.entity.archive';entityId:string;expectedRecordVersion:number;entityHash:string;reason:string}
 |{type:'memory.relationship.propose';fromId:string;toId:string;kind:MemoryRelationshipKind;description:string;practice:FactAssertion['practice'];sourceIds:string[];factIds:string[];documentIds:string[];inspectedVersion:number;validFrom?:string;validUntil?:string}
 |{type:'memory.relationship.confirm';relationshipId:string;expectedRecordVersion:number;basisHash:string}
 |{type:'memory.relationship.withdraw';relationshipId:string;expectedRecordVersion:number;reason:string};
export const companyMemoryCommandFields={
 'memory.entity.declare':['kind','name','aliases','ownerId','scope','workspaceCompany'],
 'memory.entity.archive':['entityId','expectedRecordVersion','entityHash','reason'],
 'memory.relationship.propose':['fromId','toId','kind','description','practice','sourceIds','factIds','documentIds','inspectedVersion','validFrom','validUntil'],
 'memory.relationship.confirm':['relationshipId','expectedRecordVersion','basisHash'],
 'memory.relationship.withdraw':['relationshipId','expectedRecordVersion','reason'],
};
const ensure=(v:unknown,code:string,message:string,status=409)=>{if(!v)throw new V2Error(code,message,status);};
const bounded=(v:unknown,label:string,max:number)=>{ensure(typeof v==='string'&&v.trim().length>0&&v.length<=max,'MEMORY_INPUT',`Provide ${label} within ${max} characters.`,400);return (v as string).trim();};
const sameScope=(x:Scope,y:Scope)=>scopeAudienceHash(x)===scopeAudienceHash(y);
const touch=(r:RecordBase)=>{r.version++;r.updatedAt=timestamp();};
const base=(s:MemoryState,a:ActorContext,scope:Scope,sourceIds:string[]=[],factIds:string[]=[]):RecordBase=>({id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:structuredClone(scope),provenance:{actorId:a.actorId,sourceIds:[...new Set(sourceIds)],factIds:[...new Set(factIds)],description:'Explicit scoped company-memory declaration; no legal, signing or execution authority.'}});
function strings(value:unknown){ensure(Array.isArray(value)&&value.length<=30&&value.every(x=>typeof x==='string'&&x.length>0&&x.length<=200),'MEMORY_INPUT','Choose at most 30 exact evidence records.',400);return [...new Set(value as string[])];}
function moment(value:unknown):string|null{if(value===undefined)return null;ensure(typeof value==='string'&&/^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/.test(value)&&Number.isFinite(Date.parse(value)),'MEMORY_PERIOD','Use an exact ISO date or UTC timestamp.',400);const iso=new Date(Date.parse(value as string)).toISOString();ensure((value as string).length===10?iso.slice(0,10)===value:iso===value,'MEMORY_PERIOD','The effective date does not exist in the calendar.',400);return iso;}
function entity(s:MemoryState,a:ActorContext,id:string){const e=readRecord(s,a,s.memoryEntities||[],id);ensure(memoryEntityCurrent(s,e.id)&&currentEvidenceLineage(s,e),'MEMORY_ENTITY_UNAVAILABLE','Inspect a currently available declared subject.');return e;}
export function resolveMemorySubject(s:MemoryState,a:ActorContext,id:string|undefined){membership(s,a);if(!id||id===s.entityId&&!s.memoryEntities?.some(e=>e.id===id))return null;return entity(s,a,id);}
function evidence(s:MemoryState,a:ActorContext,scope:Scope,sourceIds:string[],factIds:string[],documentIds:string[]){
 const sources=strings(sourceIds).map(id=>readRecord(s,a,s.sources,id)),facts=strings(factIds).map(id=>readRecord(s,a,s.facts,id)),documents=strings(documentIds).map(id=>readRecord(s,a,s.documents,id));
 ensure(sources.length+facts.length+documents.length>0,'MEMORY_EVIDENCE_REQUIRED','Retain at least one source, confirmed fact or current document for this relationship.');
 const records=[...sources,...facts,...documents];ensure(records.every(r=>sameScope(scope,r.scope)&&currentEvidenceLineage(s,r))&&facts.every(factCurrentlyConfirmed)&&documents.every(d=>documentHeads(s.documents).some(h=>h.id===d.id)),'MEMORY_EVIDENCE_CHANGED','Use current evidence with the exact relationship audience.');
 const allSources=new Set(sources.map(x=>x.id)),allFacts=new Set(facts.map(x=>x.id)),visited=new Set<string>();
 const visit=(r:RecordBase)=>{if(visited.has(r.id))return;visited.add(r.id);ensure(sameScope(scope,r.scope)&&canRead(s,a,r)&&currentEvidenceLineage(s,r),'MEMORY_EVIDENCE_CHANGED','Every retained evidence dependency must have the exact relationship audience.');for(const id of r.provenance.sourceIds){allSources.add(id);visit(readRecord(s,a,s.sources,id));}for(const id of r.provenance.factIds||[]){allFacts.add(id);visit(readRecord(s,a,s.facts,id));}};records.forEach(visit);for(const d of documents){allSources.add(d.sourceId);visit(readRecord(s,a,s.sources,d.sourceId));}
 return {sourceIds:[...allSources],factIds:[...allFacts],sourceHashes:Object.fromEntries([...allSources].map(id=>[id,digest(readRecord(s,a,s.sources,id))])),factHashes:Object.fromEntries([...allFacts].map(id=>[id,digest(readRecord(s,a,s.facts,id))])),documentHashes:Object.fromEntries(documents.map(d=>[d.id,digest(d)]))};
}
function relationshipCurrent(s:MemoryState,a:ActorContext,r:MemoryRelationship){const fact=s.facts.find(x=>x.id===r.factId);return r.status==='confirmed'&&!!fact&&factCurrentlyConfirmed(fact)&&canRead(s,a,fact)&&currentEvidenceLineage(s,fact)&&memoryBasisCurrent(s,r);}
export function companyMemoryView(s:MemoryState,a:ActorContext):CompanyMemoryView {
 membership(s,a);const entities=(s.memoryEntities||[]).filter(e=>memoryEntityCurrent(s,e.id)&&canRead(s,a,e)&&currentEvidenceLineage(s,e)),ids=new Set(entities.map(e=>e.id));
 return {root:{id:s.entityId,name:s.companyName},entities:entities.map(e=>({...structuredClone(e),entityHash:digest(e)})),relationships:(s.memoryRelationships||[]).filter(r=>ids.has(r.fromId)&&ids.has(r.toId)&&canRead(s,a,r)).map(r=>({...structuredClone(r),basisHash:digest(r.basis),current:relationshipCurrent(s,a,r)})),limitations:['Names and aliases are explicitly declared identifiers, not verified legal existence, deployment or authority.','Only separately confirmed, current relationships enter factual context. Planned relationships remain planned.','Subject selection and graph links do not grant membership, widen access, enumerate all agreements or establish legal applicability.']};
}
/** Exact identifiers only. Names/aliases can suggest choices in UI, never silently merge nodes. */
export function resolveCompanyContext(s:MemoryState,a:ActorContext,subjectId:string|undefined,scope:Scope):{subject:MemoryEntity|null;relationships:MemoryRelationshipView[];relatedEntities:MemoryEntity[];sourceIds:string[];factIds:string[]}{
 const subject=resolveMemorySubject(s,a,subjectId);if(!subject)return {subject:null,relationships:[],relatedEntities:[],sourceIds:[],factIds:[]};ensure(sameScope(subject.scope,scope),'MEMORY_AUDIENCE','The selected subject must have the exact conversation audience.');
 const view=companyMemoryView(s,a),relationships=view.relationships.filter(r=>r.current&&sameScope(r.scope,scope)&&(r.fromId===subject.id||r.toId===subject.id)),ids=new Set(relationships.flatMap(r=>[r.fromId,r.toId]));
 return {subject,relationships,relatedEntities:view.entities.filter(e=>ids.has(e.id)&&e.id!==subject.id),sourceIds:[...new Set([...subject.provenance.sourceIds,...relationships.flatMap(r=>r.provenance.sourceIds)])],factIds:relationships.map(r=>r.factId!)};
}
export function applyCompanyMemoryCommand(s:MemoryState,a:ActorContext,c:CompanyMemoryCommand):Record<string,unknown>{
 requireRole(s,a,'member');s.memoryEntities??=[];s.memoryRelationships??=[];
 if(c.type==='memory.entity.declare'){
  requireRole(s,a,'fact_owner');ensure(['company','product','data_practice','vendor','counterparty'].includes(c.kind),'MEMORY_KIND','Choose a supported subject kind.',400);const name=bounded(c.name,'a declared name',200),aliases=strings(c.aliases).map(x=>bounded(x,'an alias',200)),scope=requestedScope(s,a,c.scope);ensure(scope.actorIds.length===0||scope.actorIds.includes(a.actorId),'MEMORY_AUDIENCE','Your declaration must remain visible to you.');
  const owner=s.memberships.find(m=>m.actorId===c.ownerId&&!m.revokedAt&&(!m.expiresAt||Date.parse(m.expiresAt)>Date.now()));ensure(owner&&(!scope.actorIds.length||scope.actorIds.includes(c.ownerId)),'MEMORY_OWNER','Choose a current owner inside the declared audience.');
  const prospective=base(s,a,scope);ensure(canRead(s,a,prospective)&&canRead(s,{...a,actorId:c.ownerId},prospective),'MEMORY_OWNER_SCOPE','The declaring person and named owner must have current access to this workspace entity and audience.');
  if(c.workspaceCompany){requireRole(s,a,'business_owner');ensure(c.kind==='company'&&scope.kind==='team'&&!scope.actorIds.length&&!s.memoryEntities.some(e=>e.id===s.entityId),'MEMORY_ROOT_EXISTS','The workspace company can be declared once with workspace visibility.');}
  const id=c.workspaceCompany?s.entityId:randomUUID();ensure(!s.memoryEntities.some(e=>e.status==='active'&&e.kind===c.kind&&e.name===name&&sameScope(e.scope,scope)),'MEMORY_DUPLICATE','An exact named subject already exists in this audience. Inspect it or use a distinct explicit identity.');
  const body=JSON.stringify({meaning:'User-declared identifier only; not verified legal existence, current practice or authority.',subjectId:id,kind:c.kind,name,aliases,ownerId:c.ownerId});
  const source:Source={...base(s,a,scope),title:`Declared ${c.kind.replaceAll('_',' ')}: ${name}`,kind:'manual',externalId:null,externalRevision:null,text:body,contentHash:digest(body),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'unknown',originalObjectRef:null};s.sources.push(source);
  const record:MemoryEntity={...base(s,a,scope,[source.id]),id,entityId:s.entityId,kind:c.kind,name,aliases,ownerId:c.ownerId,declarationSourceId:source.id,status:'active',declaration:'user_declared',archiveReason:null};s.memoryEntities.push(record);return {entityId:record.id};
 }
 if(c.type==='memory.entity.archive'){
  const e=entity(s,a,c.entityId);requireRole(s,a,'fact_owner',e);ensure(e.version===c.expectedRecordVersion&&digest(e)===c.entityHash,'VERSION_CONFLICT','Inspect the exact current subject before archiving.');const reason=bounded(c.reason,'an archive reason',2000);ensure(e.id!==s.entityId,'MEMORY_ROOT_REQUIRED','The workspace security identity cannot be archived through company memory.');e.status='archived';e.archiveReason=reason;touch(e);const source=readRecord(s,a,s.sources,e.declarationSourceId);source.status='revoked';source.aclVersion++;touch(source);return {entityId:e.id,invalidatedSourceIds:[source.id]};
 }
 if(c.type==='memory.relationship.propose'){
  ensure(Number.isSafeInteger(c.inspectedVersion)&&c.inspectedVersion===s.version,'MEMORY_INSPECTION_CHANGED','The workspace changed since the relationship evidence was inspected. Refresh and review exact subjects and evidence.');
  const from=entity(s,a,c.fromId),to=entity(s,a,c.toId);ensure(from.id!==to.id&&sameScope(from.scope,to.scope),'MEMORY_RELATIONSHIP_SCOPE','Choose distinct declared subjects with the same audience.');ensure(['owns_product','has_data_practice','uses_vendor','contracts_with','subsidiary_of'].includes(c.kind),'MEMORY_RELATIONSHIP_KIND','Choose a supported relationship.',400);
  ensure(c.kind==='owns_product'?to.kind==='product':c.kind==='has_data_practice'?to.kind==='data_practice':c.kind==='uses_vendor'?to.kind==='vendor':c.kind==='contracts_with'?['counterparty','vendor'].includes(to.kind):from.kind==='company'&&to.kind==='company','MEMORY_RELATIONSHIP_KIND','The selected subjects do not match this relationship kind.',400);
  ensure(['planned','live','unknown'].includes(c.practice),'MEMORY_PRACTICE','State whether this relationship is planned, live or unknown.',400);const proof=evidence(s,a,from.scope,c.sourceIds,c.factIds,c.documentIds),validFrom=moment(c.validFrom),validUntil=moment(c.validUntil);ensure(!validFrom||!validUntil||Date.parse(validFrom)<Date.parse(validUntil),'MEMORY_PERIOD','The effective period must end after it starts.',400);
  const sourceIds=[...new Set([...proof.sourceIds,...from.provenance.sourceIds,...to.provenance.sourceIds])],factIds=[...new Set([...proof.factIds,...from.provenance.factIds||[],...to.provenance.factIds||[]])];
  const r:MemoryRelationship={...base(s,a,from.scope,sourceIds,factIds),entityId:s.entityId,fromId:from.id,toId:to.id,kind:c.kind,description:bounded(c.description,'the attributed relationship assertion',3000),practice:c.practice,validFrom,validUntil,ownerId:a.actorId,status:'candidate',basis:{entityHashes:{[from.id]:digest(from),[to.id]:digest(to)},sourceHashes:Object.fromEntries(sourceIds.map(id=>[id,digest(readRecord(s,a,s.sources,id))])),factHashes:Object.fromEntries(factIds.map(id=>[id,digest(readRecord(s,a,s.facts,id))])),documentHashes:proof.documentHashes},factId:null,confirmedBy:null,confirmedAt:null,withdrawalReason:null};s.memoryRelationships.push(r);return {relationshipId:r.id};
 }
 const r=readRecord(s,a,s.memoryRelationships,c.relationshipId);ensure(r.version===c.expectedRecordVersion,'VERSION_CONFLICT','Inspect the current relationship assertion.');entity(s,a,r.fromId);entity(s,a,r.toId);
 if(c.type==='memory.relationship.withdraw'){
  if(r.status==='confirmed'||r.ownerId!==a.actorId)requireRole(s,a,'fact_owner',r);ensure(r.status!=='withdrawn','MEMORY_RELATIONSHIP_WITHDRAWN','This assertion was already withdrawn.');r.withdrawalReason=bounded(c.reason,'the withdrawal reason',2000);r.status='withdrawn';touch(r);const f=s.facts.find(f=>f.id===r.factId);if(f&&f.status==='confirmed'){f.status='superseded';touch(f);}return {relationshipId:r.id,factId:r.factId};
 }
 requireRole(s,a,'fact_owner',r);ensure(r.status==='candidate'&&digest(r.basis)===c.basisHash&&memoryBasisCurrent(s,r)&&currentEvidenceLineage(s,r),'MEMORY_BASIS_CHANGED','Inspect a current candidate with its exact declared subjects and evidence.');ensure(!s.memoryRelationships.some(x=>x.id!==r.id&&x.fromId===r.fromId&&x.toId===r.toId&&x.kind===r.kind&&relationshipCurrent(s,a,x)),'MEMORY_CONFLICT','Withdraw the current assertion before confirming its replacement.');
 const fact:FactAssertion&{subjectEntityId:string;relationshipId:string}={...base(s,a,r.scope,r.provenance.sourceIds,r.provenance.factIds),entityId:s.entityId,subjectEntityId:r.fromId,relationshipId:r.id,predicate:`relationship.${r.kind}.${r.toId}`,value:{fromId:r.fromId,toId:r.toId,kind:r.kind,assertion:r.description},status:'confirmed',practice:r.practice,ownerId:a.actorId,observedAt:timestamp(),validFrom:r.validFrom,validUntil:r.validUntil,confirmedBy:a.actorId,confirmedAt:timestamp(),supersedesId:null,originVersion:s.version,reuse:'company',conversationId:null};s.facts.push(fact);r.factId=fact.id;r.status='confirmed';r.confirmedBy=a.actorId;r.confirmedAt=timestamp();touch(r);return {relationshipId:r.id,factId:fact.id};
}
