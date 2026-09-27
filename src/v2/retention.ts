import {randomUUID} from 'node:crypto';
import {slackSnapshotIncludesSource} from './source-lifecycle';
import {originalIntakeFenced} from './artifact-intake';
import {membership,scopeVisible} from './authority';
import {redactKnowledgeReceipts} from './ai';
import {redactEffectReceipts} from './execution/retention';
import type {EffectIntent} from './execution/contracts';
import {V2Error,type ActorContext,type RecordBase,type Scope,type WorkspaceState} from './contracts';
import {digest,timestamp} from './store';

const recordKinds=['sources','documents','facts','messages','conversations','scenarios','matters','proposals','approvals','actions','counsel','learning','legalAuthorities','coverage','events','effortEntries','effortBaselines','obligations','scenarioShares','routingDelegations','routingRules','inventories','attentionSettings','attentionDecisions','legalWatches','legalChanges','drafts','templateApprovals'] as const;
type RecordKind=typeof recordKinds[number];
export interface DeletionJob {
 id:string;sourceId:string;sourceIds:string[];actorId:string;scope:Scope;requestedAt:string;
 records:{kind:RecordKind;id:string;beforeHash:string;afterHash:string}[];
 originals:{reference:string;notBefore:string;status:'pending'|'purged'|'shared_reference'|'operational_exception'|'hold'|'failed';failureCode:string|null}[];
 operationalExceptionActionIds:string[];
 indexCleanup:'pending'|'complete';historicalCleanup:'pending'|'complete';
 backupExpiresAt:string|null;backupStatus:'operator_verification_required';
}
export interface DeletionView {id:string;sourceId:string;requestedAt:string;recordsRedacted:number;originalsPending:number;operationalExceptions:number;indexCleanup:DeletionJob['indexCleanup'];historicalCleanup:DeletionJob['historicalCleanup'];backupExpiresAt:string|null;backupStatus:DeletionJob['backupStatus']}
const referenceKeys=new Set(['sourceId','sourceIds','factIds','documentIds','baselineRevisionIds','artifactIds','matterId','conversationId','conversationIds','scenarioId','proposalId','originMatterId','recordId','parentRevisionId','messageId']);
function references(value:unknown,ids:Set<string>,key=''):boolean {
 if(typeof value==='string')return referenceKeys.has(key)&&ids.has(value);
 if(Array.isArray(value))return value.some(v=>references(v,ids,key));
 if(value&&typeof value==='object')return Object.entries(value).some(([k,v])=>references(v,ids,k));
 return false;
}
function entries(s:WorkspaceState){return recordKinds.flatMap(kind=>(s[kind]||[]).map(value=>({kind,value:value as unknown as RecordBase&Record<string,unknown>})));}
function originalDelay(){const value=process.env.KIARA_RETENTION_ORIGINAL_DAYS||'30';if(!/^\d{1,4}$/.test(value)||Number(value)>3650)throw new V2Error('RETENTION_CONFIG_INVALID','Original retention must be configured from zero to 3,650 days.',503);return Number(value)*86400000;}
/** Deterministic, schema-specific payload erasure. IDs, hashes and decision history remain auditable. */
export function redactedRecord(kind:RecordKind,value:RecordBase&Record<string,unknown>,rootSourceId:string){
 const r=structuredClone(value);r.version++;r.updatedAt=timestamp();r.provenance.description='Payload removed under an attributed source deletion request.';r.provenance.sourceIds=[...new Set([...r.provenance.sourceIds,rootSourceId])];
 if('title' in r)r.title='Removed evidence';
 const clear=(...keys:string[])=>{for(const key of keys)if(key in r)r[key]='';};
 switch(kind){
 case 'sources':clear('text');r.url=null;r.externalId=null;r.externalRevision=null;r.status='deleted';r.aclVersion=Number(r.aclVersion)+1;break;
 case 'documents':clear('body');r.contentHash=digest('');break;
 case 'facts':r.predicate='removed_assertion';r.value=null;r.status='unknown';break;
 case 'messages':clear('text');r.citations=[];r.artifactIds=[];break;
 case 'conversations':break;
 case 'scenarios':case 'scenarioShares':r.assumptions=[];r.questions=[];if('revokedAt' in r)r.revokedAt=r.revokedAt||timestamp();break;
 case 'routingDelegations':r.revocationReason=r.revocationReason?'Evidence payload deleted.':null;r.revokedAt=r.revokedAt||timestamp();break;
 case 'routingRules':r.active=false;break;
 case 'inventories':clear('scopeDescription');r.revocationReason='Supporting evidence deleted.';r.status='revoked';break;
 case 'attentionSettings':break;
 case 'attentionDecisions':clear('reason');break;
 case 'legalWatches':r.sourceUrl='';r.active=false;r.status='stopped';r.leaseToken=null;r.leaseUntil=null;break;
 case 'legalChanges':if(r.assessment)r.assessment={...(r.assessment as object),reason:'Assessment payload deleted.'};break;
 case 'drafts':clear('body');r.contentHash=digest('');r.changes=[];r.questions=[];r.tasks=[];r.status='rejected';r.standingEligible=false;r.rejectionReason='Supporting evidence deleted.';if(r.request)r.request={...(r.request as object),instruction:'',missingFields:[],fieldFactIds:{}};break;
 case 'templateApprovals':clear('purpose');r.fields=[];r.status='revoked';r.standingInternal=false;break;
 case 'matters':clear('objective');r.outcome=null;r.blockers=['Evidence was deleted. Future work requires a new authorized basis.'];r.tasks=(r.tasks as {title:string}[]).map(t=>({...t,title:'Removed evidence task',requiredFactPredicates:[]}));break;
 case 'proposals':clear('body');r.contentHash=digest('');r.noticeMatrix=[];r.unknowns=[];r.status='invalidated';break;
 case 'approvals':clear('note');r.recipients=[];r.destination=null;r.status='revoked';break;
 case 'actions':clear('content');r.recipients=[];r.destination=null;if(r.completion)r.completion={...(r.completion as object),artifact:'Evidence payload deleted; original completion identity and timestamp retained.'};if(!['verified','failed','canceled'].includes(String(r.status)))r.status='canceled';break;
 case 'counsel':clear('packet','intakeEvidence');r.providerName=null;r.recipient=null;r.terms=null;r.reviewNotes=[];if(r.escalation)r.escalation={...(r.escalation as object),detail:''};if(r.sharing)r.sharing={...(r.sharing as object),revokedAt:(r.sharing as {revokedAt?:string}).revokedAt||timestamp()};break;
 case 'learning':clear('rule','scopeDescription','effectSummary');r.tests=[];delete r.evaluation;delete r.originInput;break;
 case 'legalAuthorities':r.sourceUrl='';r.domain='removed';r.jurisdiction='removed';break;
 case 'coverage':r.domain='removed';r.jurisdiction='removed';r.limitations=['Supporting evidence deleted.'];r.status='unsupported';break;
 case 'events':clear('detail');break;
 case 'effortEntries':clear('evidence');if(r.voidReason)r.voidReason='Excluded record; reason payload deleted.';break;
 case 'effortBaselines':clear('comparisonScope','evidence');break;
 case 'obligations':clear('rationale','fulfillmentCriteria');r.quote=null;r.cancellationReason=r.cancellationReason?'Basis payload deleted.':null;if(r.completion)r.completion={...(r.completion as object),evidence:'Completion payload deleted; attribution retained.'};break;
 }
 return r;
}
export function deletionViews(s:WorkspaceState,a:ActorContext):DeletionView[]{const member=membership(s,a);if(!member.roles.includes('admin'))return [];return (s.deletionJobs||[]).filter(j=>j.actorId===a.actorId&&scopeVisible(s,a,j.scope)&&(!member.entityIds||member.entityIds.includes(s.entityId))).map(j=>({id:j.id,sourceId:j.sourceId,requestedAt:j.requestedAt,recordsRedacted:j.records.length,originalsPending:j.originals.filter(o=>o.status!=='purged').length,operationalExceptions:j.operationalExceptionActionIds.length,indexCleanup:j.indexCleanup,historicalCleanup:j.historicalCleanup,backupExpiresAt:j.backupExpiresAt,backupStatus:j.backupStatus}));}
/** A committed deletion fence prevents a newly uploaded alias from racing an object purge. */
export function assertOriginalNotDeleted(s:WorkspaceState,reference:string,intakeId?:string){if(originalIntakeFenced(s,reference,intakeId)||(s.deletionJobs||[]).some(j=>j.originals.some(o=>o.reference===reference)))throw new V2Error('ORIGINAL_DELETION_FENCED','These original bytes are under an existing deletion request. An operator must resolve retention before restoring this content.');}
/** Called inside the same transaction as source withdrawal; no asynchronous effect occurs here. */
export function applySourceDeletion(s:WorkspaceState,a:ActorContext,sourceId:string,operationalExceptionActionIds:string[]=[]):DeletionJob {
 const root=s.sources.find(x=>x.id===sourceId);if(!root)throw new V2Error('NOT_FOUND','Source unavailable.',404);
 const old=(s.deletionJobs||[]).find(j=>j.sourceId===sourceId),ids=new Set([sourceId,...old?.sourceIds||[],...old?.records.map(r=>r.id)||[]]),all=entries(s);let changed=true;
 // A provider's aggregate snapshot can precede the child observation, so it may have no
 // direct child provenance. Include only snapshots containing this exact erased identity.
 for(const source of s.sources)if(slackSnapshotIncludesSource(s,source,root))ids.add(source.id);
 while(changed){changed=false;for(const {value} of all)if(!ids.has(value.id)&&references(value,ids)){ids.add(value.id);changed=true;}}
 const sourceIds=s.sources.filter(src=>ids.has(src.id)).map(src=>src.id),now=timestamp(),notBefore=new Date(Date.parse(old?.requestedAt||now)+originalDelay()).toISOString();
 const job:DeletionJob=old||{id:randomUUID(),sourceId,sourceIds,actorId:a.actorId,scope:structuredClone(root.scope),requestedAt:now,records:[],originals:[],operationalExceptionActionIds:[],indexCleanup:'pending',historicalCleanup:'pending',backupExpiresAt:null,backupStatus:'operator_verification_required'};
 job.sourceIds=[...new Set([...job.sourceIds,...sourceIds])];
 job.operationalExceptionActionIds=[...new Set([...operationalExceptionActionIds,...redactEffectReceipts(s,ids),...s.actions.filter(x=>ids.has(x.id)&&['dispatching','uncertain','verifying'].includes(x.status)).map(x=>x.id)])].filter(id=>ids.has(id));
 const originalRefs=new Set(s.sources.filter(src=>sourceIds.includes(src.id)&&src.originalObjectRef).map(src=>src.originalObjectRef!));
 for(const [key,receipt] of Object.entries(s.receipts))if(key.startsWith('execution:')){const intent=receipt.result.intent as EffectIntent&{retentionOriginalReferences?:string[]};if(intent&&ids.has(intent.actionId)){for(const ref of intent.retentionOriginalReferences||[])originalRefs.add(ref);if(intent.adapterId==='internal-immutable-document-v1'&&intent.providerReceipt)originalRefs.add(intent.providerReceipt);}}
 for(const reference of originalRefs)if(!job.originals.some(o=>o.reference===reference))job.originals.push({reference,notBefore,status:'pending',failureCode:null});
 for(const id of sourceIds)if(!s.tombstones.some(t=>t.sourceId===id))s.tombstones.push({sourceId:id,deletedAt:now,reason:'Attributed source deletion; retained operational exceptions and backup verification tracked separately.',backupExpiresAt:null});
 const exceptions=new Set(job.operationalExceptionActionIds);
 for(const {kind,value} of all.filter(({value})=>ids.has(value.id))){
  if(kind==='actions'&&exceptions.has(value.id)){value.provenance.sourceIds=[...new Set([...value.provenance.sourceIds,sourceId])];continue;}
  const beforeHash=digest(value),redacted=redactedRecord(kind,value,sourceId),comparable={...redacted,version:value.version,updatedAt:value.updatedAt,...('aclVersion' in value?{aclVersion:value.aclVersion}:{})};
  if(digest(comparable)===beforeHash)continue;
  Object.assign(value,redacted);job.records.push({kind,id:value.id,beforeHash,afterHash:digest(value)});job.indexCleanup='pending';job.historicalCleanup='pending';
 }
 redactKnowledgeReceipts(s,ids,new Set(sourceIds));
 for(const [key,receipt] of Object.entries(s.receipts))if(key.startsWith('learning-evaluation:')&&typeof receipt.result.candidateId==='string'&&ids.has(receipt.result.candidateId))receipt.result={candidateId:receipt.result.candidateId,deleted:true};
 for(const o of s.outbox)if(o.status==='pending'&&o.kind==='matter_changed'&&ids.has(o.aggregateId))o.status='canceled';
 if(!old){(s.deletionJobs||=[]).push(job);s.outbox.push({id:randomUUID(),tenantId:s.tenantId,kind:'retention_cleanup',aggregateId:job.id,commandId:job.id,status:'pending',owner:'v2',createdAt:now});}return job;
}
/** Immutable history admits only the exact payload-redaction manifest committed with deletion. */
export function permittedHistoryRedaction(s:WorkspaceState,kind:'events'|'documents',before:RecordBase,after:RecordBase|undefined){return !!after&&(s.deletionJobs||[]).some(j=>s.tombstones.some(t=>t.sourceId===j.sourceId)&&j.records.some(r=>r.kind===kind&&r.id===before.id&&r.beforeHash===digest(before)&&r.afterHash===digest(after)));}

