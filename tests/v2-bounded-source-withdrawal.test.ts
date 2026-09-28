import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canRead} from '../src/v2/authority';
import type {Action,ActorContext,Matter,Proposal,RecordBase,Source,WorkspaceState} from '../src/v2/contracts';
import {ingestProviderObject} from '../src/v2/integrations/intake';
import type {Installation} from '../src/v2/integrations/config';
import {processLocalOutboxOnce} from '../src/v2/orchestration/conversations';
import {processWithdrawalReference} from '../src/v2/orchestration/withdrawal';
import {withdrawalWorkflowId} from '../src/v2/orchestration/temporal';
import {command,snapshotFromState} from '../src/v2/service';
import {pendingSourceWithdrawalSummary,resumeSourceWithdrawal} from '../src/v2/source-corrective';
import {closeV2Store,digest,readWorkspace,timestamp,transactWorkspace} from '../src/v2/store';

const tenantId='bounded-withdrawal';
const owner:ActorContext={tenantId,actorId:'owner',mode:'authenticated',expiresAt:Date.now()+60_000};
const scope={kind:'team' as const,actorIds:[] as string[]};
function base(s:WorkspaceState,id:string,actorId='owner'):RecordBase{return {id,tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope,provenance:{actorId,sourceIds:[],description:'Synthetic bounded withdrawal evidence'}};}
function addSource(s:WorkspaceState,id:string,kind:Source['kind']='manual',installation?:Installation){
 const source:Source={...base(s,id,installation?.actorId),title:'Synthetic retained evidence',kind,externalId:installation?`${installation.id}:repo:pull:7`:null,externalRevision:'1',text:'PRIVATE_SOURCE_BYTES',contentHash:digest('PRIVATE_SOURCE_BYTES'),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'unknown',originalObjectRef:null,...(installation?{installationGrant:{installationId:installation.id,configurationHash:digest(installation)}}:{})};
 s.sources.push(source);return source;
}
function addMatters(s:WorkspaceState,source:Source,count:number){for(let n=0;n<count;n++){const matter:Matter={...base(s,`matter-${source.id}-${n}`),provenance:{actorId:'owner',sourceIds:[source.id],description:'Synthetic work linked to exact retained source'},title:'Review synthetic evidence',objective:'Inspect observed evidence',entityId:s.entityId,state:'business_review',ownerId:'owner',conversationIds:[],scenarioId:null,eventIds:[],sourceIds:[source.id],factIds:[],documentIds:[],proposalId:null,tasks:[],blockers:[],outcome:null,closedAt:null,ruleVersion:s.ruleVersion};s.matters.push(matter);}}
async function isolated(run:()=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'kiara-bounded-withdrawal-')),prior={root:process.env.KIARA_V2_DATA_DIR,mode:process.env.KIARA_V2_STORE_MODE,mongo:process.env.MONGODB_URI,installations:process.env.KIARA_V2_INSTALLATIONS};process.env.KIARA_V2_DATA_DIR=root;delete process.env.KIARA_V2_STORE_MODE;delete process.env.MONGODB_URI;delete process.env.KIARA_V2_INSTALLATIONS;try{await run();}finally{await closeV2Store();for(const [key,value] of Object.entries({KIARA_V2_DATA_DIR:prior.root,KIARA_V2_STORE_MODE:prior.mode,MONGODB_URI:prior.mongo,KIARA_V2_INSTALLATIONS:prior.installations})){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(root,{recursive:true,force:true});}}
function addMembers(s:WorkspaceState,integration?:string){s.memberships.push({actorId:'owner',roles:['member','admin','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});if(integration)s.memberships.push({actorId:integration,roles:['integration'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});}
const corrections=(s:WorkspaceState)=>s.events.filter(event=>event.type==='source.withdrawal_correction').length;

test('direct revoke fences immediately, then resumes 46 linked matters without duplicate correction or outbox',async()=>isolated(async()=>{
 await transactWorkspace(tenantId,s=>{addMembers(s);const source=addSource(s,'source-manual');addMatters(s,source,46);const matter=s.matters[0];
  const proposal:Proposal={...base(s,'reviewed-proposal'),provenance:{actorId:'owner',sourceIds:[source.id],description:'Synthetic reviewed basis'},matterId:matter.id,title:'Prior reviewed plan',body:'Prior effect',contentHash:digest('Prior effect'),baselineRevisionIds:[],dependencies:{sourceVersions:{[source.id]:source.version},factVersions:{},documentHashes:{},policyVersion:s.ruleVersion,scopeHash:digest(scope)},status:'current',route:'legal_review',noticeMatrix:[],inventoryComplete:false,unknowns:[],supersedesId:null};s.proposals.push(proposal);matter.proposalId=proposal.id;
  const action:Action={...base(s,'historical-effect'),matterId:matter.id,proposalId:proposal.id,kind:'internal_document',title:'Completed historical effect',content:'Prior effect',contentHash:digest('Prior effect'),recipients:[],destination:null,status:'verified',authorizationId:null,providerIdempotencyKey:'historical-effect',providerReceipt:'prior-readback',completion:{kind:'readback',artifact:'prior-readback',verifierId:'owner',verifiedAt:timestamp()},executionOwner:'v2',leaseUntil:null};s.actions.push(action);
 });
 const before=await readWorkspace(tenantId),envelope={idempotencyKey:randomUUID(),expectedVersion:before.version,command:{type:'source.revoke' as const,sourceId:'source-manual',reason:'Synthetic access loss',expectedRecordVersion:1}};
 const first=await command(owner,envelope),state=await readWorkspace(tenantId);assert.equal(first.result.corrective,0);assert.equal(state.sources[0].status,'revoked');assert.equal(canRead(state,owner,state.sources[0]),false);assert.equal(corrections(state),0);assert.deepEqual(pendingSourceWithdrawalSummary(state),[{sourceId:'source-manual',remaining:46,deletionPending:false}]);
 const replay=await command(owner,envelope);assert.equal(replay.replayed,true);assert.equal(corrections(await readWorkspace(tenantId)),0);
 const ref=state.outbox.find(outbox=>outbox.kind==='source_withdrawal')!;const reference={tenantId,aggregateId:ref.aggregateId,outboxId:ref.id};
 assert.deepEqual(await processWithdrawalReference(reference),{status:'waiting',remaining:26,nextCheckMs:1000});await transactWorkspace(tenantId,s=>{s.outbox.find(item=>item.id===ref.id)!.status='dispatched';});assert.deepEqual(await resumeSourceWithdrawal(tenantId,'source-manual'),{status:'waiting',remaining:6,nextCheckMs:1000});assert.equal((await resumeSourceWithdrawal(tenantId,'source-manual')).status,'complete');
 const done=await readWorkspace(tenantId);assert.equal(corrections(done),46);assert.equal(done.outbox.filter(outbox=>outbox.kind==='matter_changed').length,46);assert.deepEqual(pendingSourceWithdrawalSummary(done),[]);assert.equal(done.actions[0].status,'verified');assert.equal(done.actions[0].providerReceipt,'prior-readback');assert.equal((await processWithdrawalReference(reference)).status,'complete');assert.equal(corrections(await readWorkspace(tenantId)),46);
}));

test('delete scrubs bytes and starts retention before bounded corrections finish, then resumes after redaction',async()=>isolated(async()=>{
 await transactWorkspace(tenantId,s=>{addMembers(s);const source=addSource(s,'source-delete');addMatters(s,source,47);s.proposals.push({...base(s,'delete-proposal'),provenance:{actorId:'owner',sourceIds:[source.id],description:'Synthetic deletion decision'},matterId:s.matters[0].id,title:'Old review',body:'Old source-based decision',contentHash:digest('Old source-based decision'),baselineRevisionIds:[],dependencies:{sourceVersions:{[source.id]:source.version},factVersions:{},documentHashes:{},policyVersion:s.ruleVersion,scopeHash:digest(scope)},status:'current',route:'legal_review',noticeMatrix:[],inventoryComplete:false,unknowns:[],supersedesId:null});});
 const before=await readWorkspace(tenantId);await command(owner,{idempotencyKey:randomUUID(),expectedVersion:before.version,command:{type:'source.revoke',sourceId:'source-delete',reason:'Synthetic deletion',delete:true,expectedRecordVersion:1}});
 let state=await readWorkspace(tenantId);assert.equal(state.sources[0].status,'revoked');assert.equal(canRead(state,owner,state.sources[0]),false);assert.equal(state.sources[0].text,'PRIVATE_SOURCE_BYTES');assert.equal(state.deletionJobs?.length||0,0);assert.equal(corrections(state),0);assert.deepEqual(pendingSourceWithdrawalSummary(state),[{sourceId:'source-delete',remaining:47,deletionPending:true}]);
 await resumeSourceWithdrawal(tenantId,'source-delete');state=await readWorkspace(tenantId);assert.equal(state.sources[0].status,'deleted');assert.equal(state.sources[0].text,'');assert.ok(state.deletionJobs?.some(job=>job.sourceId==='source-delete'));assert.equal(state.tombstones.filter(row=>row.sourceId==='source-delete').length,1);assert.equal(corrections(state),20);assert.equal(pendingSourceWithdrawalSummary(state)[0].remaining,27);
 await resumeSourceWithdrawal(tenantId,'source-delete');state=await readWorkspace(tenantId);assert.equal(corrections(state),40);assert.equal(pendingSourceWithdrawalSummary(state)[0].remaining,7);
 await resumeSourceWithdrawal(tenantId,'source-delete');state=await readWorkspace(tenantId);assert.equal(corrections(state),47);assert.equal(state.outbox.filter(outbox=>outbox.kind==='matter_changed').length,47);assert.equal(state.proposals[0].status,'invalidated');assert.deepEqual(pendingSourceWithdrawalSummary(state),[]);assert.equal(state.sources[0].text,'');
}));

test('provider removal fences 25 historical revisions and local worker drains retained correction jobs',async()=>isolated(async()=>{
 const installation:Installation={id:'github-1',provider:'github',tenantId,actorId:'integration',enabled:true,tokenEnv:'TEST_PROVIDER_TOKEN',webhookSecretEnv:'TEST_PROVIDER_SECRET',resources:['repo'],scope};process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([installation]);
 await transactWorkspace(tenantId,s=>{addMembers(s,'integration');for(let n=0;n<25;n++){const source=addSource(s,`provider-${n}`,'github',installation);source.externalRevision=String(n+1);addMatters(s,source,1);}});
 const removed={objectId:'repo:pull:7',revision:'removed',title:'Removed',text:'',url:null,occurredAt:timestamp(),removed:true};await ingestProviderObject(installation,'remove-1',removed);
 let state=await readWorkspace(tenantId);assert.equal(state.sources.filter(source=>source.status==='revoked').length,25);assert.equal(corrections(state),0);assert.equal(pendingSourceWithdrawalSummary(state).length,25);assert.ok(state.sources.every(source=>!canRead(state,owner,source)));
 await processLocalOutboxOnce(tenantId);state=await readWorkspace(tenantId);assert.equal(corrections(state),25);assert.equal(state.outbox.filter(outbox=>outbox.kind==='matter_changed').length,25);assert.deepEqual(pendingSourceWithdrawalSummary(state),[]);
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([installation]);await ingestProviderObject(installation,'remove-1',removed);state=await readWorkspace(tenantId);assert.equal(corrections(state),25,'duplicate removal cannot duplicate corrective records');
}));

test('a failed correction batch cannot roll back the committed access fence',async()=>isolated(async()=>{
 await transactWorkspace(tenantId,s=>{addMembers(s);addMatters(s,addSource(s,'source-capacity'),1);});
 await command(owner,{idempotencyKey:randomUUID(),expectedVersion:(await readWorkspace(tenantId)).version,command:{type:'source.revoke',sourceId:'source-capacity',reason:'Synthetic capacity boundary',expectedRecordVersion:1}});
 const pending=await readWorkspace(tenantId),outbox=pending.outbox.find(item=>item.kind==='source_withdrawal')!;
 await transactWorkspace(tenantId,s=>{s.receipts['test-capacity-padding']={hash:'synthetic',result:{padding:'x'.repeat(11_999_000-Buffer.byteLength(JSON.stringify(s))-100)}};});
 await assert.rejects(processWithdrawalReference({tenantId,aggregateId:'source-capacity',outboxId:outbox.id}),(error:{code?:string})=>error.code==='WORKSPACE_CAPACITY');
 let state=await readWorkspace(tenantId);assert.equal(state.sources[0].status,'revoked');assert.equal(canRead(state,owner,state.sources[0]),false);assert.equal(corrections(state),0);assert.equal(pendingSourceWithdrawalSummary(state)[0].remaining,1);
 await transactWorkspace(tenantId,s=>{delete s.receipts['test-capacity-padding'];});
 assert.equal((await processWithdrawalReference({tenantId,aggregateId:'source-capacity',outboxId:outbox.id})).status,'complete');state=await readWorkspace(tenantId);assert.equal(corrections(state),1);assert.equal(state.outbox.filter(item=>item.kind==='matter_changed').length,1);
}));

test('delete redaction failure remains visible and retries exactly one job; revoke then delete upgrades progress',async()=>isolated(async()=>{
 await transactWorkspace(tenantId,s=>{addMembers(s);addMatters(s,addSource(s,'source-upgrade'),1);});
 await command(owner,{idempotencyKey:randomUUID(),expectedVersion:(await readWorkspace(tenantId)).version,command:{type:'source.revoke',sourceId:'source-upgrade',reason:'Initial withdrawal',expectedRecordVersion:1}});
 await resumeSourceWithdrawal(tenantId,'source-upgrade');let state=await readWorkspace(tenantId);assert.deepEqual(pendingSourceWithdrawalSummary(state),[]);assert.equal(corrections(state),1);
 const source=state.sources[0];await command(owner,{idempotencyKey:randomUUID(),expectedVersion:state.version,command:{type:'source.revoke',sourceId:source.id,reason:'Delete withdrawn source',delete:true,expectedRecordVersion:source.version}});
 state=await readWorkspace(tenantId);assert.equal(state.sources[0].status,'revoked');assert.deepEqual(pendingSourceWithdrawalSummary(state),[{sourceId:'source-upgrade',remaining:0,deletionPending:true}]);assert.equal(state.outbox.filter(item=>item.kind==='source_withdrawal'&&item.status==='pending').length,1);
 const refs=state.outbox.filter(item=>item.kind==='source_withdrawal').map(item=>({tenantId,aggregateId:item.aggregateId,outboxId:item.id}));assert.equal(refs.length,2);assert.notEqual(withdrawalWorkflowId(refs[0]),withdrawalWorkflowId(refs[1]));assert.equal(withdrawalWorkflowId(refs[1]),withdrawalWorkflowId({...refs[1]}));
 await assert.rejects(processWithdrawalReference(refs[0]),{code:'OUTBOX_NOT_FOUND'});
 const prior=process.env.KIARA_RETENTION_ORIGINAL_DAYS;process.env.KIARA_RETENTION_ORIGINAL_DAYS='invalid';
 try{await assert.rejects(resumeSourceWithdrawal(tenantId,'source-upgrade'),(error:{code?:string})=>error.code==='RETENTION_CONFIG_INVALID');}finally{if(prior===undefined)delete process.env.KIARA_RETENTION_ORIGINAL_DAYS;else process.env.KIARA_RETENTION_ORIGINAL_DAYS=prior;}
 state=await readWorkspace(tenantId);assert.equal(state.sources[0].status,'revoked');assert.equal(canRead(state,owner,state.sources[0]),false);assert.equal(state.sources[0].text,'PRIVATE_SOURCE_BYTES');assert.equal(state.deletionJobs?.length||0,0);assert.equal(pendingSourceWithdrawalSummary(state)[0].deletionPending,true);
 assert.equal((await resumeSourceWithdrawal(tenantId,'source-upgrade')).status,'complete');state=await readWorkspace(tenantId);assert.equal(state.sources[0].status,'deleted');assert.equal(state.sources[0].text,'');assert.equal(state.deletionJobs?.filter(job=>job.sourceId==='source-upgrade').length,1);assert.equal(state.outbox.filter(item=>item.kind==='retention_cleanup').length,1);assert.equal(corrections(state),1);assert.deepEqual(pendingSourceWithdrawalSummary(state),[]);
}));

test('proposal-only deletion still invalidates frozen decisions after redaction',async()=>isolated(async()=>{
 await transactWorkspace(tenantId,s=>{addMembers(s);const source=addSource(s,'source-proposal-only');s.proposals.push({...base(s,'proposal-only'),provenance:{actorId:'owner',sourceIds:[source.id],description:'Synthetic source basis'},matterId:'historical-matter',title:'Prior decision',body:'Prior decision body',contentHash:digest('Prior decision body'),baselineRevisionIds:[],dependencies:{sourceVersions:{[source.id]:1},factVersions:{},documentHashes:{},policyVersion:s.ruleVersion,scopeHash:digest(scope)},status:'current',route:'legal_review',noticeMatrix:[],inventoryComplete:false,unknowns:[],supersedesId:null});});
 const accepted=await command(owner,{idempotencyKey:randomUUID(),expectedVersion:(await readWorkspace(tenantId)).version,command:{type:'source.revoke',sourceId:'source-proposal-only',reason:'Remove proposal basis',delete:true,expectedRecordVersion:1}});assert.equal(accepted.result.correctionStatus,'queued');
 let state=await readWorkspace(tenantId);assert.equal(state.proposals[0].status,'current');assert.deepEqual(pendingSourceWithdrawalSummary(state),[{sourceId:'source-proposal-only',remaining:0,deletionPending:true}]);
 assert.equal((await resumeSourceWithdrawal(tenantId,'source-proposal-only')).status,'complete');state=await readWorkspace(tenantId);assert.equal(state.sources[0].status,'deleted');assert.equal(state.proposals[0].status,'invalidated');assert.equal(state.deletionJobs?.length,1);assert.deepEqual(pendingSourceWithdrawalSummary(state),[]);
}));

test('pending withdrawal projects a sparse-provenance proposal and action as unusable before worker pass',async()=>isolated(async()=>{
 await transactWorkspace(tenantId,s=>{addMembers(s);const source=addSource(s,'source-read-fence');addMatters(s,source,1);const matter=s.matters[0];matter.sourceIds=[];matter.provenance.sourceIds=[];matter.state='authorized_action';const proposal:Proposal={...base(s,'pending-proposal'),matterId:matter.id,title:'Old decision',body:'Old decision',contentHash:digest('Old decision'),baselineRevisionIds:[],dependencies:{sourceVersions:{[source.id]:1},factVersions:{},documentHashes:{},policyVersion:s.ruleVersion,scopeHash:digest(scope)},status:'current',route:'legal_review',noticeMatrix:[],inventoryComplete:false,unknowns:[],supersedesId:null};s.proposals.push(proposal);matter.proposalId=proposal.id;s.actions.push({...base(s,'pending-action'),matterId:matter.id,proposalId:proposal.id,kind:'internal_document',title:'Old action',content:'Old decision',contentHash:digest('Old decision'),recipients:[],destination:null,status:'pending_manual',authorizationId:'old-approval',providerIdempotencyKey:'pending-action',providerReceipt:null,completion:null,executionOwner:'v2',leaseUntil:null});});
 await command(owner,{idempotencyKey:randomUUID(),expectedVersion:(await readWorkspace(tenantId)).version,command:{type:'source.revoke',sourceId:'source-read-fence',reason:'Withdraw decision basis',expectedRecordVersion:1}});
 const state=await readWorkspace(tenantId);assert.equal(state.proposals[0].status,'current','durable invalidation is queued separately');assert.equal(state.actions[0].status,'pending_manual');
 const view=snapshotFromState(state,owner);assert.equal(view.proposals[0].status,'invalidated');assert.equal(view.actions[0].status,'planned');assert.equal(view.actions[0].authorizationId,null);
 await resumeSourceWithdrawal(tenantId,'source-read-fence');const done=await readWorkspace(tenantId);assert.equal(done.proposals[0].status,'invalidated');assert.equal(done.actions[0].status,'planned');
}));
