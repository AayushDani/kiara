import {randomUUID} from 'node:crypto';
import {canRead,membership,readRecord,scopeVisible} from './authority';
import {V2Error,type Action,type ActorContext,type Matter, type Membership, type Proposal, type RecordBase, type Source, type WorkspaceState} from './contracts';
import {digest,readWorkspace,timestamp} from './store';
import {sourceDependencyHash} from './tasks';
import {currentEvidenceLineage} from './source-lifecycle';
import {withinConversationAudience} from './retrieval';

export type WithdrawalCommand=
 |{type:'source.correction.retry';reviewRef:string}
 |{type:'source.correction.assign';reviewRef:string;ownerId:string;expectedRecordVersion:number}
 |{type:'source.correction.effect_review';reviewRef:string;expectedRecordVersion:number;effectReviewHash:string;inspectionId:string;inspectionEvidenceHash:string;note:string}
 |{type:'source.correction.resolve';reviewRef:string;expectedRecordVersion:number;note:string;evidenceSourceIds:string[];evidenceSourceVersions:Record<string,number>;evidenceSourceHashes:Record<string,string>;evidenceSourceDependencyHashes:Record<string,string>};
export const withdrawalCommandFields:Record<WithdrawalCommand['type'],string[]>={
 'source.correction.retry':['reviewRef'],
 'source.correction.assign':['reviewRef','ownerId','expectedRecordVersion'],
 'source.correction.effect_review':['reviewRef','expectedRecordVersion','effectReviewHash','inspectionId','inspectionEvidenceHash','note'],
 'source.correction.resolve':['reviewRef','expectedRecordVersion','note','evidenceSourceIds','evidenceSourceVersions','evidenceSourceHashes','evidenceSourceDependencyHashes']
};
export interface WithdrawalExceptionView {reviewRef:string;status:'owner_unavailable'|'admin_exception'|'effect_review_required'|'effect_reviewed';correctiveMatterId:string|null;version:number|null;effectReviewHash:string|null;verifiedEffects:number}
type EffectReview={hash:string;reviewerId:string;membershipVersion:number;reviewedAt:string;noteHash:string};
type EffectInspection={reviewRef:string;effectReviewHash:string;evidenceHash:string;recordVersion:number;actorId:string;membershipVersion:number;expiresAt:string;consumedAt?:string};
function exceptionEntries(s:WorkspaceState){return Object.entries(s.receipts).filter(([key,receipt])=>key.startsWith('source-withdrawal:')&&typeof receipt.result.reviewRef==='string');}
export function isWithdrawalCorrection(s:WorkspaceState,matterId:string){return exceptionEntries(s).some(([,receipt])=>receipt.result.correctiveMatterId===matterId);}
function unreadableVerifiedEffects(s:WorkspaceState,result:Record<string,unknown>,owner:ActorContext):Action[]{
 return s.actions.filter(item=>item.matterId===result.affectedMatterId&&item.status==='verified'&&(()=>{try{return !canRead(s,owner,item)}catch{return true}})());
}
function effectReviewHash(s:WorkspaceState,effects:Action[]){
 return digest(effects.map(item=>({action:digest(item),intent:digest(s.receipts[`execution:${item.id}`]?.result.intent||null)})).sort((a,b)=>a.action.localeCompare(b.action)));
}
function effectReviewCurrent(s:WorkspaceState,result:Record<string,unknown>,hash:string,effects:Action[]){
 const review=result.effectReview as EffectReview|undefined,reviewer=review&&s.memberships.find(item=>item.actorId===review.reviewerId);
 return !!review&&review.hash===hash&&!!reviewer&&reviewer.version===review.membershipVersion&&activeRole(s,reviewer,'admin')&&effects.every(effect=>reviewer.roles.includes(effect.kind==='signature_request'?'signatory':'publisher'));
}
function retainedReadbackCurrent(s:WorkspaceState,effect:Action){
 const completion=effect.completion,intent=s.receipts[`execution:${effect.id}`]?.result.intent as {actionId?:string;actionHash?:string;adapterId?:string;status?:string;providerReceipt?:string|null;completionArtifact?:string|null;redactedAt?:string|null}|undefined;
 return effect.status==='verified'&&completion?.kind==='readback'&&!!completion.artifact&&!!effect.providerReceipt&&!!intent&&intent.actionId===effect.id&&intent.actionHash===effect.contentHash&&!!intent.adapterId&&completion.verifierId===`adapter:${intent.adapterId}`&&intent.status==='verified'&&intent.providerReceipt===effect.providerReceipt&&intent.completionArtifact===completion.artifact&&!intent.redactedAt;
}
function effectInspectionEvidence(s:WorkspaceState,effects:Action[]){
 return effects.map(effect=>{
  const intent=s.receipts[`execution:${effect.id}`]?.result.intent as {id?:string;adapterId?:string;status?:string;providerReceipt?:string|null;completionArtifact?:string|null}|undefined;
  return {actionId:effect.id,kind:effect.kind,status:effect.status,actionHash:digest(effect),targetHash:digest({recipients:effect.recipients,destination:effect.destination,contentHash:effect.contentHash}),providerReceipt:effect.providerReceipt,readbackArtifact:effect.completion?.artifact||null,readbackVerifier:effect.completion?.verifierId||null,readbackAt:effect.completion?.verifiedAt||null,intentId:intent?.id||null,adapterId:intent?.adapterId||null,intentHash:digest(intent||null),intentStatus:intent?.status||null,intentProviderReceipt:intent?.providerReceipt||null,intentCompletionArtifact:intent?.completionArtifact||null};
 }).sort((a,b)=>a.actionHash.localeCompare(b.actionHash));
}
/** This privileged operator-only inspection is intentionally absent from normal snapshots. */
export function inspectWithdrawalEffects(s:WorkspaceState,a:ActorContext,reviewRef:string,expectedRecordVersion:number){
 requireAdmin(s,a);
 const result=exceptionByRef(s,reviewRef).result,m=s.matters.find(item=>item.id===result.correctiveMatterId);
 if(result.status!=='owner_review'||!m||m.version!==expectedRecordVersion||['closed','canceled'].includes(m.state))throw new V2Error('EFFECT_REVIEW_CHANGED','Inspect the current corrective work before reviewing retained effects.',409);
 if(a.actorId===m.ownerId)throw new V2Error('FORBIDDEN','An independent current administrator must inspect retained effects.',403);
 const owner:ActorContext={tenantId:s.tenantId,actorId:m.ownerId,mode:'authenticated',expiresAt:Date.now()+60_000};
 const effects=unreadableVerifiedEffects(s,result,owner),reviewer=membership(s,a);
 if(!effects.length||!effects.every(effect=>reviewer.roles.includes(effect.kind==='signature_request'?'signatory':'publisher')))throw new V2Error('FORBIDDEN','Current delivery or signing review capacity is required.',403);
 if(!effects.every(effect=>retainedReadbackCurrent(s,effect)))throw new V2Error('EFFECT_RECEIPT_REQUIRED','Only exact retained provider readback and matching durable receipts permit this review.',409);
 for(const [key,receipt] of Object.entries(s.receipts).filter(([key])=>key.startsWith('source-effect-inspection:'))){const prior=receipt.result.inspection as EffectInspection|undefined;if(!prior||prior.consumedAt||Date.parse(prior.expiresAt)<=Date.now()||prior.actorId===a.actorId&&prior.reviewRef===reviewRef)delete s.receipts[key];}
 const evidence=effectInspectionEvidence(s,effects),currentHash=effectReviewHash(s,effects),evidenceHash=digest(evidence),inspectionId=randomUUID();
 s.receipts[`source-effect-inspection:${inspectionId}`]={hash:evidenceHash,result:{inspection:{reviewRef,effectReviewHash:currentHash,evidenceHash,recordVersion:m.version,actorId:a.actorId,membershipVersion:reviewer.version,expiresAt:new Date(Date.now()+15*60_000).toISOString()} satisfies EffectInspection}};
 return {reviewRef,effectReviewHash:currentHash,inspectionId,inspectionEvidenceHash:evidenceHash,correctiveMatterVersion:m.version,effects:evidence};
}
/** Admin inventory deliberately contains only opaque references and generic correction IDs. */
export function withdrawalExceptionViews(s:WorkspaceState,a:ActorContext):WithdrawalExceptionView[]{
 const member=membership(s,a);
 if(!activeRole(s,member,'admin'))return [];
 return exceptionEntries(s).flatMap(([,receipt])=>{
  const status=receipt.result.status;
  if(status!=='owner_unavailable'&&status!=='admin_exception'&&status!=='owner_review')return [];
  const matter=s.matters.find(item=>item.id===receipt.result.correctiveMatterId);
  if(status==='admin_exception'&&(!matter||['closed','canceled'].includes(matter.state)))return [];
  const owner=matter&&s.memberships.find(item=>item.actorId===matter.ownerId),actor:ActorContext|null=owner?{tenantId:s.tenantId,actorId:owner.actorId,mode:'authenticated',expiresAt:Date.now()+60_000}:null;
  const effects=actor?unreadableVerifiedEffects(s,receipt.result,actor):[];
  if(status==='owner_review'&&(!matter||['closed','canceled'].includes(matter.state)||!effects.length))return [];
  const hash=effects.length?effectReviewHash(s,effects):null;
  return [{reviewRef:String(receipt.result.reviewRef),status:status==='owner_review'?(hash&&effectReviewCurrent(s,receipt.result,hash,effects)?'effect_reviewed':'effect_review_required'):status,correctiveMatterId:matter?.id||null,version:matter?.version||null,effectReviewHash:hash,verifiedEffects:effects.length}];
 });
}

