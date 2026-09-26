import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signup,tick,feedback,verifyFact,verifyModelFact,review,modelProposals} from '../src/workflow/engine';
import {readState,transaction,resetStore} from '../src/data/store';
import {executeModel,type ModelProvider} from '../src/runtime/index';
import {initializeLedger,reserveAttempt,saveLedger,syncCounters} from '../src/runtime/budget';
import {id,hash} from '../src/server/hash';
import {dispatchNotification,retryNotification,webhook} from '../src/server/notifications';
import type {Json,Workflow} from '../src/server/contracts';
import {GET,POST} from '../src/app/api/[...path]/route';

const editGuard=(w:Workflow)=>({expected_candidate_revision_id:w.candidate_revision_id!,expected_state_version:w.state_version});

async function isolated(run:()=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'kiara-independent-review-'));
 const before={...process.env};
 process.env.KIARA_DATA_DIR=dir;delete process.env.MONGODB_URI;delete process.env.OPENAI_API_KEY;
 process.env.KIARA_MODEL_MODE='scripted';process.env.KIARA_EMAIL_MODE='preview';process.env.KIARA_ALLOW_LIVE_EMAIL='false';
 try{await run();}finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
}
async function start(scenario='covered'){
 const s=await readState();
 const result=await signup({customer_name:'Independent review fixture',residence:'US-CA',scenario,expected_reset_epoch:s.reset_epoch},id());
 for(let i=0;i<30;i++){
  const w=(await readState()).workflows.find(w=>w.workflow_id===result.workflow_id)!;
  if(['awaiting_founder','needs_information'].includes(w.state))return w;
  await tick();
 }
 const failed=(await readState()).workflows.find(w=>w.workflow_id===result.workflow_id)!;
 throw new Error('Workflow did not reach review: '+failed.state+' '+JSON.stringify(failed.validations.at(-1)));
}

test('review regression: unresolved model charges survive human-edit validation',()=>isolated(async()=>{
 const w=await start();
 await transaction(s=>{
  const current=s.workflows[0];current.model_mode='openai';current.model_status='unknown_charge';current.state='needs_human_review';
  const ledger=initializeLedger(s,current),attempt=reserveAttempt(ledger,'semantic_validation',1000,4000);
  attempt.status='unknown';saveLedger(s,current,ledger);syncCounters(current,ledger);
 });
 const before=await readState(),draft=before.revisions.find(r=>r.revision_id===w.candidate_revision_id)!;
 const clause=draft.clauses.find(c=>c.heading==='California privacy rights')!;
 await feedback(w.workflow_id,'lawyer',{type:'document_edit',text:clause.body+' Please contact us with questions.',clause_id:clause.clause_id,expected_reset_epoch:w.reset_epoch,...editGuard(before.workflows[0])},id());
 let countCalls=0;
 const provider:ModelProvider={count:async()=>{countCalls++;throw new Error('No network: counting must never start while a charge is unresolved');},create:async()=>{throw new Error('No network');}};
 await executeModel(w.workflow_id,w.reset_epoch,provider,'validate');
 const after=await readState();
 assert.equal(countCalls,0,'Unresolved model charges must block new provider activity');
 assert.equal(after.workflows[0].unknown_charge,true,'An archived unknown charge must remain fenced');
 assert.ok(after.workflows[0].reserved_cost>0,'Unresolved reservation must not disappear');
 await assert.rejects(resetStore(w.reset_epoch),/reconcil|Resolve/);
}));