/** Shared policy for inactive database generations and retained application migration archives. */
export function redactHistoricalRecord(kind:string,value:unknown,job:DeletionJob):unknown {
 if(!recordKinds.includes(kind as RecordKind)||!value||typeof value!=='object')return value;
 const r=value as RecordBase&Record<string,unknown>,ids=new Set([...job.sourceIds,...job.records.map(x=>x.id),...job.operationalExceptionActionIds]);
 if(!r.provenance||!ids.has(r.id)&&!references(r,ids))return value;
 const redacted=redactedRecord(kind as RecordKind,r,job.sourceId);redacted.version=r.version;redacted.updatedAt=r.updatedAt;if('aclVersion' in r)redacted.aclVersion=r.aclVersion;return redacted;
}
export function redactHistoricalWorkspace(state:WorkspaceState,job:DeletionJob){
 const ids=new Set([...job.sourceIds,...job.records.map(x=>x.id),...job.operationalExceptionActionIds]),all=entries(state);let changed=true;while(changed){changed=false;for(const {value} of all)if(!ids.has(value.id)&&references(value,ids)){ids.add(value.id);changed=true;}}
 const expanded={...job,records:[...job.records,...all.filter(({value})=>ids.has(value.id)).map(({kind,value})=>({kind,id:value.id,beforeHash:'',afterHash:''}))]};
 for(const {kind,value} of all)if(ids.has(value.id))Object.assign(value,redactHistoricalRecord(kind,value,expanded));
 redactKnowledgeReceipts(state,ids,new Set(job.sourceIds));redactEffectReceipts(state,ids,{historical:true});
 for(const [key,receipt] of Object.entries(state.receipts))if(key.startsWith('learning-evaluation:')&&typeof receipt.result.candidateId==='string'&&ids.has(receipt.result.candidateId))receipt.result={candidateId:receipt.result.candidateId,deleted:true};
 for(const sourceId of job.sourceIds)if(!state.tombstones.some(t=>t.sourceId===sourceId))state.tombstones.push({sourceId,deletedAt:job.requestedAt,reason:'Deletion propagated into application history.',backupExpiresAt:null});
}
