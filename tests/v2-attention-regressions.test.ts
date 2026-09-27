import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,snapshot} from '../src/v2/service';
import {closeV2Store,readWorkspace,transactWorkspace} from '../src/v2/store';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';
const actor=(id='owner'):ActorContext=>({tenantId:'attention-regression',actorId:id,mode:'authenticated',expiresAt:Date.now()+3600000});
async function send(id:string,c:WorkspaceCommand){const s=await readWorkspace(actor().tenantId);return command(actor(id),{idempotencyKey:crypto.randomUUID(),expectedVersion:s.version,command:c});}
async function isolated(run:()=>Promise<void>){const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-attention-review-'));for(const k of Object.keys(process.env))if(/KIARA|MONGO|VERCEL|OPENAI|RESEND/.test(k))delete process.env[k];Object.assign(process.env,{KIARA_V2_DATA_DIR:dir,KIARA_V2_AI_MODE:'local'});try{await transactWorkspace(actor().tenantId,s=>{s.memberships.push({actorId:'owner',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null},{actorId:'engineer',roles:['member','fact_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});await send('owner',{type:'matter.create',title:'Owned decision',objective:'Keep the unresolved decision owned.',scope:{kind:'team',actorIds:[]}});await run();}finally{await closeV2Store();for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}}
test('uncertain external effects remain required after future work is canceled, and acknowledgment never marks delivery',()=>isolated(async()=>{
 await transactWorkspace(actor().tenantId,s=>{const m=s.matters[0];m.state='canceled';s.actions.push({...m,id:'uncertain-effect',matterId:m.id,proposalId:'proposal',kind:'send',title:'Uncertain notice',content:'Private intended text',contentHash:'hash',recipients:['legal@example.test'],destination:null,status:'uncertain',authorizationId:null,providerIdempotencyKey:'stable',providerReceipt:null,completion:null,executionOwner:'v2',leaseUntil:null});});
 await send('owner',{type:'preference.set',key:'interruptions',value:'digest',target:'personal'});
 const initial=(await snapshot(actor())).attention.items.find(i=>i.kind==='effect')!;assert.equal(initial.required,true);assert.equal(initial.placement,'now');
 await assert.rejects(send('owner',{type:'attention.decide',itemId:initial.id,fingerprint:initial.fingerprint,decision:'dismissed',reason:'Wait until later'}),{code:'REQUIRED_ATTENTION'});
 await send('owner',{type:'attention.decide',itemId:initial.id,fingerprint:initial.fingerprint,decision:'acknowledged',reason:'Investigating provider delivery without repeating the send.'});
 const after=await snapshot(actor());assert.equal(after.attention.items.find(i=>i.id===initial.id)!.acknowledged,true);assert.equal(after.actions[0].status,'uncertain');assert.equal(after.actions[0].completion,null);assert.equal((await snapshot(actor('engineer'))).attention.items.some(i=>i.kind==='effect'),false);
}));
test('accepted routing moves only factual attention; membership change returns the task and invalidates a delegated decision',()=>isolated(async()=>{
 const m=(await snapshot(actor())).matters[0],offered=await send('owner',{type:'delegation.offer',matterId:m.id,expectedMatterVersion:m.version,recipientActorId:'engineer',topics:['product_facts'],validUntil:new Date(Date.now()+86400000).toISOString()}),d=offered.snapshot.delegations[0];
 const accepted=await send('engineer',{type:'delegation.accept',delegationId:d.id,expectedRecordVersion:d.version}),current=accepted.snapshot.delegations[0];await send('owner',{type:'routing.set',delegationId:d.id,expectedRecordVersion:current.version,topic:'product_facts'});
 const delegated=(await snapshot(actor('engineer'))).attention.items.find(i=>i.id===`task:${m.tasks[0].id}`)!;assert.ok(delegated);assert.equal((await snapshot(actor())).attention.items.some(i=>i.id===delegated.id),false);
 await transactWorkspace(actor().tenantId,s=>{s.memberships.find(m=>m.actorId==='engineer')!.version++;});
 assert.equal((await snapshot(actor('engineer'))).attention.items.some(i=>i.id===delegated.id),false);assert.equal((await snapshot(actor())).attention.items.some(i=>i.id===delegated.id),true);
 await assert.rejects(send('engineer',{type:'attention.decide',itemId:delegated.id,fingerprint:delegated.fingerprint,decision:'acknowledged',reason:'Old delegated authority'}),{code:'ATTENTION_CHANGED'});assert.equal((await readWorkspace(actor().tenantId)).matters[0].tasks[0].ownerId,'owner');
}));
