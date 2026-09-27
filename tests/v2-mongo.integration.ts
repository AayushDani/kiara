/** Explicit opt-in integration qualification. This file is deliberately outside *.test.ts. */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {MongoClient,Collection,type Db} from 'mongodb';
import {closeV2Store,digest,emptyWorkspace,readWorkspace,timestamp,transactWorkspace} from '../src/v2/store';
import {closeNormalizedStore,migrateAggregateToNormalized,normalizeWorkspace,normalizedMigrationPlan,purgeNormalizedHistory,readNormalized,rollbackNormalizedToAggregate,transactNormalized} from '../src/v2/normalized-store';
import {closeHybridIndex,mongoHybridAdapter,type HybridChunk} from '../src/v2/hybrid';
import {applySourceDeletion,redactHistoricalRecord,redactHistoricalWorkspace} from '../src/v2/retention';
import type {Action,ActorContext,RecordBase,Source,WorkspaceState} from '../src/v2/contracts';
import type {EffectIntent} from '../src/v2/execution/contracts';

const expectedUri='mongodb://127.0.0.1:27931/?replicaSet=kiaraQualification';
if(process.env.KIARA_QUALIFICATION_MONGO_URI!==expectedUri)throw new Error('Explicit KIARA_QUALIFICATION_MONGO_URI must equal the isolated loopback qualification replica-set URI.');
const databaseName=`kiara_qualification_${randomUUID().replaceAll('-','')}`;
if(!/^kiara_qualification_[a-f0-9]{32}$/.test(databaseName))throw new Error('Unsafe qualification database identity.');
const savedEnv={...process.env},oldFetch=globalThis.fetch;
let client:MongoClient,db:Db;
const evidence={database:databaseName,uri:expectedUri,mongodbVersion:'',binarySha256:'f81cb258434d548dca7244d599c82eb339043d8dedd0b1b807870c9d263117f2',node:process.version,applicationProcessRestartTested:false,serverRestartTested:false,atlasSearchTested:false,providersCalled:0,databaseDropped:false};
before(async()=>{
 for(const key of Object.keys(process.env))if(/^(KIARA|MONGO|VERCEL|OPENAI|RESEND|TEMPORAL)/.test(key))delete process.env[key];
 Object.assign(process.env,{MONGODB_URI:expectedUri,MONGODB_DB:databaseName,KIARA_V2_STORE_MODE:'aggregate',KIARA_V2_AI_MODE:'local',KIARA_V2_ATLAS_URI:expectedUri});
 globalThis.fetch=async()=>{throw new Error('Provider calls are forbidden in Mongo qualification');};
 client=new MongoClient(expectedUri,{serverSelectionTimeoutMS:5000,maxPoolSize:20});await client.connect();db=client.db(databaseName);
 const hello=await db.command({hello:1});assert.equal(hello.setName,'kiaraQualification');assert.equal(hello.isWritablePrimary,true);
 const version=await db.command({buildInfo:1});assert.equal(version.version,'8.0.32');evidence.mongodbVersion=version.version;
 await db.createCollection('qualification_identity');await db.collection('qualification_identity').insertOne({databaseName,purpose:'isolated local integration qualification'});
});
after(async()=>{
 await closeHybridIndex();await closeV2Store();
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
 const cutover=await migrateAggregateToNormalized(tenant,plan.sourceHash,false);assert.equal(cutover.dryRun,false);assert.equal((await migrateAggregateToNormalized(tenant,plan.sourceHash,false) as {replayed:boolean}).replayed,true);
 await assert.rejects(readWorkspace(tenant),code('STORE_MIGRATED'));await assert.rejects(transactWorkspace(tenant,s=>{s.companyName='Stale writer';}),code('STORE_MIGRATED'));
 mode('normalized');assert.equal(digest(await readWorkspace(tenant)),plan.sourceHash);
 await Promise.all(Array.from({length:12},(_,i)=>transactWorkspace(tenant,s=>{const value=Number(s.receipts.counter.result.value)+1;s.receipts.counter={hash:String(value),result:{value}};s.receipts[`normalized-${i}`]={hash:String(i),result:{accepted:true}};})));
 await transactWorkspace(tenant,s=>{s.memberships[0].revokedAt=timestamp();s.memberships[0].version++;s.tombstones.push({sourceId:'other-deleted-source',deletedAt:timestamp(),reason:'Preserved deletion',backupExpiresAt:null});});
 current=await readWorkspace(tenant);assert.equal(current.receipts.counter.result.value,28);assert.equal(current.actions[0].status,'uncertain');assert.equal(current.actions[0].providerReceipt,'retained-provider-id');
 await closeV2Store();assert.equal(await freshProcessHash(tenant,'normalized'),digest(current));assert.equal(digest(await readWorkspace(tenant)),digest(current));await assert.rejects(rollbackNormalizedToAggregate(tenant,plan.sourceHash,false),code('VERSION_CONFLICT'));
 assert.equal((await rollbackNormalizedToAggregate(tenant,digest(current),true)).dryRun,true);await rollbackNormalizedToAggregate(tenant,digest(current),false);await assert.rejects(readNormalized(tenant),code('STORE_CUTOVER_REQUIRED'));await closeV2Store();mode('aggregate');
 const rolled=await readWorkspace(tenant);assert.deepEqual(rolled,current);assert.equal(rolled.outbox[0].commandId,'effect-intent');assert.ok(rolled.memberships[0].revokedAt);assert.ok(rolled.tombstones.length);assert.equal(Object.keys(rolled.receipts).filter(k=>k.startsWith('normalized-')).length,12);
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
 const tenant='history-retention',secret='QUALIFICATION_PRIVATE_PAYLOAD_123';await seed(tenant,secret);let state=await readWorkspace(tenant);await migrateAggregateToNormalized(tenant,digest(state),false);mode('normalized');
 await transactWorkspace(tenant,s=>{s.actions[0].status='failed';const i=s.receipts['execution:action'].result.intent as unknown as EffectIntent;i.status='failed';s.receipts['post-cutover']={hash:'post',result:{retained:true}};});state=await readWorkspace(tenant);await rollbackNormalizedToAggregate(tenant,digest(state),false);mode('aggregate');await transactWorkspace(tenant,s=>{s.receipts['next-generation']={hash:'next',result:{retained:true}};});state=await readWorkspace(tenant);await migrateAggregateToNormalized(tenant,digest(state),false);mode('normalized');
 const actor:ActorContext={tenantId:tenant,actorId:'owner',mode:'authenticated',expiresAt:Date.now()+60000};const deleted=await transactWorkspace(tenant,s=>applySourceDeletion(s,actor,'source')),job=deleted.result;
 const redactors={redactRecord:(kind:string,value:unknown)=>redactHistoricalRecord(kind,value,job),redactWorkspace:(s:WorkspaceState)=>redactHistoricalWorkspace(s,job)};
 const cleaned=await purgeNormalizedHistory(tenant,job.id,redactors);assert.ok(cleaned.records>0);assert.ok(cleaned.archives>=2);assert.equal(cleaned.externalBackupErasureVerified,false);await closeV2Store();assert.equal((await purgeNormalizedHistory(tenant,job.id,redactors)).replayed,true);
 const collections=await db.listCollections().toArray();for(const collection of collections){if(!collection.name.startsWith('v2_'))continue;const rows=await db.collection(collection.name).find({$or:[{tenantId:tenant},{_id:tenant}]} as never).toArray();assert.doesNotMatch(JSON.stringify(rows),new RegExp(secret),collection.name);}
 const current=await readWorkspace(tenant);assert.equal(await freshProcessHash(tenant,'normalized'),digest(current));assert.equal(current.sources[0].text,'');assert.equal(current.documents[0].body,'');assert.equal(current.actions[0].status,'failed');assert.equal((current.receipts['execution:action'].result.intent as unknown as EffectIntent).providerReceipt,'retained-provider-id');assert.ok(current.tombstones.some(t=>t.sourceId==='source'));assert.ok(current.receipts['post-cutover']);
 await rollbackNormalizedToAggregate(tenant,digest(current),false);await closeV2Store();mode('aggregate');assert.doesNotMatch(JSON.stringify(await readWorkspace(tenant)),new RegExp(secret));
});
