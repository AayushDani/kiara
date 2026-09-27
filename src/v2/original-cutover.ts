import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {V2Error,type WorkspaceState} from './contracts';
import {digest,readWorkspace} from './store';
import {readPhysicalOriginal,purgeSyntheticLegacyOriginal,syntheticOriginalCutoverEnabled,type OriginalReference} from './objects';
import {activateOriginalAliases,destinationOriginalReference,inspectMongoAliasTarget,legacyOriginalHash,mongoOriginalAliasStatus,readMongoAliasReconciliation,readMongoOriginal,readOriginalCutoverManifest,reconcileMongoAliasTarget,resolveMongoOriginalAlias,retainMongoOriginal,markLegacyOriginalPurged,type OriginalAliasEntry,type OriginalCutoverManifest} from './mongo-originals';
import {liveMongoOriginalHolders} from './original-holders';
export {liveMongoOriginalHolders} from './original-holders';

const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
export interface CutoverEntry {legacy:OriginalReference;legacyHash:string;locations:string[];sourceUri:string;purgeTarget:string;bytes:number;sha256:string;destination:{database:string;collection:'v2_original_manifests';objectId:string}}
export interface OriginalCutoverPreview {tenantId:string;workspaceVersion:number;workspaceHash:string;database:string;count:number;totalBytes:number;entries:CutoverEntry[];previewHash:string;sourceVerified:true}
function scope(tenantId:string){if(!syntheticOriginalCutoverEnabled(tenantId)||!process.env.MONGODB_URI)throw new V2Error('ORIGINAL_CUTOVER_SCOPE','Name the exact synthetic tenant and isolated MongoDB database before cutover.',403);}
function sourceUri(reference:OriginalReference){if(reference.storage==='local_encrypted'){if(!/^[a-f0-9]{64}\/[a-f0-9]{64}(?:\/[a-f0-9]{16})?$/.test(reference.key))throw new V2Error('ORIGINAL_CUTOVER_SOURCE','Legacy local object key shape is invalid.',403);const root=process.env.KIARA_ORIGINALS_DIR||join(process.env.KIARA_V2_DATA_DIR||process.env.KIARA_DATA_DIR||join(process.cwd(),'.kiara'),'originals');return `file://${resolve(root,reference.key+'.json')}`;}if(reference.storage==='s3_kms'){if(!/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(reference.key))throw new V2Error('ORIGINAL_CUTOVER_SOURCE','Legacy S3 object key shape is invalid.',403);const bucket=process.env.KIARA_ORIGINALS_S3_BUCKET;if(!bucket||!/^kiara-synthetic-[a-z0-9-]+$/.test(bucket)||process.env.KIARA_ORIGINAL_CUTOVER_S3_BUCKET!==bucket||!reference.versionId)throw new V2Error('OBJECT_STORE_NOT_CONFIGURED','The exact synthetic S3 bucket and version are required for migration preview.',503);return `s3://${bucket}/${reference.key}?versionId=${encodeURIComponent(reference.versionId)}`;}throw new V2Error('ORIGINAL_CUTOVER_SOURCE','Only legacy local and S3 originals are cutover candidates.',400);}
function references(s:WorkspaceState){const rows=new Map<string,{legacy:OriginalReference;locations:string[]}>();
 const add=(value:unknown,location:string,depth=0):void=>{
  if(depth>8||value===null||value===undefined)return;
  if(typeof value==='string'){if(value.length>10000||!value.trim().startsWith('{'))return;try{add(JSON.parse(value),location,depth+1);}catch(error){if(error instanceof V2Error)throw error;}return;}
  if(Array.isArray(value)){value.forEach((item,index)=>add(item,`${location}[${index}]`,depth+1));return;}
  if(typeof value!=='object')return;const item=value as Record<string,unknown>;
  if('storage'in item&&'key'in item){if(!['local_encrypted','s3_kms','mongo_encrypted'].includes(String(item.storage)))throw new V2Error('ORIGINAL_CUTOVER_REFERENCE','A retained original has an unknown storage type.',503);if(item.storage==='mongo_encrypted')return;const legacy=item as unknown as OriginalReference,hash=legacyOriginalHash(legacy),prior=rows.get(hash);if(prior){if(JSON.stringify(prior.legacy)!==JSON.stringify(legacy))throw new V2Error('ORIGINAL_CUTOVER_REFERENCE','A legacy original hash collision was found.',503);prior.locations.push(location);}else rows.set(hash,{legacy,locations:[location]});return;}
  for(const [key,child] of Object.entries(item))add(child,`${location}.${key}`,depth+1);
 };
 for(const source of s.sources.filter(source=>source.status!=='deleted'))if(source.originalObjectRef)add(source.originalObjectRef,`sources.${source.id}.originalObjectRef`);
 if(s.migration)add((s.migration.legacyArchive as {original?:unknown})?.original,'migration.legacyArchive.original');
 for(const [key,receipt] of Object.entries(s.receipts)){
  if(key.startsWith('artifact-intake:')&&!['staging','retained'].includes((receipt.result.intake as {status?:string}|undefined)?.status||''))continue;
  if(key.startsWith('execution:')&&(receipt.result.intent as {redactedAt?:string}|undefined)?.redactedAt)continue;
  add(receipt.result,`receipts.${key}.result`);
 }
 for(const action of s.actions)if(action.completion?.artifact)add(action.completion.artifact,`actions.${action.id}.completion.artifact`);
 for(const job of s.deletionJobs||[])for(const original of job.originals.filter(x=>x.status!=='purged'))add(original.reference,`deletionJobs.${job.id}.originals`);
 return [...rows.entries()].map(([legacyHash,value])=>({legacyHash,...value,locations:[...new Set(value.locations)].sort()})).sort((a,b)=>a.legacyHash.localeCompare(b.legacyHash));
}
/** Dry run reads and hashes each old version but writes nothing. It never runs outside an
 * explicitly named synthetic tenant in a generated/isolated MongoDB database. */
