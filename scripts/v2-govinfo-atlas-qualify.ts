/** Exact public-law source intake on an isolated generated Atlas database. No legal review is inferred. */
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {MongoClient} from 'mongodb';
import {ConnectionString} from 'mongodb-connection-string-url';
import {closeMongoOriginalStore,readMongoOriginal} from '../src/v2/mongo-originals';
import {NORMALIZED_COLLECTIONS} from '../src/v2/normalized-store';
import {inspectGovInfoGranule,previewGovInfoGranule,stageGovInfoGranule} from '../src/v2/legal-reference-govinfo';
import {closeV2Store,readWorkspace,transactWorkspace} from '../src/v2/store';
import type {ActorContext} from '../src/v2/contracts';
import type {OriginalReference} from '../src/v2/objects';

const args=process.argv.slice(2),mode=args[0];
const selection={packageId:'USCODE-2024-title17',granuleId:'USCODE-2024-title17-chap1-sec105',domain:'Synthetic federal copyright source intake'};
const sourceUrl=`https://www.govinfo.gov/content/pkg/${selection.packageId}/html/${selection.granuleId}.htm`;
const inspectedAtlasHostsHash='8259e505073f806ae0ce25f34cd2784f7611b95d937441d0a09c9da3fd4d296d';
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');

function configuration(){
 if(!['--preflight','--run','--cleanup'].includes(mode)||mode!=='--cleanup'&&args.length!==1||mode==='--cleanup'&&args.length!==4)throw new Error('Use --preflight, --run or --cleanup DATABASE TENANT MARKER.');
 const configured=process.env.MONGODB_URI;
 if(!configured||process.env.MONGODB_DB!=='kiara_v2'||process.env.VERCEL||process.env.NODE_ENV==='production'||process.env.KIARA_V2_AUTH_MODE==='oidc'||process.env.KIARA_V2_ORCHESTRATION_MODE==='temporal'||process.env.KIARA_V2_WORKER_HOST)throw new Error('Select the inspected local Atlas v2 target outside a hosted process.');
 const uri=new ConnectionString(configured);
 if(!uri.hosts.length||uri.hosts.some(host=>!host.split(':')[0].endsWith('.mongodb.net'))||sha(JSON.stringify(uri.hosts.map(host=>host.toLowerCase()).sort()))!==inspectedAtlasHostsHash)throw new Error('The Atlas cluster differs from the inspected shared cluster.');
 if(mode==='--run'&&(!process.env.KIARA_GOVINFO_API_KEY||process.env.KIARA_GOVINFO_API_KEY==='DEMO_KEY'))throw new Error('A private GovInfo API key is required for the connected run.');
 return uri;
}

function requireStoppedProcess(host:string,pid:number){
 if(host!==hostname()||!Number.isSafeInteger(pid)||pid<1)throw new Error('Resume cleanup on the originating host after stopping its process.');
 try{process.kill(pid,0);}catch(error){if(typeof error==='object'&&error&&'code' in error&&error.code==='ESRCH')return;throw new Error('The originating process status is uncertain; cleanup refused.');}
 throw new Error('The originating process is still running; cleanup refused.');
}

async function cleanupGenerated(client:MongoClient,databaseName:string,tenantId:string,marker:string,fromRun=false){
 const suffix=/^kiara_legal_([a-f0-9]{32})$/.exec(databaseName)?.[1];
 if(!suffix||tenantId!==`synthetic-legal-${suffix}`||!/^[a-f0-9-]{36}$/.test(marker))throw new Error('Exact generated qualification identifiers are required for cleanup.');
 const db=client.db(databaseName);
 const identity=await db.collection<{_id:string;purpose:string;databaseName:string;tenantId:string;runHost:string;runPid:number}>('qualification_identity').findOne({_id:marker});
 if(!identity||identity.purpose!=='govinfo_atlas_qualification'||identity.databaseName!==databaseName||identity.tenantId!==tenantId)throw new Error('Generated database marker changed; refusing cleanup.');
 if(!fromRun)requireStoppedProcess(identity.runHost,identity.runPid);
 const allowed=new Set(['qualification_identity','v2_workspaces','v2_normalized_heads','v2_original_manifests','v2_original_chunks','v2_original_fences',...NORMALIZED_COLLECTIONS.map(kind=>`v2_records_${kind}`)]);
 const names=(await db.listCollections().toArray()).map(item=>item.name);
 if(names.some(name=>!allowed.has(name))||await db.collection('qualification_identity').countDocuments({})!==1||await db.collection<{_id:string}>('v2_workspaces').countDocuments({_id:{$ne:tenantId}})||await db.collection<{_id:string}>('v2_normalized_heads').countDocuments({_id:{$ne:tenantId}}))throw new Error('Generated database has an unexpected collection or owner; cleanup refused.');
 for(const kind of NORMALIZED_COLLECTIONS)if(await db.collection(`v2_records_${kind}`).countDocuments({tenantId:{$ne:tenantId}}))throw new Error('Generated database has a foreign normalized row; cleanup refused.');
 const tenantHash=sha(tenantId);
 if(await db.collection('v2_original_manifests').countDocuments({tenantHash:{$ne:tenantHash}}))throw new Error('Generated database has a foreign original manifest; cleanup refused.');
 const chunks=await db.collection<{manifestId:string}>('v2_original_chunks').find({},{projection:{manifestId:1}}).toArray();
 const fences=await db.collection<{_id:string}>('v2_original_fences').find({},{projection:{_id:1}}).toArray();
 if(chunks.some(row=>!row.manifestId?.startsWith(`${tenantHash}/`))||fences.some(row=>!row._id.startsWith(`${tenantHash}/`)))throw new Error('Generated database has a foreign original chunk or fence; cleanup refused.');
 await closeV2Store();await closeMongoOriginalStore();
 await db.dropDatabase();
 const cleanupVerified=(await db.listCollections().toArray()).length===0;
 assert.equal(cleanupVerified,true);
 console.log('GOVINFO_ATLAS_CLEANUP '+JSON.stringify({databaseName,dropped:true,cleanupVerified}));
}

