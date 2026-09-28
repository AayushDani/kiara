import {readFile,writeFile} from 'node:fs/promises';
import {backupWorkspace,restoreWorkspace,readWorkspace,transactWorkspace,closeV2Store,digest} from '../src/v2/store';
import {importLegacySnapshot,exportLegacyArchive,migrationArchiveStatus,reconcileMigrationArchiveOriginal} from '../src/v2/migration';
import {purgeExpiredIntakes,reconcileIntakeOriginal} from '../src/v2/artifact-intake';
import {processDeletionJob} from '../src/v2/retention-worker';
import {migrateAggregateToNormalized,rollbackNormalizedToAggregate} from '../src/v2/normalized-store';
import {hybridConfig,hybridIndexDefinitions,syncHybridIndex,reconcileHybridIndex,closeHybridIndex} from '../src/v2/hybrid';
import type {Role} from '../src/v2/contracts';
import type {EffectIntent} from '../src/v2/execution/contracts';
import {reconcileEffect} from '../src/v2/execution/broker';
import {command,snapshot} from '../src/v2/service';
import {inspectWithdrawalEffects,pendingSourceWithdrawalSummary,resumeSourceWithdrawal} from '../src/v2/source-corrective';
import {requireRole} from '../src/v2/authority';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';
import {checkInstallationAccess,reconcileInstallationAccess,retryInstallationAccessOwner} from '../src/v2/integrations/access-reconcile';