export async function previewOriginalCutover(tenantId:string):Promise<OriginalCutoverPreview>{
 scope(tenantId);const state=await readWorkspace(tenantId),workspaceHash=digest(state),database=process.env.MONGODB_DB!,candidates=references(state);if(candidates.length>100)throw new V2Error('ORIGINAL_CUTOVER_CAPACITY','Review at most 100 legacy originals per synthetic cutover.',413);
 const entries:CutoverEntry[]=[];for(const item of candidates){
  const uri=sourceUri(item.legacy),destination=destinationOriginalReference(tenantId,item.legacy);
  const bytes=await readPhysicalOriginal(tenantId,item.legacy);if(bytes.length!==item.legacy.bytes||sha(bytes)!==item.legacy.sha256)throw new V2Error('ORIGINAL_CUTOVER_SOURCE_CHANGED','Legacy original failed source verification.',503);
  entries.push({legacy:item.legacy,legacyHash:item.legacyHash,locations:item.locations,sourceUri:uri,purgeTarget:uri,bytes:bytes.length,sha256:item.legacy.sha256,destination:{database,collection:'v2_original_manifests',objectId:destination.key}});
 }
 if(digest(await readWorkspace(tenantId))!==workspaceHash)throw new V2Error('ORIGINAL_CUTOVER_WORKSPACE_CHANGED','Workspace changed during the migration preview.',409);
 const body={tenantId,workspaceVersion:state.version,workspaceHash,database,count:entries.length,totalBytes:entries.reduce((n,e)=>n+e.bytes,0),entries,sourceVerified:true as const};return {...body,previewHash:digest(body)};
}
async function purgeVerifiedLegacyCopies(tenantId:string,manifest:OriginalCutoverManifest){const pending:string[]=[];let purged=0;
 for(const entry of manifest.entries)if(await mongoOriginalAliasStatus(tenantId,entry.legacy)!=='active')throw new V2Error('ORIGINAL_CUTOVER_ALIAS_RETIRED','This cutover alias is no longer active; do not replay an old migration.',410);
 for(const entry of manifest.entries){if(entry.purgedAt){purged++;continue;}try{if(sourceUri(entry.legacy)!==entry.sourceUri||entry.purgeTarget!==entry.sourceUri||entry.legacyHash!==legacyOriginalHash(entry.legacy)||(await resolveMongoOriginalAlias(tenantId,entry.legacy))?.key!==entry.mongo.key)throw new V2Error('ORIGINAL_CUTOVER_TARGET_CHANGED','The exact reviewed alias or legacy purge target changed.',409);const copied=await readMongoOriginal(tenantId,entry.mongo);if(copied.length!==entry.legacy.bytes||sha(copied)!==entry.legacy.sha256)throw new V2Error('ORIGINAL_CUTOVER_READBACK','The Mongo original failed exact readback before legacy purge.',503);await purgeSyntheticLegacyOriginal(tenantId,entry.legacy);await markLegacyOriginalPurged(tenantId,manifest.previewHash,entry.legacyHash);purged++;}catch{pending.push(entry.legacyHash);}}
 return {activated:true,purged,pendingPurgeHashes:pending,previewHash:manifest.previewHash};
}
/** Exact preview hash is mandatory. Interrupted cleanup resumes from the retained alias manifest. */
export async function applyOriginalCutover(tenantId:string,previewHash:string){
 scope(tenantId);if(!/^[a-f0-9]{64}$/.test(previewHash))throw new V2Error('ORIGINAL_CUTOVER_PREVIEW','Provide the exact reviewed preview hash.',400);
 const replay=await readOriginalCutoverManifest(tenantId,previewHash);if(replay){if(replay.tenantHash!==sha(Buffer.from(tenantId)))throw new V2Error('ORIGINAL_CUTOVER_SCOPE','Cutover manifest tenant differs.',403);return purgeVerifiedLegacyCopies(tenantId,replay);}
 const preview=await previewOriginalCutover(tenantId);if(preview.previewHash!==previewHash)throw new V2Error('ORIGINAL_CUTOVER_PREVIEW_CHANGED','Reinspect the exact object and purge-target preview before applying.',409);
 const entries:OriginalAliasEntry[]=[];for(const item of preview.entries){if(sourceUri(item.legacy)!==item.sourceUri)throw new V2Error('ORIGINAL_CUTOVER_TARGET_CHANGED','The exact reviewed source changed.',409);const source=await readPhysicalOriginal(tenantId,item.legacy);if(source.length!==item.bytes||sha(source)!==item.sha256)throw new V2Error('ORIGINAL_CUTOVER_SOURCE_CHANGED','Legacy original changed during copy.',503);const mongo=await retainMongoOriginal(tenantId,source),readback=await readMongoOriginal(tenantId,mongo);if(mongo.key!==item.destination.objectId||!readback.equals(source))throw new V2Error('ORIGINAL_CUTOVER_READBACK','Mongo original did not match the reviewed destination.',503);entries.push({legacy:item.legacy,mongo,legacyHash:item.legacyHash,sourceUri:item.sourceUri,purgeTarget:item.purgeTarget,purgedAt:null});}
 if(digest(await readWorkspace(tenantId))!==preview.workspaceHash)throw new V2Error('ORIGINAL_CUTOVER_WORKSPACE_CHANGED','Workspace changed before alias activation; no aliases were enabled.',409);
 const manifest=await activateOriginalAliases(tenantId,previewHash,preview.workspaceHash,entries);return purgeVerifiedLegacyCopies(tenantId,manifest);
}

