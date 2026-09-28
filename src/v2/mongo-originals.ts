import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {Binary,MongoClient,type ClientSession,type Db} from 'mongodb';
import {V2Error} from './contracts';
import {syntheticOriginalCutoverEnabled,type OriginalReference} from './objects';
import {v2DatabaseName} from './database-target';
import {hydrateWorkspace,NORMALIZED_COLLECTIONS,type NormalizedHead,type NormalizedImage,type NormalizedRow} from './normalized-store';
import {liveMongoOriginalHolders} from './original-holders';

/** Original bytes are encrypted before they enter MongoDB. A majority transaction publishes
 * all ciphertext chunks and the manifest together; the permanent fence prevents resurrection. */
const CHUNK_BYTES=1_000_000,MAX_BYTES=20_000_000;
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
/** Hash the configured Mongo destination without exposing URI credentials in an operator plan. */
export function mongoOriginalTarget(){const uri=process.env.MONGODB_URI,database=v2DatabaseName();if(!uri)throw new V2Error('MONGO_ORIGINALS_NOT_CONFIGURED','MongoDB originals require MONGODB_URI.',503);return {database,storeFingerprint:sha(JSON.stringify({uri,database}))};}
interface Manifest {_id:string;tenantHash:string;contentHash:string;keyId:string;bytes:number;cipherHash:string;chunks:number;nonce:string;tag:string;format:1}
interface Chunk {_id:string;manifestId:string;ordinal:number;data:Binary}
interface Fence {_id:string;deleted:boolean;deletedAt:string|null;epoch:number}
export interface OriginalAliasEntry {legacy:OriginalReference;mongo:OriginalReference;legacyHash:string;sourceUri:string;purgeTarget:string;purgedAt:string|null}
export interface OriginalCutoverManifest {_id:string;tenantHash:string;previewHash:string;workspaceHash:string;storeFingerprint:string;entries:OriginalAliasEntry[];activatedAt:string}
interface Alias {_id:string;tenantHash:string;legacyHash:string;legacy:OriginalReference;mongo:OriginalReference;previewHash:string;retiredAt?:string|null}
interface Reconciliation {_id:string;tenantHash:string;targetKey:string;previewHash:string;workspaceHash:string;workspaceVersion:number;storeFingerprint:string;aliasIds:string[];completedAt:string}
let client:MongoClient|undefined,identity:string|undefined;
function keyMaterial(){const value=process.env.KIARA_ORIGINALS_KEY;if(!value||!/^[a-f0-9]{64}$/i.test(value))throw new V2Error('ENCRYPTION_KEY_REQUIRED','Configure a protected 32-byte hex key for MongoDB originals.',503);const key=Buffer.from(value,'hex');return {key,keyId:sha(key).slice(0,16)};}
export function destinationOriginalReference(tenantId:string,reference:OriginalReference):OriginalReference{const {keyId}=keyMaterial(),tenantHash=sha(tenantId);return {key:`${tenantHash}/${reference.sha256}/${keyId}`,sha256:reference.sha256,bytes:reference.bytes,encryption:'aes-256-gcm',storage:'mongo_encrypted',keyId};}
async function database():Promise<{client:MongoClient;db:Db}>{
 const uri=process.env.MONGODB_URI,dbName=v2DatabaseName();
 if(!uri)throw new V2Error('MONGO_ORIGINALS_NOT_CONFIGURED','MongoDB originals require MONGODB_URI.',503);
 const next=sha(uri+'\0'+dbName);if(client&&identity!==next)throw new V2Error('ORIGINAL_STORE_CONFIG_CHANGED','Restart the original store after changing its database identity.',503);
 if(!client){const connected=new MongoClient(uri,{serverSelectionTimeoutMS:5000,maxPoolSize:6,retryWrites:true});await connected.connect();client=connected;identity=next;}
 return {client,db:client.db(dbName)};
}
export async function closeMongoOriginalStore(){await client?.close();client=undefined;identity=undefined;}
function collections(db:Db){return {manifests:db.collection<Manifest>('v2_original_manifests'),chunks:db.collection<Chunk>('v2_original_chunks'),fences:db.collection<Fence>('v2_original_fences')};}
const canonicalLegacy=(reference:OriginalReference)=>({key:reference.key,sha256:reference.sha256,bytes:reference.bytes,encryption:reference.encryption,storage:reference.storage,keyId:reference.keyId,...(reference.versionId?{versionId:reference.versionId}:{})});
export const legacyOriginalHash=(reference:OriginalReference)=>sha(JSON.stringify(canonicalLegacy(reference)));
const legacyHash=legacyOriginalHash;
function legacyIdentity(tenantId:string,reference:OriginalReference){const tenantHash=sha(tenantId),base=`${tenantHash}/${reference.sha256}`;if(!tenantId||!/^[a-f0-9]{64}$/.test(reference.sha256)||reference.storage==='local_encrypted'&&(reference.encryption!=='aes-256-gcm'||!/^[a-f0-9]{16}$/.test(reference.keyId)||![base,`${base}/${reference.keyId}`].includes(reference.key))||reference.storage==='s3_kms'&&(reference.encryption!=='aws-kms'||reference.key!==base||!reference.versionId)||!['local_encrypted','s3_kms'].includes(reference.storage))throw new V2Error('ORIGINAL_SCOPE','Legacy original identity is outside this tenant.',403);return tenantHash;}
const aliasId=(tenantHash:string,reference:OriginalReference)=>sha(`${tenantHash}:${legacyHash(reference)}`);
async function originalAlias(tenantId:string,reference:OriginalReference):Promise<Alias|null>{
 if(!syntheticOriginalCutoverEnabled(tenantId))return null;
 const tenantHash=legacyIdentity(tenantId,reference),{db}=await database(),alias=await db.collection<Alias>('v2_original_aliases').findOne({_id:aliasId(tenantHash,reference)},{readConcern:{level:'majority'}});
 if(!alias)return null;
 if(alias.tenantHash!==tenantHash||alias.legacyHash!==legacyHash(reference)||JSON.stringify(canonicalLegacy(alias.legacy))!==JSON.stringify(canonicalLegacy(reference)))throw new V2Error('ORIGINAL_ALIAS_INTEGRITY','Original alias identity failed verification.',503);
 scopedReference(tenantId,alias.mongo);if(alias.mongo.sha256!==reference.sha256||alias.mongo.bytes!==reference.bytes)throw new V2Error('ORIGINAL_ALIAS_INTEGRITY','Original alias content identity failed verification.',503);
 if(alias.retiredAt){const {manifests,chunks,fences}=collections(db);if(!(await fences.findOne({_id:alias.mongo.key}))?.deleted||await manifests.findOne({_id:alias.mongo.key})||await chunks.findOne({manifestId:alias.mongo.key}))throw new V2Error('ORIGINAL_ALIAS_INTEGRITY','A retired alias still has available target bytes.',503);}
 return alias;
}
export async function mongoOriginalAliasStatus(tenantId:string,reference:OriginalReference):Promise<'absent'|'active'|'retired'>{
 const alias=await originalAlias(tenantId,reference);return !alias?'absent':alias.retiredAt?'retired':'active';
}
export async function resolveMongoOriginalAlias(tenantId:string,reference:OriginalReference):Promise<OriginalReference|null>{
 const alias=await originalAlias(tenantId,reference);if(alias?.retiredAt)throw new V2Error('ORIGINAL_DELETED','The cutover original was deleted.',410);
 return alias?.mongo||null;
}
export async function readOriginalCutoverManifest(tenantId:string,previewHash:string):Promise<OriginalCutoverManifest|null>{
 if(!syntheticOriginalCutoverEnabled(tenantId))throw new V2Error('ORIGINAL_CUTOVER_SCOPE','Synthetic cutover scope is required.',403);
 const {db}=await database(),manifest=await db.collection<OriginalCutoverManifest>('v2_original_cutovers').findOne({_id:sha(`${sha(tenantId)}:${previewHash}`)},{readConcern:{level:'majority'}});
 if(manifest&&manifest.storeFingerprint!==mongoOriginalTarget().storeFingerprint)throw new V2Error('ORIGINAL_CUTOVER_TARGET_CHANGED','The retained cutover manifest belongs to another reviewed MongoDB target.',409);
 return manifest;
}
/** Aliases become visible only after every candidate has survived readback. */
export async function activateOriginalAliases(tenantId:string,previewHash:string,workspaceHash:string,entries:OriginalAliasEntry[]):Promise<OriginalCutoverManifest>{
 if(!syntheticOriginalCutoverEnabled(tenantId))throw new V2Error('ORIGINAL_CUTOVER_SCOPE','Synthetic cutover scope is required.',403);
 if(!/^[a-f0-9]{64}$/.test(previewHash)||!/^[a-f0-9]{64}$/.test(workspaceHash)||entries.length>100||new Set(entries.map(x=>x.legacyHash)).size!==entries.length)throw new V2Error('ORIGINAL_CUTOVER_MANIFEST','A bounded unique reviewed manifest is required.',400);
 const tenantHash=sha(tenantId),{client:connection,db}=await database(),aliases=db.collection<Alias>('v2_original_aliases'),cutovers=db.collection<OriginalCutoverManifest>('v2_original_cutovers'),{fences}=collections(db);
 const _id=sha(`${tenantHash}:${previewHash}`),activatedAt=new Date().toISOString(),manifest:OriginalCutoverManifest={_id,tenantHash,previewHash,workspaceHash,storeFingerprint:mongoOriginalTarget().storeFingerprint,entries,activatedAt};
 for(const entry of entries){legacyIdentity(tenantId,entry.legacy);scopedReference(tenantId,entry.mongo);if(entry.legacyHash!==legacyHash(entry.legacy)||entry.legacy.sha256!==entry.mongo.sha256||entry.legacy.bytes!==entry.mongo.bytes||entry.purgedAt!==null||entry.sourceUri!==entry.purgeTarget)throw new V2Error('ORIGINAL_ALIAS_INTEGRITY','Cutover entry failed verification.',503);const readback=await readMongoOriginal(tenantId,entry.mongo);if(readback.length!==entry.legacy.bytes||sha(readback)!==entry.legacy.sha256)throw new V2Error('ORIGINAL_CUTOVER_READBACK','Every Mongo copy must pass exact readback before alias activation.',503);}
 const session=connection.startSession();try{await session.withTransaction(async()=>{
  const prior=await cutovers.findOne({_id},{session});if(prior){if(prior.storeFingerprint!==manifest.storeFingerprint)throw new V2Error('ORIGINAL_CUTOVER_TARGET_CHANGED','The retained cutover manifest belongs to another reviewed MongoDB target.',409);if(prior.previewHash!==previewHash||prior.workspaceHash!==workspaceHash||prior.entries.length!==entries.length||prior.entries.some((item,index)=>item.legacyHash!==entries[index].legacyHash||item.mongo.key!==entries[index].mongo.key||item.sourceUri!==entries[index].sourceUri||item.purgeTarget!==entries[index].purgeTarget))throw new V2Error('ORIGINAL_CUTOVER_CONFLICT','Cutover preview identity differs from the retained manifest.',503);return;}
  // Alias activation and target purge must write the same fence. A concurrent purge
  // then retries against the newly visible alias, or activation sees deletion.
  for(const key of new Set(entries.map(entry=>entry.mongo.key))){const fenced=await fences.updateOne({_id:key,deleted:false},{$inc:{epoch:1}},{session});if(fenced.matchedCount!==1)throw new V2Error('ORIGINAL_DELETED','The cutover destination was deleted before alias activation.',410);}
  for(const entry of entries){const row:Alias={_id:aliasId(tenantHash,entry.legacy),tenantHash,legacyHash:entry.legacyHash,legacy:entry.legacy,mongo:entry.mongo,previewHash,retiredAt:null};const current=await aliases.findOne({_id:row._id},{session});if(current&&JSON.stringify({...current,retiredAt:current.retiredAt||null})!==JSON.stringify(row))throw new V2Error('ORIGINAL_ALIAS_CONFLICT','A legacy original has a different active alias.',503);if(!current)await aliases.insertOne(row,{session});}
  await cutovers.insertOne(manifest,{session});
 },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:15000});}finally{await session.endSession();}
 return (await readOriginalCutoverManifest(tenantId,previewHash))!;
}
export async function markLegacyOriginalPurged(tenantId:string,previewHash:string,legacyHashValue:string){if(!syntheticOriginalCutoverEnabled(tenantId))throw new V2Error('ORIGINAL_CUTOVER_SCOPE','Synthetic cutover scope is required.',403);const {db}=await database(),_id=sha(`${sha(tenantId)}:${previewHash}`),storeFingerprint=mongoOriginalTarget().storeFingerprint;const result=await db.collection<OriginalCutoverManifest>('v2_original_cutovers').updateOne({_id,storeFingerprint,'entries.legacyHash':legacyHashValue},{$set:{'entries.$.purgedAt':new Date().toISOString()}},{writeConcern:{w:'majority'}});if(result.matchedCount!==1)throw new V2Error('ORIGINAL_CUTOVER_MANIFEST','The exact purge receipt is unavailable for this MongoDB target.',503);}
function scopedReference(tenantId:string,reference:OriginalReference){
 const tenantHash=sha(tenantId);
 if(!tenantId||reference.storage!=='mongo_encrypted'||reference.encryption!=='aes-256-gcm'||!/^[a-f0-9]{64}$/.test(reference.sha256)||!Number.isSafeInteger(reference.bytes)||reference.bytes<0||reference.bytes>MAX_BYTES||!/^[a-f0-9]{16}$/.test(reference.keyId)||reference.key!==`${tenantHash}/${reference.sha256}/${reference.keyId}`||reference.versionId!==undefined)throw new V2Error('ORIGINAL_SCOPE','MongoDB original identity or tenant scope does not match.',403);
 return tenantHash;
}
function assertManifest(manifest:Manifest|null,reference:OriginalReference,tenantHash:string){
 if(!manifest||manifest._id!==reference.key||manifest.tenantHash!==tenantHash||manifest.contentHash!==reference.sha256||manifest.keyId!==reference.keyId||manifest.bytes!==reference.bytes||manifest.format!==1||!Number.isSafeInteger(manifest.chunks)||manifest.chunks<1||manifest.chunks>Math.ceil(MAX_BYTES/CHUNK_BYTES)||!/^[a-f0-9]{64}$/.test(manifest.cipherHash)||typeof manifest.nonce!=='string'||typeof manifest.tag!=='string')throw new V2Error('ORIGINAL_INTEGRITY','MongoDB original manifest failed verification.',503);
}
export async function retainMongoOriginal(tenantId:string,bytes:Uint8Array):Promise<OriginalReference>{
 if(!tenantId||tenantId.length>200||bytes.byteLength>MAX_BYTES)throw new V2Error('ORIGINAL_CAPACITY','An authenticated tenant and source below 20 MB are required.',413);
 const {key,keyId}=keyMaterial(),tenantHash=sha(tenantId),contentHash=sha(bytes),objectKey=`${tenantHash}/${contentHash}/${keyId}`;
 const reference:OriginalReference={key:objectKey,sha256:contentHash,bytes:bytes.byteLength,encryption:'aes-256-gcm',storage:'mongo_encrypted',keyId};
 const {client:connection,db}=await database(),{manifests,chunks,fences}=collections(db);
 const prior=await manifests.findOne({_id:objectKey});if(prior){assertManifest(prior,reference,tenantHash);if((await fences.findOne({_id:objectKey}))?.deleted)throw new V2Error('ORIGINAL_DELETED','A deleted original identity cannot be retained again.',410);const saved=await readMongoOriginal(tenantId,reference);if(!saved.equals(Buffer.from(bytes)))throw new V2Error('ORIGINAL_INTEGRITY','Retained original differs from the supplied bytes.',503);return reference;}
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(objectKey));const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
 const manifest:Manifest={_id:objectKey,tenantHash,contentHash,keyId,bytes:bytes.byteLength,cipherHash:sha(ciphertext),chunks:Math.max(1,Math.ceil(ciphertext.length/CHUNK_BYTES)),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),format:1};
 const rows:Chunk[]=Array.from({length:manifest.chunks},(_,ordinal)=>({_id:`${objectKey}:${ordinal}`,manifestId:objectKey,ordinal,data:new Binary(ciphertext.subarray(ordinal*CHUNK_BYTES,(ordinal+1)*CHUNK_BYTES))}));
 const session=connection.startSession();try{
  await session.withTransaction(async()=>{
   if((await fences.findOne({_id:objectKey},{session}))?.deleted)throw new V2Error('ORIGINAL_DELETED','A deleted original identity cannot be retained again.',410);
   // Retention and upload contend on the same identity even when neither has a manifest yet.
   await fences.updateOne({_id:objectKey,deleted:{$ne:true}},{$setOnInsert:{deleted:false,deletedAt:null},$inc:{epoch:1}},{upsert:true,session});
   if(await manifests.findOne({_id:objectKey},{session}))return;
   await chunks.insertMany(rows,{session,ordered:true});await manifests.insertOne(manifest,{session});
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:15000});
 }catch(error){if((error as {code?:number}).code!==11000)throw error;}finally{await session.endSession();}
 const saved=await readMongoOriginal(tenantId,reference);if(!saved.equals(Buffer.from(bytes)))throw new V2Error('ORIGINAL_INTEGRITY','MongoDB original did not survive exact readback.',503);return reference;
}
export async function readMongoOriginal(tenantId:string,reference:OriginalReference):Promise<Buffer>{
 const tenantHash=scopedReference(tenantId,reference),{key,keyId}=keyMaterial();if(keyId!==reference.keyId)throw new V2Error('ORIGINAL_KEY_REQUIRED','The retained original requires its matching encryption key.',503);
 const {db}=await database(),{manifests,chunks,fences}=collections(db);
 if((await fences.findOne({_id:reference.key},{readConcern:{level:'majority'}}))?.deleted)throw new V2Error('ORIGINAL_DELETED','The retained original was deleted.',410);
 const manifest=await manifests.findOne({_id:reference.key},{readConcern:{level:'majority'}});assertManifest(manifest,reference,tenantHash);
 const rows=await chunks.find({manifestId:reference.key},{readConcern:{level:'majority'}}).sort({ordinal:1}).toArray();if(rows.length!==manifest!.chunks||rows.some((row,index)=>row._id!==`${reference.key}:${index}`||row.ordinal!==index||row.manifestId!==reference.key))throw new V2Error('ORIGINAL_INTEGRITY','MongoDB original chunks are missing or reordered.',503);
 const ciphertext=Buffer.concat(rows.map(row=>Buffer.from(row.data.buffer)));if(sha(ciphertext)!==manifest!.cipherHash||ciphertext.length!==reference.bytes)throw new V2Error('ORIGINAL_INTEGRITY','MongoDB original ciphertext failed verification.',503);
 try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(manifest!.nonce,'base64'));decipher.setAAD(Buffer.from(reference.key));decipher.setAuthTag(Buffer.from(manifest!.tag,'base64'));const plain=Buffer.concat([decipher.update(ciphertext),decipher.final()]);if(plain.length!==reference.bytes||sha(plain)!==reference.sha256)throw new Error();return plain;}catch{throw new V2Error('ORIGINAL_INTEGRITY','MongoDB original failed authenticated decryption or checksum verification.',503);}
}
/** Inspect the physical rows as well as the deletion fence in a restored database. */
export async function inspectMongoOriginalDeletion(tenantId:string,reference:OriginalReference):Promise<{fenceDeleted:boolean;manifestAbsent:boolean;chunksAbsent:boolean}>{
 scopedReference(tenantId,reference);
 const {db}=await database(),{manifests,chunks,fences}=collections(db),readConcern={level:'majority' as const};
 const [fence,manifest,chunk]=await Promise.all([
  fences.findOne({_id:reference.key},{readConcern}),
  manifests.findOne({_id:reference.key},{readConcern,projection:{_id:1}}),
  chunks.findOne({manifestId:reference.key},{readConcern,projection:{_id:1}}),
 ]);
 return {fenceDeleted:fence?.deleted===true&&typeof fence.deletedAt==='string'&&Number.isSafeInteger(fence.epoch)&&fence.epoch>0,manifestAbsent:manifest===null,chunksAbsent:chunk===null};
}
export async function purgeMongoOriginal(tenantId:string,reference:OriginalReference):Promise<void>{
 const tenantHash=scopedReference(tenantId,reference),{client:connection,db}=await database(),{manifests,chunks,fences}=collections(db),aliases=db.collection<Alias>('v2_original_aliases');
 const session=connection.startSession();try{await session.withTransaction(async()=>{
  const existing=await manifests.findOne({_id:reference.key},{session});if(existing)assertManifest(existing,reference,tenantHash);
  await fences.updateOne({_id:reference.key},{$set:{deleted:true,deletedAt:new Date().toISOString()},$inc:{epoch:1}},{upsert:true,session});
  if(await aliases.findOne({tenantHash,'mongo.key':reference.key,retiredAt:null},{session,projection:{_id:1}}))throw new V2Error('ORIGINAL_ALIAS_TARGET_HELD','A cutover alias still holds this Mongo original.',409);
  await chunks.deleteMany({manifestId:reference.key},{session});await manifests.deleteOne({_id:reference.key},{session});
 },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:15000});}finally{await session.endSession();}
 if(!(await fences.findOne({_id:reference.key}))?.deleted||await manifests.findOne({_id:reference.key})||await chunks.findOne({manifestId:reference.key}))throw new V2Error('ORIGINAL_PURGE_UNVERIFIED','MongoDB original deletion could not be verified.',503);
}