/** A source loss must not make its owner's outstanding work disappear with its evidence. */
function dependsOnSource(s:WorkspaceState,record:RecordBase,sourceId:string,seen=new Set<string>()):boolean {
 if(seen.has(record.id))return false;
 seen.add(record.id);
 for(const id of record.provenance.sourceIds){
  if(id===sourceId)return true;
  const source=s.sources.find(item=>item.id===id);
  if(source&&dependsOnSource(s,source,sourceId,seen))return true;
 }
 for(const id of record.provenance.factIds||[]){
  const fact=s.facts.find(item=>item.id===id);
  if(fact&&dependsOnSource(s,fact,sourceId,seen))return true;
 }
 return false;
}

function affected(s:WorkspaceState,matter:Matter,sourceId:string){
 if(matter.sourceIds.includes(sourceId)||dependsOnSource(s,matter,sourceId))return true;
 if(matter.sourceIds.some(id=>{const source=s.sources.find(item=>item.id===id);return !!source&&dependsOnSource(s,source,sourceId)}))return true;
 if(matter.factIds.some(id=>{const fact=s.facts.find(item=>item.id===id);return !!fact&&dependsOnSource(s,fact,sourceId)}))return true;
 if(matter.documentIds.some(id=>{const document=s.documents.find(item=>item.id===id);return !!document&&dependsOnSource(s,document,sourceId)}))return true;
 return s.proposals.some(proposal=>proposal.matterId===matter.id&&proposalAffected(s,proposal,sourceId));
}

