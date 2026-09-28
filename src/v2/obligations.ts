import {randomUUID} from 'node:crypto';
import {canRead,membership,readRecord,requireRole} from './authority';
import {V2Error,type ActorContext,type RecordBase,type WorkspaceState} from './contracts';
import {digest,timestamp} from './store';
export interface Obligation extends RecordBase {
 matterId:string;title:string;ownerId:string;dueAt:string;deadlineType:'contractual'|'legal'|'launch_target'|'response_target';
 sourceId:string|null;quote:string|null;rationale:string;fulfillmentCriteria:string;actionBinding:{id:string;contentHash:string}|null;basisHash:string;sourceVersion:number|null;
 status:'proposed'|'active'|'fulfilled'|'canceled';review:{actorId:string;membershipVersion:number;basisHash:string;reviewedAt:string}|null;
 completion:{kind:'verified_action'|'human_attestation';actionId:string|null;evidence:string;actorId:string;recordedAt:string;completedLate:boolean}|null;
 cancellationReason:string|null;acknowledgedAt:string|null;eligibility?:'current'|'stale';overdue?:boolean;
}
export type ObligationCommand=
 | {type:'obligation.propose';matterId:string;title:string;ownerId:string;dueAt:string;deadlineType:Obligation['deadlineType'];sourceId?:string;quote?:string;rationale:string;fulfillmentCriteria?:string;fulfillmentActionId?:string}
 | {type:'obligation.review';obligationId:string;expectedRecordVersion:number;basisHash:string}
 | {type:'obligation.fulfill';obligationId:string;expectedRecordVersion:number;basisHash:string;kind:'verified_action'|'human_attestation';actionId?:string;evidence:string}
 | {type:'obligation.cancel';obligationId:string;expectedRecordVersion:number;reason:string}
 | {type:'obligation.acknowledge';obligationId:string;expectedRecordVersion:number};
export const obligationCommandFields:Record<ObligationCommand['type'],string[]>={
 'obligation.propose':['matterId','title','ownerId','dueAt','deadlineType','sourceId','quote','rationale','fulfillmentCriteria','fulfillmentActionId'],
 'obligation.review':['obligationId','expectedRecordVersion','basisHash'],
 'obligation.fulfill':['obligationId','expectedRecordVersion','basisHash','kind','actionId','evidence'],
 'obligation.cancel':['obligationId','expectedRecordVersion','reason'],
 'obligation.acknowledge':['obligationId','expectedRecordVersion']};