test('review: authenticated early delivery receipts reconcile once when the send response arrives',()=>isolated(async()=>{
 const w=await start();
 process.env.KIARA_EMAIL_MODE='delivery';process.env.KIARA_ALLOW_LIVE_EMAIL='true';
 process.env.RESEND_API_KEY='re_test_only_fake';process.env.KIARA_EMAIL_FROM='sender@example.com';process.env.KIARA_LAWYER_EMAIL='recipient@example.com';
 const secret=Buffer.from('independent-test-only-webhook-secret');process.env.RESEND_WEBHOOK_SECRET='whsec_'+secret.toString('base64');
 await review(w.workflow_id,'founder',{action:'approved',expected_state_version:w.state_version,expected_reset_epoch:w.reset_epoch,bundle_hash:w.bundle_hash!,note:'Test review'},id());
 const providerID='email_independent_test',messageID='evt_independent_test',timestamp=String(Math.floor(Date.now()/1000));
 const payload=JSON.stringify({type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:providerID}});
 const signature='v1,'+createHmac('sha256',secret).update(`${messageID}.${timestamp}.${payload}`).digest('base64');
 const request=()=>new Request('http://localhost/api/webhooks/resend',{method:'POST',body:payload,headers:{'svix-id':messageID,'svix-timestamp':timestamp,'svix-signature':signature}});
 const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{
  calls++;await webhook(request());await webhook(request());
  return new Response(JSON.stringify({id:providerID}),{status:200,headers:{'content-type':'application/json'}});
 };
 try{await dispatchNotification();}finally{globalThis.fetch=originalFetch;}
 const state=await readState();
 assert.equal(calls,1);assert.equal(state.notifications[0].status,'delivered');
 assert.equal(state.notifications[0].provider_message_id,providerID);
 assert.equal(Object.keys(state.receipts).filter(k=>k.endsWith(':webhook:'+messageID)).length,1);
 assert.equal(state.workflows[0].state,'awaiting_lawyer','A delivery receipt never supplies legal approval');
 await assert.rejects(resetStore(w.reset_epoch),/reconcil|Resolve|Retain/);
}));

test('review regression: verified company facts preserve signup-specific provenance',()=>isolated(async()=>{
 const w=await start('unknown');
 const correction=await feedback(w.workflow_id,'founder',{type:'fact_correction',text:'Verified prior-year synthetic revenue',fact_key:'annual_gross_revenue_usd',proposed_value:30000000,expected_reset_epoch:w.reset_epoch},id());
 await verifyFact(correction.feedback_id,'founder',w.reset_epoch);
 const current=(await readState()).workflows[0];
 const value=(key:string)=>current.facts.find(f=>f.fact_key===key)?.value;
 assert.equal(value('declared_legal_residence'),'US-CA');
 assert.equal(value('physical_state_at_collection'),'US-CA');
 assert.equal(value('ca_consumers_commercial_processing_current_year'),1);
 assert.equal(value('ca_processing_initiated_on'),'2026-09-26');
}));

test('review regression: changed input can start a new settled model ledger',()=>isolated(async()=>{
 process.env.KIARA_MODEL_MODE='openai';
 const s=await readState(),created=await signup({customer_name:'New snapshot',residence:'US-CA',scenario:'covered',expected_reset_epoch:s.reset_epoch},id());
 for(let i=0;i<20;i++)if(await tick())break;
 const first=(await readState()).workflows[0];
 await executeModel(first.workflow_id,first.reset_epoch,{count:async()=>1000,create:async()=>{throw Object.assign(new Error('Explicit test rejection'),{status:400});}});
 const correction=await feedback(created.workflow_id,'founder',{type:'fact_correction',text:'Correct settled run inputs',fact_key:'annual_gross_revenue_usd',proposed_value:31000000,expected_reset_epoch:first.reset_epoch},id());
 await verifyFact(correction.feedback_id,'founder',first.reset_epoch);
 for(let i=0;i<20;i++)if(await tick())break;
 let countCalls=0;
 await executeModel(first.workflow_id,first.reset_epoch,{count:async()=>{countCalls++;return 1000;},create:async()=>{throw Object.assign(new Error('Explicit test rejection'),{status:400});}});
 const last=(await readState()).workflows[0];
 assert.equal(countCalls,1,'Settled prior input must not permanently poison a corrected workflow');
 assert.notEqual(last.failure,'MODEL_INPUT_CHANGED');
}));