function proposalAffected(s:WorkspaceState,proposal:Proposal,sourceId:string){
 if(dependsOnSource(s,proposal,sourceId)||Object.hasOwn(proposal.dependencies.sourceVersions,sourceId))return true;
 if(Object.keys(proposal.dependencies.factVersions).some(id=>{const fact=s.facts.find(item=>item.id===id);return !!fact&&dependsOnSource(s,fact,sourceId)}))return true;
 return Object.keys(proposal.dependencies.documentHashes).some(id=>{const document=s.documents.find(item=>item.id===id);return !!document&&dependsOnSource(s,document,sourceId)});
}

/** Revocation removes future authority but does not rewrite submitted or completed effects. */
export function invalidateSourceWithdrawalDecisions(s:WorkspaceState,source:Source,matterIds?:Set<string>,proposalIds?:Set<string>){
 for(const proposal of s.proposals.filter(item=>(!matterIds||matterIds.has(item.matterId))&&(proposalIds?proposalIds.has(item.id):proposalAffected(s,item,source.id)))){
  if(proposal.status==='current'){proposal.status='invalidated';proposal.version++;proposal.updatedAt=timestamp();}
  for(const approval of s.approvals.filter(item=>item.proposalId===proposal.id&&item.status==='active')){approval.status='invalidated';approval.version++;approval.updatedAt=timestamp();}
  for(const action of s.actions.filter(item=>item.proposalId===proposal.id&&['planned','authorized','pending_manual'].includes(item.status))){
   if(action.status==='planned'&&!action.authorizationId)continue;
   action.status='planned';action.authorizationId=null;action.version++;action.updatedAt=timestamp();
  }
 }
}

function activeRole(s:WorkspaceState,membership:Membership,role:'business_owner'|'admin'){
 if(membership.revokedAt||membership.expiresAt&&Date.parse(membership.expiresAt)<=Date.now()||!membership.roles.includes('member')||!membership.roles.includes(role))return false;
 if(role==='admin'&&membership.matterIds!==null)return false;
 return !membership.entityIds||membership.entityIds.includes(s.entityId);
}

function eligibleOwner(s:WorkspaceState,membership:Membership,matter:Matter){
 if(!activeRole(s,membership,'business_owner'))return false;
 const actor:ActorContext={tenantId:s.tenantId,actorId:membership.actorId,mode:'authenticated',expiresAt:Date.now()+60_000};
 try{
  if(!scopeVisible(s,actor,matter.scope))return false;
  if(membership.matterIds&&!membership.matterIds.includes(matter.id)&&!(matter.scope.kind==='private'&&matter.scope.actorIds.includes(membership.actorId)))return false;
  return true;
 }catch{return false;}
}

const withdrawalKey=(matterId:string,sourceId:string)=>`source-withdrawal:${digest({matterId,sourceId})}`;

