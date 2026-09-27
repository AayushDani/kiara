import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {mkdir,open,readFile,link,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {V2Error} from './contracts';

export interface OriginalReference {key:string;sha256:string;bytes:number;encryption:'aes-256-gcm'|'aws-kms';storage:'local_encrypted'|'mongo_encrypted'|'s3_kms';keyId:string;versionId?:string}
const sha=(data:string|Uint8Array)=>createHash('sha256').update(data).digest('hex');
const root=()=>process.env.KIARA_ORIGINALS_DIR||join(process.env.KIARA_V2_DATA_DIR||process.env.KIARA_DATA_DIR||join(process.cwd(),'.kiara'),'originals');
export function syntheticOriginalCutoverEnabled(tenantId:string){return /^synthetic-[a-z0-9-]{1,80}$/.test(tenantId)&&process.env.KIARA_ORIGINAL_CUTOVER_TENANT===tenantId&&/^kiara_(qualification|synthetic)_[a-z0-9]+$/.test(process.env.MONGODB_DB||'');}
async function syncDirectory(path:string){const directory=await open(path,'r');try{await directory.sync();}finally{await directory.close();}}
async function encryptionKey(){
 const configured=process.env.KIARA_ORIGINALS_KEY;
 if(configured){if(!/^[a-f0-9]{64}$/i.test(configured))throw new V2Error('ENCRYPTION_KEY_INVALID','Original storage requires a 32-byte hex key.',503);return Buffer.from(configured,'hex');}
 if(process.env.VERCEL||process.env.KIARA_V2_AUTH_MODE==='oidc')throw new V2Error('ENCRYPTION_KEY_REQUIRED','Configure protected original-storage encryption before importing source bytes.',503);
 await mkdir(root(),{recursive:true,mode:0o700});const path=join(root(),'local-encryption-key');
 try{return Buffer.from(await readFile(path,'utf8'),'hex');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const value=randomBytes(32);try{const file=await open(path,'wx',0o600);try{await file.writeFile(value.toString('hex'));await file.sync();}finally{await file.close();}await syncDirectory(root());return value;}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return Buffer.from(await readFile(path,'utf8'),'hex');throw e;}
}
/** Local encrypted adapter. Managed object-storage deployment is a separate qualification. */
export async function retainOriginal(tenantId:string,bytes:Uint8Array):Promise<OriginalReference>{
 const mode=process.env.KIARA_ORIGINALS_MODE||(process.env.MONGODB_URI?'mongo_encrypted':'local_encrypted');
 if(mode==='mongo_encrypted')return (await import('./mongo-originals')).retainMongoOriginal(tenantId,bytes);
 if(mode==='s3_kms')return (await import('./s3-originals')).retainS3Original(tenantId,bytes);
 if(mode!=='local_encrypted')throw new V2Error('OBJECT_STORE_NOT_CONFIGURED','Choose a supported original-storage mode.',503);
 if(!tenantId||bytes.byteLength>20_000_000)throw new V2Error('ORIGINAL_CAPACITY','An authenticated tenant and source below 20 MB are required.',413);
 if(process.env.VERCEL)throw new V2Error('OBJECT_STORE_REQUIRED','Configure a durable managed original-storage adapter; ephemeral local storage is not sufficient.',503);
 const key=await encryptionKey(),contentHash=sha(bytes),tenantHash=sha(tenantId),keyId=sha(key).slice(0,16),objectKey=`${tenantHash}/${contentHash}/${keyId}`;
 // Old two-segment references remain immutable and replayable under their original key.
 const legacy:OriginalReference={key:`${tenantHash}/${contentHash}`,sha256:contentHash,bytes:bytes.byteLength,encryption:'aes-256-gcm',storage:'local_encrypted',keyId};
 try{const old=JSON.parse(await readFile(join(root(),legacy.key+'.json'),'utf8'));if(old.keyId===keyId){await readOriginal(tenantId,legacy);return legacy;}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const dir=join(root(),tenantHash,contentHash);await mkdir(dir,{recursive:true,mode:0o700});
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(objectKey));const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
 const envelope=Buffer.from(JSON.stringify({version:1,keyId:sha(key).slice(0,16),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')}));
 const temporary=join(dir,`${contentHash}.${randomBytes(8).toString('hex')}.tmp`),target=join(dir,keyId+'.json'),file=await open(temporary,'wx',0o600);
 try{await file.writeFile(envelope);await file.sync();}finally{await file.close();}
 try{try{await link(temporary,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}for(const path of [dir,join(root(),tenantHash),root()])await syncDirectory(path);}finally{await rm(temporary,{force:true});}
 const reference:OriginalReference={key:objectKey,sha256:contentHash,bytes:bytes.byteLength,encryption:'aes-256-gcm',storage:'local_encrypted',keyId};await readOriginal(tenantId,reference);return reference;
}
export async function readOriginal(tenantId:string,reference:OriginalReference):Promise<Buffer>{
 if(reference.storage!=='mongo_encrypted'&&process.env.MONGODB_URI&&syntheticOriginalCutoverEnabled(tenantId)){const alias=await(await import('./mongo-originals')).resolveMongoOriginalAlias(tenantId,reference);if(alias)return (await import('./mongo-originals')).readMongoOriginal(tenantId,alias);}
 return readPhysicalOriginal(tenantId,reference);
}
/** The migration operator verifies legacy bytes directly before an alias can take effect. */
export async function readPhysicalOriginal(tenantId:string,reference:OriginalReference):Promise<Buffer>{
 if(reference.storage==='mongo_encrypted')return (await import('./mongo-originals')).readMongoOriginal(tenantId,reference);
 if(reference.storage==='s3_kms')return (await import('./s3-originals')).readS3Original(tenantId,reference);
 if(reference.storage!=='local_encrypted')throw new V2Error('ORIGINAL_SCOPE','Unknown original storage mode.',403);
 const tenantHash=sha(tenantId);
 if(!/^[a-f0-9]{64}\/[a-f0-9]{64}(?:\/[a-f0-9]{16})?$/.test(reference.key)||!reference.key.startsWith(tenantHash+'/')||reference.key.split('/')[1]!==reference.sha256||(reference.key.split('/').length===3&&reference.key.split('/')[2]!==reference.keyId))throw new V2Error('ORIGINAL_SCOPE','The original belongs to another scope.',403);
 const key=await encryptionKey(),envelope=JSON.parse(await readFile(join(root(),reference.key+'.json'),'utf8'));
 if(envelope.version!==1||envelope.keyId!==sha(key).slice(0,16)||reference.keyId!==envelope.keyId)throw new V2Error('ORIGINAL_KEY_REQUIRED','The retained original requires its matching encryption key.',503);
 try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.nonce,'base64'));decipher.setAAD(Buffer.from(reference.key));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));const bytes=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]);if(sha(bytes)!==reference.sha256||bytes.length!==reference.bytes)throw new Error();return bytes;}catch{throw new V2Error('ORIGINAL_INTEGRITY','The original failed authenticated decryption or checksum verification.',503);}
}

