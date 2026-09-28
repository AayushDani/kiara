/** Explicit opt-in integration qualification. This file is deliberately outside *.test.ts. */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {MongoClient,Collection,type Db} from 'mongodb';
import {closeV2Store,digest,emptyWorkspace,readWorkspace,timestamp,transactWorkspace} from '../src/v2/store';
import {closeNormalizedStore,migrateAggregateToNormalized,normalizeWorkspace,normalizedMigrationPlan,purgeNormalizedHistory,readNormalized,rollbackNormalizedToAggregate,transactNormalized} from '../src/v2/normalized-store';
import {closeHybridIndex,mongoHybridAdapter,type HybridChunk} from '../src/v2/hybrid';
import {activateOriginalAliases,closeMongoOriginalStore,legacyOriginalHash,markLegacyOriginalPurged,readMongoOriginal,retainMongoOriginal,purgeMongoOriginal} from '../src/v2/mongo-originals';
import {readOriginal,readPhysicalOriginal,retainOriginal,purgeOriginal} from '../src/v2/objects';
import {applyOriginalAliasTargetReconciliation,applyOriginalCutover,liveMongoOriginalHolders,previewOriginalAliasTargetReconciliation,previewOriginalCutover} from '../src/v2/original-cutover';
import {applySourceDeletion,redactHistoricalRecord,redactHistoricalWorkspace} from '../src/v2/retention';
import type {Action,ActorContext,RecordBase,Source,WorkspaceState} from '../src/v2/contracts';
import type {EffectIntent} from '../src/v2/execution/contracts';

