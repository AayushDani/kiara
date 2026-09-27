import {createHash} from 'node:crypto';
import {requireRole} from './authority';
import {V2Error,type ActorContext,type WorkspaceState} from './contracts';
import {retainOriginal,purgeOriginal,readOriginal,type OriginalReference} from './objects';
import {digest,readWorkspace,timestamp,transactWorkspace} from './store';

interface Intake {id:string;actorId:string;contentHash:string;bytes:number;createdAt:string;expiresAt:string;reference:string|null;status:'staging'|'retained'|'attached'|'purging'|'purged';failureCode:string|null}
const prefix='artifact-intake:';
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
function protectedOriginal(s:WorkspaceState,reference:string,contentHash:string){
 return s.sources.some(src=>src.status!=='deleted'&&src.originalObjectRef===reference)||s.actions.some(a=>['dispatching','uncertain','verifying'].includes(a.status)&&sha(a.content)===contentHash);
}
export function originalIntakeFenced(s:WorkspaceState,reference:string,intakeId?:string){const admitted=intakeId?s.receipts[prefix+intakeId]?.result.intake as Intake|undefined:undefined;const fresh=admitted?.reference===reference&&['retained','attached'].includes(admitted.status);return Object.entries(s.receipts).some(([key,receipt])=>{const job=receipt.result.intake as Intake|undefined;return key.startsWith(prefix)&&job?.reference===reference&&(job.status==='purging'||!fresh&&job.status==='purged');});}
/** Track intake before object I/O so rejected or stale commands do not create silent retained artifacts. */
export async function retainIntakeOriginal(a:ActorContext,idempotencyKey:string,bytes:Uint8Array,expectedVersion:number,options:{retain?:typeof retainOriginal}={}):Promise<{reference:OriginalReference;expectedVersion:number}>{
 const id=digest({actor:a.actorId,key:idempotencyKey}),key=prefix+id,contentHash=sha(bytes);
 const claimed=await transactWorkspace(a.tenantId,s=>{requireRole(s,a,'member');if(Object.entries(s.receipts).some(([otherKey,receipt])=>{const intake=receipt.result.intake as Intake|undefined;return otherKey.startsWith(prefix)&&intake?.contentHash===contentHash&&intake.status==='purging';}))throw new V2Error('ORIGINAL_PURGE_IN_PROGRESS','These original bytes are currently being purged. Wait for verified cleanup before starting a new intake.');if((s.deletionJobs||[]).some(j=>j.originals.some(o=>{try{return JSON.parse(o.reference).sha256===contentHash;}catch{return true;}})))throw new V2Error('ORIGINAL_DELETION_FENCED','These bytes are already under deletion and cannot be re-created by another intake.');const commandAlreadySaved=!!s.receipts[digest({actorId:a.actorId,key:idempotencyKey})];if(s.version!==expectedVersion&&!commandAlreadySaved)throw new V2Error('VERSION_CONFLICT','The workspace changed before original intake. Refresh and review.');const prior=s.receipts[key]?.result.intake as Intake|undefined;if(prior){if(prior.contentHash!==contentHash||prior.bytes!==bytes.byteLength)throw new V2Error('IDEMPOTENCY_CONFLICT','This intake key already identifies different original bytes.');if(['purging','purged'].includes(prior.status))throw new V2Error('INTAKE_EXPIRED','This unattached intake expired. Start a new reviewed upload.');return prior;}const job:Intake={id,actorId:a.actorId,contentHash,bytes:bytes.byteLength,createdAt:timestamp(),expiresAt:new Date(Date.now()+86400000).toISOString(),reference:null,status:'staging',failureCode:null};s.receipts[key]={hash:digest({id,contentHash,bytes:bytes.byteLength}),result:{intake:job}};s.outbox.push({id:`artifact_${id}`,tenantId:s.tenantId,kind:'artifact_cleanup',aggregateId:id,commandId:id,status:'pending',owner:'v2',createdAt:job.createdAt});return job;});
 if(claimed.result.reference)return {reference:JSON.parse(claimed.result.reference) as OriginalReference,expectedVersion:claimed.state.version};
 const reference=await(options.retain||retainOriginal)(a.tenantId,bytes),encoded=JSON.stringify(reference);
 const saved=await transactWorkspace(a.tenantId,s=>{const unchanged=s.version===claimed.state.version,job=s.receipts[key].result.intake as Intake;job.reference=encoded;if(job.status==='staging'){job.status='retained';job.failureCode=null;}return unchanged&&!['purging','purged'].includes(job.status);});
 if(!saved.result)throw new V2Error('VERSION_CONFLICT','The workspace changed while retaining the original. Refresh and review before applying it.');
 return {reference,expectedVersion:saved.state.version};
}
/** Called by operator/worker sweep. Source deletion owns attached originals; this only handles abandoned intake. */
export async function purgeExpiredIntakes(tenantId:string,intakeId?:string){
 const before=await readWorkspace(tenantId),keys=Object.keys(before.receipts).filter(k=>k.startsWith(prefix)&&(!intakeId||k===prefix+intakeId));let purged=0,retained=0,unresolved=0;
 for(const key of keys){
  const claim=await transactWorkspace(tenantId,s=>{const job=s.receipts[key].result.intake as Intake;if(job.status==='purged')return null;if(job.reference&&s.sources.some(src=>src.status!=='deleted'&&src.originalObjectRef===job.reference)){job.status='attached';return null;}if(job.reference&&protectedOriginal(s,job.reference,job.contentHash))return null;if(Object.entries(s.receipts).some(([otherKey,r])=>{const other=r.result.intake as Intake|undefined;return otherKey!==key&&otherKey.startsWith(prefix)&&other?.contentHash===job.contentHash&&(other.status==='staging'||other.status==='retained'&&Date.parse(other.expiresAt)>Date.now());}))return null;if(Date.parse(job.expiresAt)>Date.now())return null;if(!job.reference){job.failureCode='ORIGINAL_REFERENCE_RECONCILIATION_REQUIRED';return {missing:true,job};}job.status='purging';return {missing:false,job};});
  if(!claim.result){retained++;continue;}if(claim.result.missing){unresolved++;continue;}
  const {job}=claim.result;try{await purgeOriginal(tenantId,JSON.parse(job.reference!) as OriginalReference);await transactWorkspace(tenantId,s=>{const current=s.receipts[key].result.intake as Intake;current.status='purged';current.failureCode=null;});purged++;}catch{await transactWorkspace(tenantId,s=>{(s.receipts[key].result.intake as Intake).failureCode='ORIGINAL_PURGE_UNVERIFIED';});unresolved++;}
 }
 return {purged,retained,unresolved,externalBackupErasureVerified:false};
}

