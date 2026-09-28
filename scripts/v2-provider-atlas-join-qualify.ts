/** Generated-tenant Atlas/provider qualification. --preflight cannot dispatch or write. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import OpenAI from 'openai';
import {MongoClient} from 'mongodb';
import {ConnectionString} from 'mongodb-connection-string-url';
import {closeStore} from '../src/data/store';
import {globalSpendStatus} from '../src/server/global-spend';
import {NORMALIZED_COLLECTIONS} from '../src/v2/normalized-store';
import {closeV2Store,digest,readWorkspace,transactWorkspace} from '../src/v2/store';
import {command,snapshot} from '../src/v2/service';
import {authorizedHybridChunks,closeHybridIndex,hybridConfig,mongoHybridAdapter,retrieveHybridEvidence,syncHybridIndex} from '../src/v2/hybrid';
import {processDeletionJob} from '../src/v2/retention-worker';
import type {EmbeddingProvider} from '../src/v2/embeddings';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';

const mode=process.argv.slice(2).join(' ');
const runId='provider-atlas-join-20260927';
const suffix='20260927';
const tenantId=`synthetic-provider-atlas-${suffix}`;
const markerCollection='v2_qualification_runs';
const scopedCollections=['v2_search_chunks','v2_search_record_fences','v2_normalized_redactions','v2_normalized_migrations',...NORMALIZED_COLLECTIONS.map(kind=>`v2_records_${kind}`)];
const inspectedAtlasHostsHash='8259e505073f806ae0ce25f34cd2784f7611b95d937441d0a09c9da3fd4d296d';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
interface RunMarker {_id:string;purpose:'provider_atlas_join';tenantId:string;status:'running'|'cleaning'|'complete';providerDispatches:number;qualified:boolean;createdAt:string;runLeaseUntil:string;runHost:string;runPid:number;cleanupOwner?:string;cleanupLeaseUntil?:string;cleanupHost?:string;cleanupPid?:number;cleanupVerifiedAt?:string}

function requireStoppedProcess(host:string|undefined,pid:number|undefined){
 if(host!==hostname()||!Number.isSafeInteger(pid)||!pid||pid<1)throw new Error('Resume cleanup on the originating host after stopping the prior process.');
 try{process.kill(pid,0);}catch(error){
  if(typeof error==='object'&&error&&'code' in error&&error.code==='ESRCH')return;
  throw new Error('Prior qualification process status is uncertain; cleanup refused.');
 }
 throw new Error('Prior qualification process is still running; stop it before cleanup.');
}

function configuration(){
 if(!['--preflight','--run','--cleanup'].includes(mode))throw new Error('Use --preflight, --run or --cleanup.');
 const uri=process.env.MONGODB_URI;
 if(!uri)throw new Error('An explicit Atlas URI is required.');
 const parsed=new ConnectionString(uri);
 if(!parsed.hosts.length||parsed.hosts.some(host=>!host.split(':')[0].endsWith('.mongodb.net')))throw new Error('Only Atlas hosts are allowed.');
 const hostsHash=createHash('sha256').update(JSON.stringify(parsed.hosts.map(host=>host.toLowerCase()).sort())).digest('hex');
 if(hostsHash!==inspectedAtlasHostsHash)throw new Error('The Atlas host set differs from the inspected shared-ledger cluster.');
 if(process.env.KIARA_V2_ATLAS_URI&&process.env.KIARA_V2_ATLAS_URI!==uri)throw new Error('The retrieval URI must be the exact normalized-store Atlas URI.');
 if(process.env.VERCEL||process.env.NODE_ENV==='production'||process.env.KIARA_V2_AUTH_MODE==='oidc'||process.env.KIARA_V2_ORCHESTRATION_MODE==='temporal'||process.env.KIARA_V2_WORKER_HOST)throw new Error('This generated-tenant probe cannot run in a hosted process.');
 if(process.env.MONGODB_DB!=='kiara_v2'||process.env.KIARA_BUDGET_DB!=='kiara'||process.env.KIARA_OPENAI_BUDGET_USD!=='50'||process.env.KIARA_V2_STORE_MODE!=='normalized'||process.env.KIARA_V2_RETRIEVAL_MODE!=='atlas'||process.env.KIARA_V2_AI_MODE!=='local')throw new Error('Set the dedicated v2 database, inspected kiara shared ledger, $50 cap, normalized store, Atlas retrieval and local AI mode explicitly.');
 const config=hybridConfig();
 if(config.searchIndex!=='kiara_keyword_v1'||config.vectorIndex!=='kiara_vector_v1')throw new Error('Select the exact configured Atlas Search indexes.');
 if(mode==='--run'&&!process.env.OPENAI_API_KEY)throw new Error('The provider credential is required for the two-call run.');
 return uri;
}

async function inspect(client:MongoClient){
 const db=client.db('kiara_v2');
 const indexes=await db.collection('v2_search_chunks').listSearchIndexes().toArray() as Array<{name:string;status?:string;queryable?:boolean}>;
 for(const name of ['kiara_keyword_v1','kiara_vector_v1']){
  const index=indexes.find(row=>row.name===name);
  if(!index||index.status!=='READY'||index.queryable!==true)throw new Error(`Atlas Search index ${name} is not READY and queryable.`);
 }
 const budget=await globalSpendStatus();
 if(budget.budget_usd!==50||budget.spent_usd<24.067081||budget.spent_usd>=50||budget.request_count<569||budget.blocking_unknown_charges||budget.inflight)throw new Error('The existing shared provider ledger is not in a safe settled state under the $50 cap.');
 return budget;
}

async function send(actor:ActorContext,input:WorkspaceCommand){
 return command(actor,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(actor)).version,command:input});
}

async function cleanup(client:MongoClient,fromRun=false){
 const db=client.db('kiara_v2'),markers=db.collection<RunMarker>(markerCollection);
 const saved=await markers.findOne({_id:runId});
 if(!saved||saved.purpose!=='provider_atlas_join'||saved.tenantId!==tenantId||saved.providerDispatches>2)throw new Error('Generated-tenant cleanup marker changed; refusing deletion.');
 const exactId=[{name:'v2_workspaces',filter:{_id:tenantId}},{name:'v2_normalized_heads',filter:{_id:tenantId}}];
 const verifyEmpty=async()=>{
  for(const item of exactId)assert.equal(await db.collection<{_id:string}>(item.name).countDocuments(item.filter),0);
  for(const name of scopedCollections)assert.equal(await db.collection(name).countDocuments({tenantId}),0);
 };
 if(saved.status==='complete'){
  await verifyEmpty();
  console.log('PROVIDER_ATLAS_CLEANUP '+JSON.stringify({runId,tenantHash:digest(tenantId),generatedRowsRemoved:true,sharedLedgerRetained:true,markerRetained:true,qualified:saved.qualified,verificationOnly:true}));
  return;
 }
 const now=new Date().toISOString(),owner=randomUUID();
 if(!fromRun&&saved.status==='running'&&saved.runLeaseUntil>now)throw new Error('The qualification run lease is still active; stop the run and wait for expiry before cleanup.');
 if(!fromRun&&saved.status==='cleaning'&&(!saved.cleanupLeaseUntil||saved.cleanupLeaseUntil>now))throw new Error('The cleanup lease is still active; wait for expiry before resuming cleanup.');
 if(!fromRun&&saved.status==='running')requireStoppedProcess(saved.runHost,saved.runPid);
 if(!fromRun&&saved.status==='cleaning')requireStoppedProcess(saved.cleanupHost,saved.cleanupPid);
 const claim=fromRun
  ? {_id:runId,status:'running' as const}
  : saved.status==='running'
   ? {_id:runId,status:'running' as const,runLeaseUntil:{$lte:now}}
   : {_id:runId,status:'cleaning' as const,cleanupLeaseUntil:{$lte:now}};
 const claimed=await markers.findOneAndUpdate(claim,{$set:{status:'cleaning',cleanupOwner:owner,cleanupLeaseUntil:new Date(Date.now()+30*60_000).toISOString(),cleanupHost:hostname(),cleanupPid:process.pid}},{returnDocument:'after'});
 if(!claimed)throw new Error('Cleanup ownership changed; refusing deletion.');
 console.log('PROVIDER_ATLAS_CLEANUP_STARTED '+JSON.stringify({runId,tenantId,previousStatus:saved.status}));
 const state=await readWorkspace(tenantId);
 const jobs=Object.entries(state.receipts).filter(([key])=>key.startsWith('embedding:')).map(([,receipt])=>receipt.result.job as {status?:string;recoveryPending?:boolean});
 const budget=await globalSpendStatus();
 if(budget.blocking_unknown_charges||budget.inflight||jobs.some(job=>!['complete','rejected'].includes(job.status||'')||job.recoveryPending)){
  console.error('PROVIDER_ATLAS_RECONCILIATION_REQUIRED '+JSON.stringify({runId,tenantId,cleanupAttempted:false}));
  throw new Error('Generated tenant retained for charge reconciliation; no cleanup was attempted.');
 }
 await closeV2Store();await closeHybridIndex();await closeStore();
 for(const item of exactId)await db.collection<{_id:string}>(item.name).deleteMany(item.filter);
 for(const name of scopedCollections)await db.collection(name).deleteMany({tenantId});
 await verifyEmpty();
 const completed=await markers.updateOne({_id:runId,purpose:'provider_atlas_join',tenantId,status:'cleaning',cleanupOwner:owner},{$set:{status:'complete',cleanupVerifiedAt:new Date().toISOString()},$unset:{cleanupOwner:'',cleanupLeaseUntil:'',cleanupHost:'',cleanupPid:''}});
 assert.equal(completed.matchedCount,1);
 console.log('PROVIDER_ATLAS_CLEANUP '+JSON.stringify({runId,tenantHash:digest(tenantId),generatedRowsRemoved:true,sharedLedgerRetained:true,markerRetained:true,qualified:saved.qualified}));
}

async function run(client:MongoClient,before:Awaited<ReturnType<typeof globalSpendStatus>>){
 const db=client.db('kiara_v2'),markers=db.collection<RunMarker>(markerCollection);
 const occupied=await Promise.all(scopedCollections.map(name=>db.collection(name).findOne({tenantId},{projection:{_id:1}})));
 if(await markers.findOne({_id:runId})||await db.collection<{_id:string}>('v2_normalized_heads').findOne({_id:tenantId})||await db.collection<{_id:string}>('v2_workspaces').findOne({_id:tenantId})||occupied.some(Boolean))throw new Error('Qualification run or generated tenant already exists; use marker-checked --cleanup if needed.');
 await markers.insertOne({_id:runId,purpose:'provider_atlas_join',tenantId,status:'running',providerDispatches:0,qualified:false,createdAt:new Date().toISOString(),runLeaseUntil:new Date(Date.now()+30*60_000).toISOString(),runHost:hostname(),runPid:process.pid});
 console.log('PROVIDER_ATLAS_RUN_STARTED '+JSON.stringify({runId,tenantId,providerCallLimit:2}));
 let providerCalls=0;
 try{
  const actorId=`synthetic-reviewer-${suffix}`;
  const actor:ActorContext={tenantId,actorId,mode:'authenticated',expiresAt:Date.now()+30*60_000};
  await transactWorkspace(tenantId,state=>{state.memberships.push({actorId,roles:['member','admin','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
  const text=`Synthetic project ${suffix} requires thirty days advance written notice before a new processor is enabled.`;
  const added=await send(actor,{type:'document.add',title:`Synthetic processor notice ${suffix}`,body:text,authority:'executed',kind:'agreement'});
  const documentId=String(added.result.documentId),sourceId=String(added.result.sourceId);
  const message=await send(actor,{type:'message.send',text:`What advance written notice does synthetic project ${suffix} require before a new processor?`});
  const conversationId=String(message.result.conversationId),userMessageId=message.snapshot.messages.filter(x=>x.role==='user').at(-1)!.id;
  const api=new OpenAI({apiKey:process.env.OPENAI_API_KEY!,maxRetries:0,timeout:45000});
  const provider:EmbeddingProvider={create:async request=>{
   const claimed=await markers.findOneAndUpdate({_id:runId,status:'running',runLeaseUntil:{$gt:new Date().toISOString()},providerDispatches:{$lt:2}},{$inc:{providerDispatches:1}},{returnDocument:'after'});
   if(!claimed)throw new Error('Durable two-call provider limit reached.');
   providerCalls++;
   return api.embeddings.create(request);
  }};
  const index=await syncHybridIndex(actor,[documentId],{provider});
  assert.equal(index.indexed,1);
  const state=await readWorkspace(tenantId),chunks=authorizedHybridChunks(state,actor).filter(chunk=>chunk.recordId===documentId);
  assert.equal(chunks.length,1);
  const adapter=mongoHybridAdapter();
  const first=await retrieveHybridEvidence(actor,conversationId,userMessageId,'provider-atlas-join',{provider});
  assert.equal(first.version,'v2-atlas-hybrid-1');
  const queryJob=(await readWorkspace(tenantId)).receipts['embedding:query:provider-atlas-join']?.result.job as {vector?:number[];status?:string}|undefined;
  if(queryJob?.status!=='complete'||queryJob.vector?.length!==1536)throw new Error('The exact query embedding receipt is incomplete.');
  const input={config:hybridConfig(),tenantId,entityId:state.entityId,chunkIds:[chunks[0].id],question:message.snapshot.messages.filter(x=>x.role==='user').at(-1)!.text,vector:queryJob.vector};
  let found=false;
  for(let attempt=0;attempt<18;attempt++){
   const result=await adapter.search(input);
   if(result.keywordIds.includes(chunks[0].id)&&result.vectorIds.includes(chunks[0].id)){found=true;break;}
   await delay(5000);
  }
  assert.equal(found,true,'Both Atlas search branches must return the authorized provider-vector chunk.');
  const replay=await retrieveHybridEvidence(actor,conversationId,userMessageId,'provider-atlas-join',{provider});
  assert.ok(replay.evidence.some(item=>item.sourceId===sourceId));
  assert.equal(providerCalls,2);
  const foreign=await adapter.search({...input,tenantId:`foreign-${suffix}`});
  assert.deepEqual(foreign,{keywordIds:[],vectorIds:[]});
  const after=await globalSpendStatus();
  assert.equal(after.blocking_unknown_charges,0);
  assert.ok(after.request_count>=before.request_count+2);
  const deleted=await send(actor,{type:'source.revoke',sourceId,reason:'Generated qualification cleanup',delete:true});
  const job=(await readWorkspace(tenantId)).deletionJobs?.find(item=>item.sourceId===sourceId);
  assert.ok(job&&deleted.snapshot.deletions.length);
  await processDeletionJob(tenantId,job.id);
  assert.deepEqual(await adapter.present(tenantId,[chunks[0].id]),[]);
  const qualified=await markers.updateOne({_id:runId,status:'running',providerDispatches:2},{$set:{qualified:true}});
  assert.equal(qualified.matchedCount,1);
  console.log('PROVIDER_ATLAS_JOIN_EVIDENCE '+JSON.stringify({tenantHash:digest(tenantId),sourceHash:digest(text),providerCalls,indexedChunks:index.indexed,keywordAndVectorReturnedSameAuthorizedChunk:true,foreignTenantDenied:true,queryReplayNoProviderCall:true,deletionRemovedChunk:true,sharedLedgerRequestsBefore:before.request_count,sharedLedgerRequestsAfter:after.request_count,sharedLedgerSpentBefore:before.spent_usd,sharedLedgerSpentAfter:after.spent_usd,hostedRequestVerified:false}));
 }finally{await cleanup(client,true);}
}

async function main(){
 const uri=configuration(),client=new MongoClient(uri,{serverSelectionTimeoutMS:10000,maxPoolSize:4});
 try{
  await client.connect();
  if(mode==='--cleanup')await cleanup(client);
  else{
   const budget=await inspect(client);
   if(mode==='--preflight')console.log('PROVIDER_ATLAS_PREFLIGHT '+JSON.stringify({atlasIndexesReady:true,sharedBudgetUsd:budget.budget_usd,sharedSpentUsd:budget.spent_usd,sharedRequestCount:budget.request_count,blockingUnknownCharges:budget.blocking_unknown_charges,runMarker:(await client.db('kiara_v2').collection<RunMarker>(markerCollection).findOne({_id:runId}))?.status||'absent',providerKeyPresent:!!process.env.OPENAI_API_KEY,providerCalls:0,writes:0}));
   else await run(client,budget);
  }
 }finally{await closeV2Store().catch(()=>{});await closeHybridIndex().catch(()=>{});await closeStore().catch(()=>{});await client.close().catch(()=>{});}
}
main().catch(error=>{console.error('PROVIDER_ATLAS_FAILURE '+JSON.stringify({code:typeof error==='object'&&error&&'code' in error&&typeof error.code==='string'?error.code:'QUALIFICATION_FAILED'}));process.exitCode=1;});