export interface AliasTargetInspection {targetHash:string;aliases:{id:string;legacyHash:string;previewHash:string;purgedAt:string}[]}
const sameMongo=(a:OriginalReference,b:OriginalReference)=>a.key===b.key&&a.sha256===b.sha256&&a.bytes===b.bytes&&a.encryption===b.encryption&&a.storage===b.storage&&a.keyId===b.keyId&&a.versionId===b.versionId;
/** The cutover receipt, each active alias, and each old-version purge receipt must agree. */
async function inspectAliasTarget(db:Db,tenantId:string,tenantHash:string,reference:OriginalReference,session?:ClientSession):Promise<AliasTargetInspection>{
 const aliases=await db.collection<Alias>('v2_original_aliases').find({tenantHash,'mongo.key':reference.key,retiredAt:null},{session}).toArray();
 if(!aliases.length)throw new V2Error('ORIGINAL_ALIAS_TARGET_NOT_FOUND','Select an active synthetic alias target.',404);
 const cutovers=await db.collection<OriginalCutoverManifest>('v2_original_cutovers').find({tenantHash,'entries.mongo.key':reference.key},{session}).toArray();
 const entries=cutovers.flatMap(c=>c.entries.filter(e=>e.mongo.key===reference.key).map(e=>({cutover:c,entry:e})));
 if(entries.length!==aliases.length)throw new V2Error('ORIGINAL_ALIAS_INTEGRITY','The active aliases and cutover receipts differ.',503);
 const rows=aliases.map(alias=>{
  if(!sameMongo(alias.mongo,reference)||alias.tenantHash!==tenantHash||legacyIdentity(tenantId,alias.legacy)!==tenantHash||alias._id!==aliasId(tenantHash,alias.legacy)||alias.legacyHash!==legacyHash(alias.legacy))throw new V2Error('ORIGINAL_ALIAS_INTEGRITY','The target alias identity differs.',503);
  const matches=entries.filter(({cutover,entry})=>cutover.previewHash===alias.previewHash&&entry.legacyHash===alias.legacyHash&&sameMongo(entry.mongo,reference));
  if(matches.length!==1||!matches[0].entry.purgedAt)throw new V2Error('ORIGINAL_LEGACY_PURGE_PENDING','Every aliased legacy version must have an exact purge receipt.',409);
  return {id:alias._id,legacyHash:alias.legacyHash,previewHash:alias.previewHash,purgedAt:matches[0].entry.purgedAt};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 return {aliases:rows,targetHash:sha(JSON.stringify(rows))};
}
export async function inspectMongoAliasTarget(tenantId:string,reference:OriginalReference):Promise<AliasTargetInspection>{
 if(!syntheticOriginalCutoverEnabled(tenantId))throw new V2Error('ORIGINAL_CUTOVER_SCOPE','Synthetic cutover scope is required.',403);
 const tenantHash=scopedReference(tenantId,reference),{db}=await database();
 await readMongoOriginal(tenantId,reference);
 return inspectAliasTarget(db,tenantId,tenantHash,reference);
}
const reconciliationId=(tenantHash:string,key:string,previewHash:string)=>sha(`${tenantHash}:${key}:${previewHash}`);
export async function readMongoAliasReconciliation(tenantId:string,reference:OriginalReference,previewHash:string):Promise<number|null>{
 if(!syntheticOriginalCutoverEnabled(tenantId))throw new V2Error('ORIGINAL_CUTOVER_SCOPE','Synthetic cutover scope is required.',403);
 const tenantHash=scopedReference(tenantId,reference),{db}=await database(),receipt=await db.collection<Reconciliation>('v2_original_reconciliations').findOne({_id:reconciliationId(tenantHash,reference.key,previewHash)},{readConcern:{level:'majority'}});
 if(!receipt)return null;
 if(receipt.storeFingerprint!==mongoOriginalTarget().storeFingerprint)throw new V2Error('ORIGINAL_RECONCILIATION_TARGET_CHANGED','The retained reconciliation receipt belongs to another reviewed MongoDB target.',409);
 if(receipt.tenantHash!==tenantHash||receipt.targetKey!==reference.key||receipt.previewHash!==previewHash||!receipt.aliasIds.length||new Set(receipt.aliasIds).size!==receipt.aliasIds.length)throw new V2Error('ORIGINAL_RECONCILIATION_INTEGRITY','The deletion receipt identity differs.',503);
 const {manifests,chunks,fences}=collections(db),aliases=db.collection<Alias>('v2_original_aliases');
 if(!(await fences.findOne({_id:reference.key}))?.deleted||await manifests.findOne({_id:reference.key})||await chunks.findOne({manifestId:reference.key})||await aliases.findOne({tenantHash,'mongo.key':reference.key,retiredAt:null})||await aliases.countDocuments({_id:{$in:receipt.aliasIds},tenantHash,'mongo.key':reference.key,retiredAt:{$type:'string'}})!==receipt.aliasIds.length)throw new V2Error('ORIGINAL_PURGE_UNVERIFIED','The alias target deletion receipt failed readback.',503);
 return receipt.aliasIds.length;
}
/** The workspace-head write conflicts with every normalized holder mutation; the original
 * fence conflicts with upload, native purge, and new alias activation. */
export async function reconcileMongoAliasTarget(tenantId:string,reference:OriginalReference,expected:{previewHash:string;workspaceVersion:number;workspaceHash:string;targetHash:string;storeFingerprint:string;aliasIds:string[]}){
 if(!syntheticOriginalCutoverEnabled(tenantId)||process.env.KIARA_V2_STORE_MODE!=='normalized')throw new V2Error('ORIGINAL_CUTOVER_SCOPE','Select a normalized synthetic tenant in an isolated database.',403);
 if(process.env.KIARA_RETENTION_HOLD==='true')throw new V2Error('ORIGINAL_ALIAS_TARGET_HELD','An operator retention hold prevents original deletion.',409);
 const tenantHash=scopedReference(tenantId,reference);
 if(!/^[a-f0-9]{64}$/.test(expected.previewHash)||!/^[a-f0-9]{64}$/.test(expected.workspaceHash)||!/^[a-f0-9]{64}$/.test(expected.targetHash)||!/^[a-f0-9]{64}$/.test(expected.storeFingerprint)||!Number.isSafeInteger(expected.workspaceVersion)||expected.workspaceVersion<1||!expected.aliasIds.length||expected.aliasIds.length>100||expected.aliasIds.some(id=>!/^[a-f0-9]{64}$/.test(id)))throw new V2Error('ORIGINAL_RECONCILIATION_PREVIEW','Provide the exact reviewed target and workspace preview.',400);
 if(expected.storeFingerprint!==mongoOriginalTarget().storeFingerprint)throw new V2Error('ORIGINAL_RECONCILIATION_TARGET_CHANGED','The selected MongoDB target differs from the reviewed reconciliation.',409);
 const prior=await readMongoAliasReconciliation(tenantId,reference,expected.previewHash);if(prior!==null)return {deleted:true,replayed:true,previewHash:expected.previewHash,aliasesRetired:prior};
 const {client:connection,db}=await database(),{manifests,chunks,fences}=collections(db),aliases=db.collection<Alias>('v2_original_aliases'),receipts=db.collection<Reconciliation>('v2_original_reconciliations');
 const session=connection.startSession();try{await session.withTransaction(async()=>{
  if(process.env.KIARA_RETENTION_HOLD==='true')throw new V2Error('ORIGINAL_ALIAS_TARGET_HELD','An operator retention hold prevents original deletion.',409);
  if(expected.storeFingerprint!==mongoOriginalTarget().storeFingerprint)throw new V2Error('ORIGINAL_RECONCILIATION_TARGET_CHANGED','The selected MongoDB target changed during reconciliation.',409);
  const locked=await db.collection<{_id:string;mode:string;version:number;stateHash:string}>('v2_normalized_heads').updateOne({_id:tenantId,mode:'normalized',version:expected.workspaceVersion,stateHash:expected.workspaceHash},{$inc:{retentionEpoch:1}},{session});
  if(locked.matchedCount!==1)throw new V2Error('ORIGINAL_RECONCILIATION_WORKSPACE_CHANGED','The holder state changed after preview.',409);
  const head=await db.collection<NormalizedHead>('v2_normalized_heads').findOne({_id:tenantId},{session});
  if(!head||head.mode!=='normalized'||head.stateHash!==expected.workspaceHash)throw new V2Error('ORIGINAL_RECONCILIATION_WORKSPACE_CHANGED','The holder state changed during reconciliation.',409);
  const rows={} as NormalizedImage['rows'];for(const kind of NORMALIZED_COLLECTIONS)rows[kind]=await db.collection<NormalizedRow>(`v2_records_${kind}`).find({tenantId,generation:head.generation},{session}).sort({ordinal:1}).toArray();
  const holders=liveMongoOriginalHolders(hydrateWorkspace({head,rows}),reference,undefined,{forReconciliation:true});
  if(holders.length)throw new V2Error('ORIGINAL_ALIAS_TARGET_HELD','A current workspace reference still holds the Mongo original.',409);
  const current=await inspectAliasTarget(db,tenantId,tenantHash,reference,session);
  if(current.targetHash!==expected.targetHash||JSON.stringify(current.aliases.map(a=>a.id))!==JSON.stringify(expected.aliasIds))throw new V2Error('ORIGINAL_RECONCILIATION_TARGET_CHANGED','The alias or legacy-purge receipts changed after preview.',409);
  assertManifest(await manifests.findOne({_id:reference.key},{session}),reference,tenantHash);
  const retiredAt=new Date().toISOString(),fenced=await fences.updateOne({_id:reference.key,deleted:false},{$set:{deleted:true,deletedAt:retiredAt},$inc:{epoch:1}},{session});
  if(fenced.matchedCount!==1)throw new V2Error('ORIGINAL_DELETED','The target was already deleted.',410);
  const retired=await aliases.updateMany({_id:{$in:expected.aliasIds},tenantHash,'mongo.key':reference.key,retiredAt:null},{$set:{retiredAt}},{session});
  if(retired.modifiedCount!==expected.aliasIds.length)throw new V2Error('ORIGINAL_RECONCILIATION_TARGET_CHANGED','An alias changed during reconciliation.',409);
  await chunks.deleteMany({manifestId:reference.key},{session});await manifests.deleteOne({_id:reference.key},{session});
  await receipts.insertOne({_id:reconciliationId(tenantHash,reference.key,expected.previewHash),tenantHash,targetKey:reference.key,previewHash:expected.previewHash,workspaceHash:expected.workspaceHash,workspaceVersion:expected.workspaceVersion,storeFingerprint:expected.storeFingerprint,aliasIds:expected.aliasIds,completedAt:retiredAt},{session});
 },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:15000});}finally{await session.endSession();}
 if(await readMongoAliasReconciliation(tenantId,reference,expected.previewHash)===null)throw new V2Error('ORIGINAL_PURGE_UNVERIFIED','The alias target deletion receipt was not durable.',503);
 return {deleted:true,replayed:false,previewHash:expected.previewHash,aliasesRetired:expected.aliasIds.length};
}