export async function processIntakeJob(tenantId:string,intakeId:string){
 const s=await readWorkspace(tenantId),job=s.receipts[prefix+intakeId]?.result.intake as Intake|undefined;if(!job)throw new V2Error('INTAKE_NOT_FOUND','Retained intake is unavailable.',404);
 if(job.status==='purged')return {complete:true,nextCheckMs:0};
 if(job.reference&&s.sources.some(src=>src.status!=='deleted'&&src.originalObjectRef===job.reference)){await purgeExpiredIntakes(tenantId,intakeId);return {complete:true,nextCheckMs:0};}
 const wait=Date.parse(job.expiresAt)-Date.now();if(wait>0)return {complete:false,nextCheckMs:Math.max(60000,Math.min(86400000,wait))};
 const result=await purgeExpiredIntakes(tenantId,intakeId);const after=(await readWorkspace(tenantId)).receipts[prefix+intakeId].result.intake as Intake;return {complete:after.status==='purged'||after.status==='attached',nextCheckMs:result.unresolved?21600000:3600000};
}

/** Operator recovery records a verified exact manifest after an interrupted object write; it never imports or publishes content. */
export async function reconcileIntakeOriginal(tenantId:string,intakeId:string,reference:OriginalReference){
 const key=prefix+intakeId,before=await readWorkspace(tenantId),prior=before.receipts[key]?.result.intake as Intake|undefined;
 if(!prior)throw new V2Error('INTAKE_NOT_FOUND','Inspect a retained intake identity before recovery.',404);
 if(['purging','purged'].includes(prior.status))throw new V2Error('INTAKE_EXPIRED','An intake already fenced for purge cannot accept another reference.');
 if(reference.sha256!==prior.contentHash||reference.bytes!==prior.bytes)throw new V2Error('ORIGINAL_INTEGRITY','This manifest does not identify the exact admitted bytes.');
 const encoded=JSON.stringify(reference);if(prior.reference&&prior.reference!==encoded)throw new V2Error('ORIGINAL_REFERENCE_CONFLICT','Recovery cannot replace a retained original identity.');
 const bytes=await readOriginal(tenantId,reference);if(sha(bytes)!==prior.contentHash||bytes.byteLength!==prior.bytes)throw new V2Error('ORIGINAL_INTEGRITY','The original did not match the admitted intake.');
 return (await transactWorkspace(tenantId,s=>{const current=s.receipts[key]?.result.intake as Intake|undefined;if(!current||digest(current)!==digest(prior))throw new V2Error('VERSION_CONFLICT','The intake changed during exact-original verification. Inspect it again.');current.reference=encoded;current.status='retained';current.failureCode=null;return {intakeId,status:current.status,expiresAt:current.expiresAt,verified:true};})).result;
}
