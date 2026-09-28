import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {V2Error} from '../src/v2/contracts';
import type {OriginalReference} from '../src/v2/objects';
import {parseRestoreCommand,validateRestoreManifest,validateRestoreTarget,verifyRestoredOriginals} from '../scripts/v2-original-restore-verify';

const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const tenant='recovery-test-tenant',readable=Buffer.from('selected retained synthetic bytes'),deleted=Buffer.from('selected deleted synthetic bytes'),keyId='a'.repeat(16);
const reference=(bytes:Buffer):OriginalReference=>({key:`${sha(tenant)}/${sha(bytes)}/${keyId}`,sha256:sha(bytes),bytes:bytes.length,encryption:'aes-256-gcm',storage:'mongo_encrypted',keyId});
const kept=reference(readable),gone=reference(deleted),manifest={tenantId:tenant,checks:[{reference:kept,expected:'readable' as const},{reference:gone,expected:'deleted' as const}]};
const target={database:'kiara_recovery_qualification',sourceDatabase:'kiara_v2',manifestPath:'/tmp/selected-restore-checks.json'};
const env={NODE_ENV:'test' as const,MONGODB_URI:'mongodb+srv://example:secret@cluster.mongodb.net/?retryWrites=true',MONGODB_DB:target.database,KIARA_ORIGINALS_KEY:'1'.repeat(64)};

test('recovery verifier requires a distinct isolated TLS Atlas database and matching key',()=>{
 assert.deepEqual(parseRestoreCommand(['--database',target.database,'--source-database',target.sourceDatabase,'--manifest',target.manifestPath]),target);
 assert.equal(validateRestoreTarget(target,env).database,target.database);
 for(const override of [{MONGODB_DB:'kiara_v2'},{MONGODB_URI:'mongodb://localhost:27017'},{MONGODB_URI:'mongodb+srv://cluster.mongodb.net/?tlsInsecure=true'},{MONGODB_URI:'mongodb+srv://cluster.mongodb.net/kiara_v2'},{KIARA_ORIGINALS_KEY:''}])assert.throws(()=>validateRestoreTarget(target,{...env,...override}));
 assert.throws(()=>validateRestoreTarget({...target,sourceDatabase:target.database},env));
 const multiHost='mongodb://example:secret@host-a.mongodb.net:27017,host-b.mongodb.net:27017,host-c.mongodb.net:27017/kiara_recovery_qualification?replicaSet=atlas-test&authSource=admin&tls=true';
 assert.equal(validateRestoreTarget(target,{...env,MONGODB_URI:multiHost}).database,target.database);
 for(const override of [
  `${multiHost}&tls=false`,
  `${multiHost}&tlsAllowInvalidCertificates=true`,
  multiHost.replace('host-c.mongodb.net','foreign.example.test'),
  multiHost.replace('/kiara_recovery_qualification?','/kiara_v2?'),
  multiHost.replace('&tls=true',''),
 ])assert.throws(()=>validateRestoreTarget(target,{...env,MONGODB_URI:override}));
 assert.throws(()=>validateRestoreTarget(target,{...env,MONGODB_URI:multiHost,NODE_ENV:'production'}));
});

test('restore manifest rejects cross-tenant references and requires retained/deleted probes',()=>{
 assert.deepEqual(validateRestoreManifest(manifest),manifest);
 assert.throws(()=>validateRestoreManifest({...manifest,checks:[manifest.checks[0]]}));
 assert.throws(()=>validateRestoreManifest({...manifest,tenantId:'other-tenant'}));
 assert.throws(()=>validateRestoreManifest({...manifest,checks:[manifest.checks[0],manifest.checks[0]]}));
});

test('restored bytes and permanent deletion fence must both be observed',async()=>{
 const reader=async(_tenantId:string,ref:OriginalReference)=>{if(ref.key===kept.key)return readable;if(ref.key===gone.key)throw new V2Error('ORIGINAL_DELETED','Deleted.',410);throw Error('Unexpected reference');};
 const cleanDeletion=async()=>({fenceDeleted:true,manifestAbsent:true,chunksAbsent:true});
 const result=await verifyRestoredOriginals(target,manifest,env,reader,cleanDeletion);
 assert.equal(result.verified,true);assert.equal(result.checks.length,2);
 assert.equal(result.checks[0].bytes,readable.length);
 assert.doesNotMatch(JSON.stringify(result),/selected retained|selected deleted|secret/);
 await assert.rejects(verifyRestoredOriginals(target,manifest,env,async(_tenantId,ref)=>ref.key===kept.key?Buffer.from('tampered'):Promise.reject(new V2Error('ORIGINAL_DELETED','Deleted.',410)),cleanDeletion));
 await assert.rejects(verifyRestoredOriginals(target,manifest,env,async(_tenantId,ref)=>ref.key===kept.key?readable:deleted,cleanDeletion),/previously deleted original was readable/);
 await assert.rejects(verifyRestoredOriginals(target,manifest,env,async(_tenantId,ref)=>ref.key===kept.key?readable:Promise.reject(new V2Error('ORIGINAL_INTEGRITY','Missing manifest.',503)),cleanDeletion));
 for(const rows of [
  {fenceDeleted:false,manifestAbsent:true,chunksAbsent:true},
  {fenceDeleted:true,manifestAbsent:false,chunksAbsent:true},
  {fenceDeleted:true,manifestAbsent:true,chunksAbsent:false},
 ])await assert.rejects(verifyRestoredOriginals(target,manifest,env,reader,async()=>rows),/deleted original retained/);
});
