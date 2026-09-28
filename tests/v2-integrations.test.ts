import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac,randomUUID} from 'node:crypto';
import {backupWorkspace,closeV2Store,digest,readWorkspace,restoreWorkspace,transactWorkspace} from '../src/v2/store';
import {canRead} from '../src/v2/authority';
import {applyWithdrawalCommand,inspectWithdrawalEffects} from '../src/v2/source-corrective';
import {command,snapshot} from '../src/v2/service';
import {resolveInstallation,type Installation} from '../src/v2/integrations/config';
import {acceptWebhook,ingestProviderObject,syncDriveInstallation,verifyWebhook} from '../src/v2/integrations/intake';
import {providerRequest,readDriveFile,readGitHubPullRequest,readSlackThread,type ProviderFetch} from '../src/v2/integrations/read';
import {dispatchOutbox,matterWorkflowId,temporalConfig} from '../src/v2/orchestration/temporal';
import {reconcileReference} from '../src/v2/orchestration/activities';
import {processConversationReference,processLocalOutboxOnce} from '../src/v2/orchestration/conversations';
import {processWithdrawalReference} from '../src/v2/orchestration/withdrawal';
import type {Action,ActorContext,Matter,OutboxEntry,WorkspaceCommand} from '../src/v2/contracts';
const github:Installation={id:'github-1',provider:'github',tenantId:'tenant-a',actorId:'integration',enabled:true,tokenEnv:'TEST_PROVIDER_TOKEN',webhookSecretEnv:'TEST_WEBHOOK_SECRET',resources:['acme/product'],scope:{kind:'team',actorIds:[]},providerInstallationId:'777'};
const slack:Installation={...github,id:'slack-1',provider:'slack',slackTeamId:'T1',resources:['C1']};
const drive:Installation={...github,id:'drive-1',provider:'drive',driveChannelId:'channel-1',driveResourceId:'resource-1',driveStartPageToken:'cursor-0',resources:['folder:folder1']};
async function isolated(run:()=>Promise<void>){const env={...process.env},oldFetch=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'kiara-v2-integrations-'));for(const k of Object.keys(process.env))if(/KIARA|MONGO|VERCEL|OPENAI|RESEND|TEMPORAL/.test(k))delete process.env[k];Object.assign(process.env,{KIARA_V2_DATA_DIR:dir,KIARA_V2_INSTALLATIONS:JSON.stringify([github,slack,drive]),TEST_PROVIDER_TOKEN:'synthetic-token',TEST_WEBHOOK_SECRET:'synthetic-secret'});globalThis.fetch=async()=>{throw new Error('Unexpected live provider attempt');};try{await transactWorkspace('tenant-a',s=>{for(const actorId of ['integration','owner'])s.memberships.push({actorId,roles:actorId==='integration'?['integration']:['member','admin','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});await run();}finally{await closeV2Store();globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);await rm(dir,{recursive:true,force:true});}}
function signedGitHub(p:unknown,type='pull_request'){const raw=Buffer.from(JSON.stringify(p)),headers=new Headers({'x-github-event':type,'x-github-delivery':'delivery-1','x-hub-signature-256':`sha256=${createHmac('sha256','synthetic-secret').update(raw).digest('hex')}`});return {raw,headers};}
function pr(repo='acme/product'){return {installation:{id:777},repository:{full_name:repo},action:'closed',pull_request:{number:7,title:'AI summary experiment',body:'Synthetic data only; consider rollout later.',head:{sha:'abc'},updated_at:'2026-09-27T12:00:00Z',merged:true}};}
function signedSlack(p:unknown,ts=String(Math.floor(Date.now()/1000))){const raw=Buffer.from(JSON.stringify(p)),headers=new Headers({'x-slack-request-timestamp':ts,'x-slack-signature':`v0=${createHmac('sha256','synthetic-secret').update(`v0:${ts}:`).update(raw).digest('hex')}`});return {raw,headers};}
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
const execFileAsync=promisify(execFile);
async function flushWithdrawals(){for(let turn=0;turn<100;turn++){const s=await readWorkspace('tenant-a'),pending=Object.entries(s.receipts).filter(([key,receipt])=>key.startsWith('source-withdrawal-progress:')&&receipt.result.status==='pending');if(!pending.length)return;for(const [,receipt] of pending){const sourceId=String(receipt.result.sourceId),outbox=s.outbox.find(item=>item.kind==='source_withdrawal'&&item.aggregateId===sourceId&&item.status==='pending');assert.ok(outbox);await processWithdrawalReference({tenantId:'tenant-a',aggregateId:sourceId,outboxId:outbox.id});}}throw Error('Synthetic withdrawal did not finish within bounded test turns.');}

test('installation configuration is unavailable when absent, revoked or missing referenced credentials',()=>isolated(async()=>{
 delete process.env.KIARA_V2_INSTALLATIONS;await assert.rejects(resolveInstallation('github-1'),{code:'CONNECTION_UNAVAILABLE'});process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([{...github,enabled:false}]);await assert.rejects(resolveInstallation('github-1'),{code:'CONNECTION_UNAVAILABLE'});delete process.env.TEST_WEBHOOK_SECRET;const {raw,headers}=signedGitHub(pr());assert.throws(()=>verifyWebhook(github,headers,raw),{code:'CONNECTION_UNAVAILABLE'});
}));
test('GitHub authenticates raw bytes, installation and selected repo before durable intake',()=>isolated(async()=>{
 const {raw,headers}=signedGitHub(pr());await acceptWebhook(github.id,headers,raw);let s=await readWorkspace('tenant-a');assert.equal(s.sources.length,1);assert.equal(s.outbox.length,1);assert.equal(s.sources[0].scope.kind,'team');assert.match(s.sources[0].text,/does not establish deployment/);assert.equal(s.facts.length,0);
 headers.set('x-github-delivery','header-only-replay');await acceptWebhook(github.id,headers,raw);s=await readWorkspace('tenant-a');assert.equal(s.sources.length,1);assert.equal(s.outbox.length,1);
 await assert.rejects(acceptWebhook(github.id,headers,Buffer.from(raw.toString().replace('Synthetic','Customer'))),{code:'WEBHOOK_INVALID'});
 const other=signedGitHub(pr('acme/private'));await assert.rejects(acceptWebhook(github.id,other.headers,other.raw),{code:'INSTALLATION_SCOPE'});const wrong=signedGitHub({...pr(),installation:{id:888}});await assert.rejects(acceptWebhook(github.id,wrong.headers,wrong.raw),{code:'WEBHOOK_INVALID'});assert.equal((await readWorkspace('tenant-b')).sources.length,0);
}));
test('older backup cannot restore withdrawn provider text or invalidated approval into a live tenant',()=>isolated(async()=>{
 const {raw,headers}=signedGitHub(pr());await acceptWebhook(github.id,headers,raw);
 const source=(await readWorkspace('tenant-a')).sources[0],now=new Date().toISOString(),scope={kind:'team' as const,actorIds:[]};
 const dependencies={sourceVersions:{[source.id]:source.version},factVersions:{},documentHashes:{},policyVersion:1,scopeHash:digest(scope)};
 await transactWorkspace('tenant-a',s=>{
  s.proposals.push({id:'restore-proposal',tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope,provenance:{actorId:'owner',sourceIds:[source.id],description:'Synthetic review'},matterId:'restore-matter',title:'Review',body:'Review provider evidence.',contentHash:digest('Review provider evidence.'),baselineRevisionIds:[],dependencies,status:'current',route:'legal_review',noticeMatrix:[],inventoryComplete:false,unknowns:[],supersedesId:null});
  s.approvals.push({id:'restore-approval',tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope,provenance:{actorId:'owner',sourceIds:[source.id],description:'Synthetic approval'},matterId:'restore-matter',proposalId:'restore-proposal',proposalHash:digest('Review provider evidence.'),actionId:null,actionHash:null,capacity:'business',actorId:'owner',membershipVersion:1,dependencies,conditions:[],recipients:[],destination:null,validUntil:'2027-01-01T00:00:00.000Z',status:'active',note:'Synthetic approval'});
 });
 const backup=await backupWorkspace('tenant-a');
 await ingestProviderObject(github,'restore-withdrawal',{objectId:'acme/product:pull:7',revision:'withdrawn',title:'Withdrawn PR',text:'',url:null,occurredAt:now,removed:true});
 await flushWithdrawals();
 const current=await readWorkspace('tenant-a'),owner:ActorContext={tenantId:'tenant-a',actorId:'owner',mode:'authenticated',expiresAt:Date.now()+10000};
 assert.equal(digest(current.events),digest(backup.state.events));
 assert.equal(current.sources[0].status,'revoked');assert.equal(canRead(current,owner,current.sources[0]),false);
 assert.equal(current.proposals[0].status,'invalidated');assert.equal(current.approvals[0].status,'invalidated');
 await assert.rejects(restoreWorkspace(backup,current.version,true),{code:'RESTORE_TARGET_NOT_EMPTY'});
 await assert.rejects(restoreWorkspace(backup,current.version,false),{code:'RESTORE_TARGET_NOT_EMPTY'});
 assert.equal(digest(await readWorkspace('tenant-a')),digest(current));
}));
test('signed provider deletion leaves one private owner-visible corrective task without leaking withdrawn evidence or changing effect history',()=>isolated(async()=>{
 const owner:ActorContext={tenantId:'tenant-a',actorId:'owner',mode:'authenticated',expiresAt:Date.now()+3600000};
 const send=async(value:WorkspaceCommand)=>command(owner,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(owner)).version,command:value});
 const created=await send({type:'matter.create',title:'PRIVATE_MATTER_CANARY',objective:'PRIVATE_OBJECTIVE_CANARY'}),matterId=String(created.result.matterId);
 const message={type:'event_callback',team_id:'T1',event_id:'source-visible-before-removal',event:{type:'message',channel:'C1',user:'U1',ts:'1750000000.100',text:'WITHDRAWN_SOURCE_CANARY'}};
 const signed=signedSlack(message),retained=await acceptWebhook(slack.id,signed.headers,signed.raw),sourceId=String(retained.sourceId);
 const beforeLink=await snapshot(owner),matter=beforeLink.matters.find(item=>item.id===matterId)!,source=beforeLink.sources.find(item=>item.id===sourceId)!;
 await send({type:'event.link_matter',matterId,expectedMatterVersion:matter.version,sourceId,expectedSourceVersion:source.version});
 const linked=(await snapshot(owner)).matters.find(item=>item.id===matterId)!;
 const prepared=await send({type:'matter.prepare',matterId,expectedRecordVersion:linked.version}),proposalId=String(prepared.result.proposalId);
 await transactWorkspace('tenant-a',s=>{
  const current=s.matters.find(item=>item.id===matterId)!;current.state='closed';current.closedAt=new Date().toISOString();current.outcome='Earlier outcome remains historical';
  const now=new Date().toISOString();
  const action=(status:Action['status'],id:string):Action=>({id,tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(current.scope),provenance:{actorId:'owner',sourceIds:[sourceId],description:'Historical effect'},matterId,proposalId,kind:'send',title:'Historical effect',content:'WITHDRAWN_EFFECT_CANARY',contentHash:digest('WITHDRAWN_EFFECT_CANARY'),recipients:[],destination:null,status,authorizationId:status==='authorized'?'prior-authorization':null,providerIdempotencyKey:id,providerReceipt:id,completion:status==='verified'?{kind:'readback',artifact:'Prior exact receipt',verifierId:'owner',verifiedAt:now}:null,executionOwner:'v2',leaseUntil:null});
  s.actions.push(action('verified','prior-verified'),action('uncertain','prior-uncertain'),action('authorized','prior-authorized'));
  s.memberships.push({actorId:'unrelated',roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
  s.memberships.push({actorId:'operator',roles:['member','admin'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
  s.memberships.find(item=>item.actorId==='owner')!.matterIds=[matterId];
 });
 const deletion=signedSlack({type:'event_callback',team_id:'T1',event_id:'deleted-message',event:{type:'message',channel:'C1',subtype:'message_deleted',deleted_ts:'1750000000.100'}});
 await acceptWebhook(slack.id,deletion.headers,deletion.raw);
 await flushWithdrawals();
 const state=await readWorkspace('tenant-a'),corrections=state.matters.filter(item=>item.id!==matterId),correction=corrections[0];
 assert.equal(corrections.length,1);assert.equal(correction.ownerId,'owner');assert.deepEqual(correction.scope,{kind:'private',actorIds:['owner']});
 assert.deepEqual(correction.provenance.sourceIds,[]);assert.deepEqual(correction.sourceIds,[]);assert.deepEqual(correction.tasks[0].evidenceIds,[]);
 assert.equal(state.matters.find(item=>item.id===matterId)!.state,'closed','historical outcome remains recorded');
 assert.equal(state.proposals.find(item=>item.id===proposalId)?.status,'invalidated');
 assert.deepEqual(state.actions.map(item=>item.status),['verified','uncertain','planned']);assert.equal(state.actions[2].authorizationId,null);
 assert.ok(state.outbox.some(item=>item.kind==='matter_changed'&&item.aggregateId===correction.id&&item.status==='pending'));
 const view=await snapshot(owner),other=await snapshot({...owner,actorId:'unrelated'});
 assert.ok(view.matters.some(item=>item.id===correction.id));assert.ok(!view.matters.some(item=>item.id===matterId));
 assert.ok(view.attention.items.some(item=>item.matterId===correction.id&&item.kind==='task'));
 assert.ok(!other.matters.some(item=>item.id===correction.id));assert.ok(!other.attention.items.some(item=>item.matterId===correction.id));
 assert.doesNotMatch(JSON.stringify({matter:correction,event:state.events.find(item=>item.matterId===correction.id),outbox:state.outbox.find(item=>item.aggregateId===correction.id)}),/PRIVATE_MATTER_CANARY|PRIVATE_OBJECTIVE_CANARY|WITHDRAWN_SOURCE_CANARY|WITHDRAWN_EFFECT_CANARY/);
 const independent=await send({type:'document.add',title:'Private independent review',body:'Current permitted record for effect reconciliation.',authority:'effective',scope:{kind:'private',actorIds:['owner']}}),evidence=independent.snapshot.sources.at(-1)!;
 const reviewRef=correction.title.match(/EW-[A-F0-9]{12}/)![0];
 const operatorActor:ActorContext={...owner,actorId:'operator'};
 await assert.rejects(async()=>command(operatorActor,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(operatorActor)).version,command:{type:'source.correction.assign',reviewRef,ownerId:'operator',expectedRecordVersion:correction.version}}),{code:'NOT_FOUND'});
 await assert.rejects(()=>send({type:'source.correction.resolve',reviewRef,expectedRecordVersion:correction.version,note:'I reviewed the current record and all known historical effects for this work.',evidenceSourceIds:[evidence.id],evidenceSourceVersions:{[evidence.id]:evidence.version},evidenceSourceHashes:{[evidence.id]:evidence.contentHash},evidenceSourceDependencyHashes:{[evidence.id]:evidence.evidenceDependencyHash!}}),{code:'RECONCILIATION_REQUIRED'});
 assert.equal((await snapshot(owner)).matters.find(item=>item.id===correction.id)?.state,'needs_facts');
 await acceptWebhook(slack.id,deletion.headers,deletion.raw);
 assert.equal((await readWorkspace('tenant-a')).matters.length,2,'a repeated signed deletion creates no second corrective matter');
 const current=(await readWorkspace('tenant-a')).sources.find(item=>item.id===sourceId)!;
 const operator:ActorContext={...owner,actorId:'operator'};
 await command(operator,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(operator)).version,command:{type:'source.revoke',sourceId,expectedRecordVersion:current.version,reason:'Delete retained source',delete:true}});
 await flushWithdrawals();
 const afterDelete=await readWorkspace('tenant-a');assert.equal(afterDelete.matters.filter(item=>item.id!==matterId).length,1);assert.ok(afterDelete.outbox.some(item=>item.aggregateId===correction.id&&item.status==='pending'));assert.ok((await snapshot(owner)).attention.items.some(item=>item.matterId===correction.id));
}));
test('direct source deletion creates safe admin corrective work when the former owner is revoked, including closed work without a proposal',()=>isolated(async()=>{
 const owner:ActorContext={tenantId:'tenant-a',actorId:'owner',mode:'authenticated',expiresAt:Date.now()+3600000};
 const send=async(a:ActorContext,value:WorkspaceCommand)=>command(a,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(a)).version,command:value});
 const document=await send(owner,{type:'document.add',title:'PRIVATE_DOCUMENT_CANARY',body:'PRIVATE_BODY_CANARY',authority:'effective'}),sourceId=String(document.result.sourceId);
 const created=await send(owner,{type:'matter.create',title:'PRIVATE_CLOSED_CANARY',objective:'PRIVATE_OBJECTIVE_CANARY'}),matterId=String(created.result.matterId);
 await transactWorkspace('tenant-a',s=>{const matter=s.matters.find(item=>item.id===matterId)!;matter.sourceIds=[sourceId];matter.provenance.sourceIds=[sourceId];matter.state='closed';matter.closedAt=new Date().toISOString();matter.outcome='Historical completion';matter.proposalId=null;s.memberships.find(item=>item.actorId==='owner')!.revokedAt=new Date().toISOString();s.memberships.push({actorId:'operator',roles:['member','admin'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});s.memberships.push({actorId:'candidate',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});s.memberships.push({actorId:'unrelated',roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
 const operator:ActorContext={...owner,actorId:'operator'},deleted=await send(operator,{type:'source.revoke',sourceId,reason:'Remove the private source',delete:true});
 assert.equal(deleted.result.corrective,0);await flushWithdrawals();
 const state=await readWorkspace('tenant-a'),correction=state.matters.find(item=>item.id!==matterId)!;
 assert.equal(correction.ownerId,'operator');assert.deepEqual(correction.scope,{kind:'private',actorIds:['operator']});assert.equal(correction.tasks[0].status,'pending');
 assert.equal(correction.tasks[0].kind,'verification');assert.deepEqual(correction.provenance.sourceIds,[]);
 assert.ok(state.outbox.some(item=>item.aggregateId===correction.id&&item.status==='pending'));
 assert.ok((await snapshot(operator)).attention.items.some(item=>item.matterId===correction.id));
 assert.ok(!(await snapshot({...owner,actorId:'unrelated'})).matters.some(item=>item.id===correction.id));
 assert.ok(!state.deletionJobs?.some(job=>job.records.some(record=>record.id===correction.id)));
 assert.doesNotMatch(JSON.stringify(correction),/PRIVATE_DOCUMENT_CANARY|PRIVATE_BODY_CANARY|PRIVATE_CLOSED_CANARY|PRIVATE_OBJECTIVE_CANARY/);
 const ref=(await snapshot(operator)).withdrawalExceptions.find(item=>item.correctiveMatterId===correction.id)!.reviewRef;
 await assert.rejects(()=>send(operator,{type:'source.correction.assign',reviewRef:ref,ownerId:'unrelated',expectedRecordVersion:correction.version}),{code:'OWNER_REQUIRED'});
 await transactWorkspace('tenant-a',s=>{const item=s.matters.find(row=>row.id===correction.id)!;item.tasks.push({...item.tasks[0],id:'unexpected-legal-review',kind:'legal',title:'Unexpected review'});});
 await assert.rejects(()=>send(operator,{type:'source.correction.assign',reviewRef:ref,ownerId:'candidate',expectedRecordVersion:correction.version}),{code:'CORRECTION_WORKFLOW_CHANGED'});
 await transactWorkspace('tenant-a',s=>{const item=s.matters.find(row=>row.id===correction.id)!;item.tasks=item.tasks.filter(task=>task.id!=='unexpected-legal-review');});
 const assigned=await send(operator,{type:'source.correction.assign',reviewRef:ref,ownerId:'candidate',expectedRecordVersion:correction.version});
 assert.equal(assigned.snapshot.matters.some(item=>item.id===correction.id),false,'former admin loses the private matter');
 const candidate:ActorContext={...owner,actorId:'candidate'},current=await snapshot(candidate),work=current.matters.find(item=>item.id===correction.id)!;
 assert.equal(work.ownerId,'candidate');assert.equal(work.tasks[0].ownerId,'candidate');assert.equal(work.tasks[0].kind,'business');
 assert.ok(current.attention.items.some(item=>item.matterId===correction.id));assert.equal(current.matters.some(item=>item.id===matterId),false);
 assert.deepEqual(work.provenance.sourceIds,[]);assert.deepEqual(work.sourceIds,[]);
 await assert.rejects(()=>send(candidate,{type:'matter.prepare',matterId:correction.id,expectedRecordVersion:work.version}),{code:'CORRECTION_WORKFLOW_ONLY'});
 await assert.rejects(()=>send(candidate,{type:'matter.cancel',matterId:correction.id,expectedRecordVersion:work.version,reason:'Bypass the review'}),{code:'CORRECTION_WORKFLOW_ONLY'});
 const proof=await send(candidate,{type:'document.add',title:'Independent review record',body:'Current permitted evidence supports closing the historical review exception.',authority:'effective',scope:{kind:'private',actorIds:['candidate']}});
 const evidence=proof.snapshot.sources.at(-1)!;
 await assert.rejects(()=>send(operator,{type:'source.correction.resolve',reviewRef:ref,expectedRecordVersion:work.version,note:'I reviewed all currently permitted records and the historical effect status.',evidenceSourceIds:[evidence.id],evidenceSourceVersions:{[evidence.id]:evidence.version},evidenceSourceHashes:{[evidence.id]:evidence.contentHash},evidenceSourceDependencyHashes:{[evidence.id]:evidence.evidenceDependencyHash!}}),{code:'FORBIDDEN'});
 await assert.rejects(()=>send(candidate,{type:'source.correction.resolve',reviewRef:ref,expectedRecordVersion:work.version,note:'I reviewed the current independent record and confirmed no unresolved external effects remain.',evidenceSourceIds:[evidence.id],evidenceSourceVersions:{[evidence.id]:evidence.version},evidenceSourceHashes:{[evidence.id]:evidence.contentHash},evidenceSourceDependencyHashes:{[evidence.id]:'stale'}}),{code:'TASK_EVIDENCE_CHANGED'});
 await transactWorkspace('tenant-a',s=>{const now=new Date().toISOString();s.actions.push({id:'unresolved-correction-effect',tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(s.matters.find(item=>item.id===correction.id)!.scope),provenance:{actorId:'candidate',sourceIds:[],description:'Injected unresolved effect for closure gate'},matterId:correction.id,proposalId:'none',kind:'send',title:'Injected unresolved effect',content:'',contentHash:digest(''),recipients:[],destination:null,status:'uncertain',authorizationId:null,providerIdempotencyKey:'unresolved-correction-effect',providerReceipt:null,completion:null,executionOwner:'v2',leaseUntil:null});assert.throws(()=>applyWithdrawalCommand(s,candidate,{type:'source.correction.resolve',reviewRef:ref,expectedRecordVersion:work.version,note:'I reviewed the current independent record and confirmed no unresolved external effects remain.',evidenceSourceIds:[evidence.id],evidenceSourceVersions:{[evidence.id]:evidence.version},evidenceSourceHashes:{[evidence.id]:evidence.contentHash},evidenceSourceDependencyHashes:{[evidence.id]:evidence.evidenceDependencyHash!}}),{code:'RECONCILIATION_REQUIRED'});s.actions.pop();});
 const resolved=await send(candidate,{type:'source.correction.resolve',reviewRef:ref,expectedRecordVersion:work.version,note:'I reviewed the current independent record and confirmed no unresolved external effects remain.',evidenceSourceIds:[evidence.id],evidenceSourceVersions:{[evidence.id]:evidence.version},evidenceSourceHashes:{[evidence.id]:evidence.contentHash},evidenceSourceDependencyHashes:{[evidence.id]:evidence.evidenceDependencyHash!}});
 assert.equal(resolved.snapshot.matters.find(item=>item.id===correction.id)?.state,'closed');assert.equal(resolved.snapshot.matters.find(item=>item.id===correction.id)?.tasks[0].completion?.actorId,'candidate');
 assert.equal((await readWorkspace('tenant-a')).matters.find(item=>item.id===matterId)?.state,'closed','the original historical outcome remains unchanged');
 assert.equal(Object.values((await readWorkspace('tenant-a')).receipts).find(item=>item.result.reviewRef===ref)?.result.status,'resolved');
 assert.equal((await snapshot(operator)).withdrawalExceptions.some(item=>item.reviewRef===ref),false);
 await transactWorkspace('tenant-a',s=>{const member=s.memberships.find(item=>item.actorId==='candidate')!;member.roles.push('admin');member.version++;});
 await send(candidate,{type:'source.revoke',sourceId:evidence.id,reason:'The independent review record was later withdrawn'});
 await flushWithdrawals();
 const later=await snapshot(candidate);
 assert.equal(later.matters.some(item=>item.id===correction.id),false,'revoked completion evidence hides the former correction');
 assert.ok(later.matters.some(item=>item.id!==matterId&&item.id!==correction.id),'later evidence loss creates new corrective work');
}));
test('source withdrawal assigns corrective work to a sign-in-capable administrator when the owner lacks member access',()=>isolated(async()=>{
 const owner:ActorContext={tenantId:'tenant-a',actorId:'owner',mode:'authenticated',expiresAt:Date.now()+3600000};
 const send=async(a:ActorContext,value:WorkspaceCommand)=>command(a,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(a)).version,command:value});
 const added=await send(owner,{type:'document.add',title:'Synthetic member-access source',body:'Synthetic evidence',authority:'unknown'}),sourceId=String(added.result.sourceId);
 const created=await send(owner,{type:'matter.create',title:'Synthetic source-dependent work',objective:'Review current evidence'}),matterId=String(created.result.matterId);
 await transactWorkspace('tenant-a',s=>{const matter=s.matters.find(item=>item.id===matterId)!;matter.sourceIds=[sourceId];matter.provenance.sourceIds=[sourceId];s.memberships.find(item=>item.actorId==='owner')!.roles=['business_owner'];s.memberships.push({actorId:'operator',roles:['member','admin'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
 const operator:ActorContext={...owner,actorId:'operator'},deleted=await send(operator,{type:'source.revoke',sourceId,reason:'Withdraw synthetic evidence'});
 assert.equal(deleted.result.corrective,0);await flushWithdrawals();
 const state=await readWorkspace('tenant-a'),correction=state.matters.find(item=>item.id!==matterId)!;
 assert.equal(correction.ownerId,'operator');assert.equal(correction.tasks[0].kind,'verification');
 assert.ok((await snapshot(operator)).attention.items.some(item=>item.matterId===correction.id));
}));
test('qualified operator reviews an exact retained readback before a new owner closes unreadable historical effects',()=>isolated(async()=>{
 const owner:ActorContext={tenantId:'tenant-a',actorId:'owner',mode:'authenticated',expiresAt:Date.now()+3600000};
 const send=async(a:ActorContext,value:WorkspaceCommand)=>command(a,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(a)).version,command:value});
 const sourceId=String((await send(owner,{type:'document.add',title:'PRIVATE_ORIGINAL_CANARY',body:'PRIVATE_VERIFIED_EFFECT_CANARY',authority:'effective'})).result.sourceId);
 const matterId=String((await send(owner,{type:'matter.create',title:'PRIVATE_MATTER_CANARY',objective:'Review historical work'})).result.matterId);
 await transactWorkspace('tenant-a',s=>{const m=s.matters.find(item=>item.id===matterId)!,now=new Date().toISOString();m.sourceIds=[sourceId];m.provenance.sourceIds=[sourceId];s.actions.push({id:'verified-original-effect',tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(m.scope),provenance:{actorId:'owner',sourceIds:[sourceId],description:'Historical submitted effect'},matterId,proposalId:'historical',kind:'send',title:'PRIVATE_EFFECT_CANARY',content:'PRIVATE_VERIFIED_EFFECT_CANARY',contentHash:digest('PRIVATE_VERIFIED_EFFECT_CANARY'),recipients:[],destination:null,status:'verified',authorizationId:null,providerIdempotencyKey:'verified-original-effect',providerReceipt:'retained-receipt',completion:{kind:'readback',artifact:'retained-receipt',verifierId:'adapter:synthetic',verifiedAt:now},executionOwner:'v2',leaseUntil:null});s.receipts['execution:verified-original-effect']={hash:'retained-intent',result:{intent:{actionId:'verified-original-effect',actionHash:digest('PRIVATE_VERIFIED_EFFECT_CANARY'),adapterId:'synthetic',status:'verified',providerReceipt:'retained-receipt',completionArtifact:'retained-receipt',redactedAt:null}}};s.memberships.find(item=>item.actorId==='owner')!.revokedAt=now;s.memberships.push({actorId:'operator',roles:['member','admin'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});s.memberships.push({actorId:'new-owner',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
 const operator:ActorContext={...owner,actorId:'operator'},withdrawn=await send(operator,{type:'source.revoke',sourceId,reason:'Withdraw historical evidence'});
 assert.equal(withdrawn.result.corrective,0);await flushWithdrawals();
 const exception=(await snapshot(operator)).withdrawalExceptions[0],correction=(await readWorkspace('tenant-a')).matters.find(item=>item.id!==matterId)!;
 await send(operator,{type:'source.correction.assign',reviewRef:exception.reviewRef,ownerId:'new-owner',expectedRecordVersion:correction.version});
 const candidate:ActorContext={...owner,actorId:'new-owner'},current=await snapshot(candidate);
 assert.equal(current.matters.some(item=>item.id===matterId),false);assert.equal(current.actions.some(item=>item.id==='verified-original-effect'),false);
 const review=await send(candidate,{type:'document.add',title:'Current independent record',body:'Current authorized review evidence only.',authority:'effective',scope:{kind:'private',actorIds:['new-owner']}}),evidence=review.snapshot.sources.at(-1)!;
 const work=(await snapshot(candidate)).matters.find(item=>item.id===correction.id)!;
 assert.ok(work.blockers.some(item=>/Historical effects are not readable/.test(item)));
 await assert.rejects(()=>send(candidate,{type:'source.correction.resolve',reviewRef:exception.reviewRef,expectedRecordVersion:work.version,note:'I reviewed this independent record and cannot inspect earlier submitted effects.',evidenceSourceIds:[evidence.id],evidenceSourceVersions:{[evidence.id]:evidence.version},evidenceSourceHashes:{[evidence.id]:evidence.contentHash},evidenceSourceDependencyHashes:{[evidence.id]:evidence.evidenceDependencyHash!}}),{code:'EFFECT_REVIEW_UNAVAILABLE'});
 const preview=(await snapshot(operator)).withdrawalExceptions.find(item=>item.reviewRef===exception.reviewRef)!;
 assert.equal(preview.status,'effect_review_required');assert.equal(preview.verifiedEffects,1);assert.match(preview.effectReviewHash!,/^[a-f0-9]{64}$/);
 const generic={type:'source.correction.effect_review' as const,reviewRef:exception.reviewRef,expectedRecordVersion:preview.version!,effectReviewHash:preview.effectReviewHash!,inspectionId:'00000000-0000-0000-0000-000000000000',inspectionEvidenceHash:'0'.repeat(64),note:'I inspected the retained readback record and its exact provider receipt.'};
 await assert.rejects(()=>send(operator,generic),{code:'FORBIDDEN'});
 await transactWorkspace('tenant-a',s=>{const reviewer=s.memberships.find(item=>item.actorId==='operator')!;reviewer.roles.push('publisher');reviewer.version++;});
 await transactWorkspace('tenant-a',s=>{s.memberships.push({actorId:'restricted-reviewer',roles:['member','admin','publisher'],version:1,expiresAt:null,revokedAt:null,matterIds:['unrelated'],entityIds:null});});
 const restricted:ActorContext={...operator,actorId:'restricted-reviewer'};
 assert.equal((await snapshot(restricted)).withdrawalExceptions.length,0);
 await assert.rejects(()=>transactWorkspace('tenant-a',s=>inspectWithdrawalEffects(s,restricted,exception.reviewRef,preview.version!)),{code:'FORBIDDEN'});
 await assert.rejects(()=>send(restricted,generic),{code:'FORBIDDEN'});
 await assert.rejects(()=>send(operator,generic),{code:'EFFECT_INSPECTION_REQUIRED'},'a status fingerprint and plausible note do not prove inspection');
 await assert.rejects(()=>send(operator,{...generic,effectReviewHash:'0'.repeat(64)}),{code:'EFFECT_REVIEW_CHANGED'});
 await transactWorkspace('tenant-a',s=>{const effect=s.actions.find(item=>item.id==='verified-original-effect')!,prior=effect.providerReceipt;effect.providerReceipt=null;assert.throws(()=>inspectWithdrawalEffects(s,operator,exception.reviewRef,preview.version!),{code:'EFFECT_RECEIPT_REQUIRED'});effect.providerReceipt=prior;});
 await transactWorkspace('tenant-a',s=>{const intent=s.receipts['execution:verified-original-effect'].result.intent as {adapterId:string};intent.adapterId='different-adapter';assert.throws(()=>inspectWithdrawalEffects(s,operator,exception.reviewRef,preview.version!),{code:'EFFECT_RECEIPT_REQUIRED'});intent.adapterId='synthetic';});
 const inspected=(await transactWorkspace('tenant-a',s=>inspectWithdrawalEffects(s,operator,exception.reviewRef,preview.version!))).result;
 assert.equal(inspected.effects.length,1);assert.equal(inspected.effects[0].actionId,'verified-original-effect');assert.equal(inspected.effects[0].kind,'send');assert.equal(inspected.effects[0].providerReceipt,'retained-receipt');assert.equal(inspected.effects[0].readbackArtifact,'retained-receipt');assert.equal(inspected.effects[0].intentProviderReceipt,'retained-receipt');
 assert.doesNotMatch(JSON.stringify(inspected),/PRIVATE_ORIGINAL_CANARY|PRIVATE_EFFECT_CANARY|PRIVATE_VERIFIED_EFFECT_CANARY|PRIVATE_MATTER_CANARY/);
 const normalAfterInspection=await snapshot(operator);assert.equal(normalAfterInspection.actions.some(item=>item.id==='verified-original-effect'),false);assert.doesNotMatch(JSON.stringify(normalAfterInspection),/retained-receipt/);
 const inspectedCommand={...generic,effectReviewHash:inspected.effectReviewHash,inspectionId:inspected.inspectionId,inspectionEvidenceHash:inspected.inspectionEvidenceHash};
 const secondInspection=(await transactWorkspace('tenant-a',s=>inspectWithdrawalEffects(s,operator,exception.reviewRef,preview.version!))).result;
 assert.equal(Object.keys((await readWorkspace('tenant-a')).receipts).filter(key=>key.startsWith('source-effect-inspection:')).length,1,'repeat inspection replaces its earlier challenge');
 await assert.rejects(()=>send(operator,inspectedCommand),{code:'EFFECT_INSPECTION_REQUIRED'},'replaced inspection cannot be replayed');
 await transactWorkspace('tenant-a',s=>{const effect=s.actions.find(item=>item.id==='verified-original-effect')!;effect.completion!.artifact='new exact readback';effect.version++;});
 await assert.rejects(()=>send(operator,{...inspectedCommand,inspectionId:secondInspection.inspectionId,inspectionEvidenceHash:secondInspection.inspectionEvidenceHash}),{code:'EFFECT_REVIEW_CHANGED'},'a changed retained artifact invalidates the inspection challenge');
 await transactWorkspace('tenant-a',s=>{const effect=s.actions.find(item=>item.id==='verified-original-effect')!,intent=s.receipts['execution:verified-original-effect'].result.intent as {completionArtifact:string};effect.completion!.artifact='new exact readback';intent.completionArtifact='new exact readback';});
 const fresh=(await snapshot(operator)).withdrawalExceptions.find(item=>item.reviewRef===exception.reviewRef)!;
 const inspectionPath=join(process.env.KIARA_V2_DATA_DIR!,'retained-inspection.json'),notePath=join(process.env.KIARA_V2_DATA_DIR!,'review-note.txt'),script=join(process.cwd(),'scripts/v2-operator.ts');
 const cliInspection=JSON.parse((await execFileAsync(process.execPath,['--import','tsx',script,'withdrawal-inspect','tenant-a','operator',exception.reviewRef,String(fresh.version),(await snapshot(operator)).version.toString(),inspectionPath])).stdout);
 assert.equal(cliInspection.inspectionFile,inspectionPath);assert.equal((await stat(inspectionPath)).mode&0o777,0o600);
 const reinspected=JSON.parse(await readFile(inspectionPath,'utf8')) as ReturnType<typeof inspectWithdrawalEffects>;
 assert.equal(reinspected.effects[0].readbackArtifact,'new exact readback');
 await writeFile(notePath,'I inspected the newly retained adapter readback record and matching provider receipt; this does not claim a new delivery.',{mode:0o600});
 const tamperedPath=join(process.env.KIARA_V2_DATA_DIR!,'tampered-inspection.json');await writeFile(tamperedPath,JSON.stringify({...reinspected,effects:[{...reinspected.effects[0],readbackArtifact:'different'}]}),{mode:0o600});
 await assert.rejects(execFileAsync(process.execPath,['--import','tsx',script,'withdrawal-review','tenant-a','operator',tamperedPath,String(cliInspection.version),notePath]),/inspected evidence file is invalid/);
 await execFileAsync(process.execPath,['--import','tsx',script,'withdrawal-review','tenant-a','operator',inspectionPath,String(cliInspection.version),notePath]);
 assert.equal((await snapshot(operator)).withdrawalExceptions.find(item=>item.reviewRef===exception.reviewRef)?.status,'effect_reviewed');
 await transactWorkspace('tenant-a',s=>{s.memberships.find(item=>item.actorId==='operator')!.version++;});
 const stale=(await snapshot(candidate)).matters.find(item=>item.id===correction.id)!;
 await assert.rejects(()=>send(candidate,{type:'source.correction.resolve',reviewRef:exception.reviewRef,expectedRecordVersion:stale.version,note:'I reviewed the current independent record and the retained operator decision.',evidenceSourceIds:[evidence.id],evidenceSourceVersions:{[evidence.id]:evidence.version},evidenceSourceHashes:{[evidence.id]:evidence.contentHash},evidenceSourceDependencyHashes:{[evidence.id]:evidence.evidenceDependencyHash!}}),{code:'EFFECT_REVIEW_UNAVAILABLE'});
 const renewed=(await snapshot(operator)).withdrawalExceptions.find(item=>item.reviewRef===exception.reviewRef)!;
 const renewedInspection=(await transactWorkspace('tenant-a',s=>inspectWithdrawalEffects(s,operator,exception.reviewRef,renewed.version!))).result;
 await send(operator,{...generic,expectedRecordVersion:renewed.version!,effectReviewHash:renewedInspection.effectReviewHash,inspectionId:renewedInspection.inspectionId,inspectionEvidenceHash:renewedInspection.inspectionEvidenceHash,note:'I renewed my exact retained readback review under current delivery-review authority.'});
 const updated=(await snapshot(candidate)).matters.find(item=>item.id===correction.id)!;
 const closed=await send(candidate,{type:'source.correction.resolve',reviewRef:exception.reviewRef,expectedRecordVersion:updated.version,note:'I reviewed the current independent record after qualified operator review of the retained effect receipt.',evidenceSourceIds:[evidence.id],evidenceSourceVersions:{[evidence.id]:evidence.version},evidenceSourceHashes:{[evidence.id]:evidence.contentHash},evidenceSourceDependencyHashes:{[evidence.id]:evidence.evidenceDependencyHash!}});
 assert.equal(closed.snapshot.matters.find(item=>item.id===correction.id)?.state,'closed');
 const state=await readWorkspace('tenant-a');assert.equal(state.actions.find(item=>item.id==='verified-original-effect')?.status,'verified');assert.equal(state.matters.find(item=>item.id===matterId)?.state,'needs_facts');
 assert.doesNotMatch(JSON.stringify({matter:work,exception:current.withdrawalExceptions}),/PRIVATE_ORIGINAL_CANARY|PRIVATE_EFFECT_CANARY|PRIVATE_VERIFIED_EFFECT_CANARY|PRIVATE_MATTER_CANARY/);
}));
test('provider withdrawal commits a durable unresolved exception when no current owner or administrator exists',()=>isolated(async()=>{
 const owner:ActorContext={tenantId:'tenant-a',actorId:'owner',mode:'authenticated',expiresAt:Date.now()+3600000};
 const send=async(value:WorkspaceCommand)=>command(owner,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(owner)).version,command:value});
 const created=await send({type:'matter.create',title:'No current owner',objective:'Review evidence access'}),matterId=String(created.result.matterId);
 const signed=signedSlack({type:'event_callback',team_id:'T1',event_id:'owner-loss-input',event:{type:'message',channel:'C1',user:'U1',ts:'1750000000.120',text:'Provider observation'}}),retained=await acceptWebhook(slack.id,signed.headers,signed.raw),sourceId=String(retained.sourceId);
 const before=await snapshot(owner);await send({type:'event.link_matter',matterId,expectedMatterVersion:before.matters[0].version,sourceId,expectedSourceVersion:before.sources[0].version});
 await transactWorkspace('tenant-a',s=>{s.memberships.find(item=>item.actorId==='owner')!.revokedAt=new Date().toISOString();s.memberships.push({actorId:'restricted-operator',roles:['member','admin'],version:1,expiresAt:null,revokedAt:null,matterIds:['unrelated-matter'],entityIds:null});});
 await ingestProviderObject(slack,'owner-loss-removal',{objectId:'C1:message:1750000000.120',revision:'removed',title:'Removed',text:'',url:null,occurredAt:new Date().toISOString(),removed:true});
 await flushWithdrawals();
 const state=await readWorkspace('tenant-a');assert.equal(state.sources.find(item=>item.id===sourceId)?.status,'revoked');assert.equal(state.matters.length,1);
 const exception=Object.entries(state.receipts).find(([key,receipt])=>key.startsWith('source-withdrawal:')&&receipt.result.status==='owner_unavailable');
 assert.ok(exception,'an operator can find the exact unresolved exception after a qualified admin is provisioned');
 const restricted:ActorContext={...owner,actorId:'restricted-operator'},restrictedView=await snapshot(restricted);
 assert.deepEqual(restrictedView.withdrawalExceptions,[]);assert.equal(restrictedView.matters.length,0);
 await assert.rejects(()=>command(restricted,{idempotencyKey:randomUUID(),expectedVersion:restrictedView.version,command:{type:'source.correction.retry',reviewRef:String(exception![1].result.reviewRef)}}),{code:'FORBIDDEN'});
 await ingestProviderObject(slack,'owner-loss-removal-replayed',{objectId:'C1:message:1750000000.120',revision:'removed',title:'Removed',text:'',url:null,occurredAt:new Date().toISOString(),removed:true});
 assert.equal(Object.keys((await readWorkspace('tenant-a')).receipts).filter(key=>key.startsWith('source-withdrawal:')).length,1);
 await transactWorkspace('tenant-a',s=>{s.memberships.push({actorId:'operator',roles:['member','admin'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
 const operator:ActorContext={...owner,actorId:'operator'},visible=await snapshot(operator);
 assert.deepEqual(visible.withdrawalExceptions.map(item=>item.status),['owner_unavailable']);
 assert.equal(visible.withdrawalExceptions[0].correctiveMatterId,null);
 assert.equal(visible.matters.some(item=>item.id===matterId),false);
 assert.doesNotMatch(JSON.stringify(visible.withdrawalExceptions),/owner-loss-input|C1:message|No current owner|Provider observation/);
 const ref=visible.withdrawalExceptions[0].reviewRef;
 await command(operator,{idempotencyKey:randomUUID(),expectedVersion:visible.version,command:{type:'source.correction.retry',reviewRef:ref}});
 const recovered=await readWorkspace('tenant-a'),correction=recovered.matters.find(item=>item.id!==matterId)!;
 assert.ok(correction);assert.equal(correction.ownerId,'operator');
 assert.equal(recovered.receipts[exception![0]].result.status,'admin_exception');
 assert.ok((await snapshot(operator)).attention.items.some(item=>item.matterId===correction.id));
 assert.deepEqual((await snapshot(operator)).withdrawalExceptions.map(item=>item.status),['admin_exception']);
 await ingestProviderObject(slack,'owner-loss-removal-again',{objectId:'C1:message:1750000000.120',revision:'removed',title:'Removed',text:'',url:null,occurredAt:new Date().toISOString(),removed:true});
 assert.equal((await readWorkspace('tenant-a')).matters.length,2);
}));
test('withdrawal identifies a matter reached only through a confirmed fact source lineage',()=>isolated(async()=>{
 const owner:ActorContext={tenantId:'tenant-a',actorId:'owner',mode:'authenticated',expiresAt:Date.now()+3600000};
 const send=async(value:WorkspaceCommand)=>command(owner,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(owner)).version,command:value});
 await transactWorkspace('tenant-a',s=>{s.memberships.find(item=>item.actorId==='owner')!.roles.push('fact_owner');});
 const supplied=await send({type:'document.add',title:'Evidence source',body:'Factual evidence for a planned change.',authority:'effective'}),sourceId=String(supplied.result.sourceId);
 const proposed=await send({type:'fact.propose',predicate:'planned_change',value:'A proposed change',sourceIds:[sourceId]}),fact=proposed.snapshot.facts.at(-1)!;
 await send({type:'fact.confirm',factId:fact.id,expectedRecordVersion:fact.version,expectedOriginVersion:fact.originVersion});
 const created=await send({type:'matter.create',title:'Work from a fact',objective:'Review the planned change'}),matterId=String(created.result.matterId);
 await transactWorkspace('tenant-a',s=>{const matter=s.matters.find(item=>item.id===matterId)!;matter.factIds=[fact.id];matter.provenance.factIds=[fact.id];assert.deepEqual(matter.sourceIds,[]);assert.deepEqual(matter.provenance.sourceIds,[]);});
 await send({type:'source.revoke',sourceId,reason:'Remove factual evidence'});
 await flushWithdrawals();
 const state=await readWorkspace('tenant-a'),correction=state.matters.find(item=>item.id!==matterId)!;
 assert.ok(correction);assert.equal(correction.ownerId,'owner');assert.deepEqual(correction.provenance.sourceIds,[]);
 assert.ok((await snapshot(owner)).attention.items.some(item=>item.matterId===correction.id));
}));
test('owner links two signed provider observations to one matter with an inline review update',()=>isolated(async()=>{
 const owner:ActorContext={tenantId:'tenant-a',actorId:'owner',mode:'authenticated',expiresAt:Date.now()+3600000};
 const send=async(value:WorkspaceCommand)=>command(owner,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(owner)).version,command:value});
 const created=await send({type:'matter.create',title:'Synthetic rollout review',objective:'Review a possible product change'}),matterId=String(created.result.matterId);
 const gh=signedGitHub(pr());const pull=await acceptWebhook(github.id,gh.headers,gh.raw);
 const slackEvent={type:'event_callback',team_id:'T1',event_id:'Ev-same-matter',event:{type:'message',channel:'C1',user:'U1',ts:'1750000000.777',text:'Discussing a possible synthetic-data launch.'}};
 const signed=signedSlack(slackEvent);const thread=await acceptWebhook(slack.id,signed.headers,signed.raw);
 assert.equal(pull.matterId,null);assert.equal(thread.matterId,null);
 await transactWorkspace('tenant-a',s=>{s.memberships.push({actorId:'second-owner',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
 const second:ActorContext={...owner,actorId:'second-owner'},beforeLink=await snapshot(second),target=beforeLink.matters.find(item=>item.id===matterId)!,candidate=beforeLink.sources.find(item=>item.id===pull.sourceId)!;
 await assert.rejects(command(second,{idempotencyKey:randomUUID(),expectedVersion:beforeLink.version,command:{type:'event.link_matter',sourceId:candidate.id,expectedSourceVersion:candidate.version,matterId,expectedMatterVersion:target.version}}),{code:'MATTER_OWNER_REQUIRED'});
 for(const sourceId of [String(pull.sourceId),String(thread.sourceId)]){const view=await snapshot(owner),matter=view.matters.find(item=>item.id===matterId)!,source=view.sources.find(item=>item.id===sourceId)!;await send({type:'event.link_matter',sourceId,expectedSourceVersion:source.version,matterId,expectedMatterVersion:matter.version});}
 const view=await snapshot(owner),matter=view.matters.find(item=>item.id===matterId)!;
 assert.deepEqual(new Set(matter.sourceIds),new Set([pull.sourceId,thread.sourceId]));
 const updates=view.messages.filter(message=>matter.conversationIds.includes(message.conversationId)&&message.provenance.sourceIds.some(id=>matter.sourceIds.includes(id)));
 assert.equal(updates.length,2);assert.ok(updates.every(message=>message.text.includes('not proof of deployment')&&message.role==='assistant'&&message.citations.length===1));assert.equal(view.facts.length,0);
 await assert.rejects(send({type:'event.link_matter',sourceId:String(pull.sourceId),expectedSourceVersion:view.sources.find(item=>item.id===pull.sourceId)!.version,matterId,expectedMatterVersion:matter.version}),{code:'EVENT_ALREADY_LINKED'});
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
 const processor=async(tenantId:string,runId:string)=>{seen.push({tenantId,runId});return {id:runId,version:1,conversationId:'conversation-1',userMessageId:'question-1',status:'complete' as const,reason:'Sensitive private explanation must not enter history',assistantMessageId:'answer-1',createdAt:'now',updatedAt:'now'};};
 assert.deepEqual(await processConversationReference(ref,processor),{status:'complete'});await processLocalOutboxOnce('tenant-a',{processor});assert.equal((await readWorkspace('tenant-a')).outbox[0].status,'dispatched');assert.deepEqual(seen[0],{tenantId:'tenant-a',runId:'run-1'});assert.ok(!JSON.stringify(await processConversationReference(ref,processor)).includes('Sensitive'));
}));
test('local runner waits through active lease, retains unknown outcomes, and respects managed owner',()=>isolated(async()=>{
 await transactWorkspace('tenant-a',s=>{s.outbox.push({id:'answer-outbox',tenantId:s.tenantId,kind:'conversation_answer',aggregateId:'run-1',commandId:'question-1',status:'pending',owner:'v2',createdAt:new Date().toISOString()});});
 let calls=0;const deferred=new Map<string,number>(),processor=async(_tenantId:string,runId:string)=>({id:runId,version:1,conversationId:'c',userMessageId:'m',status:++calls===1?'running' as const:'unknown' as const,reason:null,assistantMessageId:null,createdAt:'now',updatedAt:'now'});
 assert.equal((await processLocalOutboxOnce('tenant-a',{processor,deferred})).waiting,1);await processLocalOutboxOnce('tenant-a',{processor,deferred});assert.equal(calls,1);assert.equal((await readWorkspace('tenant-a')).outbox[0].status,'pending');deferred.set('answer-outbox',0);await processLocalOutboxOnce('tenant-a',{processor,deferred});assert.equal(calls,2);assert.equal((await readWorkspace('tenant-a')).outbox[0].status,'dispatched');process.env.KIARA_V2_ORCHESTRATION_MODE='temporal';await assert.rejects(processLocalOutboxOnce('tenant-a',{processor}),{code:'ORCHESTRATION_OWNER'});assert.equal(calls,2);
}));
test('Temporal dispatch selects conversation workflow by kind and excludes external actions',()=>isolated(async()=>{
 await transactWorkspace('tenant-a',s=>{s.outbox.push({id:'answer-outbox',tenantId:s.tenantId,kind:'conversation_answer',aggregateId:'run-1',commandId:'question-1',status:'pending',owner:'v2',createdAt:new Date().toISOString()},{id:'external-outbox',tenantId:s.tenantId,kind:'external_action',aggregateId:'action-1',commandId:'action-1',status:'pending',owner:'v2',createdAt:new Date().toISOString()});});
 const calls:unknown[]=[];await dispatchOutbox('tenant-a',{signal:async(ref,kind)=>{calls.push({ref,kind});}});assert.deepEqual(calls,[{ref:{tenantId:'tenant-a',aggregateId:'run-1',outboxId:'answer-outbox'},kind:'conversation_answer'}]);assert.equal((await readWorkspace('tenant-a')).outbox[1].status,'pending');
}));
test('deferred effect reads cannot starve newer local conversation work beyond the batch boundary',()=>isolated(async()=>{
 const deferred=new Map<string,number>();await transactWorkspace('tenant-a',s=>{for(let i=0;i<100;i++){const id=`effect-${i}`;s.outbox.push({id,tenantId:s.tenantId,kind:'effect_reconcile',aggregateId:`action-${i}`,commandId:id,status:'pending',owner:'v2',createdAt:new Date().toISOString()});deferred.set(id,Date.now()+3600000);}s.outbox.push({id:'later-answer',tenantId:s.tenantId,kind:'conversation_answer',aggregateId:'later-run',commandId:'question',status:'pending',owner:'v2',createdAt:new Date().toISOString()});});let calls=0;await processLocalOutboxOnce('tenant-a',{deferred,processor:async(_tenant,runId)=>{calls++;return {id:runId,version:1,conversationId:'c',userMessageId:'m',status:'complete',reason:null,assistantMessageId:'a',createdAt:'now',updatedAt:'now'};},effectProcessor:async()=>{throw Error('Deferred effects must not run');}});assert.equal(calls,1);assert.equal((await readWorkspace('tenant-a')).outbox.find(o=>o.id==='later-answer')!.status,'dispatched');
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
