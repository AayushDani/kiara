/** Generated-tenant Atlas/provider qualification. --preflight cannot dispatch or write. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
const suffix=randomUUID().replaceAll('-','');
const tenantId=`synthetic-provider-atlas-${suffix}`;
const marker=randomUUID();
const markerCollection='v2_qualification_runs';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function configuration(){
 if(!['--preflight','--run'].includes(mode))throw new Error('Use --preflight or --run.');
 const uri=process.env.MONGODB_URI;
 if(!uri)throw new Error('An explicit Atlas URI is required.');
 const parsed=new ConnectionString(uri);
 if(!parsed.hosts.length||parsed.hosts.some(host=>!host.split(':')[0].endsWith('.mongodb.net')))throw new Error('Only Atlas hosts are allowed.');
 if(process.env.KIARA_V2_ATLAS_URI&&process.env.KIARA_V2_ATLAS_URI!==uri)throw new Error('The retrieval URI must be the exact normalized-store Atlas URI.');
 if(process.env.VERCEL||process.env.NODE_ENV==='production'||process.env.KIARA_V2_AUTH_MODE==='oidc'||process.env.KIARA_V2_ORCHESTRATION_MODE==='temporal'||process.env.KIARA_V2_WORKER_HOST)throw new Error('This generated-tenant probe cannot run in a hosted process.');
 if(process.env.MONGODB_DB!=='kiara_v2'||!process.env.KIARA_BUDGET_DB||process.env.KIARA_BUDGET_DB==='kiara_v2'||process.env.KIARA_OPENAI_BUDGET_USD!=='50'||process.env.KIARA_V2_STORE_MODE!=='normalized'||process.env.KIARA_V2_RETRIEVAL_MODE!=='atlas'||process.env.KIARA_V2_AI_MODE!=='local')throw new Error('Set the dedicated v2 database, existing separate shared ledger, $50 cap, normalized store, Atlas retrieval and local AI mode explicitly.');
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

async function cleanup(client:MongoClient){
 const db=client.db('kiara_v2'),markers=db.collection<{_id:string;marker:string}> (markerCollection);
 const saved=await markers.findOne({_id:tenantId});
 if(saved?.marker!==marker)throw new Error('Generated-tenant cleanup marker changed; refusing deletion.');
 const state=await readWorkspace(tenantId);
 const jobs=Object.entries(state.receipts).filter(([key])=>key.startsWith('embedding:')).map(([,receipt])=>receipt.result.job as {status?:string;providerDispatched?:boolean});
 const budget=await globalSpendStatus();
 if(budget.blocking_unknown_charges||jobs.some(job=>!['complete','rejected'].includes(job.status||'')||job.status==='rejected'&&job.providerDispatched)){
  console.error('PROVIDER_ATLAS_RECONCILIATION_REQUIRED '+JSON.stringify({tenantId,cleanupAttempted:false}));
  throw new Error('Generated tenant retained for charge reconciliation; no cleanup was attempted.');
 }
 await closeV2Store();await closeHybridIndex();await closeStore();
 const exactId=[{name:'v2_workspaces',filter:{_id:tenantId}},{name:'v2_normalized_heads',filter:{_id:tenantId}}];
 const scoped=['v2_search_chunks','v2_search_record_fences','v2_normalized_redactions','v2_normalized_migrations',...NORMALIZED_COLLECTIONS.map(kind=>`v2_records_${kind}`)];
 for(const item of exactId)await db.collection<{_id:string}>(item.name).deleteMany(item.filter);
 for(const name of scoped)await db.collection(name).deleteMany({tenantId});
 for(const item of exactId)assert.equal(await db.collection<{_id:string}>(item.name).countDocuments(item.filter),0);
 for(const name of scoped)assert.equal(await db.collection(name).countDocuments({tenantId}),0);
 await markers.deleteOne({_id:tenantId,marker});
 assert.equal(await markers.countDocuments({_id:tenantId}),0);
 console.log('PROVIDER_ATLAS_CLEANUP '+JSON.stringify({tenantHash:digest(tenantId),generatedRowsRemoved:true,sharedLedgerRetained:true}));
}

async function run(client:MongoClient,before:Awaited<ReturnType<typeof globalSpendStatus>>){
 const db=client.db('kiara_v2'),markers=db.collection<{_id:string;marker:string}>(markerCollection);
 if(await markers.findOne({_id:tenantId})||await db.collection<{_id:string}>('v2_normalized_heads').findOne({_id:tenantId})||await db.collection<{_id:string}>('v2_workspaces').findOne({_id:tenantId})||await db.collection('v2_search_chunks').findOne({tenantId}))throw new Error('Generated tenant ID unexpectedly exists.');
 await markers.insertOne({_id:tenantId,marker});
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
  const provider:EmbeddingProvider={create:async request=>{if(providerCalls>=2)throw new Error('Two-call provider limit reached.');providerCalls++;return api.embeddings.create(request);}};
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
  console.log('PROVIDER_ATLAS_JOIN_EVIDENCE '+JSON.stringify({tenantHash:digest(tenantId),sourceHash:digest(text),providerCalls,indexedChunks:index.indexed,keywordAndVectorReturnedSameAuthorizedChunk:true,foreignTenantDenied:true,queryReplayNoProviderCall:true,deletionRemovedChunk:true,sharedLedgerRequestsBefore:before.request_count,sharedLedgerRequestsAfter:after.request_count,sharedLedgerSpentBefore:before.spent_usd,sharedLedgerSpentAfter:after.spent_usd,hostedRequestVerified:false}));
 }finally{await cleanup(client);}
}

async function main(){
 const uri=configuration(),client=new MongoClient(uri,{serverSelectionTimeoutMS:10000,maxPoolSize:4});
 try{
  await client.connect();
  const budget=await inspect(client);
  if(mode==='--preflight')console.log('PROVIDER_ATLAS_PREFLIGHT '+JSON.stringify({atlasIndexesReady:true,sharedBudgetUsd:budget.budget_usd,sharedSpentUsd:budget.spent_usd,sharedRequestCount:budget.request_count,blockingUnknownCharges:budget.blocking_unknown_charges,providerKeyPresent:!!process.env.OPENAI_API_KEY,providerCalls:0,writes:0}));
  else await run(client,budget);
 }finally{await closeV2Store().catch(()=>{});await closeHybridIndex().catch(()=>{});await closeStore().catch(()=>{});await client.close().catch(()=>{});}
}
main().catch(error=>{console.error('PROVIDER_ATLAS_FAILURE '+JSON.stringify({code:typeof error==='object'&&error&&'code' in error&&typeof error.code==='string'?error.code:'QUALIFICATION_FAILED'}));process.exitCode=1;});