/** Only the retention worker calls this after committing an object-reference deletion fence. */
export async function purgeOriginal(tenantId:string,reference:OriginalReference):Promise<void>{
 if(reference.storage!=='mongo_encrypted'&&process.env.MONGODB_URI&&syntheticOriginalCutoverEnabled(tenantId)){const status=await(await import('./mongo-originals')).mongoOriginalAliasStatus(tenantId,reference);if(status==='active')throw new V2Error('ORIGINAL_ALIAS_TARGET_HELD','A cutover alias target requires a separate exact-holder cleanup review.',409);if(status==='retired')return;}
 return purgePhysicalOriginal(tenantId,reference);
}
/** Restricted operator helper for the exact synthetic tenant and isolated database. */
export async function purgeSyntheticLegacyOriginal(tenantId:string,reference:OriginalReference):Promise<void>{
 if(!syntheticOriginalCutoverEnabled(tenantId)||reference.storage==='mongo_encrypted')throw new V2Error('ORIGINAL_CUTOVER_SCOPE','Synthetic cutover scope is required.',403);
 return purgePhysicalOriginal(tenantId,reference);
}
async function purgePhysicalOriginal(tenantId:string,reference:OriginalReference):Promise<void>{
 if(reference.storage==='mongo_encrypted')return (await import('./mongo-originals')).purgeMongoOriginal(tenantId,reference);
 if(reference.storage==='s3_kms')return (await import('./s3-originals')).purgeS3Original(tenantId,reference);
 const tenantHash=sha(tenantId);
 if(reference.storage!=='local_encrypted'||!/^[a-f0-9]{64}\/[a-f0-9]{64}(?:\/[a-f0-9]{16})?$/.test(reference.key)||!reference.key.startsWith(tenantHash+'/')||reference.key.split('/')[1]!==reference.sha256||(reference.key.split('/').length===3&&reference.key.split('/')[2]!==reference.keyId))throw new V2Error('ORIGINAL_SCOPE','Original deletion identity is outside this tenant.',403);
 const path=join(root(),reference.key+'.json');await rm(path,{force:true});
 try{await syncDirectory(dirname(path));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 try{await readFile(path);throw new V2Error('ORIGINAL_PURGE_UNVERIFIED','The original remains present after deletion.',503);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
