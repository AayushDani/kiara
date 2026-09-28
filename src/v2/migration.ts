import type {State} from '../server/contracts';
import {V2Error} from './contracts';
import {digest,readWorkspace,transactWorkspace,timestamp} from './store';
import {retainOriginal,readOriginal,type OriginalReference} from './objects';

export interface MigrationPlan {version:2;sourceTenantId:string;destinationTenantId:string;sourceHash:string;expectedVersion:number;legacyEpoch:number;counts:{documents:number;workflows:number;events:number;receipts:number;notifications:number};unresolvedProviderOutcomes:number;inFlightWork:number;effectOwner:'legacy';dryRun:boolean}
function decode(bytes:Uint8Array):State{let parsed;try{parsed=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw new V2Error('MIGRATION_INPUT','Supply an intact legacy JSON snapshot.');}const state=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&'state' in parsed?parsed.state:parsed;if(!state||typeof state!=='object'||Array.isArray(state)||state.schema_version!==1||typeof state.tenant_id!=='string'||!state.tenant_id||!Array.isArray(state.revisions)||!Array.isArray(state.workflows)||!Array.isArray(state.events)||!Array.isArray(state.notifications)||!state.receipts||typeof state.receipts!=='object'||Array.isArray(state.receipts))throw new V2Error('MIGRATION_SCHEMA','The source does not match the supported legacy schema.');return state;}
function assertLegacyTenant(legacy:State,expectedLegacyTenantId:string){
 if(typeof expectedLegacyTenantId!=='string'||!expectedLegacyTenantId||legacy.tenant_id!==expectedLegacyTenantId)throw new V2Error('MIGRATION_TENANT_MISMATCH','The legacy snapshot tenant differs from the reviewed source tenant.');
 if(legacy.workflows.some(row=>!row||row.tenant_id!==legacy.tenant_id)||legacy.events.some(row=>!row||row.tenant_id!==legacy.tenant_id))throw new V2Error('MIGRATION_MIXED_TENANTS','Legacy workflow and event rows must belong to the reviewed source tenant.');
}
/** Additive archive import: old work keeps its old effect owner, so both engines cannot dispatch it. */
export async function importLegacySnapshot(tenantId:string,bytes:Uint8Array,expectedVersion:number,expectedLegacyTenantId:string,dryRun=true):Promise<MigrationPlan>{
 const legacy=decode(bytes);assertLegacyTenant(legacy,expectedLegacyTenantId);const sourceHash=digest(Array.from(bytes)),current=await readWorkspace(tenantId);
 if(current.version!==expectedVersion)throw new V2Error('VERSION_CONFLICT','The destination changed. Re-run the migration dry run.');
 const plan:MigrationPlan={version:2,sourceTenantId:legacy.tenant_id,destinationTenantId:tenantId,sourceHash,expectedVersion,legacyEpoch:legacy.reset_epoch,counts:{documents:legacy.revisions.length,workflows:legacy.workflows.length,events:legacy.events.length,receipts:Object.keys(legacy.receipts).length,notifications:legacy.notifications.length},unresolvedProviderOutcomes:legacy.workflows.filter(w=>w.unknown_charge||w.reserved_cost>0).length+legacy.notifications.filter(n=>['sending','unknown_delivery'].includes(n.status)).length,inFlightWork:legacy.workflows.filter(w=>!['finalized','closed_no_change','rejected','superseded','failed'].includes(w.state)).length,effectOwner:'legacy',dryRun};
 if(current.migration&&current.migration.sourceHash!==sourceHash)throw new V2Error('MIGRATION_CONFLICT','This workspace has a different retained legacy archive. It cannot be overwritten.');
 if(dryRun||current.migration)return plan;
 const original=await retainOriginal(tenantId,bytes);const verified=await readOriginal(tenantId,original);if(!Buffer.from(bytes).equals(verified))throw new V2Error('MIGRATION_BACKUP_FAILED','Source bytes did not survive the backup verification.');
 await transactWorkspace(tenantId,state=>{
  if(state.version!==expectedVersion)throw new V2Error('VERSION_CONFLICT','The destination changed after backup. Repeat the dry run; the encrypted backup remains retained.');
  state.migration={sourceHash,legacyArchive:{original,legacyTenant:legacy.tenant_id,legacyEpoch:legacy.reset_epoch,counts:plan.counts,unresolvedProviderOutcomes:plan.unresolvedProviderOutcomes,inFlightWork:plan.inFlightWork},importedAt:timestamp(),effectOwner:'legacy',status:'imported_read_only'};
 });return plan;
}
export async function exportLegacyArchive(tenantId:string){const state=await readWorkspace(tenantId);if(!state.migration)throw new V2Error('MIGRATION_REQUIRED','No retained migration archive exists.',404);const archive=state.migration.legacyArchive as {original:OriginalReference};return readOriginal(tenantId,archive.original);}
