import {createHash} from 'node:crypto';
import type {State} from '../server/contracts';
import {V2Error} from './contracts';
import {digest,operatorDestinationIdentity,readWorkspace,transactWorkspace,timestamp} from './store';
import {retainOriginal,readOriginal,readPhysicalOriginal,type OriginalReference} from './objects';

export interface MigrationPlan {version:2;sourceTenantId:string;destinationTenantId:string;sourceHash:string;expectedVersion:number;destinationStateHash:string;destination:ReturnType<typeof operatorDestinationIdentity>;planHash:string;legacyEpoch:number;counts:{documents:number;workflows:number;events:number;receipts:number;notifications:number};unresolvedProviderOutcomes:number;inFlightWork:number;effectOwner:'legacy';dryRun:boolean}
interface ArchiveIntake {sourceHash:string;contentHash:string;bytes:number;legacyTenantId:string;destinationFingerprint:string;createdAt:string;attemptedAt:string|null;reference:string|null;status:'staging'|'retained'|'attached'}
const archivePrefix='migration-archive:';
const archiveKey=(sourceHash:string)=>archivePrefix+sourceHash;
function archiveIntake(result:Record<string,unknown>){return result.archive as ArchiveIntake|undefined;}
function checkedArchive(intake:ArchiveIntake|undefined,sourceHash:string,contentHash:string,bytes:number,legacyTenantId:string,destinationFingerprint:string){
 if(!intake||intake.sourceHash!==sourceHash||intake.contentHash!==contentHash||intake.bytes!==bytes||intake.legacyTenantId!==legacyTenantId||intake.destinationFingerprint!==destinationFingerprint)throw new V2Error('MIGRATION_ARCHIVE_CONFLICT','The retained archive intake belongs to different bytes, tenant or destination.',409);
 return intake;
}
/** Operator inventory: exact archived bytes and storage references remain private. */
export async function migrationArchiveStatus(tenantId:string){const s=await readWorkspace(tenantId);return {version:s.version,archives:Object.entries(s.receipts).filter(([key])=>key.startsWith(archivePrefix)).map(([,receipt])=>{const i=archiveIntake(receipt.result);return {sourceHash:i?.sourceHash||null,contentHash:i?.contentHash||null,bytes:i?.bytes||null,destinationFingerprint:i?.destinationFingerprint||null,status:i?.status||'invalid',hasReference:!!i?.reference,attemptedAt:i?.attemptedAt||null,createdAt:i?.createdAt||null};})};}
/** An S3 upload may have succeeded without returning a version. Only an exact readback can repair its durable manifest. */
export async function reconcileMigrationArchiveOriginal(tenantId:string,sourceHash:string,reference:OriginalReference,options:{afterReadback?:()=>Promise<void>}={}){
 if(!/^[a-f0-9]{64}$/.test(sourceHash))throw new V2Error('MIGRATION_ARCHIVE_NOT_FOUND','Inspect the exact staged archive hash.',404);
 const key=archiveKey(sourceHash),before=await readWorkspace(tenantId),intake=archiveIntake(before.receipts[key]?.result||{});
 if(!intake||intake.status==='attached')throw new V2Error('MIGRATION_ARCHIVE_NOT_FOUND','Inspect a pending archive intake.',404);
 if(operatorDestinationIdentity().fingerprint!==intake.destinationFingerprint)throw new V2Error('MIGRATION_ARCHIVE_TARGET_CHANGED','Select the exact original workspace and object-store destination.',409);
 const expectedStorage=process.env.KIARA_ORIGINALS_MODE||(process.env.MONGODB_URI?'mongo_encrypted':'local_encrypted');
 if(reference.storage!==expectedStorage)throw new V2Error('MIGRATION_ARCHIVE_TARGET_CHANGED','The manifest belongs to a different original-storage mode.',409);
 if(reference.sha256!==intake.contentHash||reference.bytes!==intake.bytes)throw new V2Error('MIGRATION_ARCHIVE_INTEGRITY','The manifest does not identify the admitted archive bytes.',409);
 const bytes=await readPhysicalOriginal(tenantId,reference);if(createHash('sha256').update(bytes).digest('hex')!==intake.contentHash||bytes.byteLength!==intake.bytes||digest(Array.from(bytes))!==sourceHash)throw new V2Error('MIGRATION_ARCHIVE_INTEGRITY','The retained archive failed exact readback.',409);
 await options.afterReadback?.();
 const encoded=JSON.stringify(reference);
 return (await transactWorkspace(tenantId,s=>{if(s.version!==before.version)throw new V2Error('MIGRATION_PLAN_CHANGED','The archive or destination changed during readback; inspect and retry.',409);const current=checkedArchive(archiveIntake(s.receipts[key]?.result||{}),sourceHash,intake.contentHash,intake.bytes,intake.legacyTenantId,intake.destinationFingerprint);if(!['staging','retained'].includes(current.status)||s.migration)throw new V2Error('MIGRATION_ARCHIVE_CONFLICT','An attached archive cannot be reconciled as pending.',409);if(current.reference&&current.reference!==encoded)throw new V2Error('MIGRATION_ARCHIVE_CONFLICT','Recovery cannot replace an existing archive version.',409);current.reference=encoded;current.status='retained';return {sourceHash,status:current.status,verified:true};})).result;
}
function decode(bytes:Uint8Array):State{let parsed;try{parsed=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw new V2Error('MIGRATION_INPUT','Supply an intact legacy JSON snapshot.');}const state=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&'state' in parsed?parsed.state:parsed;if(!state||typeof state!=='object'||Array.isArray(state)||state.schema_version!==1||typeof state.tenant_id!=='string'||!state.tenant_id||!Array.isArray(state.revisions)||!Array.isArray(state.workflows)||!Array.isArray(state.events)||!Array.isArray(state.notifications)||!state.receipts||typeof state.receipts!=='object'||Array.isArray(state.receipts))throw new V2Error('MIGRATION_SCHEMA','The source does not match the supported legacy schema.');return state;}
function assertLegacyTenant(legacy:State,expectedLegacyTenantId:string){
 if(typeof expectedLegacyTenantId!=='string'||!expectedLegacyTenantId||legacy.tenant_id!==expectedLegacyTenantId)throw new V2Error('MIGRATION_TENANT_MISMATCH','The legacy snapshot tenant differs from the reviewed source tenant.');
 if(legacy.workflows.some(row=>!row||row.tenant_id!==legacy.tenant_id)||legacy.events.some(row=>!row||row.tenant_id!==legacy.tenant_id))throw new V2Error('MIGRATION_MIXED_TENANTS','Legacy workflow and event rows must belong to the reviewed source tenant.');
}
/** Additive archive import: old work keeps its old effect owner, so both engines cannot dispatch it. */
export async function importLegacySnapshot(tenantId:string,bytes:Uint8Array,expectedVersion:number,expectedLegacyTenantId:string,expectedSourceHash:string|null,dryRun=true,expectedPlanHash:string|null=null,options:{retain?:typeof retainOriginal;afterRetain?:(reference:OriginalReference)=>Promise<void>}={}):Promise<MigrationPlan>{
 const legacy=decode(bytes);assertLegacyTenant(legacy,expectedLegacyTenantId);const sourceHash=digest(Array.from(bytes)),current=await readWorkspace(tenantId);
 if(!dryRun&&(!expectedSourceHash||!/^[a-f0-9]{64}$/.test(expectedSourceHash)||expectedSourceHash!==sourceHash))throw new V2Error('MIGRATION_SOURCE_CHANGED','The legacy snapshot differs from the reviewed dry run. Repeat the check before retaining an archive.');
 if(current.version!==expectedVersion)throw new V2Error('VERSION_CONFLICT','The destination changed. Re-run the migration dry run.');
 const destination=operatorDestinationIdentity(),destinationStateHash=digest(current),reviewed={operation:'migrate',sourceTenantId:legacy.tenant_id,destinationTenantId:tenantId,sourceHash,expectedVersion,destinationStateHash,destination};
 const plan:MigrationPlan={version:2,sourceTenantId:legacy.tenant_id,destinationTenantId:tenantId,sourceHash,expectedVersion,destinationStateHash,destination,planHash:digest(reviewed),legacyEpoch:legacy.reset_epoch,counts:{documents:legacy.revisions.length,workflows:legacy.workflows.length,events:legacy.events.length,receipts:Object.keys(legacy.receipts).length,notifications:legacy.notifications.length},unresolvedProviderOutcomes:legacy.workflows.filter(w=>w.unknown_charge||w.reserved_cost>0).length+legacy.notifications.filter(n=>['sending','unknown_delivery'].includes(n.status)).length,inFlightWork:legacy.workflows.filter(w=>!['finalized','closed_no_change','rejected','superseded','failed'].includes(w.state)).length,effectOwner:'legacy',dryRun};
 if(current.migration&&current.migration.sourceHash!==sourceHash)throw new V2Error('MIGRATION_CONFLICT','This workspace has a different retained legacy archive. It cannot be overwritten.');
 if(!dryRun&&(!expectedPlanHash||expectedPlanHash!==plan.planHash))throw new V2Error('MIGRATION_PLAN_CHANGED','The source or destination differs from the reviewed migration check. Repeat the check before applying.',409);
 if(dryRun||current.migration)return plan;
 const contentHash=createHash('sha256').update(bytes).digest('hex'),key=archiveKey(sourceHash),fingerprint=destination.fingerprint;
 const claimed=await transactWorkspace(tenantId,state=>{
  if(state.version!==expectedVersion||digest(state)!==destinationStateHash)throw new V2Error('MIGRATION_PLAN_CHANGED','The destination changed before archive intake.',409);
  if(Object.entries(state.receipts).some(([otherKey,receipt])=>otherKey.startsWith(archivePrefix)&&otherKey!==key&&archiveIntake(receipt.result)?.status!=='attached'))throw new V2Error('MIGRATION_ARCHIVE_PENDING','Resolve the earlier retained archive intake before importing different bytes.',409);
  const prior=state.receipts[key];if(prior){const intake=checkedArchive(archiveIntake(prior.result),sourceHash,contentHash,bytes.byteLength,legacy.tenant_id,fingerprint);if(intake.status==='attached')throw new V2Error('MIGRATION_ARCHIVE_CONFLICT','An attached archive cannot be reused without its migration record.',409);}
  else state.receipts[key]={hash:sourceHash,result:{archive:{sourceHash,contentHash,bytes:bytes.byteLength,legacyTenantId:legacy.tenant_id,destinationFingerprint:fingerprint,createdAt:timestamp(),attemptedAt:null,reference:null,status:'staging'} satisfies ArchiveIntake}};
 });
 const attempt=await transactWorkspace(tenantId,state=>{
  if(state.version!==claimed.state.version)throw new V2Error('MIGRATION_PLAN_CHANGED','The destination changed before original storage; review a new plan.',409);
  const intake=checkedArchive(archiveIntake(state.receipts[key]?.result||{}),sourceHash,contentHash,bytes.byteLength,legacy.tenant_id,fingerprint);
  if(!intake.reference&&intake.attemptedAt&&process.env.KIARA_ORIGINALS_MODE==='s3_kms')throw new V2Error('MIGRATION_ARCHIVE_REFERENCE_REQUIRED','An S3 archive write may have succeeded; reconcile its exact object version before retrying.',409);
  if(!intake.attemptedAt)intake.attemptedAt=timestamp();
  return intake.reference;
 });
 const original=attempt.result?JSON.parse(attempt.result) as OriginalReference:await(options.retain||retainOriginal)(tenantId,bytes);
 if(!attempt.result)await options.afterRetain?.(original);
 const verified=await readPhysicalOriginal(tenantId,original);if(!Buffer.from(bytes).equals(verified))throw new V2Error('MIGRATION_BACKUP_FAILED','Source bytes did not survive the backup verification.');
 const encoded=JSON.stringify(original),saved=await transactWorkspace(tenantId,state=>{
  const unchanged=state.version===attempt.state.version,intake=checkedArchive(archiveIntake(state.receipts[key]?.result||{}),sourceHash,contentHash,bytes.byteLength,legacy.tenant_id,fingerprint);
  if(intake.status==='attached'||state.migration)throw new V2Error('MIGRATION_ARCHIVE_CONFLICT','An attached archive cannot be restaged.',409);
  if(intake.reference&&intake.reference!==encoded)throw new V2Error('MIGRATION_ARCHIVE_CONFLICT','The staged archive version changed during readback.',409);
  intake.reference=encoded;intake.status='retained';return unchanged;
 });
 if(!saved.result)throw new V2Error('MIGRATION_PLAN_CHANGED','The destination changed after backup; the verified original is inventoried for a fresh plan.',409);
 await transactWorkspace(tenantId,state=>{
  if(state.version!==saved.state.version||digest(state)!==digest(saved.state)||operatorDestinationIdentity().fingerprint!==fingerprint)throw new V2Error('MIGRATION_PLAN_CHANGED','The destination changed after backup. Repeat the dry run; the encrypted backup remains inventoried.',409);
  const intake=checkedArchive(archiveIntake(state.receipts[key]?.result||{}),sourceHash,contentHash,bytes.byteLength,legacy.tenant_id,fingerprint);if(intake.reference!==encoded||intake.status!=='retained')throw new V2Error('MIGRATION_ARCHIVE_CONFLICT','The verified archive intake changed before attachment.',409);
  state.migration={sourceHash,legacyArchive:{original,legacyTenant:legacy.tenant_id,legacyEpoch:legacy.reset_epoch,counts:plan.counts,unresolvedProviderOutcomes:plan.unresolvedProviderOutcomes,inFlightWork:plan.inFlightWork},importedAt:timestamp(),effectOwner:'legacy',status:'imported_read_only'};
  intake.status='attached';
 });return plan;
}
export async function exportLegacyArchive(tenantId:string){const state=await readWorkspace(tenantId);if(!state.migration)throw new V2Error('MIGRATION_REQUIRED','No retained migration archive exists.',404);const archive=state.migration.legacyArchive as {original:OriginalReference};return readOriginal(tenantId,archive.original);}