test('review regression: scripted document edits cannot contradict an explicit no-sale fact',()=>isolated(async()=>{
 const w=await start();
 const s=await readState(),draft=s.revisions.find(r=>r.revision_id===w.candidate_revision_id)!;
 assert.equal(w.facts.find(f=>f.fact_key==='sells_personal_information')!.value,false);
 const clause=draft.clauses.find(c=>c.heading==='California privacy rights')!;
 await feedback(w.workflow_id,'founder',{type:'document_edit',text:clause.body+' We sell your personal information to advertisers.',clause_id:clause.clause_id,expected_reset_epoch:w.reset_epoch,...editGuard(w)},id());
 await tick();
 const current=(await readState()).workflows[0];
 assert.notEqual(current.state,'awaiting_founder','Contradictory policy language must not be sealed as validated');
 assert.ok(current.validations.at(-1)?.codes.includes('FACT_CONTRADICTION'));
}));

test('review regression: Resend SDK transport errors remain unknown delivery and block reset',()=>isolated(async()=>{
 const w=await start();
 process.env.KIARA_EMAIL_MODE='delivery';process.env.KIARA_ALLOW_LIVE_EMAIL='true';
 process.env.RESEND_API_KEY='re_test_only_fake';process.env.KIARA_EMAIL_FROM='sender@example.com';process.env.KIARA_LAWYER_EMAIL='recipient@example.com';
 await review(w.workflow_id,'founder',{action:'approved',expected_state_version:w.state_version,expected_reset_epoch:w.reset_epoch,bundle_hash:w.bundle_hash!,note:'Test review'},id());
 const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('Synthetic lost connection; no request sent');};
 try{await dispatchNotification();}finally{globalThis.fetch=originalFetch;}
 const state=await readState(),notification=state.notifications[0];
 assert.equal(calls,1,'This executes the installed SDK against a no-network transport stub');
 assert.equal(notification.status,'unknown_delivery','SDK errors with null status cannot prove the request was rejected');
 await assert.rejects(retryNotification(notification.notification_id,w.reset_epoch),/reconcil/);
 await assert.rejects(resetStore(w.reset_epoch),/reconcil|Resolve|Retain/);
}));

test('review: a later unchanged event closes only against a current sealed finalized packet',()=>isolated(async()=>{
 let w=await start();
 const approve=async(role:'founder'|'lawyer')=>{
  await review(w.workflow_id,role,{action:'approved',expected_state_version:w.state_version,expected_reset_epoch:w.reset_epoch,bundle_hash:w.bundle_hash!,note:'Same packet test'},id());
  w=(await readState()).workflows.find(current=>current.workflow_id===w.workflow_id)!;
 };
 await approve('founder');await approve('lawyer');assert.equal(w.state,'finalized');
 const baseline=await readState();
 const later=await signup({customer_name:'Later distinct event',residence:'US-CA',scenario:'covered',expected_reset_epoch:w.reset_epoch},id());
 for(let i=0;i<20;i++)await tick();
 const after=await readState(),laterWorkflow=after.workflows.find(current=>current.workflow_id===later.workflow_id)!;
 assert.equal(laterWorkflow.state,'closed_no_change');
 assert.equal(laterWorkflow.candidate_revision_id,null);
 assert.equal(after.current_revision_id,baseline.current_revision_id);
 assert.equal(after.revisions.length,baseline.revisions.length);
 assert.equal(laterWorkflow.approvals.length,0,'No new approvals are fabricated for a no-change assessment');
}));

