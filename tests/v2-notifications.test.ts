import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,snapshot} from '../src/v2/service';
import {closeV2Store,readWorkspace,transactWorkspace} from '../src/v2/store';
import {applyAttentionCommand,attentionView} from '../src/v2/attention';
import {applyNotificationCommand,notificationView,notificationGrant,processNotificationWatch,processNotificationDelivery,reconcileNotificationDelivery} from '../src/v2/notifications';
import type {ActorContext,WorkspaceState} from '../src/v2/contracts';
const dirs:string[]=[];let sequence=0;
const keys=['KIARA_V2_DATA_DIR','MONGODB_URI','KIARA_V2_AI_MODE','KIARA_V2_NOTIFICATION_GRANTS','KIARA_ALLOW_LIVE_EMAIL','NOTIFY_TEST_TOKEN'];
const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const actor=(id='owner'):ActorContext=>({tenantId:'notification-tests',actorId:id,mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','business_owner','fact_owner']});
const grant=(mode:'preview'|'resend'='resend')=>({tenantId:actor().tenantId,actorId:'owner',email:'owner@example.invalid',from:'kiara@example.invalid',mode,tokenEnv:'NOTIFY_TEST_TOKEN',appOrigin:'https://kiara.example.invalid',validUntil:'2099-01-01T00:00:00.000Z'});
beforeEach(async()=>{await closeV2Store();const dir=await mkdtemp(join(tmpdir(),'kiara-notifications-'));dirs.push(dir);process.env.KIARA_V2_DATA_DIR=dir;delete process.env.MONGODB_URI;process.env.KIARA_V2_AI_MODE='local';process.env.KIARA_V2_NOTIFICATION_GRANTS=JSON.stringify([grant()]);process.env.KIARA_ALLOW_LIVE_EMAIL='true';process.env.NOTIFY_TEST_TOKEN='injected-only';});
after(async()=>{await closeV2Store();for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}await Promise.all(dirs.map(dir=>rm(dir,{recursive:true,force:true})));});
async function fixture(options:{required?:boolean;mode?:'preview'|'resend';enabled?:boolean}={}){
 process.env.KIARA_V2_NOTIFICATION_GRANTS=JSON.stringify([grant(options.mode)]);
 await command(actor(),{idempotencyKey:`notification-${++sequence}`,expectedVersion:(await snapshot(actor())).version,command:{type:'matter.create',title:'Secret fictional acquisition',objective:'Private business detail must stay in app',scope:{kind:'private',actorIds:['owner']}}});
 return (await transactWorkspace(actor().tenantId,s=>{const m=s.matters[0];m.tasks=m.tasks.slice(0,1);m.tasks[0].title='Secret fictional financing condition';if(options.required!==false){m.tasks[0].dueAt='2020-01-01T00:00:00Z';m.tasks[0].deadlineType='response_target';}applyAttentionCommand(s,actor(),{type:'attention.configure',expectedRecordVersion:0,timezone:'UTC',quietEnabled:false,quietStart:'18:00',quietEnd:'09:00',digestAt:'00:00',approachingHours:24});if(options.enabled!==false)applyNotificationCommand(s,actor(),{type:'notification.configure',mode:'required_and_digest',expectedRecordVersion:0,expectedGrantHash:notificationView(s,actor()).configuration.grantHash});return s.notificationEnrollments?.[0]?.id||'';})).result;
}
async function state(){return readWorkspace(actor().tenantId);}
function provider(event='delivered') {let posts=0,gets=0,payload:any;const fetcher=async(_url:unknown,init?:RequestInit)=>{if(init?.method==='POST'){posts++;payload=JSON.parse(String(init.body));return Response.json({id:'email-receipt'});}gets++;return Response.json({...payload,id:'email-receipt',last_event:event});};return {fetcher:fetcher as typeof fetch,get posts(){return posts;},get gets(){return gets;},get payload(){return payload;}};}
async function prepared(){const enrollment=await fixture();process.env.KIARA_ALLOW_LIVE_EMAIL='false';await processNotificationWatch(actor().tenantId,enrollment);process.env.KIARA_ALLOW_LIVE_EMAIL='true';const d=(await state()).notificationDeliveries![0];assert.equal(d.status,'prepared');return d;}

test('email is off until exact configured recipient opt-in; malformed and conflicting grants are unavailable',async()=>{
 await fixture({enabled:false});let s=await state();assert.equal(notificationView(s,actor()).effective,false);assert.equal((s.notificationDeliveries||[]).length,0);assert.throws(()=>applyNotificationCommand(s,actor(),{type:'notification.configure',mode:'digest',expectedRecordVersion:0,expectedGrantHash:'stale'}),{code:'NOTIFICATION_GRANT_CHANGED'});
 for(const invalid of [[grant(),grant()],[{...grant(),appOrigin:'https://kiara.example.invalid/unsafe'}],[{...grant(),validUntil:'2000-01-01'}],[{...grant(),appOrigin:'http://public.example.invalid'}]]){process.env.KIARA_V2_NOTIFICATION_GRANTS=JSON.stringify(invalid);assert.throws(()=>notificationGrant(s.tenantId,'owner'),{code:'NOTIFICATION_NOT_CONFIGURED'});}assert.equal(notificationView(s,actor()).configuration.available,false);
});
test('required email contains only generic authenticated link; exact provider read-back distinguishes delivered',async()=>{
 const e=await fixture(),p=provider();await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher});assert.equal(p.posts,1);assert.equal(p.gets,1);assert.doesNotMatch(JSON.stringify(p.payload),/Secret|financing|acquisition|Private business/);assert.match(p.payload.text,/https:\/\/kiara.example.invalid\/review\/attention/);assert.equal((await state()).notificationDeliveries![0].status,'delivered');await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher});assert.equal(p.posts,1);
});
test('semantic dedup ignores unrelated versions but changed required conditions produce a new notice',async()=>{
 const e=await fixture(),p=provider();await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher});await transactWorkspace(actor().tenantId,s=>{s.matters[0].version++;});await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher});assert.equal(p.posts,1);await transactWorkspace(actor().tenantId,s=>{s.matters[0].tasks[0].title='New required condition';});await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher});assert.equal(p.posts,2);
});
test('digest dedup is once per local calendar day despite changes in item membership',async()=>{
 const e=await fixture({required:false}),p=provider();await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher});assert.equal(p.posts,1);await transactWorkspace(actor().tenantId,s=>{s.matters[0].tasks[0].title='Changed ordinary work';});await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher});assert.equal(p.posts,1);assert.equal((await state()).notificationDeliveries![0].kind,'digest');
});
test('quiet hours defer digest while required escalation can pass',async()=>{
 const e=await fixture({required:false}),p=provider();await transactWorkspace(actor().tenantId,s=>{const v=s.attentionSettings![0];v.quietEnabled=true;v.quietStart='00:00';v.quietEnd='23:59';});await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher,now:Date.parse('2030-01-01T12:00:00Z')});assert.equal(p.posts,0);await transactWorkspace(actor().tenantId,s=>{s.matters[0].tasks[0].dueAt='2020-01-01T00:00:00Z';});await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher});assert.equal(p.posts,1);
});
test('preview and provider acceptance are never reported as verified delivery',async()=>{
 const e=await fixture({mode:'preview'}),p=provider();await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher});assert.equal(p.posts,0);assert.equal((await state()).notificationDeliveries![0].status,'preview');
});
test('a lost POST response stays unknown across retry and accepts only exact read-back',async()=>{
 const e=await fixture();let posts=0,payload:any;const fetcher=(async(_url:unknown,init?:RequestInit)=>{if(init?.method==='POST'){posts++;payload=JSON.parse(String(init.body));throw new Error('connection lost after provider accepted');}return Response.json({...payload,id:'lost-receipt',last_event:'delivered'});}) as typeof fetch;
 await processNotificationWatch(actor().tenantId,e,{fetcher});const d=(await state()).notificationDeliveries![0];assert.equal(d.status,'unknown');await processNotificationDelivery(actor().tenantId,d.id,{fetcher});assert.equal(posts,1);await reconcileNotificationDelivery(actor().tenantId,d.id,'lost-receipt',{fetcher,actor:actor(),expectedVersion:d.version});assert.equal((await state()).notificationDeliveries![0].status,'delivered');assert.equal(posts,1);
});
test('concurrent workers send once and a late acceptance survives expired-lease recovery',async()=>{
 const d=await prepared();let posts=0,payload:any,resolvePost!:()=>void,started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});const release=new Promise<void>(resolve=>{resolvePost=resolve;});const fetcher=(async(_url:unknown,init?:RequestInit)=>{if(init?.method==='POST'){posts++;payload=JSON.parse(String(init.body));started();await release;return Response.json({id:'late-receipt'});}return Response.json({...payload,id:'late-receipt',last_event:'delivered'});}) as typeof fetch;
 const first=processNotificationDelivery(actor().tenantId,d.id,{fetcher});await entered;await processNotificationDelivery(actor().tenantId,d.id,{fetcher});assert.equal(posts,1);await transactWorkspace(actor().tenantId,s=>{s.notificationDeliveries![0].leaseUntil=Date.now()-1;});await processNotificationDelivery(actor().tenantId,d.id,{fetcher});assert.equal((await state()).notificationDeliveries![0].status,'unknown');resolvePost();await first;assert.equal(posts,1);assert.equal((await state()).notificationDeliveries![0].providerReceipt,'late-receipt');assert.equal((await state()).notificationDeliveries![0].status,'delivered');
});
test('membership, source condition and opt-out changes stop a prepared send at final admission',async()=>{
 const d=await prepared(),p=provider();await processNotificationDelivery(actor().tenantId,d.id,{fetcher:p.fetcher,beforeDispatch:async()=>{await transactWorkspace(actor().tenantId,s=>{applyNotificationCommand(s,actor(),{type:'notification.configure',mode:'off',expectedRecordVersion:s.notificationEnrollments!.at(-1)!.version,expectedGrantHash:null});});}});assert.equal(p.posts,0);assert.equal((await state()).notificationDeliveries![0].status,'canceled');assert.equal(attentionView(await state(),actor()).items[0].required,true);
});
test('acknowledged work and revoked membership cannot trigger prepared email',async()=>{
 const d=await prepared(),p=provider();await transactWorkspace(actor().tenantId,s=>{const item=attentionView(s,actor()).items[0];applyAttentionCommand(s,actor(),{type:'attention.decide',itemId:item.id,fingerprint:item.fingerprint,decision:'acknowledged',reason:'I have reviewed this pending work.'});});await processNotificationDelivery(actor().tenantId,d.id,{fetcher:p.fetcher});assert.equal(p.posts,0);assert.equal((await state()).notificationDeliveries![0].status,'canceled');
});
test('accepted receipt requires matching provider bytes, and another actor cannot reconcile it',async()=>{
 const e=await fixture(),p=provider('sent');await processNotificationWatch(actor().tenantId,e,{fetcher:p.fetcher});const d=(await state()).notificationDeliveries![0];assert.equal(d.status,'accepted');await snapshot(actor('other'));await assert.rejects(()=>reconcileNotificationDelivery(actor().tenantId,d.id,'email-receipt',{fetcher:p.fetcher,actor:actor('other'),expectedVersion:d.version}),{code:'NOT_FOUND'});const bad=(async()=>Response.json({...p.payload,id:'email-receipt',text:'different',last_event:'delivered'})) as typeof fetch;await assert.rejects(()=>reconcileNotificationDelivery(actor().tenantId,d.id,'email-receipt',{fetcher:bad,actor:actor(),expectedVersion:d.version}),{code:'NOTIFICATION_READBACK_MISMATCH'});assert.equal((await state()).notificationDeliveries![0].status,'accepted');assert.equal(p.posts,1);
});


