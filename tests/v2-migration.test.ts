import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {seed,TENANT} from '../src/data/fixtures';
import {importLegacySnapshot,exportLegacyArchive} from '../src/v2/migration';
import {retainOriginal,readOriginal} from '../src/v2/objects';
import {readWorkspace,backupWorkspace,restoreWorkspace,digest} from '../src/v2/store';

test('migration dry run is inert; archive import is restartable and preserves exact legacy bytes without dispatch ownership',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-'));
 try{
  process.env.KIARA_V2_DATA_DIR=join(dir,'workspaces');process.env.KIARA_ORIGINALS_DIR=join(dir,'originals');delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_ORIGINALS_KEY;process.env.KIARA_V2_AUTH_MODE='local_demo';
  const bytes=Buffer.from(JSON.stringify(seed(),null,2)+'\n');
  const dry=await importLegacySnapshot('tenant-migration',bytes,0,TENANT,null,true);assert.equal(dry.effectOwner,'legacy');assert.equal(dry.version,2);assert.equal(dry.sourceTenantId,TENANT);assert.equal(dry.destinationTenantId,'tenant-migration');assert.equal((await readWorkspace('tenant-migration')).version,0);
  await importLegacySnapshot('tenant-migration',bytes,0,TENANT,dry.sourceHash,false);const migrated=await readWorkspace('tenant-migration');assert.ok(migrated.migration);assert.equal((migrated.migration.legacyArchive as {legacyTenant:string}).legacyTenant,TENANT);assert.equal(migrated.actions.length,0);assert.equal(migrated.outbox.length,0);assert.ok(bytes.equals(await exportLegacyArchive('tenant-migration')));
  await importLegacySnapshot('tenant-migration',bytes,migrated.version,TENANT,dry.sourceHash,false);assert.equal((await readWorkspace('tenant-migration')).version,migrated.version);
  const changed=Buffer.from(JSON.stringify(seed(2)));await assert.rejects(importLegacySnapshot('tenant-migration',changed,migrated.version,TENANT,digest(Array.from(changed)),false),/different retained/);
  const backup=await backupWorkspace('tenant-migration');assert.equal((await restoreWorkspace(backup,migrated.version,true)).dryRun,true);backup.hash='tampered';await assert.rejects(restoreWorkspace(backup,migrated.version),/checksum/);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('migration requires the reviewed source tenant and rejects foreign legacy rows before dry run or archive retention',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-identity-'));
 try{
  process.env.KIARA_V2_DATA_DIR=join(dir,'workspaces');process.env.KIARA_ORIGINALS_DIR=join(dir,'originals');delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_ORIGINALS_KEY;process.env.KIARA_V2_AUTH_MODE='local_demo';
  const bytes=Buffer.from(JSON.stringify(seed()));
  for(const dryRun of [true,false])await assert.rejects(importLegacySnapshot('destination',bytes,0,'unexpected-tenant',dryRun?null:digest(Array.from(bytes)),dryRun),{code:'MIGRATION_TENANT_MISMATCH'});
  const foreignWorkflow=JSON.parse(JSON.stringify(seed()));foreignWorkflow.workflows.push({tenant_id:'unexpected-tenant'});
  const foreignEvent=JSON.parse(JSON.stringify(seed()));foreignEvent.events.push({tenant_id:'unexpected-tenant'});
  for(const state of [foreignWorkflow,foreignEvent])for(const dryRun of [true,false]){const mixed=Buffer.from(JSON.stringify(state));await assert.rejects(importLegacySnapshot('destination',mixed,0,TENANT,dryRun?null:digest(Array.from(mixed)),dryRun),{code:'MIGRATION_MIXED_TENANTS'});}
  assert.equal((await readWorkspace('destination')).version,0);await assert.rejects(exportLegacyArchive('destination'),{code:'MIGRATION_REQUIRED'});await assert.rejects(stat(join(dir,'originals')),{code:'ENOENT'});
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('migration apply refuses a same-tenant snapshot replaced after dry run before retaining original bytes',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-hash-'));
 try{
  process.env.KIARA_V2_DATA_DIR=join(dir,'workspaces');process.env.KIARA_ORIGINALS_DIR=join(dir,'originals');delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_ORIGINALS_KEY;process.env.KIARA_V2_AUTH_MODE='local_demo';
  const inspected=Buffer.from(JSON.stringify(seed())),replaced=Buffer.from(JSON.stringify(seed(2)));
  const check=await importLegacySnapshot('destination',inspected,0,TENANT,null,true);
  assert.notEqual(digest(Array.from(replaced)),check.sourceHash);
  await assert.rejects(importLegacySnapshot('destination',replaced,0,TENANT,check.sourceHash,false),{code:'MIGRATION_SOURCE_CHANGED'});
  await assert.rejects(importLegacySnapshot('destination',inspected,0,TENANT,null,false),{code:'MIGRATION_SOURCE_CHANGED'});
  assert.equal((await readWorkspace('destination')).version,0);
  await assert.rejects(stat(join(dir,'originals')),{code:'ENOENT'});
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('migration operator requires the inspected source hash and rejects replacement at the same path',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-cli-'));
 try{
  const snapshotPath=join(dir,'legacy.json'),originalsDir=join(dir,'originals'),inspected=Buffer.from(JSON.stringify(seed())),replaced=Buffer.from(JSON.stringify(seed(2)));
  await writeFile(snapshotPath,inspected);
  const script=join(dirname(fileURLToPath(import.meta.url)),'../scripts/v2-operator.ts');
  const run=(operation:'migrate-check'|'migrate',hash?:string)=>spawnSync(process.execPath,['--import','tsx',script,operation,'destination',snapshotPath,'0',TENANT,...(hash?[hash]:[])],{cwd:join(dirname(fileURLToPath(import.meta.url)),'..'),env:{...process.env,KIARA_V2_DATA_DIR:join(dir,'workspaces'),KIARA_ORIGINALS_DIR:originalsDir,KIARA_V2_STORE_MODE:'',KIARA_ORIGINALS_MODE:'local_encrypted',KIARA_ORIGINALS_KEY:'',MONGODB_URI:'',VERCEL:'',KIARA_V2_AUTH_MODE:'local_demo'},encoding:'utf8'});
  const check=run('migrate-check');assert.equal(check.status,0,check.stderr);const sourceHash=JSON.parse(check.stdout).sourceHash as string;
  assert.equal(sourceHash,digest(Array.from(inspected)));
  const missing=run('migrate');assert.equal(missing.status,1);assert.match(missing.stderr,/reviewed source hash/);
  await writeFile(snapshotPath,replaced);
  const changed=run('migrate',sourceHash);assert.equal(changed.status,1);assert.match(changed.stderr,/differs from the reviewed dry run/);
  await assert.rejects(stat(originalsDir),{code:'ENOENT'});
  await writeFile(snapshotPath,inspected);
  const applied=run('migrate',sourceHash);assert.equal(applied.status,0,applied.stderr);assert.equal(JSON.parse(applied.stdout).sourceHash,sourceHash);
 }finally{await rm(dir,{recursive:true,force:true});}
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
