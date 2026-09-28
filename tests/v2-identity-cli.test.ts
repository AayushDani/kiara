import test from 'node:test';
import assert from 'node:assert/strict';
import {identityBindingKey} from '../src/v2/oidc-identities';
import {identityOperationPlan,parseIdentityCommand,runIdentityCommand} from '../scripts/v2-identity';

const issuer='https://id.example.test',subject='synthetic-release-subject',tenantId='synthetic-release-tenant',actorId='synthetic-release-actor';
const env:NodeJS.ProcessEnv={NODE_ENV:'test',KIARA_V2_STORE_MODE:'normalized',KIARA_OIDC_IDENTITY_SOURCE:'mongo',MONGODB_URI:'mongodb://isolated.example.test',MONGODB_DB:'kiara_synthetic_release_db',KIARA_V2_RELEASE_SYNTHETIC_TENANT:tenantId,KIARA_V2_RELEASE_SYNTHETIC_DB:'kiara_synthetic_release_db'};
const base=(phase:'preview'|'apply',action:'provision'|'revoke'='provision',previewHash?:string)=>({phase,action,issuer,subject,tenantId,actorId,expectedVersion:action==='revoke'?1:0,...(previewHash?{previewHash}:{})});
const absent=()=>({bindingId:identityBindingKey(issuer,subject),version:0,status:'absent' as const,tenantId:null,actorId:null});

test('identity CLI parser requires exact fields and one matching preview hash on apply',()=>{
 const args=['--issuer',issuer,'--subject',subject,'--tenant',tenantId,'--actor',actorId,'--expected-version','0'];
 assert.deepEqual(parseIdentityCommand(['preview','provision',...args]),base('preview'));
 assert.throws(()=>parseIdentityCommand(['apply','provision',...args]),/preview hash/i);
 assert.throws(()=>parseIdentityCommand(['preview','provision',...args,'--subject','other']),/duplicate/i);
 assert.throws(()=>parseIdentityCommand(['preview','provision',...args,'--unknown','value']),/unknown/i);
 assert.throws(()=>parseIdentityCommand(['preview','provision',...args,'--expected-version','1']),/duplicate/i);
 assert.throws(()=>parseIdentityCommand(['preview','provision',...args.slice(0,-1),'01']),/safe expected version/i);
 for(const invalid of ['https://operator:secret@id.example.test','https://id.example.test/path?client=kiara','https://id.example.test/path#fragment'])assert.throws(()=>parseIdentityCommand(['preview','provision','--issuer',invalid,...args.slice(2)]),/without credentials, query or fragment/i);
});

test('provision preview binds exact identity, current row and store; apply uses the same hash',async()=>{
 let row:{bindingId:string;version:number;status:'absent'|'active'|'revoked';tenantId:string|null;actorId:string|null}=absent(),writes=0,previews=0;
 const deps={inspect:async()=>({...row}),provision:async(input:{dryRun:boolean})=>{if(input.dryRun)previews++;else{writes++;row={...row,version:1,status:'active',tenantId,actorId};}return {bindingId:row.bindingId,operation:'create',expectedVersion:0,nextVersion:1,changed:!input.dryRun};},revoke:async()=>{throw new Error('unexpected revoke');}} as any;
 const preview=await runIdentityCommand(base('preview'),env,deps);
 assert.equal(preview.subject,subject);assert.equal(preview.tenantId,tenantId);assert.equal(preview.actorId,actorId);assert.equal(preview.operation,'create');assert.equal(preview.currentBinding.status,'absent');assert.equal(preview.changed,false);assert.equal(previews,1);assert.equal(writes,0);
 assert.equal(JSON.stringify(preview).includes('isolated.example.test'),false);
 await assert.rejects(()=>runIdentityCommand({...base('preview'),tenantId:'real-tenant'},env,deps),/exact configured synthetic tenant and isolated Mongo database/);
 await assert.rejects(()=>runIdentityCommand(base('apply','provision','a'.repeat(64)),env,deps),/Preview hash changed/);
 assert.equal(writes,0);
 await assert.rejects(()=>runIdentityCommand(base('apply','provision',preview.previewHash),{...env,MONGODB_DB:'other_db'},deps),/exact configured synthetic tenant and isolated Mongo database/);
 await assert.rejects(()=>runIdentityCommand(base('apply','provision',preview.previewHash),{...env,MONGODB_DB:'kiara',KIARA_V2_RELEASE_SYNTHETIC_DB:'kiara'},deps),/exact configured synthetic tenant and isolated Mongo database/);
 assert.equal(writes,0);
 await assert.rejects(()=>runIdentityCommand({...base('apply','provision',preview.previewHash),tenantId:'real-tenant'},env,deps),/exact configured synthetic tenant and isolated Mongo database/);
 await assert.rejects(()=>runIdentityCommand(base('apply','provision',preview.previewHash),{...env,KIARA_V2_RELEASE_SYNTHETIC_DB:undefined},deps),/exact configured synthetic tenant and isolated Mongo database/);
 assert.equal(writes,0);
 const applied=await runIdentityCommand(base('apply','provision',preview.previewHash),env,deps);
 assert.equal(applied.phase,'applied');assert.equal(applied.changed,true);assert.equal(writes,1);
 await assert.rejects(()=>runIdentityCommand(base('apply','provision',preview.previewHash),env,deps),/version changed/);
});