/** Existing receipts are a stable cursor while a withdrawn source's affected work is processed in batches. */
export function pendingSourceWithdrawalMatters(s:WorkspaceState,source:Source):number {
 return s.matters.filter(matter=>affected(s,matter,source.id)&&!s.receipts[withdrawalKey(matter.id,source.id)]).length;
}

const directProgressKey=(sourceId:string)=>`source-withdrawal-progress:${sourceId}`;
const directBatchLimit=20;
const directScanLimit=100;
interface DirectWithdrawalProgress {sourceId:string;sourceVersion:number;actorId:string;kind:'manual'|'provider';status:'pending'|'complete';phase:'matters'|'proposals'|'deletion'|'complete';matterCursor:string|null;proposalCursor:string|null;deleteRequested:boolean;deletionApplied:boolean;startedAt:string;updatedAt:string}

/** The accepting transaction writes only a small access fence and cursor, never an affected-ID list. */
export function captureSourceWithdrawal(s:WorkspaceState,source:Source,actorId:string,kind:DirectWithdrawalProgress['kind'],deleteRequested=false){
 const prior=s.receipts[directProgressKey(source.id)]?.result as unknown as DirectWithdrawalProgress|undefined;
 if(prior){
  if(deleteRequested&&!prior.deleteRequested){
   prior.deleteRequested=true;prior.deletionApplied=false;prior.status='pending';prior.phase=prior.phase==='complete'?'deletion':prior.phase;prior.updatedAt=timestamp();
   for(const item of s.outbox)if(item.kind==='source_withdrawal'&&item.aggregateId===source.id&&item.owner==='v2'&&item.status==='pending')item.status='canceled';
   s.outbox.push({id:randomUUID(),tenantId:s.tenantId,kind:'source_withdrawal',aggregateId:source.id,commandId:source.id,status:'pending',owner:'v2',createdAt:prior.updatedAt});
  }
  return {sourceId:source.id,remaining:null,queued:prior.status==='pending'};
 }
 const now=timestamp(),progress:DirectWithdrawalProgress={sourceId:source.id,sourceVersion:source.version,actorId,kind,status:'pending',phase:'matters',matterCursor:null,proposalCursor:null,deleteRequested,deletionApplied:false,startedAt:now,updatedAt:now};
 s.receipts[directProgressKey(source.id)]={hash:digest({sourceId:source.id,sourceVersion:source.version,kind,deleteRequested}),result:progress as unknown as Record<string,unknown>};
 s.outbox.push({id:randomUUID(),tenantId:s.tenantId,kind:'source_withdrawal',aggregateId:source.id,commandId:source.id,status:'pending',owner:'v2',createdAt:now});
 return {sourceId:source.id,remaining:null,queued:true};
}

/** Scan stable record IDs in bounded steps while provenance remains intact; delete only after both passes. */
export function resumeSourceWithdrawalInState(s:WorkspaceState,maxMatters=directBatchLimit,sourceIds?:Set<string>){
 let processed=0,corrective=0;
 for(const [key,receipt] of Object.entries(s.receipts)){
  if(!key.startsWith('source-withdrawal-progress:')||processed>=maxMatters)continue;
  const progress=receipt.result as unknown as DirectWithdrawalProgress;
  if(progress.status!=='pending'||sourceIds&&!sourceIds.has(progress.sourceId))continue;
  const source=s.sources.find(item=>item.id===progress.sourceId);
  if(!source||!['revoked','deleted'].includes(source.status))throw new Error('A pending source withdrawal has no committed access fence.');
  if(progress.phase==='matters'){
   const rows=s.matters.filter(m=>progress.matterCursor===null||m.id>progress.matterCursor).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,directScanLimit);
   let scanned=0;
   for(const matter of rows){
    if(processed>=maxMatters)break;
    scanned++;progress.matterCursor=matter.id;
    if(!affected(s,matter,source.id)||s.receipts[withdrawalKey(matter.id,source.id)])continue;
    corrective+=retainSourceWithdrawalWork(s,source,progress.actorId,{matterIds:[matter.id],retryUnavailable:false});processed++;
   }
   if(scanned===rows.length&&rows.length<directScanLimit)progress.phase='proposals';
  }
  if(progress.phase==='proposals'&&processed<maxMatters){
   const rows=s.proposals.filter(p=>progress.proposalCursor===null||p.id>progress.proposalCursor).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,directScanLimit);
   let scanned=0;
   for(const proposal of rows){
    if(processed>=maxMatters)break;
    scanned++;progress.proposalCursor=proposal.id;
    if(!proposalAffected(s,proposal,source.id))continue;
    invalidateSourceWithdrawalDecisions(s,source,undefined,new Set([proposal.id]));processed++;
   }
   if(scanned===rows.length&&rows.length<directScanLimit)progress.phase=progress.deleteRequested?'deletion':'complete';
  }
  if(progress.phase==='complete')progress.status='complete';
  progress.updatedAt=timestamp();
 }
 return {processedMatters:processed,correctiveMatters:corrective,remaining:Object.entries(s.receipts).filter(([key,receipt])=>key.startsWith('source-withdrawal-progress:')&&receipt.result.status==='pending'&&(!sourceIds||sourceIds.has(String(receipt.result.sourceId)))).reduce((sum,[,receipt])=>{const source=s.sources.find(item=>item.id===receipt.result.sourceId);return sum+(source?pendingSourceWithdrawalMatters(s,source):0);},0)};
}

