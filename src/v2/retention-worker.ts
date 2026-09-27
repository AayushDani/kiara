import {createHash,randomUUID} from 'node:crypto';
import {applySourceDeletion,redactHistoricalRecord,redactHistoricalWorkspace,type DeletionJob} from './retention';
import {purgeOriginal,type OriginalReference} from './objects';
import {purgeHybridRecords} from './hybrid';
import {purgeNormalizedHistory} from './normalized-store';
import {readWorkspace,transactWorkspace,digest} from './store';
import {V2Error} from './contracts';

export interface RetentionAdapters {
 original?:(tenantId:string,reference:OriginalReference)=>Promise<void>;
 index?:(tenantId:string,deletionId:string,recordIds:string[])=>Promise<unknown>;
 history?:(tenantId:string,deletionId:string,job:DeletionJob)=>Promise<unknown>;
}
const purgeClaimMs=15*60_000;
function getJob(s:Awaited<ReturnType<typeof readWorkspace>>,id:string){const job=s.deletionJobs?.find(j=>j.id===id);if(!job)throw new V2Error('DELETION_NOT_FOUND','Deletion request unavailable.',404);return job;}
function sameOriginal(left:string,right:string){try{const identity=(value:string)=>{const r=JSON.parse(value);return {storage:r.storage,key:r.key,versionId:r.versionId||null,keyId:r.keyId,sha256:r.sha256};};return digest(identity(left))===digest(identity(right));}catch{return false;}}
export function originalHeldElsewhere(s:Awaited<ReturnType<typeof readWorkspace>>,job:DeletionJob,reference:string){
 const affected=new Set([...job.records.map(r=>r.id),...job.operationalExceptionActionIds]);let contentHash:string;try{contentHash=JSON.parse(reference).sha256;}catch{return true;}
 if(s.sources.some(src=>src.status!=='deleted'&&!!src.originalObjectRef&&sameOriginal(src.originalObjectRef,reference)))return true;
 // A second deleted source may share the same physical object but have a later
 // retention deadline. Neither job may purge the bytes before every owner is due.
 if((s.deletionJobs||[]).some(other=>other.id!==job.id&&other.originals.some(original=>original.status!=='purged'&&sameOriginal(original.reference,reference)&&(original.status==='purging'&&Date.parse(original.claimExpiresAt||'')>Date.now()||!Number.isFinite(Date.parse(original.notBefore))||Date.parse(original.notBefore)>Date.now()||other.operationalExceptionActionIds.length>0))))return true;
 for(const [key,receipt] of Object.entries(s.receipts)){
  if(key.startsWith('artifact-intake:')){const intake=receipt.result.intake as {reference?:string;contentHash?:string;status?:string;expiresAt?:string}|undefined;if(intake?.status==='staging'&&intake.contentHash===contentHash)return true;if(intake?.reference&&['staging','retained'].includes(intake.status||'')&&Date.parse(intake.expiresAt||'')>Date.now()&&sameOriginal(intake.reference,reference))return true;}
  if(key.startsWith('execution:')){const intent=receipt.result.intent as {actionId:string;status:string;redactedAt?:string;providerReceipt?:string;completionArtifact?:string;retentionOriginalReferences?:string[];actionSnapshot?:{content?:string;completion?:{artifact?:string}}}|undefined;if(!intent||affected.has(intent.actionId)||intent.redactedAt&&['verified','failed'].includes(intent.status))continue;const refs=[intent.providerReceipt,intent.completionArtifact,intent.actionSnapshot?.completion?.artifact,...intent.retentionOriginalReferences||[]].filter((r):r is string=>!!r);if(refs.some(r=>{if(sameOriginal(r,reference))return true;try{const parsed=JSON.parse(r);return parsed.readback&&sameOriginal(JSON.stringify(parsed.readback),reference);}catch{return false;}}))return true;if(['prepared','dispatched','verifying','uncertain'].includes(intent.status)&&intent.actionSnapshot?.content&&createHash('sha256').update(intent.actionSnapshot.content).digest('hex')===contentHash)return true;}
 }
 return s.actions.some(a=>!affected.has(a.id)&&['dispatching','uncertain','verifying'].includes(a.status)&&createHash('sha256').update(a.content).digest('hex')===contentHash);
}
const failureCode=(error:unknown)=>error instanceof V2Error?error.code:'RETENTION_PROVIDER_UNAVAILABLE';
/** Durable worker input is an opaque tenant/job reference, never evidence text or object credentials. */
export async function processDeletionJob(tenantId:string,jobId:string,adapters:RetentionAdapters={}){
 const refreshed=await transactWorkspace(tenantId,s=>{const j=getJob(s,jobId);return applySourceDeletion(s,{tenantId,actorId:j.actorId,expiresAt:Date.now()+1000,mode:'authenticated'},j.sourceId);});
 let job=refreshed.result;const failures:string[]=[];
 const manifestKey=`${job.id}:${digest({sources:job.sourceIds,records:job.records.map(r=>[r.id,r.afterHash]),exceptions:job.operationalExceptionActionIds})}`;
 const recordIds=[...new Set([...job.sourceIds,...job.records.map(r=>r.id),...job.operationalExceptionActionIds])];
 const hasIndex=!!adapters.index||process.env.KIARA_V2_RETRIEVAL_MODE==='atlas'||Object.keys(refreshed.state.receipts).some(k=>k.startsWith('embedding:index:'));
 if(hasIndex)await transactWorkspace(tenantId,s=>{getJob(s,jobId).indexCleanup='pending';});
 if(adapters.history||process.env.MONGODB_URI)await transactWorkspace(tenantId,s=>{getJob(s,jobId).historicalCleanup='pending';});
 try{if(hasIndex)await(adapters.index||purgeHybridRecords)(tenantId,manifestKey,recordIds);await transactWorkspace(tenantId,s=>{getJob(s,jobId).indexCleanup='complete';});}catch(error){failures.push(failureCode(error));}
 try{if(adapters.history)await adapters.history(tenantId,manifestKey,job);else if(process.env.MONGODB_URI)await purgeNormalizedHistory(tenantId,manifestKey,{redactRecord:(kind,value)=>redactHistoricalRecord(kind,value,job),redactWorkspace:state=>redactHistoricalWorkspace(state,job)});await transactWorkspace(tenantId,s=>{getJob(s,jobId).historicalCleanup='complete';});}catch(error){failures.push(failureCode(error));}
 for(const original of job.originals){
  if(original.status==='purged')continue;
  // The holder/deadline check and renewable purge claim share the workspace transaction.
  // A concurrent worker must not dispatch the same physical purge while this claim is live.
  const claim=await transactWorkspace(tenantId,s=>{
   const currentJob=getJob(s,jobId),row=currentJob.originals.find(o=>o.reference===original.reference);
   if(!row||row.status==='purged'||row.status==='purging'&&Date.parse(row.claimExpiresAt||'')>Date.now())return null;
   const status=process.env.KIARA_RETENTION_HOLD==='true'?'hold':currentJob.operationalExceptionActionIds.length?'operational_exception':originalHeldElsewhere(s,currentJob,row.reference)?'shared_reference':null;
   if(status){row.status=status;row.failureCode=null;row.claimId=null;row.claimExpiresAt=null;return null;}
   const due=Date.parse(row.notBefore);
   if(!Number.isFinite(due)||due>Date.now()){row.status='pending';row.claimId=null;row.claimExpiresAt=null;return null;}
   const claimId=randomUUID();row.status='purging';row.failureCode=null;row.claimId=claimId;row.claimExpiresAt=new Date(Date.now()+purgeClaimMs).toISOString();return claimId;
  });
  if(!claim.result)continue;
  try{
   const reference=JSON.parse(original.reference) as OriginalReference;await(adapters.original||purgeOriginal)(tenantId,reference);
   await transactWorkspace(tenantId,s=>{const row=getJob(s,jobId).originals.find(o=>o.reference===original.reference)!;if(row.claimId!==claim.result)return;row.status='purged';row.failureCode=null;row.claimId=null;row.claimExpiresAt=null;});
  }catch(error){const code=failureCode(error);const recorded=await transactWorkspace(tenantId,s=>{const row=getJob(s,jobId).originals.find(o=>o.reference===original.reference)!;if(row.claimId!==claim.result)return false;row.status='failed';row.failureCode=code;row.claimId=null;row.claimExpiresAt=null;return true;});if(recorded.result)failures.push(code);}
 }
 job=getJob(await readWorkspace(tenantId),jobId);
 return {jobId,applicationCleanupComplete:job.indexCleanup==='complete'&&job.historicalCleanup==='complete'&&job.originals.every(o=>o.status==='purged')&&!job.operationalExceptionActionIds.length,originalsPending:job.originals.filter(o=>o.status!=='purged').length,operationalExceptions:job.operationalExceptionActionIds.length,nextOriginalDueAt:job.originals.flatMap(o=>o.status==='pending'?[o.notBefore]:o.status==='purging'&&o.claimExpiresAt?[o.claimExpiresAt]:[]).sort()[0]||null,failures:[...new Set(failures)],externalBackupErasureVerified:false};
}
