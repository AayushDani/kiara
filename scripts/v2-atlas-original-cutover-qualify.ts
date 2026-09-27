/** Connected, generated-tenant Atlas drill. Never accepts an existing database or tenant. */
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MongoClient} from 'mongodb';
import {ConnectionString} from 'mongodb-connection-string-url';
import {applyOriginalAliasTargetReconciliation,applyOriginalCutover,previewOriginalAliasTargetReconciliation,previewOriginalCutover} from '../src/v2/original-cutover';
import {closeMongoOriginalStore,purgeMongoOriginal,readMongoOriginal,retainMongoOriginal} from '../src/v2/mongo-originals';
import {purgeOriginal,readOriginal,readPhysicalOriginal,retainOriginal} from '../src/v2/objects';
import {closeV2Store,digest,readWorkspace,timestamp,transactWorkspace} from '../src/v2/store';
import {applySourceDeletion} from '../src/v2/retention';
import {processDeletionJob} from '../src/v2/retention-worker';
import {purgeExpiredIntakes} from '../src/v2/artifact-intake';

const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const code=(expected:string)=>(error:unknown)=>(error as {code?:string}).code===expected;
const suffix=randomUUID().replaceAll('-','');
const databaseName=`kiara_qualification_${suffix}`;
const tenantId=`synthetic-atlas-cutover-${suffix}`;
const marker=randomUUID();