export function pendingSourceWithdrawalSummary(s:WorkspaceState){return Object.entries(s.receipts).filter(([key,receipt])=>key.startsWith('source-withdrawal-progress:')&&receipt.result.status==='pending').map(([,receipt])=>{const source=s.sources.find(item=>item.id===receipt.result.sourceId);return {sourceId:String(receipt.result.sourceId),remaining:source?pendingSourceWithdrawalMatters(s,source):0,deletionPending:!!receipt.result.deleteRequested&&!receipt.result.deletionApplied};});}

/** Operator continuation when no workspace is being refreshed; never contacts a provider. */
export async function resumeSourceWithdrawal(tenantId:string,sourceId:string){
 if(!sourceId||sourceId.length>200)throw new V2Error('SOURCE_REQUIRED','Inspect the exact pending withdrawal source ID.',400);
 const s=await readWorkspace(tenantId);
 if(s.receipts[directProgressKey(sourceId)]?.result.status!=='pending')throw new V2Error('WITHDRAWAL_NOT_PENDING','This source has no pending corrective work.',409);
 const outbox=s.outbox.filter(item=>item.kind==='source_withdrawal'&&item.aggregateId===sourceId&&item.owner==='v2'&&item.status!=='canceled').at(-1);
 if(!outbox)throw new V2Error('OUTBOX_NOT_FOUND','The source withdrawal reference is unavailable.',404);
 return (await import('./orchestration/withdrawal')).processWithdrawalReference({tenantId,aggregateId:sourceId,outboxId:outbox.id});
}

/** Called before the source changes status, inside the same workspace transaction. */
export function retainSourceWithdrawalWork(s:WorkspaceState,source:Source,actorId:string,options:{maxMatters?:number;retryUnavailable?:boolean;onlyReviewRef?:string;matterIds?:string[]}={}):number {
 const matters=s.matters.filter(matter=>{
  const prior=s.receipts[withdrawalKey(matter.id,source.id)];
  return options.onlyReviewRef?prior?.result.status==='owner_unavailable'&&prior.result.reviewRef===options.onlyReviewRef:options.matterIds?options.matterIds.includes(matter.id):affected(s,matter,source.id);
 });
 let created=0,attempted=0;
 for(const matter of matters){
  const key=withdrawalKey(matter.id,source.id);
  const previous=s.receipts[key];
  if(previous&&(previous.result.status!=='owner_unavailable'||options.retryUnavailable===false))continue;
  if(attempted>=(options.maxMatters??Infinity))break;
  attempted++;
  const reviewRef=`EW-${key.slice('source-withdrawal:'.length,'source-withdrawal:'.length+12).toUpperCase()}`;
  const assigned=s.memberships.find(member=>member.actorId===matter.ownerId&&eligibleOwner(s,member,matter));
  const administrator=assigned?null:s.memberships.filter(member=>activeRole(s,member,'admin')).sort((a,b)=>a.actorId.localeCompare(b.actorId))[0]||null;
  const owner=assigned||administrator;
  if(!owner){
   // Never keep unavailable evidence current simply because no qualified owner exists.
   // The receipt is a durable operator exception; the former owner sees no source content.
   s.receipts[key]={hash:key,result:{status:'owner_unavailable',reviewRef,affectedMatterId:matter.id,sourceId:source.id}};
   continue;
  }
  const now=timestamp(),id=randomUUID(),adminException=!assigned;
  const correction:Matter={
   id,tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,
   scope:{kind:'private',actorIds:[owner.actorId]},
   provenance:{actorId,sourceIds:[],factIds:[],description:'Source-independent corrective work after evidence access changed.'},
   title:adminException?`Assign an owner for affected work · ${reviewRef}`:`Review work after evidence access changed · ${reviewRef}`,
   objective:adminException?'An earlier work item lost supporting evidence. Assign an authorized business owner and assess completed or unresolved effects from currently permitted records.':'An earlier work item lost supporting evidence. Reassess its decisions and any completed or unresolved effects from currently permitted records.',
   entityId:s.entityId,state:'needs_facts',ownerId:owner.actorId,conversationIds:[],scenarioId:null,eventIds:[],sourceIds:[],factIds:[],documentIds:[],proposalId:null,
   tasks:[{id:randomUUID(),title:adminException?'Assign an authorized owner and review the evidence-loss exception':'Review affected work using current authorized evidence',ownerId:owner.actorId,status:'pending',kind:adminException?'verification':'business',purpose:'work',dueAt:null,deadlineType:'undated',evidenceIds:[]}],
   blockers:[adminException?'The previous owner is unavailable or no longer authorized. Assign a qualified owner before work resumes.':'Supporting evidence is unavailable. Earlier external effects remain historical; check their current outcome before further action.'],
   outcome:null,closedAt:null,ruleVersion:s.ruleVersion,correlationKeys:[]
  };
  s.matters.push(correction);
  s.events.push({id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(correction.scope),provenance:{actorId,sourceIds:[],factIds:[],description:'Source-independent corrective work.'},type:'source.withdrawal_correction',title:'Affected work needs review',detail:'Supporting evidence became unavailable. The assigned owner must review current evidence and historical effects.',matterId:id,recordId:id,measurement:s.rehearsal?'fictional_rehearsal':'observed'});
  s.outbox.push({id:randomUUID(),tenantId:s.tenantId,kind:'matter_changed',aggregateId:id,commandId:key,status:'pending',owner:'v2',createdAt:now});
  s.receipts[key]={hash:key,result:{status:adminException?'admin_exception':'owner_review',reviewRef,correctiveMatterId:id,affectedMatterId:matter.id,sourceId:source.id}};
  created++;
 }
 return created;
}