const expectedUri='mongodb://127.0.0.1:27931/?replicaSet=kiaraQualification';
if(process.env.KIARA_QUALIFICATION_MONGO_URI!==expectedUri)throw new Error('Explicit KIARA_QUALIFICATION_MONGO_URI must equal the isolated loopback qualification replica-set URI.');
const databaseName=`kiara_qualification_${randomUUID().replaceAll('-','')}`;
if(!/^kiara_qualification_[a-f0-9]{32}$/.test(databaseName))throw new Error('Unsafe qualification database identity.');
const savedEnv={...process.env},oldFetch=globalThis.fetch;
let client:MongoClient,db:Db;
const evidence={database:databaseName,uri:expectedUri,mongodbVersion:'',binarySha256Verified:false,node:process.version,applicationProcessRestartTested:false,serverRestartTested:false,atlasSearchTested:false,providersCalled:0,databaseDropped:false};
before(async()=>{
 for(const key of Object.keys(process.env))if(/^(KIARA|MONGO|VERCEL|OPENAI|RESEND|TEMPORAL)/.test(key))delete process.env[key];
 Object.assign(process.env,{MONGODB_URI:expectedUri,MONGODB_DB:databaseName,KIARA_V2_STORE_MODE:'aggregate',KIARA_V2_AI_MODE:'local',KIARA_V2_ATLAS_URI:expectedUri,KIARA_ORIGINALS_MODE:'mongo_encrypted',KIARA_ORIGINALS_KEY:'4'.repeat(64)});
 globalThis.fetch=async()=>{throw new Error('Provider calls are forbidden in Mongo qualification');};
 client=new MongoClient(expectedUri,{serverSelectionTimeoutMS:5000,maxPoolSize:20});await client.connect();db=client.db(databaseName);
 const hello=await db.command({hello:1});assert.equal(hello.setName,'kiaraQualification');assert.equal(hello.isWritablePrimary,true);
 const version=await db.command({buildInfo:1});assert.equal(version.version,'8.0.32');evidence.mongodbVersion=version.version;
 await db.createCollection('qualification_identity');await db.collection('qualification_identity').insertOne({databaseName,purpose:'isolated local integration qualification'});
});
after(async()=>{
 await closeHybridIndex();await closeMongoOriginalStore();await closeV2Store();
 if(client){try{if(db?.databaseName!==databaseName||!/^kiara_qualification_[a-f0-9]{32}$/.test(databaseName))throw new Error('Refusing cleanup outside this generated database.');await db.dropDatabase();evidence.databaseDropped=true;}finally{await client.close();}}
 globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);
 console.log('MONGO_QUALIFICATION_EVIDENCE '+JSON.stringify(evidence));
});
const mode=(value:'aggregate'|'normalized')=>{process.env.KIARA_V2_STORE_MODE=value;};
const code=(expected:string)=>(error:unknown)=>(error as {code?:string}).code===expected;
async function freshProcessHash(tenant:string,storageMode:'aggregate'|'normalized'){
 const result=await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',"import {readWorkspace,digest,closeV2Store} from './src/v2/store.ts';try{console.log(digest(await readWorkspace(process.argv[1])));}finally{await closeV2Store();}",tenant],{cwd:process.cwd(),timeout:20000,env:{PATH:process.env.PATH,NODE_ENV:'test',MONGODB_URI:expectedUri,MONGODB_DB:databaseName,KIARA_V2_STORE_MODE:storageMode,KIARA_V2_AI_MODE:'local'}});
 evidence.applicationProcessRestartTested=true;return result.stdout.trim();
}
function fixture(tenantId:string,secret='Synthetic retained terms.'):WorkspaceState {
 const s=emptyWorkspace(tenantId),now=timestamp();s.memberships.push({actorId:'owner',roles:['member','admin','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
 const base=(id:string,sources:string[]=[]):RecordBase=>({id,tenantId,version:1,createdAt:now,updatedAt:now,scope:{kind:'team',actorIds:[]},provenance:{actorId:'owner',sourceIds:sources,description:secret}});
 const source:Source={...base('source'),title:secret,kind:'manual',externalId:null,externalRevision:null,text:secret,contentHash:digest(secret),url:null,status:'active',aclVersion:1,observedAt:now,effectiveAt:null,authority:'draft',originalObjectRef:null};s.sources.push(source);
 s.documents.push({...base('document',['source']),documentId:'document-family',title:secret,body:secret,contentHash:digest(secret),authority:'draft',sourceId:'source',revision:1,parentRevisionId:null,amendsDocumentId:null,status:'current',kind:'draft'});
 const action:Action={...base('action',['source']),matterId:'matter',proposalId:'proposal',kind:'send',title:secret,content:secret,contentHash:digest(secret),recipients:['synthetic@example.test'],destination:null,status:'uncertain',authorizationId:'authorization',providerIdempotencyKey:'stable-provider-key',providerReceipt:'retained-provider-id',completion:null,executionOwner:'v2',leaseUntil:null};s.actions.push(action);
 const actor:ActorContext={tenantId,actorId:'owner',expiresAt:Date.now()+3600000,mode:'authenticated'};
 const intent:EffectIntent={id:'effect-intent',actionId:action.id,tenantId,owner:'v2',actor,actionHash:action.contentHash,proposalHash:'proposal-hash',dependencies:{sourceVersions:{source:1},factVersions:{},documentHashes:{document:digest(secret)},policyVersion:1,scopeHash:'scope-hash'},authorizationId:'authorization',executionDecision:{actorId:'owner',membershipVersion:1,previewHash:'preview-hash',mode:'email',sender:'sender@example.test',approvedAt:now},actionSnapshot:structuredClone(action),adapterId:'synthetic-never-invoked',adapterConfigurationHash:'configuration',idempotencyKey:action.providerIdempotencyKey,status:'uncertain',leaseToken:null,leaseUntil:null,providerReceipt:action.providerReceipt,createdAt:now,updatedAt:now,failure:'PROVIDER_OUTCOME_UNKNOWN',completionArtifact:null};
 s.receipts['execution:action']={hash:digest({id:intent.id,actionHash:intent.actionHash,idempotencyKey:intent.idempotencyKey}),result:{intent}};s.receipts.accepted={hash:'accepted-command',result:{effectId:intent.id}};
 s.outbox.push({id:'effect-outbox',tenantId,kind:'effect_reconcile',aggregateId:action.id,commandId:intent.id,owner:'v2',status:'pending',createdAt:now});
 s.events.push({...base('event',['source']),type:'qualification.fixture',title:secret,detail:secret,matterId:null,recordId:'source',measurement:'fictional_rehearsal'});
 return s;
}
async function seed(tenant:string,secret?:string){mode('aggregate');return transactWorkspace(tenant,s=>Object.assign(s,fixture(tenant,secret)));}
async function reviewedCutover(tenant:string,stateHash:string){const check=await migrateAggregateToNormalized(tenant,stateHash,true);return migrateAggregateToNormalized(tenant,stateHash,false,check.planHash);}
async function reviewedRollback(tenant:string,stateHash:string){const check=await rollbackNormalizedToAggregate(tenant,stateHash,true);return rollbackNormalizedToAggregate(tenant,stateHash,false,check.planHash);}
async function stageInterruptedCutover(state:WorkspaceState){
 const plan=normalizedMigrationPlan(state),migrationId=digest({tenantId:state.tenantId,sourceHash:plan.sourceHash}),image=normalizeWorkspace(state,plan.generation,migrationId);
 await db.collection('v2_normalized_migrations').insertOne({_id:migrationId as never,tenantId:state.tenantId,sourceVersion:state.version,sourceHash:plan.sourceHash,generation:plan.generation,status:'staging',backup:{format:'kiara-v2-backup',createdAt:timestamp(),hash:plan.sourceHash,state},imageHash:digest(image)});
 // This is the real persisted stage boundary after its commit, before head publication.
 for(const [kind,rows] of Object.entries(image.rows))if(rows.length)await db.collection(`v2_records_${kind}`).insertMany(rows as never[]);
 return plan;
}

test('real aggregate CAS, interrupted migration resume, normalized transactions and current-state rollback preserve durable effects',{timeout:120000},async()=>{
 const tenant='cas-and-cutover';await seed(tenant);const start=await readWorkspace(tenant);
 const writes=await Promise.all(Array.from({length:16},(_,i)=>transactWorkspace(tenant,s=>{const value=Number(s.receipts.counter?.result.value||0)+1;s.receipts.counter={hash:String(value),result:{value}};s.receipts[`aggregate-${i}`]={hash:String(i),result:{accepted:true}};return value;})));
 assert.equal(new Set(writes.map(r=>r.result)).size,16);let current=await readWorkspace(tenant);assert.equal(current.receipts.counter.result.value,16);assert.equal(current.version,start.version+16);
 const stale=digest(current);await transactWorkspace(tenant,s=>{s.receipts.drift={hash:'drift',result:{accepted:true}};});await assert.rejects(migrateAggregateToNormalized(tenant,stale,false),code('MIGRATION_SOURCE_CHANGED'));
 current=await readWorkspace(tenant);const plan=await stageInterruptedCutover(current);assert.equal(await db.collection('v2_normalized_heads').findOne({_id:tenant as never}),null);await closeV2Store();
 const cutover=await reviewedCutover(tenant,plan.sourceHash);assert.equal(cutover.dryRun,false);assert.equal((await migrateAggregateToNormalized(tenant,plan.sourceHash,false,cutover.planHash) as {replayed:boolean}).replayed,true);
 await assert.rejects(readWorkspace(tenant),code('STORE_MIGRATED'));await assert.rejects(transactWorkspace(tenant,s=>{s.companyName='Stale writer';}),code('STORE_MIGRATED'));
 mode('normalized');assert.equal(digest(await readWorkspace(tenant)),plan.sourceHash);
 await Promise.all(Array.from({length:12},(_,i)=>transactWorkspace(tenant,s=>{const value=Number(s.receipts.counter.result.value)+1;s.receipts.counter={hash:String(value),result:{value}};s.receipts[`normalized-${i}`]={hash:String(i),result:{accepted:true}};})));
 await transactWorkspace(tenant,s=>{s.memberships[0].revokedAt=timestamp();s.memberships[0].version++;s.tombstones.push({sourceId:'other-deleted-source',deletedAt:timestamp(),reason:'Preserved deletion',backupExpiresAt:null});});
 current=await readWorkspace(tenant);assert.equal(current.receipts.counter.result.value,28);assert.equal(current.actions[0].status,'uncertain');assert.equal(current.actions[0].providerReceipt,'retained-provider-id');
 await closeV2Store();assert.equal(await freshProcessHash(tenant,'normalized'),digest(current));assert.equal(digest(await readWorkspace(tenant)),digest(current));await assert.rejects(rollbackNormalizedToAggregate(tenant,plan.sourceHash,false),code('VERSION_CONFLICT'));
 assert.equal((await rollbackNormalizedToAggregate(tenant,digest(current),true)).dryRun,true);await reviewedRollback(tenant,digest(current));await assert.rejects(readNormalized(tenant),code('STORE_CUTOVER_REQUIRED'));await closeV2Store();mode('aggregate');
 const rolled=await readWorkspace(tenant);assert.deepEqual(rolled,current);assert.equal(rolled.outbox[0].commandId,'effect-intent');assert.ok(rolled.memberships[0].revokedAt);assert.ok(rolled.tombstones.length);assert.equal(Object.keys(rolled.receipts).filter(k=>k.startsWith('normalized-')).length,12);
});

test('normalization and rollback apply reject a cloned state in a different MongoDB database',{timeout:120000},async()=>{
 const tenant='same-state-different-store',secondName=`kiara_qualification_${randomUUID().replaceAll('-','')}`,second=client.db(secondName);
 assert.match(secondName,/^kiara_qualification_[a-f0-9]{32}$/);
 try{
  await seed(tenant);const state=await readWorkspace(tenant),stateHash=digest(state);
  await second.collection<{_id:string;version:number;state:WorkspaceState}>('v2_workspaces').insertOne({_id:tenant,version:state.version,state});
  const firstCheck=await migrateAggregateToNormalized(tenant,stateHash,true);
  await closeV2Store();process.env.MONGODB_DB=secondName;
  const secondCheck=await migrateAggregateToNormalized(tenant,stateHash,true);
  assert.notEqual(secondCheck.planHash,firstCheck.planHash);
  await assert.rejects(migrateAggregateToNormalized(tenant,stateHash,false,firstCheck.planHash),code('NORMALIZATION_PLAN_CHANGED'));
  assert.equal((await second.collection<{_id:string}>('v2_normalized_heads').countDocuments({_id:tenant})),0);
  await second.collection<{_id:string;version:number}>('v2_workspaces').updateOne({_id:tenant},{$set:{version:state.version+1}});
  await assert.rejects(migrateAggregateToNormalized(tenant,stateHash,false,secondCheck.planHash),code('NORMALIZATION_PLAN_CHANGED'));
  await second.collection<{_id:string;version:number}>('v2_workspaces').updateOne({_id:tenant},{$set:{version:state.version}});
  await migrateAggregateToNormalized(tenant,stateHash,false,secondCheck.planHash);
  await closeV2Store();process.env.MONGODB_DB=databaseName;
  await migrateAggregateToNormalized(tenant,stateHash,false,firstCheck.planHash);
  const firstRollback=await rollbackNormalizedToAggregate(tenant,stateHash,true);
  await closeV2Store();process.env.MONGODB_DB=secondName;
  const secondRollback=await rollbackNormalizedToAggregate(tenant,stateHash,true);
  assert.notEqual(secondRollback.planHash,firstRollback.planHash);
  await assert.rejects(rollbackNormalizedToAggregate(tenant,stateHash,false,firstRollback.planHash),code('NORMALIZATION_PLAN_CHANGED'));
  assert.equal((await second.collection('v2_normalized_heads').findOne({_id:tenant as never}))?.mode,'normalized');
  await second.collection<{_id:string;storageFence:{mode:'normalized';generation:string;migrationId:string}}>('v2_workspaces').updateOne({_id:tenant},{$set:{'storageFence.migrationId':'unexpected-owner'}});
  await assert.rejects(rollbackNormalizedToAggregate(tenant,stateHash,false,secondRollback.planHash),code('NORMALIZATION_PLAN_CHANGED'));
  await second.collection<{_id:string;storageFence:{mode:'normalized';generation:string;migrationId:string}}>('v2_workspaces').updateOne({_id:tenant},{$set:{'storageFence.migrationId':digest({tenantId:tenant,sourceHash:stateHash})}});
  await rollbackNormalizedToAggregate(tenant,stateHash,false,secondRollback.planHash);
  assert.equal((await second.collection('v2_normalized_heads').findOne({_id:tenant as never}))?.mode,'aggregate');
 }finally{await closeV2Store();process.env.MONGODB_DB=databaseName;await second.dropDatabase();}
});

test('real concurrent empty-tenant aggregate and normalized bootstraps commit only one owner',{timeout:120000},async()=>{
 mode('aggregate');for(let round=0;round<8;round++){
  const tenant=`bootstrap-${round}`,aggregate=()=>transactWorkspace(tenant,s=>{s.receipts.owner={hash:'aggregate',result:{mode:'aggregate'}};}),normalized=()=>transactNormalized(tenant,s=>{s.receipts.owner={hash:'normalized',result:{mode:'normalized'}};});
  const results=await Promise.allSettled(round%2?[normalized(),aggregate()]:[aggregate(),normalized()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const row=await db.collection('v2_workspaces').findOne({_id:tenant as never}),head=await db.collection('v2_normalized_heads').findOne({_id:tenant as never});assert.ok(row);if(head?.mode==='normalized'){assert.equal(row.storageFence.mode,'normalized');assert.equal((await readNormalized(tenant)).receipts.owner.result.mode,'normalized');}else{assert.equal(row.storageFence,undefined);assert.equal(row.state.receipts.owner.result.mode,'aggregate');}
 }
});

test('real index transactions permanently fence deletion including a writer paused after its snapshot read',{timeout:120000},async()=>{
 const adapter=mongoHybridAdapter(),tenantId='index-tenant',recordId='deleted-record',chunk:HybridChunk={id:'chunk-one',tenantId,entityId:'entity',kind:'source',recordId,recordHash:digest('revision'),offset:0,title:'Synthetic index title',text:'Synthetic index text',protocol:'kiara-atlas-chunks-1',structureVersion:'clauses-definitions-context-v1',embeddingPolicyHash:digest('embedding-policy')};
 await adapter.upsert(chunk,[0.1,0.2]);assert.deepEqual(await adapter.present(tenantId,[chunk.id]),[chunk.id]);
 const original=Collection.prototype.updateOne;let release!:()=>void,entered!:()=>void,paused=false;const gate=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);const fenceId=digest({tenantId,recordId});
 Collection.prototype.updateOne=async function(this:Collection,filter:any,...args:any[]){if(!paused&&this.collectionName==='v2_search_record_fences'&&filter._id===fenceId&&filter.deleted){paused=true;entered();await gate;}return original.call(this,filter,...args as [any,any]);} as typeof Collection.prototype.updateOne;
 try{const late=adapter.upsert({...chunk,id:'late-chunk',recordHash:digest('later-revision')},[0.3,0.4]);await waiting;await adapter.removeRecords!(tenantId,[recordId]);release();await assert.rejects(late,code('INDEX_RECORD_DELETED'));}finally{release?.();Collection.prototype.updateOne=original;}
 assert.equal(await db.collection('v2_search_chunks').countDocuments({tenantId,recordId}),0);assert.equal((await db.collection('v2_search_record_fences').findOne({_id:fenceId as never}))!.deleted,true);await closeHybridIndex();
 await assert.rejects(mongoHybridAdapter().upsert({...chunk,id:'after-client-restart'},[0.5]),code('INDEX_RECORD_DELETED'));assert.equal(await db.collection('v2_search_chunks').countDocuments({tenantId,recordId}),0);
 // A different tenant's same record identity remains independent.
 await mongoHybridAdapter().upsert({...chunk,id:'other-tenant-chunk',tenantId:'other-index-tenant'},[0.1]);assert.deepEqual(await mongoHybridAdapter().present('other-index-tenant',['other-tenant-chunk']),['other-tenant-chunk']);
});

test('real historical generations, migration backups and frozen aggregate erase payload and replay after client restart',{timeout:120000},async()=>{
 const tenant='history-retention',secret='QUALIFICATION_PRIVATE_PAYLOAD_123';await seed(tenant,secret);let state=await readWorkspace(tenant);await reviewedCutover(tenant,digest(state));mode('normalized');
 await transactWorkspace(tenant,s=>{s.actions[0].status='failed';const i=s.receipts['execution:action'].result.intent as unknown as EffectIntent;i.status='failed';s.receipts['post-cutover']={hash:'post',result:{retained:true}};});state=await readWorkspace(tenant);await reviewedRollback(tenant,digest(state));mode('aggregate');await transactWorkspace(tenant,s=>{s.receipts['next-generation']={hash:'next',result:{retained:true}};});state=await readWorkspace(tenant);await reviewedCutover(tenant,digest(state));mode('normalized');
 const actor:ActorContext={tenantId:tenant,actorId:'owner',mode:'authenticated',expiresAt:Date.now()+60000};const deleted=await transactWorkspace(tenant,s=>applySourceDeletion(s,actor,'source')),job=deleted.result;
 const redactors={redactRecord:(kind:string,value:unknown)=>redactHistoricalRecord(kind,value,job),redactWorkspace:(s:WorkspaceState)=>redactHistoricalWorkspace(s,job)};
 const cleaned=await purgeNormalizedHistory(tenant,job.id,redactors);assert.ok(cleaned.records>0);assert.ok(cleaned.archives>=2);assert.equal(cleaned.externalBackupErasureVerified,false);await closeV2Store();assert.equal((await purgeNormalizedHistory(tenant,job.id,redactors)).replayed,true);
 const collections=await db.listCollections().toArray();for(const collection of collections){if(!collection.name.startsWith('v2_'))continue;const rows=await db.collection(collection.name).find({$or:[{tenantId:tenant},{_id:tenant}]} as never).toArray();assert.doesNotMatch(JSON.stringify(rows),new RegExp(secret),collection.name);}
 const current=await readWorkspace(tenant);assert.equal(await freshProcessHash(tenant,'normalized'),digest(current));assert.equal(current.sources[0].text,'');assert.equal(current.documents[0].body,'');assert.equal(current.actions[0].status,'failed');assert.equal((current.receipts['execution:action'].result.intent as unknown as EffectIntent).providerReceipt,'retained-provider-id');assert.ok(current.tombstones.some(t=>t.sourceId==='source'));assert.ok(current.receipts['post-cutover']);
 await reviewedRollback(tenant,digest(current));await closeV2Store();mode('aggregate');assert.doesNotMatch(JSON.stringify(await readWorkspace(tenant)),new RegExp(secret));
});

test('encrypted Mongo originals survive exact readback, duplicate intake and restart; deletion fences concurrent reuse',{timeout:120000},async()=>{
 const tenant='synthetic-original-tenant',bytes=Buffer.alloc(17_000_000,37);
 bytes.write('synthetic-original-only',4096);
 const reference=await retainMongoOriginal(tenant,bytes);
 assert.equal(reference.storage,'mongo_encrypted');assert.equal(reference.bytes,bytes.length);
 assert.deepEqual(await readMongoOriginal(tenant,reference),bytes);
 assert.deepEqual(await retainMongoOriginal(tenant,bytes),reference);
 assert.equal(await db.collection('v2_original_manifests').countDocuments({_id:reference.key as never}),1);
 assert.equal(await db.collection('v2_original_chunks').countDocuments({manifestId:reference.key}),17);
 await closeMongoOriginalStore();assert.deepEqual(await readMongoOriginal(tenant,reference),bytes);
 await assert.rejects(readMongoOriginal('other-tenant',reference),code('ORIGINAL_SCOPE'));
 await purgeMongoOriginal(tenant,reference);
 assert.equal(await db.collection('v2_original_manifests').countDocuments({_id:reference.key as never}),0);
 assert.equal(await db.collection('v2_original_chunks').countDocuments({manifestId:reference.key}),0);
 assert.equal((await db.collection('v2_original_fences').findOne({_id:reference.key as never}))?.deleted,true);
 await assert.rejects(retainMongoOriginal(tenant,bytes),code('ORIGINAL_DELETED'));
 await assert.rejects(readMongoOriginal(tenant,reference),code('ORIGINAL_DELETED'));
 await purgeMongoOriginal(tenant,reference);
 const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex'),racing=Buffer.from('synthetic concurrent upload'),keyId=hash(Buffer.from(process.env.KIARA_ORIGINALS_KEY!,'hex')).slice(0,16);
 const raceRef={...reference,key:`${hash(tenant)}/${hash(racing)}/${keyId}`,sha256:hash(racing),bytes:racing.length,keyId};
 const originalUpdate=Collection.prototype.updateOne;let release!:()=>void,entered!:()=>void,paused=false;const gate=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
 Collection.prototype.updateOne=async function(this:Collection,filter:any,...args:any[]){if(!paused&&this.collectionName==='v2_original_fences'&&filter._id===raceRef.key&&filter.deleted){paused=true;entered();await gate;}return originalUpdate.call(this,filter,...args as [any,any]);} as typeof Collection.prototype.updateOne;
 try{const late=retainMongoOriginal(tenant,racing);await waiting;await purgeMongoOriginal(tenant,raceRef);release();await assert.rejects(late,code('ORIGINAL_DELETED'));}finally{release?.();Collection.prototype.updateOne=originalUpdate;}
 assert.equal(await db.collection('v2_original_manifests').countDocuments({_id:raceRef.key as never}),0);
});

test('synthetic legacy cutover requires exact preview, verifies destination, and leaves alias target held for separate deletion review',{timeout:120000},async()=>{
 const tenant='synthetic-cutover-tenant',dir=await mkdtemp(join(tmpdir(),'kiara-original-cutover-')),bytes=Buffer.from('synthetic cutover original bytes');
 Object.assign(process.env,{KIARA_ORIGINAL_CUTOVER_TENANT:tenant,KIARA_ORIGINALS_DIR:dir,KIARA_ORIGINALS_MODE:'local_encrypted'});
 try{
  const legacy=await retainOriginal(tenant,bytes);assert.equal(legacy.storage,'local_encrypted');
  await transactWorkspace(tenant,s=>{Object.assign(s,fixture(tenant));s.sources[0].originalObjectRef=JSON.stringify(legacy);});
  process.env.KIARA_ORIGINALS_MODE='mongo_encrypted';
  const preview=await previewOriginalCutover(tenant);assert.equal(preview.count,1);assert.equal(preview.entries[0].sourceUri,`file://${join(dir,legacy.key+'.json')}`);assert.equal(preview.entries[0].purgeTarget,preview.entries[0].sourceUri);assert.equal(preview.entries[0].sha256,legacy.sha256);assert.equal(preview.totalBytes,bytes.length);
  await assert.rejects(applyOriginalCutover(tenant,'0'.repeat(64)),code('ORIGINAL_CUTOVER_PREVIEW_CHANGED'));
  const result=await applyOriginalCutover(tenant,preview.previewHash);assert.equal(result.purged,1);assert.deepEqual(result.pendingPurgeHashes,[]);
  await assert.rejects(readPhysicalOriginal(tenant,legacy),e=>(e as NodeJS.ErrnoException).code==='ENOENT');
  assert.deepEqual(await readOriginal(tenant,legacy),bytes);
  assert.equal((await applyOriginalCutover(tenant,preview.previewHash)).purged,1);
  await assert.rejects(purgeOriginal(tenant,legacy),code('ORIGINAL_ALIAS_TARGET_HELD'));
  assert.deepEqual(await readOriginal(tenant,legacy),bytes);
 }finally{await rm(dir,{recursive:true,force:true});delete process.env.KIARA_ORIGINAL_CUTOVER_TENANT;delete process.env.KIARA_ORIGINALS_DIR;process.env.KIARA_ORIGINALS_MODE='mongo_encrypted';}
});

test('two legacy aliases and one native holder prevent one-source deletion from removing their shared Mongo bytes',{timeout:120000},async()=>{
 const tenant='synthetic-shared-original',bytes=Buffer.from('synthetic shared original'),mongo=await retainMongoOriginal(tenant,bytes),tenantHash=createHash('sha256').update(tenant).digest('hex');
 process.env.KIARA_ORIGINAL_CUTOVER_TENANT=tenant;
 const old=(versionId:string)=>({key:`${tenantHash}/${mongo.sha256}`,sha256:mongo.sha256,bytes:mongo.bytes,encryption:'aws-kms' as const,storage:'s3_kms' as const,keyId:'synthetic-kms-key',versionId});
 const first=old('synthetic-v1'),second=old('synthetic-v2');
 const s=fixture(tenant),a=s.sources[0],b={...structuredClone(a),id:'second-alias-source',originalObjectRef:JSON.stringify(second)},c={...structuredClone(a),id:'native-mongo-source',originalObjectRef:JSON.stringify(mongo)};a.originalObjectRef=JSON.stringify(first);s.sources.push(b,c);await transactWorkspace(tenant,state=>Object.assign(state,s));
 try{
  assert.equal(liveMongoOriginalHolders(await readWorkspace(tenant),mongo).length,3);
  const entry=(legacy:ReturnType<typeof old>)=>({legacy,mongo,legacyHash:legacyOriginalHash(legacy),sourceUri:`s3://kiara-synthetic-test/${legacy.key}?versionId=${legacy.versionId}`,purgeTarget:`s3://kiara-synthetic-test/${legacy.key}?versionId=${legacy.versionId}`,purgedAt:null});
  await activateOriginalAliases(tenant,'a'.repeat(64),digest(await readWorkspace(tenant)),[entry(first),entry(second)]);
  await transactWorkspace(tenant,state=>{state.sources.find(x=>x.id===a.id)!.status='deleted';});
  assert.equal(liveMongoOriginalHolders(await readWorkspace(tenant),mongo).length,2);
  await assert.rejects(purgeOriginal(tenant,first),code('ORIGINAL_ALIAS_TARGET_HELD'));
  // A native source can hold the same content-addressed target. Its deletion
  // path must also respect the aliases, even though its physical key differs.
  await transactWorkspace(tenant,state=>{state.sources.find(x=>x.id===c.id)!.status='deleted';});
  assert.equal(liveMongoOriginalHolders(await readWorkspace(tenant),mongo).length,1);
  await assert.rejects(purgeOriginal(tenant,mongo),code('ORIGINAL_ALIAS_TARGET_HELD'));
  assert.deepEqual(await readMongoOriginal(tenant,mongo),bytes);
 }finally{delete process.env.KIARA_ORIGINAL_CUTOVER_TENANT;}
});

test('alias activation cannot publish a reference after concurrent native purge commits',{timeout:120000},async()=>{
 const tenant='synthetic-alias-purge-race',bytes=Buffer.from('synthetic alias purge race'),mongo=await retainMongoOriginal(tenant,bytes),tenantHash=createHash('sha256').update(tenant).digest('hex');
 const legacy={key:`${tenantHash}/${mongo.sha256}`,sha256:mongo.sha256,bytes:mongo.bytes,encryption:'aws-kms' as const,storage:'s3_kms' as const,keyId:'synthetic-kms-key',versionId:'synthetic-v1'};
 const uri=`s3://kiara-synthetic-test/${legacy.key}?versionId=${legacy.versionId}`;
 const entry={legacy,mongo,legacyHash:legacyOriginalHash(legacy),sourceUri:uri,purgeTarget:uri,purgedAt:null};
 process.env.KIARA_ORIGINAL_CUTOVER_TENANT=tenant;
 const originalUpdate=Collection.prototype.updateOne;let resume!:()=>void,purgeEntered!:()=>void,aliasEntered!:()=>void,paused=false;
 const gate=new Promise<void>(resolve=>resume=resolve),purging=new Promise<void>(resolve=>purgeEntered=resolve),aliasing=new Promise<void>(resolve=>aliasEntered=resolve);
 Collection.prototype.updateOne=async function(this:Collection,filter:any,update:any,...args:any[]){
  if(this.collectionName==='v2_original_fences'&&filter._id===mongo.key){
   if(update?.$set?.deleted===true&&!paused){paused=true;const result=await originalUpdate.call(this,filter,update,...args as [any]);purgeEntered();await gate;return result;}
   if(filter.deleted===false)aliasEntered();
  }
  return originalUpdate.call(this,filter,update,...args as [any]);
 } as typeof Collection.prototype.updateOne;
 try{
  const purge=purgeMongoOriginal(tenant,mongo);await purging;
  const activateResult=activateOriginalAliases(tenant,'b'.repeat(64),'c'.repeat(64),[entry]).then(()=>null,error=>error);await aliasing;
  resume();await purge;assert.equal((await activateResult as {code?:string})?.code,'ORIGINAL_DELETED');
  assert.equal(await db.collection('v2_original_aliases').countDocuments({tenantHash,'mongo.key':mongo.key}),0);
  await assert.rejects(readMongoOriginal(tenant,mongo),code('ORIGINAL_DELETED'));
 }finally{resume?.();Collection.prototype.updateOne=originalUpdate;delete process.env.KIARA_ORIGINAL_CUTOVER_TENANT;}
});

test('synthetic alias reconciliation waits for every holder and retention delay, then retires aliases and fences exact bytes',{timeout:120000},async()=>{
 const tenant='synthetic-alias-reconciliation',bytes=Buffer.from('synthetic alias reconciliation'),mongo=await retainMongoOriginal(tenant,bytes),tenantHash=createHash('sha256').update(tenant).digest('hex');
 const old=(versionId:string)=>({key:`${tenantHash}/${mongo.sha256}`,sha256:mongo.sha256,bytes:mongo.bytes,encryption:'aws-kms' as const,storage:'s3_kms' as const,keyId:'synthetic-kms-key',versionId});
 const first=old('synthetic-v1'),second=old('synthetic-v2'),previewId='d'.repeat(64),uri=(ref:ReturnType<typeof old>)=>`s3://kiara-synthetic-test/${ref.key}?versionId=${ref.versionId}`;
 const entry=(legacy:ReturnType<typeof old>)=>({legacy,mongo,legacyHash:legacyOriginalHash(legacy),sourceUri:uri(legacy),purgeTarget:uri(legacy),purgedAt:null});
 process.env.KIARA_ORIGINAL_CUTOVER_TENANT=tenant;mode('normalized');
 try{
  await transactWorkspace(tenant,s=>{Object.assign(s,fixture(tenant));s.sources[0].originalObjectRef=JSON.stringify(first);s.sources.push({...structuredClone(s.sources[0]),id:'second-alias-source',originalObjectRef:JSON.stringify(second)},{...structuredClone(s.sources[0]),id:'native-source',originalObjectRef:JSON.stringify(mongo)});});
  await activateOriginalAliases(tenant,previewId,digest(await readWorkspace(tenant)),[entry(first),entry(second)]);
  await markLegacyOriginalPurged(tenant,previewId,legacyOriginalHash(first));await assert.rejects(previewOriginalAliasTargetReconciliation(tenant,mongo),code('ORIGINAL_LEGACY_PURGE_PENDING'));
  await markLegacyOriginalPurged(tenant,previewId,legacyOriginalHash(second));
  let preview=await previewOriginalAliasTargetReconciliation(tenant,mongo);assert.equal(preview.eligible,false);assert.equal(preview.aliases.length,2);assert.ok(preview.holders.some(x=>x.startsWith('source:')));
  const future=new Date(Date.now()+86400000).toISOString();await transactWorkspace(tenant,s=>{for(const source of s.sources){source.status='deleted';s.tombstones.push({sourceId:source.id,deletedAt:timestamp(),reason:'Synthetic deletion',backupExpiresAt:null});}s.deletionJobs=[{id:'deletion-one',sourceId:'source',sourceIds:['source'],actorId:'owner',scope:{kind:'team',actorIds:[]},requestedAt:timestamp(),records:[],originals:[{reference:JSON.stringify(first),notBefore:future,status:'pending',failureCode:null}],operationalExceptionActionIds:[],indexCleanup:'complete',historicalCleanup:'complete',backupExpiresAt:null,backupStatus:'operator_verification_required'}];});
  preview=await previewOriginalAliasTargetReconciliation(tenant,mongo);assert.equal(preview.eligible,false);assert.ok(preview.holders.includes('deletion:deletion-one'));
  await transactWorkspace(tenant,s=>{s.deletionJobs![0].originals[0].notBefore=new Date(Date.now()-1000).toISOString();});
  preview=await previewOriginalAliasTargetReconciliation(tenant,mongo);assert.equal(preview.eligible,true);assert.deepEqual(preview.holders,[]);
  await transactWorkspace(tenant,s=>{s.receipts.reconciliationDrift={hash:'drift',result:{accepted:true}};});
  await assert.rejects(applyOriginalAliasTargetReconciliation(tenant,mongo,preview.previewHash),code('ORIGINAL_RECONCILIATION_PREVIEW_CHANGED'));
  preview=await previewOriginalAliasTargetReconciliation(tenant,mongo);
  const originalUpdate=Collection.prototype.updateOne;let release!:()=>void,entered!:()=>void,paused=false;const gate=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
  Collection.prototype.updateOne=async function(this:Collection,filter:any,update:any,...args:any[]){if(!paused&&this.collectionName==='v2_normalized_heads'&&filter._id===tenant&&update?.$inc?.retentionEpoch===1){paused=true;entered();await gate;}return originalUpdate.call(this,filter,update,...args as [any]);} as typeof Collection.prototype.updateOne;
  try{const racing=applyOriginalAliasTargetReconciliation(tenant,mongo,preview.previewHash);await waiting;await transactWorkspace(tenant,s=>{s.sources.push({...structuredClone(s.sources[0]),id:'late-native-holder',status:'active',originalObjectRef:JSON.stringify(mongo)});});release();await assert.rejects(racing,code('ORIGINAL_RECONCILIATION_WORKSPACE_CHANGED'));}finally{release?.();Collection.prototype.updateOne=originalUpdate;}
  assert.deepEqual(await readMongoOriginal(tenant,mongo),bytes);
  await transactWorkspace(tenant,s=>{const late=s.sources.find(x=>x.id==='late-native-holder')!;late.status='deleted';s.tombstones.push({sourceId:late.id,deletedAt:timestamp(),reason:'Synthetic deletion',backupExpiresAt:null});});
  preview=await previewOriginalAliasTargetReconciliation(tenant,mongo);
  const result=await applyOriginalAliasTargetReconciliation(tenant,mongo,preview.previewHash);assert.equal(result.deleted,true);assert.equal(result.replayed,false);assert.equal(result.aliasesRetired,2);
  assert.equal(await db.collection('v2_original_manifests').countDocuments({_id:mongo.key as never}),0);assert.equal(await db.collection('v2_original_chunks').countDocuments({manifestId:mongo.key}),0);
  assert.equal(await db.collection('v2_original_aliases').countDocuments({tenantHash,'mongo.key':mongo.key,retiredAt:null}),0);assert.equal(await db.collection('v2_original_aliases').countDocuments({tenantHash,'mongo.key':mongo.key,retiredAt:{$type:'string'}}),2);
  await assert.rejects(readOriginal(tenant,first),code('ORIGINAL_DELETED'));await assert.rejects(readMongoOriginal(tenant,mongo),code('ORIGINAL_DELETED'));
  await purgeOriginal(tenant,first);await purgeOriginal(tenant,second);await purgeMongoOriginal(tenant,mongo);
  assert.equal((await applyOriginalAliasTargetReconciliation(tenant,mongo,preview.previewHash)).replayed,true);
  await assert.rejects(applyOriginalCutover(tenant,previewId),code('ORIGINAL_CUTOVER_ALIAS_RETIRED'));
  await assert.rejects(activateOriginalAliases(tenant,'e'.repeat(64),digest(await readWorkspace(tenant)),[entry(first)]),code('ORIGINAL_DELETED'));
 }finally{delete process.env.KIARA_ORIGINAL_CUTOVER_TENANT;mode('aggregate');}
});

test('cutover preview rejects path traversal and a non-synthetic S3 bucket before source access',{timeout:120000},async()=>{
 const tenant='synthetic-invalid-source',state=fixture(tenant),source=state.sources[0],hash='a'.repeat(64);
 process.env.KIARA_ORIGINAL_CUTOVER_TENANT=tenant;
 try{
  source.originalObjectRef=JSON.stringify({key:`../${hash}`,sha256:hash,bytes:1,encryption:'aes-256-gcm',storage:'local_encrypted',keyId:'b'.repeat(16)});
  await transactWorkspace(tenant,s=>Object.assign(s,state));
  await assert.rejects(previewOriginalCutover(tenant),code('ORIGINAL_CUTOVER_SOURCE'));
  process.env.KIARA_ORIGINALS_S3_BUCKET='customer-production-bucket';
  await transactWorkspace(tenant,s=>{s.sources[0].originalObjectRef=JSON.stringify({key:`${createHash('sha256').update(tenant).digest('hex')}/${hash}`,sha256:hash,bytes:1,encryption:'aws-kms',storage:'s3_kms',keyId:'synthetic-key',versionId:'v1'});});
  await assert.rejects(previewOriginalCutover(tenant),code('OBJECT_STORE_NOT_CONFIGURED'));
 }finally{delete process.env.KIARA_ORIGINAL_CUTOVER_TENANT;delete process.env.KIARA_ORIGINALS_S3_BUCKET;}
});