test('explicit reenrollment can prepare a canceled unsent condition without retrying an uncertain dispatch',async()=>{
 const d=await prepared(),p=provider();await transactWorkspace(actor().tenantId,s=>{applyNotificationCommand(s,actor(),{type:'notification.configure',mode:'off',expectedRecordVersion:s.notificationEnrollments!.at(-1)!.version,expectedGrantHash:null});});
 const e=(await transactWorkspace(actor().tenantId,s=>applyNotificationCommand(s,actor(),{type:'notification.configure',mode:'required_and_digest',expectedRecordVersion:s.notificationEnrollments!.at(-1)!.version,expectedGrantHash:notificationView(s,actor()).configuration.grantHash}))).result.enrollmentId;
 await processNotificationWatch(actor().tenantId,String(e),{fetcher:p.fetcher});const s=await state();assert.equal(p.posts,1);assert.equal(s.notificationDeliveries!.find(x=>x.id===d.id)!.status,'canceled');assert.equal(s.notificationDeliveries!.length,2);assert.equal(s.notificationDeliveries![1].status,'delivered');
});

test('membership change immediately before dispatch cancels the prepared notification',async()=>{
 const d=await prepared(),p=provider();await processNotificationDelivery(actor().tenantId,d.id,{fetcher:p.fetcher,beforeDispatch:async()=>{await transactWorkspace(actor().tenantId,s=>{s.memberships.find(m=>m.actorId==='owner')!.version++;});}});assert.equal(p.posts,0);assert.equal((await state()).notificationDeliveries![0].status,'canceled');
});


