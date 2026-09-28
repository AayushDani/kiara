import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {seed,TENANT} from '../src/data/fixtures';
import {importLegacySnapshot,exportLegacyArchive,migrationArchiveStatus,reconcileMigrationArchiveOriginal} from '../src/v2/migration';
import {retainOriginal,readOriginal,type OriginalReference} from '../src/v2/objects';
import {readWorkspace,backupWorkspace,restoreWorkspace,digest,emptyWorkspace,transactWorkspace} from '../src/v2/store';

test('migration dry run is inert; archive import is restartable and preserves exact legacy bytes without dispatch ownership',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-'));
 try{
  process.env.KIARA_V2_DATA_DIR=join(dir,'workspaces');process.env.KIARA_ORIGINALS_DIR=join(dir,'originals');delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_ORIGINALS_KEY;process.env.KIARA_V2_AUTH_MODE='local_demo';
  const bytes=Buffer.from(JSON.stringify(seed(),null,2)+'\n');
  const dry=await importLegacySnapshot('tenant-migration',bytes,0,TENANT,null,true);assert.equal(dry.effectOwner,'legacy');assert.equal(dry.version,2);assert.equal(dry.sourceTenantId,TENANT);assert.equal(dry.destinationTenantId,'tenant-migration');assert.equal((await readWorkspace('tenant-migration')).version,0);
  await importLegacySnapshot('tenant-migration',bytes,0,TENANT,dry.sourceHash,false,dry.planHash);const migrated=await readWorkspace('tenant-migration');assert.ok(migrated.migration);assert.equal((migrated.migration.legacyArchive as {legacyTenant:string}).legacyTenant,TENANT);assert.equal(migrated.actions.length,0);assert.equal(migrated.outbox.length,0);assert.ok(bytes.equals(await exportLegacyArchive('tenant-migration')));
  const replay=await importLegacySnapshot('tenant-migration',bytes,migrated.version,TENANT,null,true);await importLegacySnapshot('tenant-migration',bytes,migrated.version,TENANT,replay.sourceHash,false,replay.planHash);assert.equal((await readWorkspace('tenant-migration')).version,migrated.version);
  const changed=Buffer.from(JSON.stringify(seed(2)));await assert.rejects(importLegacySnapshot('tenant-migration',changed,migrated.version,TENANT,digest(Array.from(changed)),false),/different retained/);
  const backup=await backupWorkspace('tenant-migration');assert.equal((await restoreWorkspace(backup,migrated.version,true)).dryRun,true);backup.hash='tampered';await assert.rejects(restoreWorkspace(backup,migrated.version),/checksum/);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('post-retain destination change inventories the exact original and a fresh reviewed plan safely reuses it',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-race-'));
 try{
  Object.assign(process.env,{KIARA_V2_DATA_DIR:join(dir,'workspaces'),KIARA_ORIGINALS_DIR:join(dir,'originals'),KIARA_ORIGINALS_MODE:'local_encrypted',KIARA_V2_AUTH_MODE:'local_demo'});delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_ORIGINALS_KEY;
  const tenant='migration-race',bytes=Buffer.from(JSON.stringify(seed())),reviewed=await importLegacySnapshot(tenant,bytes,0,TENANT,null,true);let retained:OriginalReference|null=null;
  await assert.rejects(importLegacySnapshot(tenant,bytes,0,TENANT,reviewed.sourceHash,false,reviewed.planHash,{afterRetain:async reference=>{retained=reference;await transactWorkspace(tenant,s=>{s.companyName='Concurrent accepted change';});}}),{code:'MIGRATION_PLAN_CHANGED'});
  const status=await migrationArchiveStatus(tenant),state=await readWorkspace(tenant);assert.equal(state.migration,null);assert.equal(status.archives.length,1);assert.equal(status.archives[0].status,'retained');assert.equal(status.archives[0].hasReference,true);assert.equal(status.archives[0].sourceHash,reviewed.sourceHash);assert.deepEqual(await readOriginal(tenant,retained!),bytes);
  const fresh=await importLegacySnapshot(tenant,bytes,state.version,TENANT,null,true);await importLegacySnapshot(tenant,bytes,state.version,TENANT,fresh.sourceHash,false,fresh.planHash,{retain:async()=>{throw new Error('A verified retained reference must be reused.');}});
  assert.equal((await migrationArchiveStatus(tenant)).archives[0].status,'attached');assert.deepEqual(await exportLegacyArchive(tenant),bytes);assert.equal((await readWorkspace(tenant)).outbox.length,0);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('interrupted archive write remains visible until exact manifest reconciliation, with no false deletion claim',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-interrupted-'));
 try{
  Object.assign(process.env,{KIARA_V2_DATA_DIR:join(dir,'workspaces'),KIARA_ORIGINALS_DIR:join(dir,'originals'),KIARA_ORIGINALS_MODE:'local_encrypted',KIARA_V2_AUTH_MODE:'local_demo'});delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_ORIGINALS_KEY;
  const tenant='migration-interrupted',bytes=Buffer.from(JSON.stringify(seed())),reviewed=await importLegacySnapshot(tenant,bytes,0,TENANT,null,true);let retained:OriginalReference|null=null;
  await assert.rejects(importLegacySnapshot(tenant,bytes,0,TENANT,reviewed.sourceHash,false,reviewed.planHash,{afterRetain:async reference=>{retained=reference;throw new Error('Simulated stop after object write');}}),/Simulated stop/);
  let status=await migrationArchiveStatus(tenant);assert.equal(status.archives[0].status,'staging');assert.equal(status.archives[0].hasReference,false);assert.ok(status.archives[0].attemptedAt);assert.equal((await readWorkspace(tenant)).migration,null);
  await assert.rejects(reconcileMigrationArchiveOriginal(tenant,reviewed.sourceHash,{...retained!,bytes:retained!.bytes+1}),{code:'MIGRATION_ARCHIVE_INTEGRITY'});
  await reconcileMigrationArchiveOriginal(tenant,reviewed.sourceHash,retained!);status=await migrationArchiveStatus(tenant);assert.equal(status.archives[0].status,'retained');assert.equal(status.archives[0].hasReference,true);
  const fresh=await importLegacySnapshot(tenant,bytes,status.version,TENANT,null,true);await importLegacySnapshot(tenant,bytes,status.version,TENANT,fresh.sourceHash,false,fresh.planHash,{retain:async()=>{throw new Error('No second write is allowed.');}});assert.deepEqual(await exportLegacyArchive(tenant),bytes);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('archive reconciliation cannot downgrade an intake attached during readback',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-reconcile-race-'));
 try{
  Object.assign(process.env,{KIARA_V2_DATA_DIR:join(dir,'workspaces'),KIARA_ORIGINALS_DIR:join(dir,'originals'),KIARA_ORIGINALS_MODE:'local_encrypted',KIARA_V2_AUTH_MODE:'local_demo'});delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_ORIGINALS_KEY;
  const tenant='migration-reconcile-race',bytes=Buffer.from(JSON.stringify(seed())),reviewed=await importLegacySnapshot(tenant,bytes,0,TENANT,null,true);let retained:OriginalReference|null=null;
  await assert.rejects(importLegacySnapshot(tenant,bytes,0,TENANT,reviewed.sourceHash,false,reviewed.planHash,{afterRetain:async reference=>{retained=reference;throw new Error('Simulated stop');}}),/Simulated stop/);
  await assert.rejects(reconcileMigrationArchiveOriginal(tenant,reviewed.sourceHash,retained!,{afterReadback:async()=>{await transactWorkspace(tenant,s=>{const intake=s.receipts[`migration-archive:${reviewed.sourceHash}`].result.archive as {status:string;reference:string|null};intake.status='attached';intake.reference=JSON.stringify(retained);});}}),{code:'MIGRATION_PLAN_CHANGED'});
  const intake=(await readWorkspace(tenant)).receipts[`migration-archive:${reviewed.sourceHash}`].result.archive as {status:string;reference:string|null};assert.equal(intake.status,'attached');assert.equal(intake.reference,JSON.stringify(retained));
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('an S3 staging archive with no version manifest blocks blind upload retry',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-migration-s3-'));
 try{
  Object.assign(process.env,{KIARA_V2_DATA_DIR:join(dir,'workspaces'),KIARA_ORIGINALS_MODE:'s3_kms',KIARA_V2_AUTH_MODE:'local_demo'});delete process.env.MONGODB_URI;delete process.env.VERCEL;
  const tenant='migration-s3-interrupted',bytes=Buffer.from(JSON.stringify(seed())),reviewed=await importLegacySnapshot(tenant,bytes,0,TENANT,null,true);
  const unknown:OriginalReference={storage:'s3_kms',encryption:'aws-kms',key:'unconfirmed',keyId:'unconfirmed',versionId:'unconfirmed',sha256:'0'.repeat(64),bytes:bytes.length};
  await assert.rejects(importLegacySnapshot(tenant,bytes,0,TENANT,reviewed.sourceHash,false,reviewed.planHash,{retain:async()=>unknown,afterRetain:async()=>{throw new Error('S3 outcome unknown');}}),/S3 outcome unknown/);
  const status=await migrationArchiveStatus(tenant);assert.equal(status.archives[0].status,'staging');assert.equal(status.archives[0].hasReference,false);
  const fresh=await importLegacySnapshot(tenant,bytes,status.version,TENANT,null,true);
  await assert.rejects(importLegacySnapshot(tenant,bytes,status.version,TENANT,fresh.sourceHash,false,fresh.planHash,{retain:async()=>{throw new Error('Unsafe duplicate upload');}}),{code:'MIGRATION_ARCHIVE_REFERENCE_REQUIRED'});
  const different=Buffer.from(JSON.stringify(seed(2))),differentPlan=await importLegacySnapshot(tenant,different,(await readWorkspace(tenant)).version,TENANT,null,true);
  await assert.rejects(importLegacySnapshot(tenant,different,(await readWorkspace(tenant)).version,TENANT,differentPlan.sourceHash,false,differentPlan.planHash,{retain:async()=>{throw new Error('Unreviewed replacement upload');}}),{code:'MIGRATION_ARCHIVE_PENDING'});
  assert.equal((await migrationArchiveStatus(tenant)).archives[0].hasReference,false);assert.equal((await readWorkspace(tenant)).migration,null);
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
  const run=(operation:'migrate-check'|'migrate',hash?:string,planHash?:string,dataDir=join(dir,'workspaces'))=>spawnSync(process.execPath,['--import','tsx',script,operation,'destination',snapshotPath,'0',TENANT,...(hash?[hash]:[]),...(planHash?[planHash]:[])],{cwd:join(dirname(fileURLToPath(import.meta.url)),'..'),env:{...process.env,KIARA_V2_DATA_DIR:dataDir,KIARA_ORIGINALS_DIR:originalsDir,KIARA_V2_STORE_MODE:'',KIARA_ORIGINALS_MODE:'local_encrypted',KIARA_ORIGINALS_KEY:'',MONGODB_URI:'',VERCEL:'',KIARA_V2_AUTH_MODE:'local_demo'},encoding:'utf8'});
  const check=run('migrate-check');assert.equal(check.status,0,check.stderr);const {sourceHash,planHash}=JSON.parse(check.stdout) as {sourceHash:string;planHash:string};
  assert.equal(sourceHash,digest(Array.from(inspected)));
  const missing=run('migrate');assert.equal(missing.status,1);assert.match(missing.stderr,/reviewed source and plan hashes/);
  await writeFile(snapshotPath,replaced);
  const changed=run('migrate',sourceHash,planHash);assert.equal(changed.status,1);assert.match(changed.stderr,/differs from the reviewed dry run/);
  await assert.rejects(stat(originalsDir),{code:'ENOENT'});
  await writeFile(snapshotPath,inspected);
  const switched=run('migrate',sourceHash,planHash,join(dir,'other-workspaces'));assert.equal(switched.status,1);assert.match(switched.stderr,/source or destination differs from the reviewed migration check/);await assert.rejects(stat(originalsDir),{code:'ENOENT'});
  const applied=run('migrate',sourceHash,planHash);assert.equal(applied.status,0,applied.stderr);assert.equal(JSON.parse(applied.stdout).sourceHash,sourceHash);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('restore operator binds the reviewed backup and destination before writing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kiara-v2-restore-plan-'));
 try{
  const backupPath=join(dir,'backup.json'),script=join(dirname(fileURLToPath(import.meta.url)),'../scripts/v2-operator.ts'),state=emptyWorkspace('restore-tenant');state.version=2;state.companyName='Reviewed recovery snapshot';
  const backup={format:'kiara-v2-backup',createdAt:'2026-09-28T00:00:00.000Z',hash:digest(state),state};
  await writeFile(backupPath,JSON.stringify(backup));
  const run=(operation:'restore-check'|'restore',planHash?:string,dataDir=join(dir,'destination'))=>spawnSync(process.execPath,['--import','tsx',script,operation,'restore-tenant',backupPath,'0',...(planHash?[planHash]:[])],{cwd:join(dirname(fileURLToPath(import.meta.url)),'..'),env:{...process.env,KIARA_V2_DATA_DIR:dataDir,KIARA_V2_STORE_MODE:'',MONGODB_URI:'',VERCEL:'',KIARA_V2_AUTH_MODE:'local_demo'},encoding:'utf8'});
  const checked=run('restore-check');assert.equal(checked.status,0,checked.stderr);const planHash=JSON.parse(checked.stdout).planHash as string;
  const missing=run('restore');assert.equal(missing.status,1);assert.match(missing.stderr,/reviewed plan hash/);
  const replacement=structuredClone(backup);replacement.state.companyName='Different recovery snapshot';replacement.hash=digest(replacement.state);await writeFile(backupPath,JSON.stringify(replacement));
  const changed=run('restore',planHash);assert.equal(changed.status,1);assert.match(changed.stderr,/backup or destination differs from the reviewed restore check/);
  await writeFile(backupPath,JSON.stringify(backup));
  const switched=run('restore',planHash,join(dir,'other-destination'));assert.equal(switched.status,1);assert.match(switched.stderr,/backup or destination differs from the reviewed restore check/);
  const applied=run('restore',planHash);assert.equal(applied.status,0,applied.stderr);assert.equal(JSON.parse(applied.stdout).backupHash,digest(backup));
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
