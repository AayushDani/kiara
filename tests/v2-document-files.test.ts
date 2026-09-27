import test from 'node:test';
import assert from 'node:assert/strict';
import {exportReviewDocx,parseDocument,inspectDocx} from '../src/v2/document-files';
import {retainS3Original,readS3Original} from '../src/v2/s3-originals';

test('Word review export round-trips body and authority manifest while rejecting malformed archives',async()=>{
 const document=await exportReviewDocx({title:'Fictional review packet',body:'Clause one\nCustomer transcripts remain in staging.\n\nClause two\nPrior notice is subject to the executed agreement.',manifest:['Record: example-record','No legal clearance or publication is inferred.']});
 inspectDocx(document);const parsed=await parseDocument(document,'review.docx');assert.match(parsed.text,/Customer transcripts remain in staging/);assert.match(parsed.text,/example-record/);assert.ok(parsed.warnings.some(w=>w.includes('tracked-change')));
 assert.throws(()=>inspectDocx(Buffer.from('not an archive')),/DOCX/);await assert.rejects(parseDocument(Buffer.from('pdf'),'source.pdf'),/PDF\/OCR/);
 const inflated=Buffer.from(document);const directory=inflated.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));inflated.writeUInt32LE(200_000_000,directory+24);assert.throws(()=>inspectDocx(inflated),/excessive/);
 const mismatched=Buffer.from(document);const local=mismatched.readUInt32LE(directory+42);mismatched.writeUInt32LE(1,local+22);assert.throws(()=>inspectDocx(mismatched),/differ/);
 const dishonest=Buffer.from(document);let entry=directory;while(dishonest.readUInt32LE(entry+24)<50){entry+=46+dishonest.readUInt16LE(entry+28)+dishonest.readUInt16LE(entry+30)+dishonest.readUInt16LE(entry+32);}const bodyOffset=dishonest.readUInt32LE(entry+42);dishonest.writeUInt32LE(10,entry+24);dishonest.writeUInt32LE(10,bodyOffset+22);assert.throws(()=>inspectDocx(dishonest),/declared archive size/);
});

test('S3 originals require KMS and a version receipt; repeated upload reconciles the retained version',async()=>{
 const before={...process.env};Object.assign(process.env,{KIARA_ORIGINALS_S3_BUCKET:'test-bucket',AWS_REGION:'us-east-1',KIARA_ORIGINALS_KMS_KEY_ID:'arn:aws:kms:us-east-1:123456789012:key/test-kms-key'});
 try{
  const bytes=Buffer.from('Original agreement bytes'),seen:{input:Record<string,unknown>}[]=[];let manifest:Record<string,string>={};let uploaded=false;
  const client={send:async(command:any):Promise<Record<string,unknown>>=>{seen.push(command);if(command.constructor.name==='PutObjectCommand'){assert.equal(command.input.ServerSideEncryption,'aws:kms');assert.equal(command.input.IfNoneMatch,'*');manifest=command.input.Metadata;if(uploaded)throw Object.assign(new Error('Already retained'),{name:'PreconditionFailed'});uploaded=true;return {VersionId:'version-1',ServerSideEncryption:'aws:kms',SSEKMSKeyId:process.env.KIARA_ORIGINALS_KMS_KEY_ID};}if(command.constructor.name==='HeadObjectCommand')return {VersionId:'version-1',ServerSideEncryption:'aws:kms',SSEKMSKeyId:process.env.KIARA_ORIGINALS_KMS_KEY_ID,Metadata:manifest,ContentLength:bytes.length};return {VersionId:'version-1',ServerSideEncryption:'aws:kms',SSEKMSKeyId:process.env.KIARA_ORIGINALS_KMS_KEY_ID,Metadata:manifest,Body:(async function*(){yield bytes;})()};}};
  const first=await retainS3Original('tenant-a',bytes,client),replayed=await retainS3Original('tenant-a',bytes,client);assert.deepEqual(first,replayed);assert.ok((await readS3Original('tenant-a',first,client)).equals(bytes));await assert.rejects(readS3Original('tenant-b',first,client),/scope/);
  await assert.rejects(retainS3Original('tenant-a',bytes,{send:async()=>({ServerSideEncryption:'aws:kms',SSEKMSKeyId:process.env.KIARA_ORIGINALS_KMS_KEY_ID})}),/versioned KMS/);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
});