test('grant renewal preserves unknown dedup and permits exact readback under the same current delivery identity',async()=>{
 const e=await fixture();let posts=0,payload:any;const fetcher=(async(_url:unknown,init?:RequestInit)=>{if(init?.method==='POST'){posts++;payload=JSON.parse(String(init.body));throw new Error('Unknown original send');}return Response.json({...payload,id:'renewal-receipt',last_event:'delivered'});}) as typeof fetch;
 await processNotificationWatch(actor().tenantId,e,{fetcher});const d=(await state()).notificationDeliveries![0];assert.equal(d.status,'unknown');process.env.KIARA_V2_NOTIFICATION_GRANTS=JSON.stringify([{...grant(),validUntil:'2098-01-01T00:00:00.000Z'}]);
 const renewed=(await transactWorkspace(actor().tenantId,s=>{s.memberships.find(m=>m.actorId==='owner')!.version++;return applyNotificationCommand(s,actor(),{type:'notification.configure',mode:'required_and_digest',expectedRecordVersion:s.notificationEnrollments!.at(-1)!.version,expectedGrantHash:notificationView(s,actor()).configuration.grantHash});})).result;
 await processNotificationWatch(actor().tenantId,String(renewed.enrollmentId),{fetcher});assert.equal(posts,1);await reconcileNotificationDelivery(actor().tenantId,d.id,'renewal-receipt',{fetcher,actor:actor(),expectedVersion:d.version});assert.equal((await state()).notificationDeliveries![0].status,'delivered');assert.equal(posts,1);
});