const [operation,tenantId,...args]=process.argv.slice(2);
const roles:Role[]=['member','admin','business_owner','fact_owner','legal_reviewer','publisher','signatory','evaluator','integration'];
async function main(){
 if(!tenantId)throw new Error('Usage: v2-operator <inspect|provision|backup|restore-check|restore|migrate-check|migrate|migrate-archive-status|migrate-archive-reconcile|legacy-export|normalize-check|normalize|normalize-rollback-check|index-definitions|index-sync|index-reconcile|retention-status|retention-run|intake-status|intake-sweep|intake-reconcile|effect-status|effect-reconcile|withdrawal-status|withdrawal-retry|withdrawal-assign|withdrawal-inspect|withdrawal-review|source-withdrawal-pending|source-withdrawal-run|installation-access-check|installation-access-reconcile|installation-access-retry-owner> <tenant> [arguments]');
 if(operation==='inspect'){const s=await readWorkspace(tenantId);return {tenantId,version:s.version,stateHash:digest(s),configuredStorage:process.env.KIARA_V2_STORE_MODE==='normalized'?'normalized':process.env.MONGODB_URI?'mongo_aggregate':'local',memberships:s.memberships.map(m=>({actorId:m.actorId,roles:m.roles,revokedAt:m.revokedAt})),migration:s.migration?.status||null};}
 if(['withdrawal-status','withdrawal-retry','withdrawal-assign','withdrawal-inspect','withdrawal-review'].includes(operation||'')){
  const actorId=args[0],actor:ActorContext={tenantId,actorId,expiresAt:Date.now()+3600000,mode:'authenticated'};
  if(!actorId)throw new Error('Supply a currently provisioned administrator actor ID');
  const state=await readWorkspace(tenantId),admin=requireRole(state,actor,'admin');
  if(admin.matterIds!==null||admin.entityIds!==null&&!admin.entityIds.includes(state.entityId))throw new Error('Withdrawal exception recovery requires an unrestricted current entity administrator');
  if(operation==='withdrawal-status'){const view=await snapshot(actor);return {version:view.version,exceptions:view.withdrawalExceptions};}
  if(operation==='withdrawal-inspect'){
   const [reviewRef,recordVersion,workspaceVersion,inspectionPath]=args.slice(1);
   if(args.length!==5||!/^EW-[A-F0-9]{12}$/.test(reviewRef||'')||!/^\d+$/.test(recordVersion||'')||!/^\d+$/.test(workspaceVersion||'')||!inspectionPath)throw new Error('Inspection requires administrator actor ID, opaque reference, corrective matter version, workspace version and a new protected output file');
   const inspected=await transactWorkspace(tenantId,s=>{if(s.version!==Number(workspaceVersion))throw new Error('Workspace version changed; refresh withdrawal-status');return inspectWithdrawalEffects(s,actor,reviewRef,Number(recordVersion));});
   await writeFile(inspectionPath,JSON.stringify(inspected.result,null,2),{flag:'wx',mode:0o600});
   return {inspectionFile:inspectionPath,verifiedEffects:inspected.result.effects.length,version:inspected.state.version,expiresInMinutes:15};
  }
  if(operation==='withdrawal-review'){
   const [inspectionPath,workspaceVersion,notePath]=args.slice(1);
   if(args.length!==4||!inspectionPath||!/^\d+$/.test(workspaceVersion||'')||!notePath)throw new Error('Review requires administrator actor ID, inspected evidence file, current workspace version and a review-note file');
   const inspected=JSON.parse(await readFile(inspectionPath,'utf8')) as {reviewRef:string;effectReviewHash:string;inspectionId:string;inspectionEvidenceHash:string;correctiveMatterVersion:number;effects:unknown[]};
   const {reviewRef,effectReviewHash,inspectionId,inspectionEvidenceHash,correctiveMatterVersion}=inspected;
   if(!/^EW-[A-F0-9]{12}$/.test(reviewRef||'')||!/^[a-f0-9]{64}$/.test(effectReviewHash||'')||!/^[a-f0-9]{64}$/.test(inspectionEvidenceHash||'')||!/^[a-f0-9-]{36}$/.test(inspectionId||'')||!Number.isSafeInteger(correctiveMatterVersion)||!Array.isArray(inspected.effects)||!inspected.effects.length||digest(inspected.effects)!==inspectionEvidenceHash)throw new Error('The inspected evidence file is invalid; run withdrawal-inspect again');
   const note=await readFile(notePath,'utf8');
   const saved=await command(actor,{idempotencyKey:`operator:withdrawal-review:${inspectionId}`,expectedVersion:Number(workspaceVersion),command:{type:'source.correction.effect_review',reviewRef,effectReviewHash,inspectionId,inspectionEvidenceHash,expectedRecordVersion:correctiveMatterVersion,note}});
   return {result:saved.result,replayed:saved.replayed,version:saved.snapshot.version};
  }
  const reviewRef=args[1],expectedVersion=args.at(-1);
  if(!/^EW-[A-F0-9]{12}$/.test(reviewRef||'')||!/^(0|[1-9]\d*)$/.test(expectedVersion||''))throw new Error('Supply the inspected opaque review reference and workspace version');
  let work:WorkspaceCommand;
  if(operation==='withdrawal-retry'){
   if(args.length!==3)throw new Error('Retry requires administrator actor ID, review reference and workspace version');
   work={type:'source.correction.retry',reviewRef};
  }else{
   const ownerId=args[2],recordVersion=args[3];
   if(args.length!==5||!ownerId||!/^(0|[1-9]\d*)$/.test(recordVersion||''))throw new Error('Assign requires administrator actor ID, review reference, owner ID, corrective matter version and workspace version');
   work={type:'source.correction.assign',reviewRef,ownerId,expectedRecordVersion:Number(recordVersion)};
  }
  const saved=await command(actor,{idempotencyKey:`operator:${operation}:${reviewRef}:${expectedVersion}`,expectedVersion:Number(expectedVersion),command:work});
  return {result:saved.result,replayed:saved.replayed,version:saved.snapshot.version};
 }
 if(operation==='provision'){
  const [actorId,roleList,expected]=args,grants=(roleList||'').split(',') as Role[];
  if(!actorId||!grants.length||grants.some(r=>!roles.includes(r))||!/^\d+$/.test(expected||''))throw new Error('provision requires actor ID, comma-separated roles and inspected workspace version');
  return (await transactWorkspace(tenantId,s=>{if(s.version!==Number(expected))throw new Error('Workspace version changed');if(s.memberships.some(m=>m.actorId===actorId))throw new Error('Membership exists; use an audited change rather than overwrite');s.memberships.push({actorId,roles:grants,version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});return {actorId,roles:grants};})).result;
 }
 if(operation==='intake-sweep')return purgeExpiredIntakes(tenantId);
 if(operation==='intake-reconcile'){if(!args[0]||!args[1])throw new Error('Supply the inspected intake ID and a JSON file containing its exact original manifest');return reconcileIntakeOriginal(tenantId,args[0],JSON.parse(await readFile(args[1],'utf8')));}
 if(operation==='intake-status'){const s=await readWorkspace(tenantId);return {intakes:Object.entries(s.receipts).filter(([key])=>key.startsWith('artifact-intake:')).map(([,receipt])=>{const i=receipt.result.intake as {id:string;contentHash:string;bytes:number;status:string;createdAt:string;expiresAt:string;reference:string|null;failureCode:string|null};return {id:i.id,contentHash:i.contentHash,bytes:i.bytes,status:i.status,createdAt:i.createdAt,expiresAt:i.expiresAt,hasRetainedReference:!!i.reference,failureCode:i.failureCode};})};}
 if(operation==='effect-status'){const s=await readWorkspace(tenantId);return {effects:Object.entries(s.receipts).filter(([key])=>key.startsWith('execution:')).map(([,receipt])=>{const i=receipt.result.intent as EffectIntent;return {id:i.id,actionId:i.actionId,actionHash:i.actionHash,status:i.status,adapterId:i.adapterId,hasProviderReceipt:!!i.providerReceipt,failure:i.failure,deletionRequestedAt:i.deletionRequestedAt||null,redactedAt:i.redactedAt||null};})};}
 if(operation==='effect-reconcile'){const [actionId,intentId,candidateReceipt]=args,s=await readWorkspace(tenantId),i=s.receipts[`execution:${actionId}`]?.result.intent as EffectIntent|undefined;if(!actionId||!intentId||i?.id!==intentId)throw new Error('Supply the exact action and durable intent IDs from effect-status');return reconcileEffect(tenantId,actionId,{candidateReceipt});}
 if(operation==='source-withdrawal-pending'){if(args.length)throw new Error('Pending withdrawal status takes only a tenant ID.');return {sources:pendingSourceWithdrawalSummary(await readWorkspace(tenantId))};}
 if(operation==='source-withdrawal-run'){if(args.length!==1)throw new Error('Run requires one inspected pending source ID.');return resumeSourceWithdrawal(tenantId,args[0]);}
 if(operation==='installation-access-check'){
  if(args.length>1||args.length===1&&args[0]!=='--allow-empty')throw new Error('Installation access check accepts only optional --allow-empty for an explicitly reviewed empty configuration.');
  return checkInstallationAccess(tenantId,args[0]==='--allow-empty');
 }
 if(operation==='installation-access-reconcile'){
  if(args.length<1||args.length>2||!/^[a-f0-9]{64}$/.test(args[0])||args.length===2&&args[1]!=='--allow-empty')throw new Error('Supply the reviewed plan hash and optional --allow-empty exactly as used in the check.');
  return reconcileInstallationAccess(tenantId,args[0],args[1]==='--allow-empty');
 }
 if(operation==='installation-access-retry-owner'){
  if(args.length!==2||!args[0]||!/^[1-9]\d*$/.test(args[1])||!Number.isSafeInteger(Number(args[1])))throw new Error('Supply the exact reconciled source ID and inspected source version.');
  return retryInstallationAccessOwner(tenantId,args[0],Number(args[1]));
 }
 if(operation==='retention-status'){const s=await readWorkspace(tenantId);return {deletions:(s.deletionJobs||[]).map(j=>({id:j.id,sourceId:j.sourceId,originals:j.originals.map(o=>({status:o.status,notBefore:o.notBefore,failureCode:o.failureCode})),indexCleanup:j.indexCleanup,historicalCleanup:j.historicalCleanup,operationalExceptions:j.operationalExceptionActionIds.length,backupStatus:j.backupStatus}))};}
 if(operation==='retention-run'){if(!args[0])throw new Error('Supply an inspected deletion job ID');return processDeletionJob(tenantId,args[0]);}
 if(operation==='normalize-check'||operation==='normalize'){
  if(args.length!==(operation==='normalize-check'?1:2)||!/^[a-f0-9]{64}$/.test(args[0]||'')||operation==='normalize'&&!/^[a-f0-9]{64}$/.test(args[1]||''))throw new Error('Normalization requires the inspected aggregate state hash and, for apply, the reviewed plan hash.');
  return migrateAggregateToNormalized(tenantId,args[0],operation==='normalize-check',operation==='normalize'?args[1]:null);
 }
 if(operation==='normalize-rollback-check'||operation==='normalize-rollback'){
  if(args.length!==(operation==='normalize-rollback-check'?1:2)||!/^[a-f0-9]{64}$/.test(args[0]||'')||operation==='normalize-rollback'&&!/^[a-f0-9]{64}$/.test(args[1]||''))throw new Error('Normalization rollback requires the inspected normalized state hash and, for apply, the reviewed plan hash.');
  return rollbackNormalizedToAggregate(tenantId,args[0],operation==='normalize-rollback-check',operation==='normalize-rollback'?args[1]:null);
 }
 if(operation==='index-definitions')return hybridIndexDefinitions(hybridConfig());
 if(operation==='index-sync'||operation==='index-reconcile'){const actor={tenantId,actorId:args[0],expiresAt:Date.now()+3600000,mode:'authenticated' as const};if(!actor.actorId)throw new Error('Supply a currently provisioned admin actor ID');return operation==='index-sync'?syncHybridIndex(actor,args.slice(1)):reconcileHybridIndex(actor);}
 if(operation==='backup'){if(!args[0])throw new Error('Supply a new backup path');await writeFile(args[0],JSON.stringify(await backupWorkspace(tenantId)),{flag:'wx',mode:0o600});return {backup:args[0],containsSensitiveData:true};}
 if(operation==='restore-check'||operation==='restore'){
  const [backupPath,version,reviewedPlanHash]=args;
  if(args.length!==(operation==='restore-check'?2:3)||!backupPath||!/^(0|[1-9]\d*)$/.test(version||'')||!Number.isSafeInteger(Number(version))||operation==='restore'&&!/^[a-f0-9]{64}$/.test(reviewedPlanHash||''))throw new Error('Restore requires backup path, inspected destination version, and the reviewed plan hash for apply.');
  const backup=JSON.parse(await readFile(backupPath,'utf8'));if(backup.state?.tenantId!==tenantId)throw new Error('Tenant does not match backup');return restoreWorkspace(backup,Number(version),operation==='restore-check',operation==='restore'?reviewedPlanHash:null);
 }
 if(operation==='migrate-check'||operation==='migrate'){
  const [snapshotPath,version,expectedLegacyTenantId,reviewedSourceHash,reviewedPlanHash]=args;
  if(args.length!==(operation==='migrate-check'?3:5)||!snapshotPath||!/^(0|[1-9]\d*)$/.test(version||'')||!Number.isSafeInteger(Number(version))||!expectedLegacyTenantId||expectedLegacyTenantId.length>200||operation==='migrate'&&(!/^[a-f0-9]{64}$/.test(reviewedSourceHash||'')||!/^[a-f0-9]{64}$/.test(reviewedPlanHash||'')))throw new Error('Migration requires snapshot path, inspected destination version, exact expected legacy tenant ID, and the reviewed source and plan hashes for apply.');
  return importLegacySnapshot(tenantId,await readFile(snapshotPath),Number(version),expectedLegacyTenantId,operation==='migrate'?reviewedSourceHash:null,operation==='migrate-check',operation==='migrate'?reviewedPlanHash:null);
 }
 if(operation==='migrate-archive-status'){if(args.length)throw new Error('Archive status accepts only the exact tenant');return migrationArchiveStatus(tenantId);}
 if(operation==='migrate-archive-reconcile'){if(args.length!==2||!/^[a-f0-9]{64}$/.test(args[0]||''))throw new Error('Archive reconciliation requires the exact staged source hash and a protected original-manifest JSON file');return reconcileMigrationArchiveOriginal(tenantId,args[0],JSON.parse(await readFile(args[1],'utf8')));}
 if(operation==='legacy-export'){await writeFile(args[0],await exportLegacyArchive(tenantId),{flag:'wx',mode:0o600});return {path:args[0],effectOwner:'legacy'};}
 throw new Error('Unknown operation');
}
main().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error instanceof Error?error.message:'Operator command failed');process.exitCode=1;}).finally(async()=>{await closeV2Store();await closeHybridIndex();});
