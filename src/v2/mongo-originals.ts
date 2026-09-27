import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {Binary,MongoClient,type Db} from 'mongodb';
import {V2Error} from './contracts';
import type {OriginalReference} from './objects';

/** Original bytes are encrypted before they enter MongoDB. A majority transaction publishes
 * all ciphertext chunks and the manifest together; the permanent fence prevents resurrection. */
const CHUNK_BYTES=1_000_000,MAX_BYTES=20_000_000;
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
interface Manifest {_id:string;tenantHash:string;contentHash:string;keyId:string;bytes:number;cipherHash:string;chunks:number;nonce:string;tag:string;format:1}
interface Chunk {_id:string;manifestId:string;ordinal:number;data:Binary}
interface Fence {_id:string;deleted:boolean;deletedAt:string|null;epoch:number}
let client:MongoClient|undefined,identity:string|undefined;
function keyMaterial(){const value=process.env.KIARA_ORIGINALS_KEY;if(!value||!/^[a-f0-9]{64}$/i.test(value))throw new V2Error('ENCRYPTION_KEY_REQUIRED','Configure a protected 32-byte hex key for MongoDB originals.',503);const key=Buffer.from(value,'hex');return {key,keyId:sha(key).slice(0,16)};}
async function database():Promise<{client:MongoClient;db:Db}>{
 const uri=process.env.MONGODB_URI,dbName=process.env.MONGODB_DB||'kiara';
 if(!uri)throw new V2Error('MONGO_ORIGINALS_NOT_CONFIGURED','MongoDB originals require MONGODB_URI.',503);
 const next=sha(uri+'\0'+dbName);if(client&&identity!==next)throw new V2Error('ORIGINAL_STORE_CONFIG_CHANGED','Restart the original store after changing its database identity.',503);
 if(!client){const connected=new MongoClient(uri,{serverSelectionTimeoutMS:5000,maxPoolSize:6,retryWrites:true});await connected.connect();client=connected;identity=next;}
 return {client,db:client.db(dbName)};
}
export async function closeMongoOriginalStore(){await client?.close();client=undefined;identity=undefined;}
function collections(db:Db){return {manifests:db.collection<Manifest>('v2_original_manifests'),chunks:db.collection<Chunk>('v2_original_chunks'),fences:db.collection<Fence>('v2_original_fences')};}
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
export async function purgeMongoOriginal(tenantId:string,reference:OriginalReference):Promise<void>{
 const tenantHash=scopedReference(tenantId,reference),{client:connection,db}=await database(),{manifests,chunks,fences}=collections(db);
 const session=connection.startSession();try{await session.withTransaction(async()=>{
  const existing=await manifests.findOne({_id:reference.key},{session});if(existing)assertManifest(existing,reference,tenantHash);
  await fences.updateOne({_id:reference.key},{$set:{deleted:true,deletedAt:new Date().toISOString()},$inc:{epoch:1}},{upsert:true,session});
  await chunks.deleteMany({manifestId:reference.key},{session});await manifests.deleteOne({_id:reference.key},{session});
 },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:15000});}finally{await session.endSession();}
 if(!(await fences.findOne({_id:reference.key}))?.deleted||await manifests.findOne({_id:reference.key})||await chunks.findOne({manifestId:reference.key}))throw new V2Error('ORIGINAL_PURGE_UNVERIFIED','MongoDB original deletion could not be verified.',503);
}
