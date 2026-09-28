import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest,readWorkspace,transactWorkspace,closeV2Store} from '../src/v2/store';
import {processLegalReference} from '../src/v2/orchestration/legal';
import {processLocalOutboxOnce} from '../src/v2/orchestration/conversations';
import {dispatchOutbox} from '../src/v2/orchestration/temporal';
import {processLegalWatch} from '../src/v2/legal-maintenance';
async function isolated(run:(ref:{tenantId:string;aggregateId:string;outboxId:string})=>Promise<void>){
 const before={...process.env},oldFetch=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'kiara-legal-worker-'));
 for(const k of Object.keys(process.env))if(/KIARA|MONGO|VERCEL|OPENAI|RESEND|TEMPORAL/.test(k))delete process.env[k];process.env.KIARA_V2_DATA_DIR=dir;globalThis.fetch=async()=>{throw Error('Unexpected live source request');};
 const policy={tenantId:'legal-worker',urls:['https://law.example.test/source'],validUntil:new Date(Date.now()+86400000).toISOString(),maxBytes:1000};process.env.KIARA_V2_LEGAL_SOURCE_POLICY=JSON.stringify([policy]);
 try{await transactWorkspace('legal-worker',s=>{const base={tenantId:s.tenantId,version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),scope:{kind:'team' as const,actorIds:[]},provenance:{actorId:'reviewer',sourceIds:[],description:'Synthetic source watch'}};s.memberships.push({actorId:'reviewer',roles:['member','legal_reviewer'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});s.sources.push({...base,id:'source',title:'Current law',kind:'legal',externalId:null,externalRevision:null,text:'Unchanged source',contentHash:digest('Unchanged source'),url:policy.urls[0],status:'active',aclVersion:1,observedAt:base.createdAt,effectiveAt:null,authority:'unknown',originalObjectRef:null});s.legalAuthorities.push({...base,id:'authority',title:'Named authority',sourceUrl:policy.urls[0],jurisdiction:'Synthetic',domain:'privacy',authorityType:'statute',publishedAt:null,effectiveFrom:null,effectiveUntil:null,verifiedAt:null,reviewOwnerId:'reviewer',sourceId:'source'});s.legalWatches=[{...base,id:'watch',authorityId:'authority',ownerId:'reviewer',membershipVersion:1,sourceUrl:policy.urls[0],policyHash:digest(policy),intervalHours:48,active:true,nextCheckAt:base.createdAt,lastCheckedAt:null,lastObservedHash:null,status:'scheduled',failureCode:null,leaseToken:null,leaseUntil:null}];s.outbox.push({id:'outbox',tenantId:s.tenantId,kind:'legal_watch',aggregateId:'watch',commandId:'watch',status:'pending',owner:'v2',createdAt:base.createdAt});});await run({tenantId:'legal-worker',aggregateId:'watch',outboxId:'outbox'});}finally{await closeV2Store();globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
}
test('legal maintenance local worker reads the approved source and keeps a bounded durable watch without approving applicability',()=>isolated(async ref=>{
 let reads=0;const processor=(tenant:string,id:string)=>processLegalWatch(tenant,id,{fetcher:async(url,options)=>{reads++;assert.equal(String(url),'https://law.example.test/source');assert.equal(options?.redirect,'error');return new Response('Unchanged source',{headers:{'content-type':'text/plain'}});}}),deferred=new Map<string,number>();
 const result=await processLocalOutboxOnce(ref.tenantId,{deferred,legalProcessor:value=>processLegalReference(value,processor)});assert.equal(result.waiting,1);assert.equal(reads,1);const s=await readWorkspace(ref.tenantId);assert.equal(s.outbox[0].status,'pending');assert.equal(s.legalWatches![0].status,'scheduled');assert.equal(s.legalChanges?.length||0,0);assert.equal(s.approvals.length,0);assert.ok(deferred.get('outbox')!<=Date.now()+24*3600000);
 await processLocalOutboxOnce(ref.tenantId,{deferred,legalProcessor:value=>processLegalReference(value,processor)});assert.equal(reads,1);
 await transactWorkspace(ref.tenantId,state=>{state.legalWatches![0].active=false;state.legalWatches![0].status='stopped';});deferred.clear();await processLocalOutboxOnce(ref.tenantId,{deferred,legalProcessor:value=>processLegalReference(value,processor)});assert.equal((await readWorkspace(ref.tenantId)).outbox[0].status,'dispatched');assert.equal(reads,1);
}));
test('legal watch managed references contain no URL and mismatched tenant/job cannot reach processor',()=>isolated(async ref=>{
 const seen:unknown[]=[];await dispatchOutbox(ref.tenantId,{signal:async(value,kind)=>{assert.equal(kind,'legal_watch');seen.push(value);}});assert.deepEqual(seen,[ref]);assert.ok(!JSON.stringify(seen).includes('law.example'));
 const result=await processLegalReference(ref,async()=>({complete:false,status:'blocked',nextCheckMs:Infinity}));assert.deepEqual(result,{status:'waiting',nextCheckMs:3600000});let calls=0;await assert.rejects(processLegalReference({...ref,aggregateId:'other'},async()=>{calls++;return {complete:true,status:'stopped',nextCheckMs:0};}),{code:'OUTBOX_NOT_FOUND'});assert.equal(calls,0);
}));