async function run(base:ConnectionString){
 // Validate real private-key metadata before any Atlas write.
 const candidate=await inspectGovInfoGranule(selection);
 assert.equal(candidate.sourceUrl,sourceUrl);
 const suffix=randomUUID().replaceAll('-','');
 const databaseName=`kiara_legal_${suffix}`,tenantId=`synthetic-legal-${suffix}`,marker=randomUUID();
 // The URI's original path may be the authentication database; only MONGODB_DB changes.
 Object.assign(process.env,{MONGODB_URI:base.toString(),MONGODB_DB:databaseName,KIARA_ORIGINALS_MODE:'mongo_encrypted',KIARA_ORIGINALS_KEY:randomBytes(32).toString('hex'),KIARA_V2_STORE_MODE:'normalized',KIARA_V2_AI_MODE:'local',KIARA_V2_LEGAL_SOURCE_POLICY:JSON.stringify([{tenantId,urls:[sourceUrl],validUntil:new Date(Date.now()+3600000).toISOString(),maxBytes:100000}])});
 const client=new MongoClient(base.toString(),{serverSelectionTimeoutMS:10000,maxPoolSize:4});
 let marked=false;
 console.log('GOVINFO_ATLAS_RUN_STARTED '+JSON.stringify({databaseName,tenantId,marker,selection:`${selection.packageId}/${selection.granuleId}`}));
 try{
  await client.connect();
  const db=client.db(databaseName);
  assert.equal((await db.listCollections().toArray()).length,0,'The generated database must start empty.');
  await db.collection<{_id:string;purpose:string;databaseName:string;tenantId:string;runHost:string;runPid:number}>('qualification_identity').insertOne({_id:marker,purpose:'govinfo_atlas_qualification',databaseName,tenantId,runHost:hostname(),runPid:process.pid});marked=true;
  const actorId=`synthetic-legal-reviewer-${suffix}`;
  const actor:ActorContext={tenantId,actorId,mode:'authenticated',expiresAt:Date.now()+30*60_000};
  await transactWorkspace(tenantId,state=>{state.memberships.push({actorId,roles:['member','legal_reviewer'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
  const preview=await previewGovInfoGranule(actor,selection);
  assert.equal(preview.candidate.sourceUrl,sourceUrl);
  assert.ok(preview.text.length>0&&preview.bytes>0&&preview.bytes<=100000);
  const staged=await stageGovInfoGranule(actor,selection,{expectedPreviewHash:preview.previewHash});
  const state=await readWorkspace(tenantId);
  const source=state.sources.find(item=>item.id===staged.sourceId),authority=state.legalAuthorities.find(item=>item.id===staged.authorityId);
  assert.ok(source?.originalObjectRef&&authority);
  assert.equal(source.authority,'unknown');assert.equal(source.effectiveAt,null);
  assert.equal(authority.verifiedAt,null);assert.equal(authority.effectiveFrom,null);
  assert.equal(state.coverage.length,0);
  const reference=JSON.parse(source.originalObjectRef) as OriginalReference;
  assert.equal(reference.storage,'mongo_encrypted');
  const original=await readMongoOriginal(tenantId,reference);
  assert.equal(sha(original),staged.rawHash);
  assert.equal(await db.collection('v2_search_chunks').countDocuments({tenantId}),0);
  console.log('GOVINFO_ATLAS_EVIDENCE '+JSON.stringify({databaseName,tenantHash:sha(tenantId),packageId:selection.packageId,granuleId:selection.granuleId,sourceHash:staged.sourceHash,rawHash:staged.rawHash,metadataHash:staged.metadataHash,originalBytes:original.length,exactPreviewBound:true,encryptedOriginalReadback:true,sourceUnverified:true,coverageCount:0,searchChunkCount:0,qualifiedHumanReview:false,hostedRouteVerified:false}));
 }finally{
  try{
   if(marked)await cleanupGenerated(client,databaseName,tenantId,marker,true);
  }finally{await closeV2Store().catch(()=>{});await closeMongoOriginalStore().catch(()=>{});await client.close().catch(()=>{});if(!marked)console.log('GOVINFO_ATLAS_CLEANUP '+JSON.stringify({databaseName,dropped:false,cleanupVerified:false}));}
 }
}

async function main(){
 const uri=configuration();
 if(mode==='--cleanup'){
  const client=new MongoClient(uri.toString(),{serverSelectionTimeoutMS:10000,maxPoolSize:4});
  try{await client.connect();await cleanupGenerated(client,args[1],args[2],args[3]);}finally{await client.close().catch(()=>{});}
  return;
 }
 if(mode==='--preflight'){
  const client=new MongoClient(uri.toString(),{serverSelectionTimeoutMS:10000});
  try{await client.connect();await client.db('kiara_v2').command({ping:1});console.log('GOVINFO_ATLAS_PREFLIGHT '+JSON.stringify({atlasReachable:true,privateKeyPresent:!!process.env.KIARA_GOVINFO_API_KEY&&process.env.KIARA_GOVINFO_API_KEY!=='DEMO_KEY',sourceUrl,providerCalls:0,writes:0}));}finally{await client.close().catch(()=>{});}
 }else await run(uri);
}
main().catch(error=>{console.error('GOVINFO_ATLAS_FAILURE '+JSON.stringify({code:typeof error==='object'&&error&&'code' in error&&typeof error.code==='string'?error.code:'QUALIFICATION_FAILED'}));process.exitCode=1;});