/** Deletion is operator-only and requires an exact preview of every live holder and alias. */
export async function previewOriginalAliasTargetReconciliation(tenantId:string,mongo:OriginalReference){
 scope(tenantId);if(process.env.KIARA_V2_STORE_MODE!=='normalized')throw new V2Error('ORIGINAL_RECONCILIATION_STORE','Reconcile only a normalized synthetic workspace.',403);
 const state=await readWorkspace(tenantId),workspaceHash=digest(state),target=await inspectMongoAliasTarget(tenantId,mongo),holders=liveMongoOriginalHolders(state,mongo,undefined,{forReconciliation:true}).sort();
 if(digest(await readWorkspace(tenantId))!==workspaceHash)throw new V2Error('ORIGINAL_RECONCILIATION_WORKSPACE_CHANGED','The holder state changed during preview.',409);
 const body={tenantId,database:process.env.MONGODB_DB!,mongo,workspaceVersion:state.version,workspaceHash,targetHash:target.targetHash,aliases:target.aliases,holders,eligible:holders.length===0};
 return {...body,previewHash:digest(body)};
}
export async function applyOriginalAliasTargetReconciliation(tenantId:string,mongo:OriginalReference,previewHash:string){
 scope(tenantId);if(!/^[a-f0-9]{64}$/.test(previewHash))throw new V2Error('ORIGINAL_RECONCILIATION_PREVIEW','Provide the exact reviewed preview hash.',400);
 const prior=await readMongoAliasReconciliation(tenantId,mongo,previewHash);if(prior!==null)return {deleted:true,replayed:true,previewHash,aliasesRetired:prior};
 const preview=await previewOriginalAliasTargetReconciliation(tenantId,mongo);
 if(preview.previewHash!==previewHash)throw new V2Error('ORIGINAL_RECONCILIATION_PREVIEW_CHANGED','Inspect the current holder and alias preview again.',409);
 if(!preview.eligible)throw new V2Error('ORIGINAL_ALIAS_TARGET_HELD','A current workspace reference still holds the Mongo original.',409);
 return reconcileMongoAliasTarget(tenantId,mongo,{previewHash,workspaceVersion:preview.workspaceVersion,workspaceHash:preview.workspaceHash,targetHash:preview.targetHash,aliasIds:preview.aliases.map(a=>a.id)});
}