function exceptionByRef(s:WorkspaceState,reviewRef:string){
 if(typeof reviewRef!=='string'||!/^EW-[A-F0-9]{12}$/.test(reviewRef))throw new V2Error('NOT_FOUND','The exception is unavailable.',404);
 const found=exceptionEntries(s).find(([,receipt])=>receipt.result.reviewRef===reviewRef);
 if(!found)throw new V2Error('NOT_FOUND','The exception is unavailable.',404);
 return found[1];
}
function requireAdmin(s:WorkspaceState,a:ActorContext){
 const member=membership(s,a);
 if(!activeRole(s,member,'admin'))throw new V2Error('FORBIDDEN','Current entity administrator authority is required.',403);
}
function changeEvent(s:WorkspaceState,a:ActorContext,m:Matter,type:string,title:string,detail:string){
 const now=timestamp();
 s.events.push({id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(m.scope),provenance:{actorId:a.actorId,sourceIds:[],factIds:[],description:'Source-independent corrective work lifecycle.'},type,title,detail,matterId:m.id,recordId:m.id,measurement:s.rehearsal?'fictional_rehearsal':'observed'});
 s.outbox.push({id:randomUUID(),tenantId:s.tenantId,kind:'matter_changed',aggregateId:m.id,commandId:`${type}:${m.id}:${m.version}`,status:'pending',owner:'v2',createdAt:now});
}
export function applyWithdrawalCommand(s:WorkspaceState,a:ActorContext,c:WithdrawalCommand):Record<string,unknown>{
 if(c.type==='source.correction.retry'||c.type==='source.correction.assign'||c.type==='source.correction.effect_review')requireAdmin(s,a);
 else membership(s,a);
 const receipt=exceptionByRef(s,c.reviewRef),result=receipt.result;
 if(c.type==='source.correction.retry'){
  if(result.status!=='owner_unavailable')return {reviewRef:c.reviewRef,correctiveMatterId:result.correctiveMatterId||null,replayed:true};
  const source=s.sources.find(item=>item.id===result.sourceId);
  if(!source)throw new V2Error('NOT_FOUND','The retained exception source is unavailable for recovery.',404);
  const count=retainSourceWithdrawalWork(s,source,a.actorId,{onlyReviewRef:c.reviewRef});
  if(count!==1)throw new V2Error('EXCEPTION_RECOVERY_FAILED','The retained exception could not be assigned without widening access.',409);
  return {reviewRef:c.reviewRef,correctiveMatterId:receipt.result.correctiveMatterId};
 }
 const m=s.matters.find(item=>item.id===result.correctiveMatterId);
 if(!m||!['owner_review','admin_exception'].includes(String(result.status)))throw new V2Error('NOT_FOUND','The corrective matter is unavailable.',404);
 if(m.version!==c.expectedRecordVersion)throw new V2Error('VERSION_CONFLICT','Inspect the current corrective work before changing it.',409);
 if(m.state==='closed'||m.state==='canceled')throw new V2Error('MATTER_TERMINAL','This corrective work is already resolved.',409);
 if(c.type==='source.correction.assign'){
  if(result.status!=='admin_exception')throw new V2Error('NOT_FOUND','Only an administrator-owned exception can be assigned.',404);
  const originalTask=m.tasks[0];
  if(m.tasks.length!==1||!originalTask||originalTask.kind!=='verification'||originalTask.status!=='pending'||originalTask.completion||originalTask.evidenceIds.length||m.proposalId!==null||m.sourceIds.length||m.factIds.length||m.documentIds.length||m.provenance.sourceIds.length||s.proposals.some(item=>item.matterId===m.id)||s.actions.some(item=>item.matterId===m.id)||s.approvals.some(item=>item.matterId===m.id)||(s.obligations||[]).some(item=>item.matterId===m.id))throw new V2Error('CORRECTION_WORKFLOW_CHANGED','The administrator exception changed; inspect and reconcile its current work before assignment.',409);
  const candidate=s.memberships.find(item=>item.actorId===c.ownerId);
  if(!candidate||!activeRole(s,candidate,'business_owner'))throw new V2Error('OWNER_REQUIRED','Choose a current entity-scoped business owner.',403);
  m.ownerId=candidate.actorId;m.scope={kind:'private',actorIds:[candidate.actorId]};
  originalTask.ownerId=candidate.actorId;originalTask.kind='business';originalTask.title='Review affected work using current authorized evidence';
  m.title=`Review work after evidence access changed · ${c.reviewRef}`;
  m.objective='An earlier work item lost supporting evidence. Reassess its decisions and any completed or unresolved effects from currently permitted records.';
  m.blockers=['Supporting evidence is unavailable. Earlier external effects remain historical; check their current outcome before further action.'];
  const assignedActor:ActorContext={tenantId:s.tenantId,actorId:candidate.actorId,mode:'authenticated',expiresAt:Date.now()+60_000};
  if(s.actions.some(item=>item.matterId===result.affectedMatterId&&['verified','uncertain','dispatching','verifying','failed'].includes(item.status)&&!canRead(s,assignedActor,item)))m.blockers.push('Historical effects are not readable by this owner. Keep corrective review open for qualified operator reconciliation.');
  m.version++;m.updatedAt=timestamp();result.status='owner_review';
  changeEvent(s,a,m,c.type,'Corrective review assigned','A current business owner must assess available records and historical effects.');
  return {reviewRef:c.reviewRef,correctiveMatterId:m.id,ownerId:candidate.actorId};
 }
 if(c.type==='source.correction.effect_review'){
  if(result.status!=='owner_review'||a.actorId===m.ownerId)throw new V2Error('FORBIDDEN','An independent current administrator must review retained effect receipts.',403);
  const owner:ActorContext={tenantId:s.tenantId,actorId:m.ownerId,mode:'authenticated',expiresAt:Date.now()+60_000};
  const effects=unreadableVerifiedEffects(s,result,owner),hash=effectReviewHash(s,effects),reviewer=membership(s,a);
  if(!effects.length||c.effectReviewHash!==hash)throw new V2Error('EFFECT_REVIEW_CHANGED','Inspect the current opaque effect review fingerprint.',409);
  if(!effects.every(effect=>reviewer.roles.includes(effect.kind==='signature_request'?'signatory':'publisher')))throw new V2Error('FORBIDDEN','Current delivery or signing review capacity is required.',403);
  if(!effects.every(effect=>retainedReadbackCurrent(s,effect)))throw new V2Error('EFFECT_RECEIPT_REQUIRED','Only exact retained provider readback and matching durable receipts permit this review.',409);
  const inspection=s.receipts[`source-effect-inspection:${c.inspectionId}`]?.result.inspection as EffectInspection|undefined;
  if(!inspection||inspection.reviewRef!==c.reviewRef||inspection.effectReviewHash!==hash||inspection.evidenceHash!==c.inspectionEvidenceHash||inspection.evidenceHash!==digest(effectInspectionEvidence(s,effects))||inspection.recordVersion!==m.version||inspection.actorId!==a.actorId||inspection.membershipVersion!==reviewer.version||inspection.consumedAt||Date.parse(inspection.expiresAt)<=Date.now())throw new V2Error('EFFECT_INSPECTION_REQUIRED','Inspect the exact retained effect and provider readback before attesting.',409);
  if(typeof c.note!=='string'||c.note.trim().length<30||c.note.length>2000)throw new V2Error('REVIEW_ATTESTATION_REQUIRED','Record the exact retained receipt review in 30 to 2,000 characters.',400);
  inspection.consumedAt=timestamp();
  delete s.receipts[`source-effect-inspection:${c.inspectionId}`];
  result.effectReview={hash,reviewerId:a.actorId,membershipVersion:reviewer.version,reviewedAt:timestamp(),noteHash:digest(c.note.trim())} satisfies EffectReview;
  m.blockers=m.blockers.filter(value=>!value.startsWith('Historical effects are not readable by this owner.'));
  m.blockers.push('A qualified operator reviewed retained effect readback records. The assigned owner must still review current authorized evidence.');
  m.version++;m.updatedAt=timestamp();
  changeEvent(s,a,m,c.type,'Retained effect review recorded','An independent qualified operator reviewed exact retained readback evidence; no new provider delivery was claimed.');
  return {reviewRef:c.reviewRef,correctiveMatterId:m.id,effectReviewHash:hash,reviewed:true};
 }
 const member=membership(s,a);
 if(!activeRole(s,member,'business_owner')||m.ownerId!==a.actorId||!canRead(s,a,m))throw new V2Error('FORBIDDEN','The current assigned business owner must attest corrective review.',403);
 if(result.status!=='owner_review'||m.tasks.some(task=>task.ownerId!==a.actorId||task.kind!=='business'||task.status!=='pending'))throw new V2Error('OWNER_REQUIRED','A current business owner must be assigned to this pending corrective review.',403);
 if(typeof c.note!=='string'||c.note.trim().length<30||c.note.length>4000)throw new V2Error('TASK_EVIDENCE_REQUIRED','Describe the completed review in 30 to 4,000 characters.',400);
 if(!Array.isArray(c.evidenceSourceIds)||c.evidenceSourceIds.length<1||c.evidenceSourceIds.length>20||c.evidenceSourceIds.some(id=>typeof id!=='string'))throw new V2Error('TASK_EVIDENCE_REQUIRED','Cite current authorized evidence for the completed review.',400);
 const ids=[...new Set(c.evidenceSourceIds)];
 const sources=ids.map(id=>readRecord(s,a,s.sources,id));
 const maps=[c.evidenceSourceVersions,c.evidenceSourceHashes,c.evidenceSourceDependencyHashes];
 if(!maps.every(map=>map&&typeof map==='object'&&!Array.isArray(map)&&digest(Object.keys(map).sort())===digest([...ids].sort()))||!sources.every(source=>source.version===c.evidenceSourceVersions[source.id]&&source.contentHash===c.evidenceSourceHashes[source.id]&&sourceDependencyHash(s,[source.id])===c.evidenceSourceDependencyHashes[source.id]))throw new V2Error('TASK_EVIDENCE_CHANGED','Inspect the exact current evidence and dependency versions before attesting.',409);
 if(!sources.every(source=>currentEvidenceLineage(s,source)&&withinConversationAudience(s,m as never,source)))throw new V2Error('TASK_EVIDENCE_SCOPE','Completion evidence must remain current in the corrective matter audience.',403);
 if(s.actions.some(item=>[result.affectedMatterId,m.id].includes(item.matterId)&&['uncertain','dispatching','verifying','failed'].includes(item.status)))throw new V2Error('RECONCILIATION_REQUIRED','Historical or corrective unresolved effects require reconciliation before corrective closure.',409);
 const unreadable=unreadableVerifiedEffects(s,result,a);
 if(unreadable.length&&!effectReviewCurrent(s,result,effectReviewHash(s,unreadable),unreadable))throw new V2Error('EFFECT_REVIEW_UNAVAILABLE','Historical effects are unreadable by this owner and require current qualified operator review of retained receipts.',409);
 const now=timestamp(),task=m.tasks[0];
 if(!task||m.tasks.length!==1||m.proposalId!==null||s.proposals.some(item=>item.matterId===m.id)||s.actions.some(item=>item.matterId===m.id)||s.approvals.some(item=>item.matterId===m.id))throw new V2Error('CORRECTION_WORKFLOW_CHANGED','The dedicated corrective review cannot bypass ordinary proposal or effect gates.',409);
 task.status='done';task.evidenceIds=ids;task.completion={kind:'human_attestation',actorId:a.actorId,membershipVersion:member.version,at:now,note:c.note.trim(),sourceIds:ids,sourceVersions:Object.fromEntries(sources.map(source=>[source.id,source.version])),proofHash:sourceDependencyHash(s,ids)};
 m.sourceIds=ids;m.provenance.sourceIds=ids;
 m.state='closed';m.closedAt=now;m.outcome='Assigned owner completed corrective review of currently authorized records.';m.blockers=[];m.version++;m.updatedAt=now;
 result.status='resolved';
 changeEvent(s,a,m,c.type,'Corrective review completed','Named business owner attested review; earlier external effects remain historical.');
 return {reviewRef:c.reviewRef,correctiveMatterId:m.id,resolved:true};
}