function ensure(v:unknown,code:string,message:string):asserts v {if(!v)throw new V2Error(code,message);}
function text(v:unknown,label:string,max=3000){ensure(typeof v==='string'&&v.trim()&&v.length<=max,'INVALID_INPUT',`Provide ${label} (up to ${max} characters).`);return v.trim();}
function legal(o:Pick<Obligation,'deadlineType'>){return ['legal','contractual'].includes(o.deadlineType);}
function touch(r:RecordBase){r.version++;r.updatedAt=timestamp();}
function basis(o:Obligation){return digest({matterId:o.matterId,title:o.title,dueAt:o.dueAt,deadlineType:o.deadlineType,sourceId:o.sourceId,sourceVersion:o.sourceVersion,quote:o.quote,rationale:o.rationale,fulfillmentCriteria:o.fulfillmentCriteria,actionBinding:o.actionBinding});}
export function obligationCurrent(s:WorkspaceState,a:ActorContext,o:Obligation){
 if(!canRead(s,a,o)||!o.review||o.review.basisHash!==basis(o))return false;
 const member=s.memberships.find(m=>m.actorId===o.review!.actorId),role=legal(o)?'legal_reviewer':'business_owner';
 if(!member||member.revokedAt||member.version!==o.review.membershipVersion||!member.roles.includes(role)||(member.expiresAt&&Date.parse(member.expiresAt)<=Date.now()))return false;
 const reviewer:ActorContext={tenantId:s.tenantId,actorId:member.actorId,expiresAt:Date.now()+1000,mode:'authenticated'};if(!canRead(s,reviewer,o))return false;
 if(o.sourceId){const source=s.sources.find(x=>x.id===o.sourceId);if(!source||source.status!=='active'||source.version!==o.sourceVersion||!source.text.includes(o.quote||''))return false;}
 return true;
}
export function obligationViews(s:WorkspaceState,a:ActorContext):Obligation[]{return (s.obligations||[]).filter(o=>canRead(s,a,o)).map(o=>({...structuredClone(o),eligibility:obligationCurrent(s,a,o)?'current':'stale',overdue:!['fulfilled','canceled'].includes(o.status)&&Date.parse(o.dueAt)<Date.now()}));}
export function assertObligationsReady(s:WorkspaceState,a:ActorContext,matterId:string,forClosure=false){
 for(const o of (s.obligations||[]).filter(x=>x.matterId===matterId&&x.status!=='canceled')){
  ensure(canRead(s,a,o),'OBLIGATION_SCOPE','Required obligation evidence is unavailable; an authorized owner must resolve it.');
  if(legal(o)||forClosure)ensure(obligationCurrent(s,a,o),'DEADLINE_REVIEW_REQUIRED','A required obligation or deadline needs current version-bound review.');
  if(forClosure)ensure(o.status==='fulfilled'&&o.completion,'OBLIGATION_PENDING','Record action-specific fulfillment evidence or an authorized cancellation for every required obligation.');
 }
}
export function applyObligationCommand(s:WorkspaceState,a:ActorContext,c:ObligationCommand):Record<string,unknown>{
 const records=s.obligations||=[];let o:Obligation;
 if(c.type==='obligation.propose'){
  const m=readRecord(s,a,s.matters,c.matterId);requireRole(s,a,'business_owner',m);ensure(!['closed','canceled'].includes(m.state),'MATTER_TERMINAL','Open corrective work before adding obligations.');ensure(['contractual','legal','launch_target','response_target'].includes(c.deadlineType),'INVALID_DEADLINE','Choose the deadline’s authority type.');const owner=s.memberships.find(x=>x.actorId===c.ownerId);ensure(owner&&!owner.revokedAt&&(!owner.expiresAt||Date.parse(owner.expiresAt)>Date.now()),'OWNER_REQUIRED','Assign an active workspace member.');const ownerActor:ActorContext={tenantId:s.tenantId,actorId:owner.actorId,expiresAt:Date.now()+1000,mode:'authenticated'};ensure(canRead(s,ownerActor,m),'OWNER_SCOPE','The assigned owner must be able to read this matter.');
  ensure(typeof c.dueAt==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(c.dueAt)&&Number.isFinite(Date.parse(c.dueAt)),'INVALID_DEADLINE','Record an exact deadline with timezone.');const source=c.sourceId?readRecord(s,a,s.sources,c.sourceId):null;const quote=c.quote?text(c.quote,'an exact supporting clause',4000):null;ensure(!legal(c)||source&&quote,'DEADLINE_EVIDENCE_REQUIRED','Legal and contractual deadlines require the exact source and supporting clause.');ensure(!source||quote&&source.text.includes(quote),'QUOTE_MISMATCH','The selected source does not contain this exact clause.');
  o={id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:structuredClone(m.scope),provenance:{actorId:a.actorId,sourceIds:source?[source.id]:[],description:'Owner-proposed obligation; deadline interpretation requires distinct review'},matterId:m.id,title:text(c.title,'an obligation title',300),ownerId:c.ownerId,dueAt:new Date(c.dueAt).toISOString(),deadlineType:c.deadlineType,sourceId:source?.id||null,sourceVersion:source?.version||null,quote,rationale:text(c.rationale,'the deadline calculation and assumptions'),fulfillmentCriteria:text(c.fulfillmentCriteria||c.rationale,'the exact evidence required for fulfillment'),actionBinding:null,basisHash:'',status:'proposed',review:null,completion:null,cancellationReason:null,acknowledgedAt:null};if(c.fulfillmentActionId){const action=readRecord(s,a,s.actions,c.fulfillmentActionId);ensure(action.matterId===m.id,'OBLIGATION_ACTION_SCOPE','Choose an action from this matter.');o.actionBinding={id:action.id,contentHash:action.contentHash};}o.basisHash=basis(o);if(source){ensure(canRead(s,ownerActor,source),'OWNER_SCOPE','The assigned owner must be able to read the deadline source.');if(!m.provenance.sourceIds.includes(source.id))m.provenance.sourceIds.push(source.id);if(!m.sourceIds.includes(source.id))m.sourceIds.push(source.id);}records.push(o);
  m.tasks.push({id:`obligation:${o.id}`,title:o.title,ownerId:o.ownerId,status:'pending',kind:'verification',dueAt:o.dueAt,deadlineType:o.deadlineType,evidenceIds:[]});m.blockers=[...m.blockers,'Review the proposed obligation and its deadline basis.'];touch(m);
 }else{
  o=readRecord(s,a,records,c.obligationId);ensure(o.version===c.expectedRecordVersion,'VERSION_CONFLICT','Inspect the current obligation before continuing.');const m=readRecord(s,a,s.matters,o.matterId);ensure(!['closed','canceled'].includes(m.state),'MATTER_TERMINAL','Open corrective work for a closed or canceled matter.');const task=m.tasks.find(t=>t.id===`obligation:${o.id}`);
  switch(c.type){
  case 'obligation.review':{const reviewer=requireRole(s,a,legal(o)?'legal_reviewer':'business_owner',o);ensure(['proposed','active'].includes(o.status)&&c.basisHash===basis(o),'DEADLINE_CHANGED','Review the exact proposed deadline, source and calculation.');if(o.sourceId)ensure(readRecord(s,a,s.sources,o.sourceId).version===o.sourceVersion,'SOURCE_CHANGED','The deadline source changed. Propose a successor obligation.');o.review={actorId:a.actorId,membershipVersion:reviewer.version,basisHash:c.basisHash,reviewedAt:timestamp()};o.status='active';break;}
  case 'obligation.fulfill':{
   membership(s,a);if(legal(o))requireRole(s,a,'legal_reviewer',o);else ensure(a.actorId===o.ownerId||requireRole(s,a,'business_owner',o),'OWNER_REQUIRED','The assigned owner or business owner must record fulfillment.');ensure(o.status==='active'&&c.basisHash===basis(o)&&obligationCurrent(s,a,o),'DEADLINE_REVIEW_REQUIRED','Fulfill the current reviewed obligation.');ensure(['verified_action','human_attestation'].includes(c.kind),'INVALID_EVIDENCE','Choose verified action evidence or an attributed human attestation.');
   if(c.kind==='verified_action'){ensure(o.actionBinding&&o.actionBinding.id===c.actionId,'OBLIGATION_ACTION_BINDING_REQUIRED','Only the exact action bound into the reviewed fulfillment criteria can fulfill this obligation.');const action=readRecord(s,a,s.actions,c.actionId||'');ensure(action.matterId===m.id&&action.contentHash===o.actionBinding.contentHash&&action.status==='verified'&&action.completion,'COMPLETION_PENDING','Choose a verified action from this matter.');}
   ensure(!s.actions.some(x=>x.matterId===m.id&&['uncertain','dispatching'].includes(x.status)),'RECONCILIATION_REQUIRED','Resolve uncertain external effects before claiming fulfillment.');o.completion={kind:c.kind,actionId:c.kind==='verified_action'?c.actionId!:null,evidence:text(c.evidence,'the action-specific fulfillment evidence',5000),actorId:a.actorId,recordedAt:timestamp(),completedLate:Date.now()>Date.parse(o.dueAt)};o.status='fulfilled';if(task){task.status='done';task.evidenceIds=[o.id];}break;
  }
  case 'obligation.cancel':requireRole(s,a,legal(o)?'legal_reviewer':'business_owner',o);ensure(o.status!=='fulfilled','FULFILLMENT_RETAINED','Preserve fulfilled obligations; open corrective work.');o.cancellationReason=text(c.reason,'the cancellation basis');o.status='canceled';if(task){task.status='done';task.evidenceIds=[o.id];}break;
  case 'obligation.acknowledge':ensure(a.actorId===o.ownerId||requireRole(s,a,'business_owner',o),'OWNER_REQUIRED','Only the assigned owner or business owner can acknowledge the reminder.');o.acknowledgedAt=timestamp();break;
  }
  if(!records.some(x=>x.matterId===m.id&&x.status==='proposed'))m.blockers=m.blockers.filter(x=>x!=='Review the proposed obligation and its deadline basis.');touch(o);touch(m);
 }
 s.events.push({id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:structuredClone(o.scope),provenance:structuredClone(o.provenance),type:c.type,title:`Obligation ${c.type.split('.')[1]}`,detail:`${o.title}; ${o.deadlineType.replaceAll('_',' ')}; due ${o.dueAt}. ${o.completion?.kind==='human_attestation'?'Completion is a named human attestation.':''}`,matterId:o.matterId,recordId:o.id,measurement:s.rehearsal?'fictional_rehearsal':'observed'});
 return {obligationId:o.id,matterId:o.matterId,basisHash:o.basisHash};
}