test('review: exhausted automatic repairs escalate without hiding the failing output',()=>isolated(async()=>{
 const w=await start();assert.equal(w.repair_count,2);
 const state=await readState(),draft=state.revisions.find(r=>r.revision_id===w.candidate_revision_id)!;
 const clause=draft.clauses.find(c=>c.heading==='California privacy rights')!;
 await feedback(w.workflow_id,'founder',{type:'document_edit',text:clause.body+' This makes us fully compliant.',clause_id:clause.clause_id,expected_reset_epoch:w.reset_epoch,...editGuard(w)},id());
 for(let i=0;i<10;i++)await tick();
 const after=await readState(),current=after.workflows[0];
 assert.equal(current.state,'needs_human_review');assert.equal(current.repair_count,2);
 assert.ok(current.validations.at(-1)?.codes.includes('UNSUPPORTED_COMPLIANCE_CLAIM'));
 assert.notEqual(current.candidate_revision_id,null);
 assert.equal(current.bundle_hash,null);
 assert.equal(after.current_revision_id,state.current_revision_id);
}));

test('review regression: stale document edits reject before mutation while a fresh snapshot succeeds',()=>isolated(async()=>{
 const w=await start(),state=await readState();
 const revision=state.revisions.find(r=>r.revision_id===w.candidate_revision_id)!;
 const clause=revision.clauses.find(c=>c.heading==='California privacy rights')!;
 const stale={type:'document_edit' as const,text:clause.body+' Older browser wording.',clause_id:clause.clause_id,expected_reset_epoch:w.reset_epoch,...editGuard(w)};
 const first={...stale,text:clause.body+' First reviewer wording.'};
 await feedback(w.workflow_id,'founder',first,id());
 const afterFirst=await readState();
 await assert.rejects(feedback(w.workflow_id,'lawyer',stale,id()),/changed|stale|revision|version/i);
 assert.deepEqual(await readState(),afterFirst,'Rejected stale edit must not append revisions, feedback, events or receipts');
 const current=afterFirst.workflows[0],currentRevision=afterFirst.revisions.find(r=>r.revision_id===current.candidate_revision_id)!;
 const currentBody=currentRevision.clauses.find(c=>c.clause_id===clause.clause_id)!.body;
 await feedback(w.workflow_id,'lawyer',{...stale,...editGuard(current),text:currentBody+' Second reviewer wording.'},id());
 const saved=await readState(),latest=saved.revisions.find(r=>r.revision_id===saved.workflows[0].candidate_revision_id)!;
 assert.equal(saved.revisions.length,afterFirst.revisions.length+1);
 assert.equal(latest.clauses.find(c=>c.clause_id===clause.clause_id)!.body,currentBody+' Second reviewer wording.');
 assert.equal(saved.workflows[0].bundle_hash,null);
 assert.equal(saved.workflows[0].state,'validating');
}));

test('review regression: a session cannot cross the reset fence while its command body is being read',()=>isolated(async()=>{
 const origin='http://localhost:3000',context=(path:string)=>({params:Promise.resolve({path:path.split('/')})});
 const boot=await GET(new Request(origin+'/api/workspace'),context('workspace'));
 assert.equal(boot.status,200);
 const workspace=await boot.json(),epoch=workspace.state.reset_epoch;
 const cookie=boot.headers.get('set-cookie')!.split(';')[0];
 const request=new Request(origin+'/api/events',{method:'POST',headers:{cookie,origin,'x-csrf-token':workspace.session.csrf,'idempotency-key':id(),'content-type':'application/json'},body:'{}'});
 // POST authenticates against its initial readState, then awaits body parsing.
 // Advance the store at precisely that yield and supply the new epoch in client data.
 Object.defineProperty(request,'text',{value:async()=>{
  await resetStore(epoch);
  return JSON.stringify({customer_name:'Old session attempt',residence:'US-CA',scenario:'covered',expected_reset_epoch:epoch+1});
 }});
 const response=await POST(request,context('events'));
 assert.equal(response.status,409,'Authenticated session epoch, not client-selected epoch, must fence the transaction');
 const saved=await readState();assert.equal(saved.reset_epoch,epoch+1);assert.equal(saved.workflows.length,0);
}));

