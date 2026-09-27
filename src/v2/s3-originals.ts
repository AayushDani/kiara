import {createHash} from 'node:crypto';
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';
import {V2Error} from './contracts';
import type {OriginalReference} from './objects';

type Transport={send(command:PutObjectCommand|GetObjectCommand|HeadObjectCommand):Promise<Record<string,unknown>>};
const sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function configuration(){const bucket=process.env.KIARA_ORIGINALS_S3_BUCKET,region=process.env.AWS_REGION,keyId=process.env.KIARA_ORIGINALS_KMS_KEY_ID;if(!bucket||!region||!keyId||!/^arn:(aws|aws-us-gov|aws-cn):kms:[a-z0-9-]+:[0-9]{12}:key\/[a-zA-Z0-9-]+$/.test(keyId))throw new V2Error('OBJECT_STORE_NOT_CONFIGURED','Configure a versioned S3 bucket, AWS region and customer-managed KMS key ARN.',503);return {bucket,region,keyId};}
function transport(region:string):Transport{return new S3Client({region,maxAttempts:2}) as unknown as Transport;}
export async function retainS3Original(tenantId:string,bytes:Uint8Array,injected?:Transport):Promise<OriginalReference>{
 const config=configuration();if(!tenantId||bytes.byteLength>20_000_000)throw new V2Error('ORIGINAL_CAPACITY','An authenticated tenant and original below 20 MB are required.',413);
 const contentHash=sha(bytes),tenantHash=sha(tenantId),key=`${tenantHash}/${contentHash}`;
 const client=injected||transport(config.region);let result:Record<string,unknown>;
 try{result=await client.send(new PutObjectCommand({Bucket:config.bucket,Key:key,IfNoneMatch:'*',Body:bytes,ServerSideEncryption:'aws:kms',SSEKMSKeyId:config.keyId,ChecksumSHA256:Buffer.from(contentHash,'hex').toString('base64'),Metadata:{'tenant-hash':tenantHash,'content-sha256':contentHash},ContentType:'application/octet-stream'}));}catch(error){if((error as {name?:string}).name!=='PreconditionFailed'&&(error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw error;result=await client.send(new HeadObjectCommand({Bucket:config.bucket,Key:key,ChecksumMode:'ENABLED'}));const metadata=result.Metadata as Record<string,string>|undefined;if(metadata?.['tenant-hash']!==tenantHash||metadata?.['content-sha256']!==contentHash||result.ContentLength!==bytes.byteLength)throw new V2Error('ORIGINAL_INTEGRITY','An existing original conflicts with its tenant or content manifest.',503);}
 if(typeof result.VersionId!=='string'||!result.VersionId||result.VersionId==='null'||(result.ServerSideEncryption!=='aws:kms'||result.SSEKMSKeyId!==config.keyId))throw new V2Error('OBJECT_STORE_VERIFICATION_REQUIRED','The upload did not confirm versioned KMS storage. Inspect bucket configuration before retrying; an object may have been accepted.',503);
 return {key,sha256:contentHash,bytes:bytes.byteLength,encryption:'aws-kms',storage:'s3_kms',keyId:config.keyId,versionId:result.VersionId};
}
export async function readS3Original(tenantId:string,reference:OriginalReference,injected?:Transport):Promise<Buffer>{
 const config=configuration(),tenantHash=sha(tenantId);
 if(reference.storage!=='s3_kms'||reference.keyId!==config.keyId||!reference.versionId||!reference.key.startsWith(tenantHash+'/')||reference.key!==`${tenantHash}/${reference.sha256}`||!/^\w{64}\/\w{64}$/.test(reference.key))throw new V2Error('ORIGINAL_SCOPE','Original identity or tenant scope does not match.',403);
 const result=await(injected||transport(config.region)).send(new GetObjectCommand({Bucket:config.bucket,Key:reference.key,VersionId:reference.versionId,ChecksumMode:'ENABLED'}));
 const metadata=result.Metadata as Record<string,string>|undefined;
 if(result.VersionId!==reference.versionId||result.ServerSideEncryption!=='aws:kms'||result.SSEKMSKeyId!==reference.keyId||metadata?.['tenant-hash']!==tenantHash||metadata?.['content-sha256']!==reference.sha256)throw new V2Error('ORIGINAL_INTEGRITY','Retained original metadata failed verification.',503);
 const body=result.Body as AsyncIterable<Uint8Array>|undefined;if(!body)throw new V2Error('ORIGINAL_UNAVAILABLE','The retained original body is unavailable.',503);
 const chunks:Uint8Array[]=[];let length=0;for await(const chunk of body){length+=chunk.byteLength;if(length>20_000_000||length>reference.bytes)throw new V2Error('ORIGINAL_INTEGRITY','Retained original size differs from its manifest.',503);chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);if(bytes.length!==reference.bytes||sha(bytes)!==reference.sha256)throw new V2Error('ORIGINAL_INTEGRITY','Retained original bytes differ from the manifest.',503);return bytes;
}