async function main(){
 if(process.argv.slice(2).join(' ')!=='--synthetic-atlas')throw new Error('Explicit --synthetic-atlas qualification flag is required.');
 const uri=process.env.MONGODB_URI;
 if(!uri)throw new Error('An explicit Atlas MongoDB URI is required.');
 const parsed=new ConnectionString(uri);
 if(!parsed.hosts.length||parsed.hosts.some(host=>!host.split(':')[0].endsWith('.mongodb.net')))throw new Error('The qualification URI must name only Atlas hosts.');
 if(process.env.VERCEL||process.env.NODE_ENV==='production'||process.env.KIARA_V2_AUTH_MODE==='oidc'||process.env.KIARA_V2_ORCHESTRATION_MODE==='temporal'||process.env.KIARA_V2_WORKER_HOST)throw new Error('Refusing to run the generated-database drill in hosted mode.');
 assert.match(databaseName,/^kiara_qualification_[a-f0-9]{32}$/);
 assert.match(tenantId,/^synthetic-atlas-cutover-[a-f0-9]{32}$/);
 const localDir=await mkdtemp(join(tmpdir(),'kiara-atlas-cutover-'));
 const client=new MongoClient(uri,{serverSelectionTimeoutMS:10000,maxPoolSize:4});
 let marked=false,dropped=false,cleanupVerified=false;
 try{
  await client.connect();
  const db=client.db(databaseName);
  assert.deepEqual(await db.listCollections().toArray(),[]);
  await db.collection<{_id:string;purpose:string;tenantId:string}>('qualification_identity').insertOne({_id:marker,purpose:'generated Atlas original cutover drill',tenantId});
  marked=true;
  Object.assign(process.env,{MONGODB_DB:databaseName,KIARA_V2_STORE_MODE:'normalized',KIARA_V2_AI_MODE:'local',KIARA_ORIGINALS_MODE:'local_encrypted',KIARA_ORIGINALS_DIR:localDir,KIARA_ORIGINALS_KEY:randomBytes(32).toString('hex'),KIARA_ORIGINAL_CUTOVER_TENANT:tenantId,KIARA_RETENTION_ORIGINAL_DAYS:'0'});
  const bytes=Buffer.from(`synthetic original cutover ${suffix} ${randomBytes(256).toString('hex')}`);
  const legacy=await retainOriginal(tenantId,bytes);
  assert.equal(legacy.storage,'local_encrypted');
  const now=timestamp();
  await transactWorkspace(tenantId,state=>{state.sources.push({id:'synthetic-source',tenantId,version:1,createdAt:now,updatedAt:now,scope:{kind:'team',actorIds:[]},provenance:{actorId:'synthetic-operator',sourceIds:[],description:'generated cutover drill'},title:'Generated cutover source',kind:'manual',externalId:null,externalRevision:null,text:'Generated cutover source',contentHash:digest('Generated cutover source'),url:null,status:'active',aclVersion:1,observedAt:now,effectiveAt:null,authority:'draft',originalObjectRef:JSON.stringify(legacy)});});
  const preview=await previewOriginalCutover(tenantId);
  assert.equal(preview.database,databaseName);
  assert.equal(preview.count,1);
  assert.equal(preview.totalBytes,bytes.length);
  assert.equal(preview.entries[0].sha256,hash(bytes));
  await assert.rejects(applyOriginalCutover(tenantId,'0'.repeat(64)),code('ORIGINAL_CUTOVER_PREVIEW_CHANGED'));
  const applied=await applyOriginalCutover(tenantId,preview.previewHash);
  assert.equal(applied.activated,true);
  assert.equal(applied.purged,1);
  assert.deepEqual(applied.pendingPurgeHashes,[]);
  await assert.rejects(readPhysicalOriginal(tenantId,legacy),(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT');
  assert.deepEqual(await readOriginal(tenantId,legacy),bytes);
  const replay=await applyOriginalCutover(tenantId,preview.previewHash);
  assert.equal(replay.purged,1);
  await closeMongoOriginalStore();
  await closeV2Store();
  assert.deepEqual(await readOriginal(tenantId,legacy),bytes);
  const manifest=await db.collection('v2_original_cutovers').findOne({previewHash:preview.previewHash});
  assert.equal(manifest?.entries?.length,1);
  const target=manifest.entries[0].mongo;
  assert.deepEqual(await readMongoOriginal(tenantId,target),bytes);
  await assert.rejects(purgeOriginal(tenantId,legacy),code('ORIGINAL_ALIAS_TARGET_HELD'));
  await assert.rejects(purgeMongoOriginal(tenantId,target),code('ORIGINAL_ALIAS_TARGET_HELD'));
  assert.deepEqual(await readMongoOriginal(tenantId,target),bytes);
  assert.equal(await db.collection('v2_original_aliases').countDocuments({tenantHash:hash(Buffer.from(tenantId))}),1);
  assert.equal(await db.collection('v2_original_manifests').countDocuments({_id:target.key}),1);
  assert.equal((await readWorkspace(tenantId)).sources[0].originalObjectRef,JSON.stringify(legacy));
  console.log('ATLAS_ORIGINAL_CUTOVER_EVIDENCE '+JSON.stringify({database:databaseName,tenant:tenantId,previewHash:preview.previewHash,count:preview.count,bytes:bytes.length,sourceHash:hash(bytes),aliasReadbackAfterClientReopen:true,legacyPhysicalPurged:true,replayVerified:true,aliasAndNativePurgeHeld:true,remoteTenantDataRead:false}));
  await transactWorkspace(tenantId,state=>{state.sources.push({...structuredClone(state.sources[0]),id:'synthetic-native-holder',originalObjectRef:JSON.stringify(target)},{...structuredClone(state.sources[0]),id:'synthetic-late-native-holder',originalObjectRef:JSON.stringify(target)});});
  assert.equal((await previewOriginalAliasTargetReconciliation(tenantId,target)).eligible,false);
  const actor={tenantId,actorId:'synthetic-operator',expiresAt:Date.now()+60000,mode:'authenticated' as const};
  await transactWorkspace(tenantId,state=>{applySourceDeletion(state,actor,'synthetic-source');applySourceDeletion(state,actor,'synthetic-native-holder');applySourceDeletion(state,actor,'synthetic-late-native-holder');});
  const lateDue=new Date(Date.now()+86400000).toISOString();
  await transactWorkspace(tenantId,state=>{
   const late=state.deletionJobs!.find(job=>job.sourceId==='synthetic-late-native-holder')!;
   late.originals[0].notBefore=lateDue;
   state.receipts['artifact-intake:synthetic-expired']={hash:'synthetic-expired',result:{intake:{id:'synthetic-expired',actorId:'synthetic-operator',contentHash:target.sha256,bytes:target.bytes,createdAt:timestamp(),expiresAt:new Date(0).toISOString(),reference:JSON.stringify(target),status:'attached',failureCode:null}}};
  });
  const dueNative=(await readWorkspace(tenantId)).deletionJobs!.find(job=>job.sourceId==='synthetic-native-holder')!;
  const delayed=await processDeletionJob(tenantId,dueNative.id);
  assert.equal(delayed.originalsPending,1);
  assert.equal((await readWorkspace(tenantId)).deletionJobs!.find(job=>job.id===dueNative.id)!.originals[0].status,'shared_reference');
  assert.deepEqual(await readMongoOriginal(tenantId,target),bytes);
  const intakeHeld=await purgeExpiredIntakes(tenantId,'synthetic-expired');
  assert.equal(intakeHeld.purged,0);assert.equal(intakeHeld.retained,1);assert.equal(intakeHeld.unresolved,0);
  const delayedPreview=await previewOriginalAliasTargetReconciliation(tenantId,target);
  assert.equal(delayedPreview.eligible,false);
  assert.ok(delayedPreview.holders.some((holder:string)=>holder.startsWith('deletion:')));
  await transactWorkspace(tenantId,state=>{state.deletionJobs!.find(job=>job.sourceId==='synthetic-late-native-holder')!.originals[0].notBefore=new Date(0).toISOString();});
  // Exercise the retained holders found by independent review against normalized Atlas
  // state before allowing target deletion. These are generated receipts, not provider calls.
  await transactWorkspace(tenantId,state=>{
   state.receipts['execution:synthetic-holder']={hash:'synthetic-effect',result:{intent:{status:'uncertain',providerReceipt:JSON.stringify({readback:target}),actionSnapshot:{content:bytes.toString('utf8')},redactedAt:null}}};
   state.receipts['artifact-intake:synthetic-holder']={hash:'synthetic-intake',result:{intake:{status:'staging',contentHash:target.sha256,reference:null}}};
  });
  let held=await previewOriginalAliasTargetReconciliation(tenantId,target);
  assert.equal(held.eligible,false);
  assert.ok(held.holders.includes('effect:execution:synthetic-holder'));
  assert.ok(held.holders.includes('effect:execution:synthetic-holder:content'));
  assert.ok(held.holders.includes('intake:artifact-intake:synthetic-holder:staging'));
  await assert.rejects(applyOriginalAliasTargetReconciliation(tenantId,target,held.previewHash),code('ORIGINAL_ALIAS_TARGET_HELD'));
  await transactWorkspace(tenantId,state=>{delete state.receipts['execution:synthetic-holder'];});
  held=await previewOriginalAliasTargetReconciliation(tenantId,target);
  assert.equal(held.eligible,false);
  assert.deepEqual(held.holders,['intake:artifact-intake:synthetic-holder:staging']);
  await transactWorkspace(tenantId,state=>{delete state.receipts['artifact-intake:synthetic-holder'];});
  const cleanupPreview=await previewOriginalAliasTargetReconciliation(tenantId,target);
  assert.equal(cleanupPreview.database,databaseName);assert.equal(cleanupPreview.eligible,true);assert.equal(cleanupPreview.aliases.length,1);
  const cleaned=await applyOriginalAliasTargetReconciliation(tenantId,target,cleanupPreview.previewHash);
  assert.equal(cleaned.deleted,true);assert.equal(cleaned.replayed,false);
  assert.equal((await applyOriginalAliasTargetReconciliation(tenantId,target,cleanupPreview.previewHash)).replayed,true);
  await assert.rejects(readOriginal(tenantId,legacy),code('ORIGINAL_DELETED'));
  await assert.rejects(readMongoOriginal(tenantId,target),code('ORIGINAL_DELETED'));
  assert.equal(await db.collection('v2_original_manifests').countDocuments({_id:target.key}),0);
  assert.equal(await db.collection('v2_original_chunks').countDocuments({manifestId:target.key}),0);
  assert.equal(await db.collection('v2_original_aliases').countDocuments({tenantHash:hash(Buffer.from(tenantId)),retiredAt:{$type:'string'}}),1);
  const jobs=(await readWorkspace(tenantId)).deletionJobs||[];assert.equal(jobs.length,3);
  const outcomes=[];for(const job of jobs)outcomes.push(await processDeletionJob(tenantId,job.id));
  assert.ok(outcomes.every(x=>x.applicationCleanupComplete&&x.originalsPending===0));
  const intakeCleared=await purgeExpiredIntakes(tenantId,'synthetic-expired');
  assert.equal(intakeCleared.purged,1);
  console.log('ATLAS_ALIAS_RECONCILIATION_EVIDENCE '+JSON.stringify({database:databaseName,tenantHash:hash(Buffer.from(tenantId)),targetHash:hash(Buffer.from(target.key)),previewHash:cleanupPreview.previewHash,aliasesRetired:cleaned.aliasesRetired,retainedBytesDeleted:true,replayVerified:true,retentionJobsComplete:outcomes.length,laterNativeDeadlineHeld:true,expiredAttachedIntakeHeld:true,expiredAttachedIntakeCleared:true,unresolvedEffectReadbackHeld:true,unresolvedEffectContentHeld:true,stagingIntakeHeld:true,managedBackupErasureVerified:false,remoteTenantDataRead:false}));
  const raceBytes=Buffer.from(`generated native purge race ${suffix}`),raceReference=await retainMongoOriginal(tenantId,raceBytes),raceText=raceBytes.toString('utf8');
  await transactWorkspace(tenantId,state=>{state.sources.push({id:'synthetic-race-native',tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:{kind:'team',actorIds:[]},provenance:{actorId:'synthetic-operator',sourceIds:[],description:'generated concurrent retention drill'},title:'Generated race source',kind:'manual',externalId:null,externalRevision:null,text:raceText,contentHash:digest(raceText),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'draft',originalObjectRef:JSON.stringify(raceReference)});});
  await transactWorkspace(tenantId,state=>{applySourceDeletion(state,actor,'synthetic-race-native');});
  const raceJob=(await readWorkspace(tenantId)).deletionJobs!.find(job=>job.sourceId==='synthetic-race-native')!;
  let entered!:()=>void,released!:()=>void,physicalCalls=0;
  const firstEntered=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>released=resolve);
  const firstRun=processDeletionJob(tenantId,raceJob.id,{original:async(t,reference)=>{physicalCalls++;entered();await gate;await purgeOriginal(t,reference);}});
  await Promise.race([firstEntered,firstRun.then(()=>{throw new Error('The first retention worker exited before entering physical purge.');})]);
  try{
   const secondRun=await processDeletionJob(tenantId,raceJob.id,{original:async(t,reference)=>{physicalCalls++;await purgeOriginal(t,reference);}});
   assert.equal(physicalCalls,1);
   assert.equal(secondRun.originalsPending,1);
   assert.deepEqual(await readMongoOriginal(tenantId,raceReference),raceBytes);
  }finally{released();await firstRun;}
  assert.equal((await readWorkspace(tenantId)).deletionJobs!.find(job=>job.id===raceJob.id)!.originals[0].status,'purged');
  await assert.rejects(readMongoOriginal(tenantId,raceReference),code('ORIGINAL_DELETED'));
  console.log('ATLAS_RETENTION_RACE_EVIDENCE '+JSON.stringify({database:databaseName,tenantHash:hash(Buffer.from(tenantId)),originalHash:raceReference.sha256,physicalCalls,secondWorkerHeld:true,firstWorkerCompleted:true,encryptedBytesPurged:true,managedBackupErasureVerified:false,remoteTenantDataRead:false}));
 }finally{
  try{
   await closeMongoOriginalStore().catch(()=>{});
   await closeV2Store().catch(()=>{});
   if(marked){
    const db=client.db(databaseName);
    const exact=await db.collection<{_id:string;purpose:string;tenantId:string}>('qualification_identity').findOne({_id:marker});
    if(exact?.tenantId!==tenantId)throw new Error('Refusing cleanup because the generated database marker changed.');
    await db.dropDatabase();dropped=true;
    cleanupVerified=(await db.listCollections().toArray()).length===0;
   }
  }finally{
   await client.close().catch(()=>{});
   await rm(localDir,{recursive:true,force:true});
   console.log('ATLAS_ORIGINAL_CUTOVER_CLEANUP '+JSON.stringify({database:databaseName,dropped,cleanupVerified}));
  }
 }
}

main().catch(error=>{console.error('ATLAS_ORIGINAL_CUTOVER_FAILURE '+JSON.stringify({code:(error as {code?:string}).code||'QUALIFICATION_FAILED',message:error instanceof Error?error.message:'Unknown qualification failure'}));process.exitCode=1;});
