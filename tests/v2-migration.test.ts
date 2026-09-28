import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seed,TENANT} from '../src/data/fixtures';
import {importLegacySnapshot,exportLegacyArchive} from '../src/v2/migration';
import {retainOriginal,readOriginal} from '../src/v2/objects';
import {readWorkspace,backupWorkspace,restoreWorkspace} from '../src/v2/store';

test('migration dry run is inert; archive import is restartable and preserves exact legacy bytes without dispatch ownership',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-'));
 try{
  process.env.KIARA_V2_DATA_DIR=join(dir,'workspaces');process.env.KIARA_ORIGINALS_DIR=join(dir,'originals');delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_ORIGINALS_KEY;process.env.KIARA_V2_AUTH_MODE='local_demo';
  const bytes=Buffer.from(JSON.stringify(seed(),null,2)+'\n');
  const dry=await importLegacySnapshot('tenant-migration',bytes,0,TENANT,true);assert.equal(dry.effectOwner,'legacy');assert.equal(dry.version,2);assert.equal(dry.sourceTenantId,TENANT);assert.equal(dry.destinationTenantId,'tenant-migration');assert.equal((await readWorkspace('tenant-migration')).version,0);
  await importLegacySnapshot('tenant-migration',bytes,0,TENANT,false);const migrated=await readWorkspace('tenant-migration');assert.ok(migrated.migration);assert.equal((migrated.migration.legacyArchive as {legacyTenant:string}).legacyTenant,TENANT);assert.equal(migrated.actions.length,0);assert.equal(migrated.outbox.length,0);assert.ok(bytes.equals(await exportLegacyArchive('tenant-migration')));
  await importLegacySnapshot('tenant-migration',bytes,migrated.version,TENANT,false);assert.equal((await readWorkspace('tenant-migration')).version,migrated.version);
  await assert.rejects(importLegacySnapshot('tenant-migration',Buffer.from(JSON.stringify(seed(2))),migrated.version,TENANT,false),/different retained/);
  const backup=await backupWorkspace('tenant-migration');assert.equal((await restoreWorkspace(backup,migrated.version,true)).dryRun,true);backup.hash='tampered';await assert.rejects(restoreWorkspace(backup,migrated.version),/checksum/);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('migration requires the reviewed source tenant and rejects foreign legacy rows before dry run or archive retention',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-identity-'));
 try{
  process.env.KIARA_V2_DATA_DIR=join(dir,'workspaces');process.env.KIARA_ORIGINALS_DIR=join(dir,'originals');delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_ORIGINALS_KEY;process.env.KIARA_V2_AUTH_MODE='local_demo';
  const bytes=Buffer.from(JSON.stringify(seed()));
  for(const dryRun of [true,false])await assert.rejects(importLegacySnapshot('destination',bytes,0,'unexpected-tenant',dryRun),{code:'MIGRATION_TENANT_MISMATCH'});
  const foreignWorkflow=JSON.parse(JSON.stringify(seed()));foreignWorkflow.workflows.push({tenant_id:'unexpected-tenant'});
  const foreignEvent=JSON.parse(JSON.stringify(seed()));foreignEvent.events.push({tenant_id:'unexpected-tenant'});
  for(const state of [foreignWorkflow,foreignEvent])for(const dryRun of [true,false])await assert.rejects(importLegacySnapshot('destination',Buffer.from(JSON.stringify(state)),0,TENANT,dryRun),{code:'MIGRATION_MIXED_TENANTS'});
  assert.equal((await readWorkspace('destination')).version,0);await assert.rejects(exportLegacyArchive('destination'),{code:'MIGRATION_REQUIRED'});await assert.rejects(stat(join(dir,'originals')),{code:'ENOENT'});
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('originals use authenticated encryption and cannot be read across tenant scope',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-originals-'));
 try{
  process.env.KIARA_ORIGINALS_DIR=dir;process.env.KIARA_V2_AUTH_MODE='local_demo';delete process.env.KIARA_ORIGINALS_KEY;delete process.env.VERCEL;
  const bytes=Buffer.from('Signed original: exact spaces  and newline\n');const reference=await retainOriginal('tenant-a',bytes);assert.ok((await readOriginal('tenant-a',reference)).equals(bytes));
  assert.equal((await readFile(join(dir,reference.key+'.json'),'utf8')).includes('Signed original'),false);
  await assert.rejects(readOriginal('tenant-b',reference),/another scope/);
  await assert.rejects(readOriginal('tenant-a',{...reference,bytes:reference.bytes+1}),/integrity|decryption/);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('same-byte upload after key rotation preserves old ciphertext and both recoverable references',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-key-rotation-'));
 try{
  Object.assign(process.env,{KIARA_ORIGINALS_DIR:dir,KIARA_V2_AUTH_MODE:'local_demo',KIARA_ORIGINALS_MODE:'local_encrypted',KIARA_ORIGINALS_KEY:'11'.repeat(32)});delete process.env.VERCEL;
  const bytes=Buffer.from('Immutable original retained across key rotation.');const first=await retainOriginal('tenant-a',bytes),ciphertext=await readFile(join(dir,first.key+'.json'));
  const replay=await retainOriginal('tenant-a',bytes);assert.deepEqual(replay,first);assert.ok((await readFile(join(dir,first.key+'.json'))).equals(ciphertext));
  process.env.KIARA_ORIGINALS_KEY='22'.repeat(32);const second=await retainOriginal('tenant-a',bytes);assert.notEqual(second.key,first.key);assert.ok((await readOriginal('tenant-a',second)).equals(bytes));assert.ok((await readFile(join(dir,first.key+'.json'))).equals(ciphertext));
  await assert.rejects(readOriginal('tenant-a',first),/matching encryption key/);process.env.KIARA_ORIGINALS_KEY='11'.repeat(32);assert.ok((await readOriginal('tenant-a',first)).equals(bytes));
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});