test('revocation preview binds exact active tenant and actor, and stale or remapped rows fail closed',async()=>{
 const current={bindingId:identityBindingKey(issuer,subject),version:1,status:'active' as const,tenantId,actorId};
 const input=base('preview','revoke');
 const scope={tenantId,database:'kiara_synthetic_release_db'};
 const plan=identityOperationPlan(input,current,'store-fingerprint',scope);
 assert.equal(plan.operation,'revoke');assert.equal(plan.expectedVersion,1);assert.equal(plan.currentBinding.tenantId,tenantId);
 assert.throws(()=>identityOperationPlan({...input,actorId:'other'},current,'store-fingerprint',scope),/different tenant or actor/);
 assert.throws(()=>identityOperationPlan({...input,expectedVersion:2},current,'store-fingerprint',scope),/version changed/);
 assert.notEqual(identityOperationPlan(input,current,'store-fingerprint',{...scope,database:'another_db'}).previewHash,plan.previewHash);
 let writes=0;
 const deps={inspect:async()=>current,provision:async()=>{throw new Error('unexpected provision');},revoke:async(next:{dryRun:boolean})=>{if(!next.dryRun)writes++;return {bindingId:current.bindingId,operation:'revoke',expectedVersion:1,nextVersion:2,changed:!next.dryRun};}} as any;
 const preview=await runIdentityCommand(input,env,deps);
 assert.equal(writes,0);
 await runIdentityCommand(base('apply','revoke',preview.previewHash),env,deps);
 assert.equal(writes,1);
});

test('synthetic Preview identity can target only the exact kiara_v2 Atlas release database',async()=>{
 const releaseTenant='synthetic-kiara-preview',releaseEnv:NodeJS.ProcessEnv={
  ...env,MONGODB_URI:'mongodb+srv://cluster.example.mongodb.net/kiara_v2?retryWrites=true',
  MONGODB_DB:'kiara_v2',KIARA_V2_RELEASE_SYNTHETIC_DB:undefined,KIARA_V2_RELEASE_DB:'kiara_v2',
  KIARA_V2_RELEASE_SYNTHETIC_TENANT:releaseTenant,
 };
 const input={...base('preview'),tenantId:releaseTenant},deps={
  inspect:async()=>absent(),
  provision:async(next:{dryRun:boolean})=>({bindingId:identityBindingKey(issuer,subject),operation:'create',expectedVersion:0,nextVersion:1,changed:!next.dryRun}),
  revoke:async()=>{throw new Error('unexpected revoke');},
 } as any;
 const preview=await runIdentityCommand(input,releaseEnv,deps);
 assert.equal(preview.syntheticScope.database,'kiara_v2');
 assert.equal(preview.syntheticScope.tenantId,releaseTenant);
 const standardEnv={...releaseEnv,MONGODB_URI:'mongodb://shard-a.example.mongodb.net:27017,shard-b.example.mongodb.net:27017/kiara_v2?tls=true'};
 assert.equal((await runIdentityCommand(input,standardEnv,deps)).syntheticScope.database,'kiara_v2');
 const applied=await runIdentityCommand({...input,phase:'apply',previewHash:preview.previewHash},releaseEnv,deps);
 assert.equal(applied.changed,true);
 for(const bad of [
  {...releaseEnv,MONGODB_DB:'kiara'},
  {...releaseEnv,KIARA_V2_RELEASE_DB:undefined},
  {...releaseEnv,KIARA_V2_RELEASE_SYNTHETIC_DB:'kiara_synthetic_other'},
  {...releaseEnv,MONGODB_URI:'mongodb://localhost:27017/kiara_v2?tls=true'},
  {...releaseEnv,MONGODB_URI:'mongodb+srv://cluster.example.mongodb.net/kiara_v2?tlsInsecure=true'},
 ])await assert.rejects(()=>runIdentityCommand(input,bad,deps),/exact configured synthetic tenant/);
 await assert.rejects(()=>runIdentityCommand({...input,tenantId:'real-tenant'},releaseEnv,deps),/exact configured synthetic tenant/);
 await assert.rejects(()=>runIdentityCommand({...input,phase:'apply',previewHash:'a'.repeat(64)},releaseEnv,deps),/Preview hash changed/);
});