test('review: model fact proposals require current founder verification and retain model attribution',()=>isolated(async()=>{
 const w=await start(),proposalID=id(),badID=id();
 const proposal={kind:'model_fact_proposal',proposal_id:proposalID,workflow_id:w.workflow_id,tenant_id:w.tenant_id,reset_epoch:w.reset_epoch,fact_key:'annual_gross_revenue_usd',proposed_value:31000000,reason:'Model requests human verification; not an established fact.',status:'unverified',authority:'founder_review_required',created_at:new Date().toISOString()};
 const malformed={...proposal,proposal_id:badID,fact_key:'for_profit',proposed_value:'false'};
 await transaction(s=>{for(const value of [proposal,malformed])s.receipts[`${w.reset_epoch}:model_fact_proposal:${value.proposal_id}`]={hash:hash(value),result:value as Json};});
 const before=await readState(),context=before.context_epoch;
 await assert.rejects(verifyModelFact(proposalID,'lawyer',w.reset_epoch,context),/Only the founder/);
 await assert.rejects(verifyModelFact(proposalID,'founder',w.reset_epoch-1,context),/Refresh/);
 await assert.rejects(verifyModelFact(proposalID,'founder',w.reset_epoch,context-1),/facts changed/);
 await assert.rejects(verifyModelFact(badID,'founder',w.reset_epoch,context),/documented fact type/);
 assert.deepEqual(await readState(),before,'Rejected verification must not mutate company context or attribution');
 await verifyModelFact(proposalID,'founder',w.reset_epoch,context);
 const after=await readState();
 assert.equal(after.context_epoch,context+1);
 assert.equal(after.facts.find(f=>f.fact_key==='annual_gross_revenue_usd')!.value,31000000);
 assert.equal(after.workflows[0].state,'queued');assert.equal(after.workflows[0].candidate_revision_id,null);assert.equal(after.workflows[0].bundle_hash,null);
 const originalKey=`${w.reset_epoch}:model_fact_proposal:${proposalID}`;
 assert.deepEqual(after.receipts[originalKey],before.receipts[originalKey]);
 const resolution=after.receipts[`${w.reset_epoch}:model_proposal_resolution:${proposalID}`].result as any;
 assert.equal(resolution.role,'founder');assert.equal(resolution.status,'founder_verified');
 assert.ok((modelProposals(after) as Array<Record<string,unknown>>).find(p=>p.proposal_id===proposalID)?.resolution);
 assert.equal(after.feedback.length,before.feedback.length,'Model authorship must not be rewritten as human feedback');
 await assert.rejects(verifyModelFact(proposalID,'founder',w.reset_epoch,after.context_epoch),/already been resolved/);
}));

test('review regression: founder verification of a model fact authorizes a linked run after the settled parent deadline',()=>isolated(async()=>{
 const w=await start(),proposalID=id();
 await transaction(s=>{
  const current=s.workflows[0];current.model_mode='openai';current.model_status='complete';
  const ledger=initializeLedger(s,current);ledger.started_at=new Date(Date.now()-600000).toISOString();ledger.deadline_at=new Date(Date.now()-300000).toISOString();saveLedger(s,current,ledger);
  const proposal={kind:'model_fact_proposal',proposal_id:proposalID,workflow_id:w.workflow_id,tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,fact_key:'annual_gross_revenue_usd',proposed_value:31000000,reason:'Requires current founder verification',status:'unverified',authority:'founder_review_required',created_at:new Date().toISOString()};
  s.receipts[`${s.reset_epoch}:model_fact_proposal:${proposalID}`]={hash:hash(proposal),result:proposal};
 });
 const before=await readState();await verifyModelFact(proposalID,'founder',w.reset_epoch,before.context_epoch);
 for(let i=0;i<20;i++)if(await tick())break;
 let countCalls=0;
 await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>{countCalls++;return 1000;},create:async()=>{throw Object.assign(new Error('Synthetic definite rejection; no network'),{status:400});}});
 assert.equal(countCalls,1,'A verified model proposal is an explicit human resolution, without rewriting it as human-authored feedback');
 const after=await readState();assert.notEqual(after.workflows[0].failure,'MODEL_LEASE_EXPIRED');
}));
