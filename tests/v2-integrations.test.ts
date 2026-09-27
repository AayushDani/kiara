import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {closeV2Store,digest,readWorkspace,transactWorkspace} from '../src/v2/store';
import {canRead} from '../src/v2/authority';
import {snapshot} from '../src/v2/service';
import {resolveInstallation,type Installation} from '../src/v2/integrations/config';
import {acceptWebhook,ingestProviderObject,syncDriveInstallation,verifyWebhook} from '../src/v2/integrations/intake';
import {providerRequest,readDriveFile,readGitHubPullRequest,readSlackThread,type ProviderFetch} from '../src/v2/integrations/read';
import {dispatchOutbox,matterWorkflowId,temporalConfig} from '../src/v2/orchestration/temporal';
import {reconcileReference} from '../src/v2/orchestration/activities';
import {processConversationReference,processLocalOutboxOnce} from '../src/v2/orchestration/conversations';
import type {Matter,OutboxEntry} from '../src/v2/contracts';
const github:Installation={id:'github-1',provider:'github',tenantId:'tenant-a',actorId:'integration',enabled:true,tokenEnv:'TEST_PROVIDER_TOKEN',webhookSecretEnv:'TEST_WEBHOOK_SECRET',resources:['acme/product'],scope:{kind:'team',actorIds:[]},providerInstallationId:'777'};
const slack:Installation={...github,id:'slack-1',provider:'slack',slackTeamId:'T1',resources:['C1']};
const drive:Installation={...github,id:'drive-1',provider:'drive',driveChannelId:'channel-1',driveResourceId:'resource-1',driveStartPageToken:'cursor-0',resources:['folder:folder1']};
async function isolated(run:()=>Promise<void>){const env={...process.env},oldFetch=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'kiara-v2-integrations-'));for(const k of Object.keys(process.env))if(/KIARA|MONGO|VERCEL|OPENAI|RESEND|TEMPORAL/.test(k))delete process.env[k];Object.assign(process.env,{KIARA_V2_DATA_DIR:dir,KIARA_V2_INSTALLATIONS:JSON.stringify([github,slack,drive]),TEST_PROVIDER_TOKEN:'synthetic-token',TEST_WEBHOOK_SECRET:'synthetic-secret'});globalThis.fetch=async()=>{throw new Error('Unexpected live provider attempt');};try{await transactWorkspace('tenant-a',s=>{for(const actorId of ['integration','owner'])s.memberships.push({actorId,roles:actorId==='integration'?['integration']:['member','admin','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});await run();}finally{await closeV2Store();globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);await rm(dir,{recursive:true,force:true});}}
function signedGitHub(p:unknown,type='pull_request'){const raw=Buffer.from(JSON.stringify(p)),headers=new Headers({'x-github-event':type,'x-github-delivery':'delivery-1','x-hub-signature-256':`sha256=${createHmac('sha256','synthetic-secret').update(raw).digest('hex')}`});return {raw,headers};}
function pr(repo='acme/product'){return {installation:{id:777},repository:{full_name:repo},action:'closed',pull_request:{number:7,title:'AI summary experiment',body:'Synthetic data only; consider rollout later.',head:{sha:'abc'},updated_at:'2026-09-27T12:00:00Z',merged:true}};}
function signedSlack(p:unknown,ts=String(Math.floor(Date.now()/1000))){const raw=Buffer.from(JSON.stringify(p)),headers=new Headers({'x-slack-request-timestamp':ts,'x-slack-signature':`v0=${createHmac('sha256','synthetic-secret').update(`v0:${ts}:`).update(raw).digest('hex')}`});return {raw,headers};}
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});

test('installation configuration is unavailable when absent, revoked or missing referenced credentials',()=>isolated(async()=>{
 delete process.env.KIARA_V2_INSTALLATIONS;await assert.rejects(resolveInstallation('github-1'),{code:'CONNECTION_UNAVAILABLE'});process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([{...github,enabled:false}]);await assert.rejects(resolveInstallation('github-1'),{code:'CONNECTION_UNAVAILABLE'});delete process.env.TEST_WEBHOOK_SECRET;const {raw,headers}=signedGitHub(pr());assert.throws(()=>verifyWebhook(github,headers,raw),{code:'CONNECTION_UNAVAILABLE'});
}));
test('GitHub authenticates raw bytes, installation and selected repo before durable intake',()=>isolated(async()=>{
 const {raw,headers}=signedGitHub(pr());await acceptWebhook(github.id,headers,raw);let s=await readWorkspace('tenant-a');assert.equal(s.sources.length,1);assert.equal(s.outbox.length,1);assert.equal(s.sources[0].scope.kind,'team');assert.match(s.sources[0].text,/does not establish deployment/);assert.equal(s.facts.length,0);
 headers.set('x-github-delivery','header-only-replay');await acceptWebhook(github.id,headers,raw);s=await readWorkspace('tenant-a');assert.equal(s.sources.length,1);assert.equal(s.outbox.length,1);
 await assert.rejects(acceptWebhook(github.id,headers,Buffer.from(raw.toString().replace('Synthetic','Customer'))),{code:'WEBHOOK_INVALID'});
 const other=signedGitHub(pr('acme/private'));await assert.rejects(acceptWebhook(github.id,other.headers,other.raw),{code:'INSTALLATION_SCOPE'});const wrong=signedGitHub({...pr(),installation:{id:888}});await assert.rejects(acceptWebhook(github.id,wrong.headers,wrong.raw),{code:'WEBHOOK_INVALID'});assert.equal((await readWorkspace('tenant-b')).sources.length,0);
}));
test('installation membership revocation blocks a correctly signed event',()=>isolated(async()=>{
 await transactWorkspace('tenant-a',s=>{s.memberships[0].revokedAt=new Date().toISOString();});const {raw,headers}=signedGitHub(pr());await assert.rejects(acceptWebhook(github.id,headers,raw),{code:'MEMBERSHIP_REVOKED'});assert.equal((await readWorkspace('tenant-a')).sources.length,0);
}));
test('Slack uses bounded request time, signed team/channel, stable event identity and deletion',()=>isolated(async()=>{
 const p={type:'event_callback',team_id:'T1',event_id:'Ev1',event:{type:'message',channel:'C1',user:'U1',ts:'1750000000.100',text:'What if we tested synthetic summaries?'}};let request=signedSlack(p);await acceptWebhook(slack.id,request.headers,request.raw);await acceptWebhook(slack.id,request.headers,request.raw);assert.equal((await readWorkspace('tenant-a')).sources.length,1);
 request=signedSlack({...p,event_id:'Ev2',event:{...p.event,channel:'C2'}});await assert.rejects(acceptWebhook(slack.id,request.headers,request.raw),{code:'INSTALLATION_SCOPE'});request=signedSlack(p,'1');await assert.rejects(acceptWebhook(slack.id,request.headers,request.raw),{code:'WEBHOOK_INVALID'});
 request=signedSlack({...p,event_id:'Ev3',event:{type:'message',channel:'C1',subtype:'message_deleted',deleted_ts:p.event.ts}});await acceptWebhook(slack.id,request.headers,request.raw);assert.equal((await readWorkspace('tenant-a')).sources[0].status,'revoked');
 request=signedSlack({type:'url_verification',challenge:'challenge-synthetic'});assert.deepEqual(await acceptWebhook(slack.id,request.headers,request.raw),{challenge:'challenge-synthetic'});
}));
test('read adapters use fixed GET origins, selected resources and bounded truthful evidence',()=>isolated(async()=>{
 const calls:string[]=[];const fetcher:ProviderFetch=async(url,options)=>{assert.equal(options?.method,'GET');assert.equal(options?.redirect,'error');assert.equal(new Headers(options?.headers).get('authorization'),'Bearer synthetic-token');calls.push(String(url));if(String(url).includes('/pulls/'))return json({...pr().pull_request,state:'closed'});return json({ok:true,messages:[{ts:'1750000000.100',text:'Synthetic thread',user:'U1'}]});};
 const pull=await readGitHubPullRequest(github,'acme/product',7,fetcher);assert.match(pull.text,/does not establish deployment/);const thread=await readSlackThread(slack,'C1','1750000000.100',fetcher);assert.match(thread.text,/Synthetic thread/);assert.equal(calls.length,4);
 await assert.rejects(readGitHubPullRequest(github,'acme/private',7,fetcher),{code:'INSTALLATION_SCOPE'});await assert.rejects(providerRequest(github,new URL('https://example.com/token'),fetcher),{code:'PROVIDER_ORIGIN'});await assert.rejects(providerRequest(github,new URL('https://api.github.com/rate'),async()=>new Response('provider secret error',{status:429})),(e:any)=>e.code==='PROVIDER_UNAVAILABLE'&&!e.message.includes('secret'));
}));
test('Drive fetches authorized metadata before content and rejects unselected or unparsed files',()=>isolated(async()=>{
 const paths:string[]=[];const fetcher:ProviderFetch=async url=>{const u=new URL(String(url));paths.push(u.pathname);return u.pathname.endsWith('/export')?new Response('Selected native document'):json({id:'file1',name:'DPA',parents:['folder1'],mimeType:'application/vnd.google-apps.document',version:'3',modifiedTime:'2026-09-27T12:00:00Z'});};
 const object=await readDriveFile(drive,'file1',fetcher);assert.equal(object.text,'Selected native document');assert.equal(object.revision,'3');assert.equal(paths.length,3);
 await assert.rejects(readDriveFile(drive,'file2',async()=>json({parents:['other'],mimeType:'text/plain'})),{code:'INSTALLATION_SCOPE'});await assert.rejects(readDriveFile(drive,'file1',async()=>json({parents:['folder1'],mimeType:'application/pdf'})),{code:'PARSER_UNAVAILABLE'});
}));
test('Drive extraction rejects a revision changed between metadata and content',()=>isolated(async()=>{
 let metadataReads=0;await assert.rejects(readDriveFile(drive,'file1',async url=>String(url).includes('/export')?new Response('new text'):json({id:'file1',name:'DPA',parents:['folder1'],mimeType:'application/vnd.google-apps.document',version:String(++metadataReads),modifiedTime:'2026-09-27T12:00:00Z'})),{code:'PROVIDER_REVISION_CHANGED'});
}));
test('Drive channel notification reads changes and advances cursor only after durable ingestion',()=>isolated(async()=>{
 const requests:string[]=[];const fetcher:ProviderFetch=async url=>{const u=new URL(String(url));requests.push(u.href);if(u.pathname.endsWith('/changes'))return json({newStartPageToken:'cursor-1',changes:[{fileId:'file1',time:'2026-09-27T12:00:00Z',file:{parents:['folder1']}}]});if(u.pathname.endsWith('/export'))return new Response('Synthetic contract clause');return json({id:'file1',name:'Agreement',parents:['folder1'],mimeType:'application/vnd.google-apps.document',version:'3',modifiedTime:'2026-09-27T12:00:00Z'});};
 const headers=new Headers({'x-goog-channel-id':'channel-1','x-goog-resource-id':'resource-1','x-goog-channel-token':'synthetic-secret','x-goog-message-number':'1'});await acceptWebhook(drive.id,headers,new Uint8Array(),fetcher);let s=await readWorkspace('tenant-a');assert.equal(s.sources.length,1);assert.equal(s.receipts['integration:drive-cursor:drive-1'].result.cursor,'cursor-1');assert.ok(requests[0].includes('pageToken=cursor-0'));await acceptWebhook(drive.id,headers,new Uint8Array(),fetcher);assert.equal((await readWorkspace('tenant-a')).sources.length,1);
 headers.set('x-goog-channel-token','wrong');await assert.rejects(acceptWebhook(drive.id,headers,new Uint8Array(),fetcher),{code:'WEBHOOK_INVALID'});
 await syncDriveInstallation(drive,async()=>json({newStartPageToken:'cursor-2',changes:[{fileId:'file1',removed:true,time:'2026-09-27T12:01:00Z'}]}));s=await readWorkspace('tenant-a');assert.equal(s.sources[0].status,'revoked');assert.equal(canRead(s,{tenantId:'tenant-a',actorId:'owner',mode:'authenticated',expiresAt:Date.now()+10000},s.sources[0]),false);
}));
test('Drive cursor does not skip a failed extraction or disclose provider response text',()=>isolated(async()=>{
 const fetcher:ProviderFetch=async url=>String(url).includes('/changes?')?json({newStartPageToken:'cursor-1',changes:[{fileId:'file1',file:{parents:['folder1']}}]}):json({id:'file1',parents:['folder1'],mimeType:'application/pdf'});
 await assert.rejects(syncDriveInstallation(drive,fetcher),{code:'PARSER_UNAVAILABLE'});assert.equal((await readWorkspace('tenant-a')).receipts['integration:drive-cursor:drive-1'],undefined);
}));
test('provider revision replay conflicts instead of overwriting an accepted event',()=>isolated(async()=>{
 const value={objectId:'acme/product:pull:1',revision:'sha1',title:'PR',text:'Source evidence',url:null,occurredAt:'2026-09-27T12:00:00Z'};await ingestProviderObject(github,'stable-event',value);await assert.rejects(ingestProviderObject(github,'stable-event',{...value,text:'Conflicting body'}),{code:'IDEMPOTENCY_CONFLICT'});assert.equal((await readWorkspace('tenant-a')).sources[0].text,'Source evidence');
}));
async function outboxFixture(){await transactWorkspace('tenant-a',s=>{s.outbox.push({id:'outbox-1',tenantId:s.tenantId,kind:'matter_changed',aggregateId:'matter-1',commandId:'command-1',status:'pending',owner:'v2',createdAt:new Date().toISOString()});s.matters.push({id:'matter-1',tenantId:s.tenantId,version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),scope:{kind:'team',actorIds:[]},provenance:{actorId:'owner',sourceIds:[],description:'Synthetic'},title:'Synthetic',objective:'Synthetic',state:'needs_facts',ownerId:'owner',entityId:s.entityId,conversationIds:[],scenarioId:null,eventIds:[],sourceIds:[],factIds:[],documentIds:[],proposalId:null,tasks:[],blockers:[],outcome:null,closedAt:null,ruleVersion:1} satisfies Matter);});}
test('outbox acknowledgement loss retries only scoped refs with stable workflow identity',()=>isolated(async()=>{
 await outboxFixture();const seen:unknown[]=[];await assert.rejects(dispatchOutbox('tenant-a',{signal:async ref=>{seen.push(ref);throw new Error('lost acknowledgement');}}));assert.equal((await readWorkspace('tenant-a')).outbox[0].status,'pending');await dispatchOutbox('tenant-a',{signal:async ref=>{seen.push(ref);}});assert.deepEqual(seen[0],seen[1]);assert.deepEqual(Object.keys(seen[0] as object).sort(),['aggregateId','outboxId','tenantId']);assert.equal((await readWorkspace('tenant-a')).outbox[0].status,'dispatched');assert.equal(matterWorkflowId('tenant-a','matter-1'),matterWorkflowId('tenant-a','matter-1'));assert.notEqual(matterWorkflowId('tenant-a','matter-1'),matterWorkflowId('tenant-b','matter-1'));
}));
test('outbox dispatcher does not signal legacy-owned or canceled work',()=>isolated(async()=>{
 await outboxFixture();await transactWorkspace('tenant-a',s=>{s.outbox[0].owner='legacy';s.outbox.push({...s.outbox[0],id:'outbox-2',owner:'v2',status:'canceled'} satisfies OutboxEntry);});let calls=0;await dispatchOutbox('tenant-a',{signal:async()=>{calls++;}});assert.equal(calls,0);
}));
test('reconciliation re-reads current state for duplicate/late signals and retains unknown effects after cancellation',()=>isolated(async()=>{
 await outboxFixture();const ref={tenantId:'tenant-a',aggregateId:'matter-1',outboxId:'outbox-1'};assert.equal((await reconcileReference(ref)).status,'waiting');await transactWorkspace('tenant-a',s=>{s.matters[0].state='canceled';s.matters[0].version++;s.actions.push({id:'effect-1',tenantId:s.tenantId,version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),scope:{kind:'team',actorIds:[]},provenance:{actorId:'owner',sourceIds:[],description:'Synthetic'},matterId:'matter-1',proposalId:'p',kind:'send',title:'Synthetic',content:'Never sent',contentHash:digest('Never sent'),recipients:[],destination:null,status:'uncertain',authorizationId:null,providerIdempotencyKey:'stable',providerReceipt:null,completion:null,executionOwner:'v2',leaseUntil:null});});const after=await reconcileReference(ref);assert.equal(after.status,'reconciliation_required');assert.equal(after.unresolvedEffects,1);assert.equal((await readWorkspace('tenant-a')).actions[0].status,'uncertain');await assert.rejects(reconcileReference({...ref,tenantId:'tenant-b'}),{code:'OUTBOX_NOT_FOUND'});
}));
test('Temporal missing configuration fails explicitly and workflow source excludes source payload imports',()=>isolated(async()=>{
 assert.throws(temporalConfig,{code:'ORCHESTRATION_UNAVAILABLE'});await assert.rejects(dispatchOutbox('tenant-a'),{code:'ORCHESTRATION_UNAVAILABLE'});const source=await readFile(join(process.cwd(),'src/v2/orchestration/workflows.ts'),'utf8');assert.match(source,/continueAsNew/);assert.match(source,/reconcileReference/);assert.doesNotMatch(source,/from ['"].*(?:store|service|integrations)/);
}));

test('conversation activities return status only and local processing commits terminal acknowledgement',()=>isolated(async()=>{
 await transactWorkspace('tenant-a',s=>{s.outbox.push({id:'answer-outbox',tenantId:s.tenantId,kind:'conversation_answer',aggregateId:'run-1',commandId:'question-1',status:'pending',owner:'v2',createdAt:new Date().toISOString()});});
 const ref={tenantId:'tenant-a',aggregateId:'run-1',outboxId:'answer-outbox'},seen:unknown[]=[];
 const processor=async(tenantId:string,runId:string)=>{seen.push({tenantId,runId});return {id:runId,conversationId:'conversation-1',userMessageId:'question-1',status:'complete' as const,reason:'Sensitive private explanation must not enter history',assistantMessageId:'answer-1',createdAt:'now',updatedAt:'now'};};
 assert.deepEqual(await processConversationReference(ref,processor),{status:'complete'});await processLocalOutboxOnce('tenant-a',{processor});assert.equal((await readWorkspace('tenant-a')).outbox[0].status,'dispatched');assert.deepEqual(seen[0],{tenantId:'tenant-a',runId:'run-1'});assert.ok(!JSON.stringify(await processConversationReference(ref,processor)).includes('Sensitive'));
}));
test('local runner waits through active lease, retains unknown outcomes, and respects managed owner',()=>isolated(async()=>{
 await transactWorkspace('tenant-a',s=>{s.outbox.push({id:'answer-outbox',tenantId:s.tenantId,kind:'conversation_answer',aggregateId:'run-1',commandId:'question-1',status:'pending',owner:'v2',createdAt:new Date().toISOString()});});
 let calls=0;const deferred=new Map<string,number>(),processor=async(_tenantId:string,runId:string)=>({id:runId,conversationId:'c',userMessageId:'m',status:++calls===1?'running' as const:'unknown' as const,reason:null,assistantMessageId:null,createdAt:'now',updatedAt:'now'});
 assert.equal((await processLocalOutboxOnce('tenant-a',{processor,deferred})).waiting,1);await processLocalOutboxOnce('tenant-a',{processor,deferred});assert.equal(calls,1);assert.equal((await readWorkspace('tenant-a')).outbox[0].status,'pending');deferred.set('answer-outbox',0);await processLocalOutboxOnce('tenant-a',{processor,deferred});assert.equal(calls,2);assert.equal((await readWorkspace('tenant-a')).outbox[0].status,'dispatched');process.env.KIARA_V2_ORCHESTRATION_MODE='temporal';await assert.rejects(processLocalOutboxOnce('tenant-a',{processor}),{code:'ORCHESTRATION_OWNER'});assert.equal(calls,2);
}));
test('Temporal dispatch selects conversation workflow by kind and excludes external actions',()=>isolated(async()=>{
 await transactWorkspace('tenant-a',s=>{s.outbox.push({id:'answer-outbox',tenantId:s.tenantId,kind:'conversation_answer',aggregateId:'run-1',commandId:'question-1',status:'pending',owner:'v2',createdAt:new Date().toISOString()},{id:'external-outbox',tenantId:s.tenantId,kind:'external_action',aggregateId:'action-1',commandId:'action-1',status:'pending',owner:'v2',createdAt:new Date().toISOString()});});
 const calls:unknown[]=[];await dispatchOutbox('tenant-a',{signal:async(ref,kind)=>{calls.push({ref,kind});}});assert.deepEqual(calls,[{ref:{tenantId:'tenant-a',aggregateId:'run-1',outboxId:'answer-outbox'},kind:'conversation_answer'}]);assert.equal((await readWorkspace('tenant-a')).outbox[1].status,'pending');
}));
test('deferred effect reads cannot starve newer local conversation work beyond the batch boundary',()=>isolated(async()=>{
 const deferred=new Map<string,number>();await transactWorkspace('tenant-a',s=>{for(let i=0;i<100;i++){const id=`effect-${i}`;s.outbox.push({id,tenantId:s.tenantId,kind:'effect_reconcile',aggregateId:`action-${i}`,commandId:id,status:'pending',owner:'v2',createdAt:new Date().toISOString()});deferred.set(id,Date.now()+3600000);}s.outbox.push({id:'later-answer',tenantId:s.tenantId,kind:'conversation_answer',aggregateId:'later-run',commandId:'question',status:'pending',owner:'v2',createdAt:new Date().toISOString()});});let calls=0;await processLocalOutboxOnce('tenant-a',{deferred,processor:async(_tenant,runId)=>{calls++;return {id:runId,conversationId:'c',userMessageId:'m',status:'complete',reason:null,assistantMessageId:'a',createdAt:'now',updatedAt:'now'};},effectProcessor:async()=>{throw Error('Deferred effects must not run');}});assert.equal(calls,1);assert.equal((await readWorkspace('tenant-a')).outbox.find(o=>o.id==='later-answer')!.status,'dispatched');
}));

test('retained provider evidence becomes unreadable immediately after installation selection or actor revocation',()=>isolated(async()=>{
 const event=signedGitHub(pr());await acceptWebhook(github.id,event.headers,event.raw);const actor={tenantId:'tenant-a',actorId:'owner',mode:'authenticated' as const,expiresAt:Date.now()+60000};assert.equal((await snapshot(actor)).sources.length,1);
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([{...github,resources:['acme/other']}]);assert.equal((await snapshot(actor)).sources.length,0);let state=await readWorkspace('tenant-a');assert.equal(canRead(state,actor,state.sources[0]),false);
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([{...github,enabled:false}]);assert.equal((await snapshot(actor)).sources.length,0);
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([github]);await transactWorkspace('tenant-a',s=>{s.memberships.find(m=>m.actorId==='integration')!.revokedAt=new Date().toISOString();});state=await readWorkspace('tenant-a');assert.equal(canRead(state,actor,state.sources[0]),false);assert.equal((await snapshot(actor)).sources.length,0);
}));

test('Slack deletion revokes retained thread snapshots containing that message',()=>isolated(async()=>{
 await ingestProviderObject(slack,'thread-read',{objectId:'C1:thread:1750000000.100',revision:'1750000000.200',title:'Thread snapshot',text:JSON.stringify({channel:'C1',threadTs:'1750000000.100',messages:[{ts:'1750000000.100',text:'Initial'},{ts:'1750000000.200',text:'Later deleted'}]}),url:null,occurredAt:'2026-09-27T12:00:00Z'});
 const request=signedSlack({type:'event_callback',team_id:'T1',event_id:'Ev-deletion',event:{type:'message',channel:'C1',subtype:'message_deleted',deleted_ts:'1750000000.200'}});await acceptWebhook(slack.id,request.headers,request.raw);assert.equal((await readWorkspace('tenant-a')).sources[0].status,'revoked');
}));
