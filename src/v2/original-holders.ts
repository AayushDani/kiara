import {createHash} from 'node:crypto';
import type {WorkspaceState} from './contracts';
import type {OriginalReference} from './objects';

const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const legacyHash=(reference:OriginalReference)=>sha(JSON.stringify({key:reference.key,sha256:reference.sha256,bytes:reference.bytes,encryption:reference.encryption,storage:reference.storage,keyId:reference.keyId,...(reference.versionId?{versionId:reference.versionId}:{})}));
/** Conservative holders for a tenant/content-addressed Mongo original. Reconciliation
 * can release only deletion jobs with expired delays, committed source fences and no hold. */
export function liveMongoOriginalHolders(s:WorkspaceState,mongo:OriginalReference,deletingLegacy?:OriginalReference,options:{forReconciliation?:boolean}={}):string[]{
 const held:string[]=[];const check=(value:unknown,location:string,depth=0)=>{if(!value)return;if(depth>8){held.push(`${location}:unclassified`);return;}try{const parsed=typeof value==='string'?JSON.parse(value):value;if(!parsed||typeof parsed!=='object')return;const ref=parsed as OriginalReference;if(ref.sha256===mongo.sha256&&ref.bytes===mongo.bytes&&['local_encrypted','s3_kms','mongo_encrypted'].includes(ref.storage))held.push(location);const readback=(parsed as {readback?:unknown}).readback;if(readback)check(readback,location,depth+1);}catch{/* Non-reference provider receipts do not hold an original. */}};
 for(const source of s.sources.filter(x=>x.status!=='deleted'))check(source.originalObjectRef,`source:${source.id}`);
 for(const action of s.actions.filter(x=>['dispatching','uncertain','verifying'].includes(x.status))){if(sha(Buffer.from(action.content))===mongo.sha256)held.push(`action:${action.id}:content`);check(action.completion?.artifact,`action:${action.id}:completion`);}
 if(s.migration)check((s.migration.legacyArchive as {original?:unknown})?.original,'migration:legacyArchive');
 for(const job of s.deletionJobs||[])for(const original of job.originals.filter(x=>x.status!=='purged')){try{
  const ref=JSON.parse(original.reference) as OriginalReference;if(deletingLegacy&&legacyHash(ref)===legacyHash(deletingLegacy))continue;
  if(options.forReconciliation&&ref.sha256===mongo.sha256&&ref.bytes===mongo.bytes){
   const sourceFenced=[job.sourceId,...job.sourceIds].every(id=>s.tombstones.some(t=>t.sourceId===id)||s.sources.find(x=>x.id===id)?.status==='deleted');
   const due=Number.isFinite(Date.parse(original.notBefore))&&Date.parse(original.notBefore)<=Date.now();
   const releasable=process.env.KIARA_RETENTION_HOLD!=='true'&&!job.operationalExceptionActionIds.length&&sourceFenced&&due&&['pending','shared_reference','failed'].includes(original.status)&&(!original.failureCode||original.failureCode==='ORIGINAL_ALIAS_TARGET_HELD');
   if(releasable)continue;
  }
  check(ref,`deletion:${job.id}`);
 }catch{held.push(`deletion:${job.id}:unclassified`);}}
 for(const [key,receipt] of Object.entries(s.receipts)){
  if(key.startsWith('migration-archive:')){const archive=receipt.result.archive as {status?:string;contentHash?:string;reference?:string|null}|undefined;if(archive&&archive.status!=='purged'&&archive.contentHash===mongo.sha256){if(!archive.reference)held.push(`migration:${key}:unresolved`);else check(archive.reference,`migration:${key}`);}}
  const intake=receipt.result.intake as {status?:string;reference?:string;contentHash?:string}|undefined;if(intake?.status==='staging'&&intake.contentHash===mongo.sha256)held.push(`intake:${key}:staging`);if(intake&&['staging','retained'].includes(intake.status||''))check(intake.reference,`intake:${key}`);
  const intent=receipt.result.intent as {status?:string;redactedAt?:string;retentionOriginalReferences?:string[];providerReceipt?:string;completionArtifact?:string;actionSnapshot?:{content?:string;completion?:{artifact?:string}}}|undefined;
  if(intent&&!(intent.redactedAt&&['verified','failed'].includes(intent.status||''))){for(const ref of intent.retentionOriginalReferences||[])check(ref,`effect:${key}`);check(intent.providerReceipt,`effect:${key}`);check(intent.completionArtifact,`effect:${key}`);check(intent.actionSnapshot?.completion?.artifact,`effect:${key}`);if(['prepared','dispatched','verifying','uncertain'].includes(intent.status||'')&&intent.actionSnapshot?.content&&sha(intent.actionSnapshot.content)===mongo.sha256)held.push(`effect:${key}:content`);}
 }
 return [...new Set(held)];
}
