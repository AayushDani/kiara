import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {closeV2Store,digest,readWorkspace,transactWorkspace} from '../src/v2/store';
import {command} from '../src/v2/service';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';
import type {Installation} from '../src/v2/integrations/config';
import {acceptWebhook} from '../src/v2/integrations/intake';
import {getSlackReply} from '../src/v2/integrations/slack';
import {processSlackReply} from '../src/v2/integrations/slack-replies';
import {scopeAudienceHash,slackAudienceEligible} from '../src/v2/integrations/slack-scope';
import type {ProviderFetch} from '../src/v2/integrations/read';
import {dispatchOutbox} from '../src/v2/orchestration/temporal';
import {processSlackReference} from '../src/v2/orchestration/slack';
import {processLocalOutboxOnce} from '../src/v2/orchestration/conversations';
import {slackDeliveryViews} from '../src/v2/integrations/slack-status';

const owner:ActorContext={tenantId:'slack-tenant',actorId:'owner',mode:'authenticated',expiresAt:Date.now()+3600000};
const scope={kind:'team' as const,actorIds:['owner','integration']};
async function send(c:WorkspaceCommand,key=crypto.randomUUID()){const s=await readWorkspace(owner.tenantId);return command(owner,{idempotencyKey:key,expectedVersion:s.version,command:c});}
async function isolated(run:(i:Installation,conversationId:string)=>Promise<void>){
 const before={...process.env},oldFetch=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'kiara-slack-'));
 for(const key of Object.keys(process.env))if(/KIARA|MONGO|VERCEL|OPENAI|RESEND|TEMPORAL/.test(key))delete process.env[key];
 Object.assign(process.env,{KIARA_V2_DATA_DIR:dir,KIARA_V2_AI_MODE:'local',TEST_SLACK_TOKEN:'synthetic-token',TEST_SLACK_SECRET:'synthetic-secret'});globalThis.fetch=async()=>{throw Error('Unexpected live provider request');};
 try{
  await transactWorkspace(owner.tenantId,s=>{for(const actorId of ['owner','integration','other'])s.memberships.push({actorId,roles:actorId==='integration'?['integration']:['member','admin','business_owner','fact_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
  const conversationId=String((await send({type:'conversation.create',title:'Selected Slack continuity',scope})).result.conversationId);
  const i:Installation={id:'slack-installed',provider:'slack',tenantId:owner.tenantId,actorId:'integration',enabled:true,tokenEnv:'TEST_SLACK_TOKEN',webhookSecretEnv:'TEST_SLACK_SECRET',resources:['C1','D1'],scope,slackTeamId:'T1',slackReplies:{botUserId:'UBOT',validUntil:new Date(Date.now()+86400000).toISOString(),bindings:[{channel:'C1',threadTs:'1770000000.001',conversationId,actorId:'owner',slackUserId:'U1'}]}};
  process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([i]);await run(i,conversationId);
 }finally{await closeV2Store();globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
}
function signed(eventId='E1',event:Record<string,unknown>={},team='T1'){
 const payload={type:'event_callback',team_id:team,event_id:eventId,event:{type:'message',channel:'C1',thread_ts:'1770000000.001',ts:'1770000001.001',user:'U1',text:'What should we check for retention?',...event}},raw=Buffer.from(JSON.stringify(payload)),ts=String(Math.floor(Date.now()/1000));
 return {raw,headers:new Headers({'x-slack-request-timestamp':ts,'x-slack-signature':`v0=${createHmac('sha256','synthetic-secret').update(`v0:${ts}:`).update(raw).digest('hex')}`})};
}
async function intake(i:Installation,eventId='E1',event:Record<string,unknown>={}){const r=signed(eventId,event);return acceptWebhook(i.id,r.headers,r.raw);}
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function provider(options:{lostAck?:boolean;hidden?:boolean;beforeAdmission?:()=>Promise<void>;tamper?:boolean}={}){
 const posts:any[]=[];const fetcher:ProviderFetch=async(url,init)=>{
  const u=new URL(String(url));assert.equal(u.origin,'https://slack.com');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-token');
  if(u.pathname==='/api/auth.test')return json({ok:true,team_id:'T1',user_id:'UBOT',bot_id:'B1'});
  if(u.pathname==='/api/conversations.info'){await options.beforeAdmission?.();return json({ok:true,channel:{id:u.searchParams.get('channel'),is_member:true,is_archived:false}});}
  if(u.pathname==='/api/chat.postMessage'){assert.equal(init?.method,'POST');const body=JSON.parse(String(init.body));posts.push(body);assert.equal(body.reply_broadcast,false);assert.equal(body.mrkdwn,false);assert.equal(body.unfurl_links,false);assert.equal(body.parse,'none');assert.deepEqual(Object.keys(body.metadata.event_payload),['id']);if(options.lostAck)throw Error('Accepted before acknowledgement lost');return json({ok:true,channel:body.channel,ts:'1770000002.001'});}
  if(u.pathname==='/api/conversations.replies'){assert.equal(u.searchParams.get('ts'),'1770000000.001');const p=posts[0];return json({ok:true,messages:!p||options.hidden?[]:[{user:'UBOT',ts:'1770000002.001',thread_ts:p.thread_ts,text:options.tamper?'Contradictory provider text':p.text,metadata:p.metadata}]});}
  throw Error('Unexpected provider route');
 };return {posts,fetcher};
}
test('signed selected thread continues one conversation, pins lineage and delivers exact reply once with verified readback',()=>isolated(async(i,cid)=>{
 const result=await intake(i),again=await intake(i);assert.equal(result.continued,true);assert.equal(again.replyId,result.replyId);
 let s=await readWorkspace(owner.tenantId);assert.equal(s.conversations.length,1);assert.equal(s.messages.length,2);assert.equal(s.messages[0].channel,'slack');assert.ok(s.messages[0].provenance.sourceIds.includes(String(result.sourceId)));assert.ok(s.messages[1].provenance.sourceIds.includes(String(result.sourceId)));assert.equal(s.outbox.filter(o=>o.kind==='slack_reply').length,1);
 const io=provider();assert.equal((await processSlackReply(owner.tenantId,String(result.replyId),io)).status,'verified');await processSlackReply(owner.tenantId,String(result.replyId),io);assert.equal(io.posts.length,1);assert.equal(io.posts[0].channel,'C1');assert.equal(io.posts[0].thread_ts,'1770000000.001');
 s=await readWorkspace(owner.tenantId);const receipt=getSlackReply(s,String(result.replyId));assert.equal(receipt.conversationId,cid);assert.equal(receipt.providerTs,'1770000002.001');assert.equal(receipt.contentHash,digest(io.posts[0].text));assert.ok(!JSON.stringify(receipt).includes(s.messages[1].text));
 await send({type:'message.send',conversationId:cid,text:'Continue on the web'});s=await readWorkspace(owner.tenantId);assert.equal(s.outbox.filter(o=>o.kind==='slack_reply').length,1);
}));
test('bot messages never loop back into source ingestion and signed unmapped identities cannot impersonate the bound actor',()=>isolated(async(i)=>{
 assert.equal((await intake(i,'EBOT',{user:'UBOT',bot_id:'B1'})).ignored,true);assert.equal((await readWorkspace(owner.tenantId)).sources.length,0);
 await assert.rejects(intake(i,'EWRONG',{user:'U2'}),{code:'SLACK_USER_UNMAPPED'});assert.equal((await readWorkspace(owner.tenantId)).messages.length,0);
 const request=signed('ETEAM',{},'TOTHER');await assert.rejects(acceptWebhook(i.id,request.headers,request.raw),{code:'WEBHOOK_INVALID'});
 await assert.rejects(intake(i,'ECHANNEL',{channel:'COTHER'}),{code:'INSTALLATION_SCOPE'});
}));
test('historical web content cannot be reclassified as a Slack audience and canonical audience recursion rejects private dependencies',()=>isolated(async(i,cid)=>{
 await send({type:'message.send',conversationId:cid,text:'Already discussed privately accessible information.'});await assert.rejects(intake(i),{code:'SLACK_BINDING_REQUIRES_EMPTY_CONVERSATION'});
 assert.equal(scopeAudienceHash(scope),scopeAudienceHash({...scope,actorIds:[...scope.actorIds].reverse()}));
}));
test('destination retrieval excludes an actor private contract and company fact before forming a local answer',()=>isolated(async(i,cid)=>{
 await send({type:'document.add',title:'Private retention secret',body:'SUPER_PRIVATE_CONTRACT_573 retention is seven days.',authority:'executed',scope:{kind:'private',actorIds:['owner']}});
 const f=await send({type:'fact.propose',predicate:'private_secret',value:'SUPER_PRIVATE_FACT_987',practice:'live'});
 await transactWorkspace(owner.tenantId,s=>{const fact=s.facts.find(x=>x.id===f.result.factId)!;fact.scope={kind:'private',actorIds:['owner']};fact.status='confirmed';fact.confirmedBy='owner';fact.confirmedAt=new Date().toISOString();});
 await intake(i);const s=await readWorkspace(owner.tenantId),conversation=s.conversations.find(c=>c.id===cid)!;assert.equal(slackAudienceEligible(s,conversation,s.documents[0]),false);assert.equal(slackAudienceEligible(s,conversation,s.facts[0]),false);assert.ok(!s.messages.filter(m=>m.role==='assistant').some(m=>/SUPER_PRIVATE/.test(m.text)));
}));
test('lost acknowledgement reconciles by opaque metadata and exact bot/thread/content, never by absence or resend',()=>isolated(async(i)=>{
 const result=await intake(i),io=provider({lostAck:true});assert.equal((await processSlackReply(owner.tenantId,String(result.replyId),io)).status,'verified');assert.equal(io.posts.length,1);
 const second=await intake(i,'E2',{ts:'1770000003.001'}),unknown=provider({lostAck:true,hidden:true});assert.equal((await processSlackReply(owner.tenantId,String(second.replyId),unknown)).status,'uncertain');await processSlackReply(owner.tenantId,String(second.replyId),unknown);assert.equal(unknown.posts.length,1);
}));
test('configuration and actor membership changes during asynchronous preflight prevent the first provider post',()=>isolated(async(i)=>{
 const first=await intake(i),io=provider({beforeAdmission:async()=>{process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([{...i,enabled:false}]);}});assert.equal((await processSlackReply(owner.tenantId,String(first.replyId),io)).status,'blocked');assert.equal(io.posts.length,0);
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([i]);const next=await intake(i,'E2',{ts:'1770000003.001'}),member=provider({beforeAdmission:async()=>{await transactWorkspace(owner.tenantId,s=>{s.memberships.find(m=>m.actorId==='owner')!.version++;});}});assert.equal((await processSlackReply(owner.tenantId,String(next.replyId),member)).status,'blocked');assert.equal(member.posts.length,0);
}));
test('source edit or deletion after accepted input blocks unsent reply; mismatched provider readback stays uncertain',()=>isolated(async(i)=>{
 const first=await intake(i);await transactWorkspace(owner.tenantId,s=>{s.sources.find(x=>x.id===first.sourceId)!.version++;});const io=provider();assert.equal((await processSlackReply(owner.tenantId,String(first.replyId),io)).status,'blocked');assert.equal(io.posts.length,0);
 const next=await intake(i,'E2',{ts:'1770000003.001'}),tampered=provider({tamper:true});assert.equal((await processSlackReply(owner.tenantId,String(next.replyId),tampered)).status,'uncertain');await processSlackReply(owner.tenantId,String(next.replyId),tampered);assert.equal(tampered.posts.length,1);
}));
test('DM bindings keep the exact destination and concurrent workers can admit only one post',()=>isolated(async(i)=>{
 i.slackReplies!.bindings[0].channel='D1';process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([i]);const result=await intake(i,'EDM',{channel:'D1'});
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});const io=provider({beforeAdmission:async()=>{entered();await gate;}}),first=processSlackReply(owner.tenantId,String(result.replyId),io);await started;
 const concurrent=await processSlackReply(owner.tenantId,String(result.replyId),io);assert.equal(concurrent.status,'prepared');assert.equal(io.posts.length,0);release();assert.equal((await first).status,'verified');assert.equal(io.posts.length,1);assert.equal(io.posts[0].channel,'D1');
}));
test('outbox dispatch and local worker carry only reply references and reject substituted message identity',()=>isolated(async(i)=>{
 const result=await intake(i),s=await readWorkspace(owner.tenantId),outbox=s.outbox.find(o=>o.kind==='slack_reply')!,ref={tenantId:s.tenantId,aggregateId:String(result.replyId),outboxId:outbox.id};
 const seen:unknown[]=[];await dispatchOutbox(s.tenantId,{signal:async(value,kind)=>{if(kind==='slack_reply')seen.push(value);}});assert.deepEqual(seen,[ref]);assert.deepEqual(Object.keys(seen[0] as object).sort(),['aggregateId','outboxId','tenantId']);
 await assert.rejects(processSlackReference(ref,async()=>({id:'other',status:'verified',nextCheckMs:0})),{code:'SLACK_REPLY_IDENTITY_MISMATCH'});
 await transactWorkspace(s.tenantId,state=>{state.outbox.find(o=>o.id===outbox.id)!.status='pending';});const io=provider();await processLocalOutboxOnce(s.tenantId,{slackProcessor:value=>processSlackReference(value,(tenant,id)=>processSlackReply(tenant,id,io))});assert.equal((await readWorkspace(s.tenantId)).outbox.find(o=>o.id===outbox.id)!.status,'dispatched');assert.equal(io.posts.length,1);
}));
test('answer dependency changes during preflight block stale local facts and superseded document heads',()=>isolated(async(i)=>{
 const added=await send({type:'document.add',title:'Retention clause',body:'Retention clause says forty days.',authority:'executed',scope}),result=await intake(i);
 const changed=provider({beforeAdmission:async()=>{await transactWorkspace(owner.tenantId,s=>{const document=s.documents.find(d=>d.id===added.result.documentId)!;s.documents.push({...document,id:'replacement-head',parentRevisionId:document.id,revision:2,version:1,body:'Replacement says ten days.',contentHash:digest('Replacement says ten days.')});});}});
 assert.equal((await processSlackReply(owner.tenantId,String(result.replyId),changed)).status,'blocked');assert.equal(changed.posts.length,0);
}));
test('delivery projection distinguishes unknown completion and never leaks destination or body to another member',()=>isolated(async(i)=>{
 const result=await intake(i),unknown=provider({lostAck:true,hidden:true});await processSlackReply(owner.tenantId,String(result.replyId),unknown);let s=await readWorkspace(owner.tenantId),view=slackDeliveryViews(s,owner);assert.equal(view[0].status,'uncertain');assert.equal(view[0].reason,'delivery_unconfirmed');assert.ok(!JSON.stringify(view).includes('C1'));assert.ok(!JSON.stringify(view).includes(s.messages[1].text));assert.equal(slackDeliveryViews(s,{...owner,actorId:'other'}).length,0);
 await send({type:'source.revoke',sourceId:String(result.sourceId),reason:'Withdraw source access'});s=await readWorkspace(owner.tenantId);view=slackDeliveryViews(s,owner);assert.equal(view[0].status,'uncertain');assert.equal(view[0].messageId,null);
}));
test('later-page duplicate receipt metadata cannot establish unique delivery',()=>isolated(async(i)=>{
 const result=await intake(i),io=provider();let reads=0;const fetcher:ProviderFetch=async(url,options)=>{const response=await io.fetcher(url,options);if(!String(url).includes('conversations.replies'))return response;const body=await response.json();reads++;return json({...body,...(reads===1?{response_metadata:{next_cursor:'next-page'}}:{})});};
 assert.equal((await processSlackReply(owner.tenantId,String(result.replyId),{fetcher})).status,'uncertain');assert.equal(reads,2);assert.equal(io.posts.length,1);
}));
