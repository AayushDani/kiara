import {createHash} from 'node:crypto';
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
function getJob(s:Awaited<ReturnType<typeof readWorkspace>>,id:string){const job=s.deletionJobs?.find(j=>j.id===id);if(!job)throw new V2Error('DELETION_NOT_FOUND','Deletion request unavailable.',404);return job;}
function sameOriginal(left:string,right:string){try{const identity=(value:string)=>{const r=JSON.parse(value);return {storage:r.storage,key:r.key,versionId:r.versionId||null,keyId:r.keyId,sha256:r.sha256};};return digest(identity(left))===digest(identity(right));}catch{return false;}}
export function originalHeldElsewhere(s:Awaited<ReturnType<typeof readWorkspace>>,job:DeletionJob,reference:string){
 const affected=new Set([...job.records.map(r=>r.id),...job.operationalExceptionActionIds]);let contentHash:string;try{contentHash=JSON.parse(reference).sha256;}catch{return true;}
 if(s.sources.some(src=>src.status!=='deleted'&&!!src.originalObjectRef&&sameOriginal(src.originalObjectRef,reference)))return true;
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
  const current=await readWorkspace(tenantId);job=getJob(current,jobId);
  const status=process.env.KIARA_RETENTION_HOLD==='true'?'hold':job.operationalExceptionActionIds.length?'operational_exception':originalHeldElsewhere(current,job,original.reference)?'shared_reference':null;
  if(status){await transactWorkspace(tenantId,s=>{const row=getJob(s,jobId).originals.find(o=>o.reference===original.reference)!;row.status=status;row.failureCode=null;});continue;}
  if(Date.parse(original.notBefore)>Date.now())continue;
  try{
   const reference=JSON.parse(original.reference) as OriginalReference;await(adapters.original||purgeOriginal)(tenantId,reference);
   await transactWorkspace(tenantId,s=>{const row=getJob(s,jobId).originals.find(o=>o.reference===original.reference)!;row.status='purged';row.failureCode=null;});
  }catch(error){const code=failureCode(error);failures.push(code);await transactWorkspace(tenantId,s=>{const row=getJob(s,jobId).originals.find(o=>o.reference===original.reference)!;row.status='failed';row.failureCode=code;});}
 }
 job=getJob(await readWorkspace(tenantId),jobId);
 return {jobId,applicationCleanupComplete:job.indexCleanup==='complete'&&job.historicalCleanup==='complete'&&job.originals.every(o=>o.status==='purged')&&!job.operationalExceptionActionIds.length,originalsPending:job.originals.filter(o=>o.status!=='purged').length,operationalExceptions:job.operationalExceptionActionIds.length,nextOriginalDueAt:job.originals.filter(o=>o.status==='pending').map(o=>o.notBefore).sort()[0]||null,failures:[...new Set(failures)],externalBackupErasureVerified:false};
}
