import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {readState,transaction,closeStore} from '../../src/data/store';
import {seed,fixture} from '../../src/data/fixtures';
import {signup,tick,review} from '../../src/workflow/engine';
import {assess,EXEMPTION_SCREEN_KEYS} from '../../src/workflow/legal';
import {recheckSources} from '../../src/server/sources';
import {sourceRecheckBlock} from '../../src/server/source-health';
import {semanticDocumentPacket} from '../../src/runtime/semantic';
import {executeModel,retryBlockedModel} from '../../src/runtime';
import {enqueueAutomaticImprovementInState,hasAutomaticWork,processAutomaticImprovementStep,evaluateModelSuggestion} from '../../src/adaptation';
import {hasPendingWorkerWork,processWorkerStep} from '../../src/server/worker-step';
import {webhook} from '../../src/server/notifications';
import {strategyInstructions} from '../../src/adaptation/strategy';
import {hash,id} from '../../src/server/hash';

async function isolated(run:()=>Promise<void>){
  const before={...process.env},fetch=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'kiara-v2-regression-'));
  for(const key of Object.keys(process.env))if(/OPENAI|MONGO|VERCEL|RESEND|KIARA/.test(key))delete process.env[key];
  Object.assign(process.env,{KIARA_DATA_DIR:dir,KIARA_GLOBAL_BUDGET_DIR:dir,KIARA_MODEL_MODE:'scripted',KIARA_AUTH_MODE:'demo_simulated',KIARA_EMAIL_MODE:'preview',KIARA_ALLOW_LIVE_EMAIL:'false',KIARA_OPENAI_BUDGET_USD:'0'});
  try{await run();}finally{globalThis.fetch=fetch;await closeStore();for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
}
async function start(){const s=await readState(),ack=await signup({customer_name:'Regression fixture',residence:'US-CA',scenario:'covered',expected_reset_epoch:s.reset_epoch},id());for(let i=0;i<10;i++)await tick();return (await readState()).workflows.find(w=>w.workflow_id===ack.workflow_id)!;}
function coveredFacts(){const facts=seed().facts;facts.find(f=>f.fact_key==='declared_legal_residence')!.value='US-CA';return facts;}

test('F03 source recheck suspends approval before fetch and preserves the failure across packets',()=>isolated(async()=>{
  const before=await start();assert.equal(before.state,'awaiting_founder');
  let release!:(response:Response)=>void,observed!:()=>void;const reached=new Promise<void>(r=>observed=r);
  globalThis.fetch=async()=>{observed();return new Promise<Response>(r=>release=r);};
  const checking=recheckSources(before.workflow_id,'lawyer',before.reset_epoch);await reached;
  let s=await readState(),current=s.workflows[0];assert.equal(current.bundle_hash,null);assert.equal(sourceRecheckBlock(s),'SOURCE_RECHECK_PENDING');
  await assert.rejects(review(before.workflow_id,'founder',{action:'approved',expected_reset_epoch:before.reset_epoch,expected_state_version:before.state_version,bundle_hash:before.bundle_hash!,note:''},id()));
  release(new Response('Changed official bytes'));await assert.rejects(checking,(e:any)=>e.code==='SOURCE_CHANGED');
  s=await readState();current=s.workflows[0];assert.equal(sourceRecheckBlock(s),'SOURCE_CHANGED');assert.equal(current.failure,'SOURCE_CHANGED');assert.equal(current.bundle_hash,null);assert.equal(Date.parse(current.freshness_valid_until),0);assert.equal(current.approvals.length,0);
}));

test('F03 successful corpus recheck preserves queued siblings without evidence',()=>isolated(async()=>{
  const target=await start();const second=await signup({customer_name:'Queued sibling',residence:'US-CA',scenario:'covered',expected_reset_epoch:target.reset_epoch},id());
  const originals=fixture<any[]>('legal_source_versions.ejson.json');
  globalThis.fetch=async(url)=>{const source=originals.find(s=>s.url===String(url));assert.ok(source);return new Response(Buffer.from(source.original_bytes.$binary.base64,'base64'));};
  await recheckSources(target.workflow_id,'lawyer',target.reset_epoch);
  const state=await readState(),sibling=state.workflows.find(w=>w.workflow_id===second.workflow_id)!;
  assert.ok(['queued','waiting_for_document_slot'].includes(sibling.state));assert.equal(sibling.evidence_keys.length,0);assert.equal(sourceRecheckBlock(state),null);assert.equal(state.workflows.find(w=>w.workflow_id===target.workflow_id)!.state,'validating');
}));

test('F04 exact selected quote and clause bindings reach semantic review',()=>isolated(async()=>{
  const w=await start(),s=await readState(),base=s.revisions.find(r=>r.revision_id===w.base_revision_id)!,candidate=s.revisions.find(r=>r.revision_id===w.candidate_revision_id)!;
  const wrong=structuredClone(candidate);wrong.evidence_bindings![0].legal_refs=[{provision_key:'prov_ccpa_cpi',source_version_id:'incorrect-for-claim'}];
  assert.notDeepEqual(semanticDocumentPacket(base,candidate),semanticDocumentPacket(base,wrong));
  assert.deepEqual(semanticDocumentPacket(base,candidate).evidence_bindings,candidate.evidence_bindings);
}));

test('F05 arbitrary, missing, unknown or extra exemption fields cannot satisfy screening',()=>{
  const facts=coveredFacts(),screen=facts.find(f=>f.fact_key==='exemption_screen')!,valid=structuredClone(screen.value) as Record<string,any>;
  assert.equal(assess(facts).outcome,'covered');
  for(const value of [Object.fromEntries(Array.from({length:12},(_,i)=>['unrelated_'+i,false])),{...valid,other:false},{...valid,[EXEMPTION_SCREEN_KEYS[0]]:null},Object.fromEntries(Object.entries(valid).filter(([k])=>k!==EXEMPTION_SCREEN_KEYS[0]))]){
    screen.value=value;const result=assess(facts);assert.equal(result.outcome,'needs_information');assert.ok(result.missing_facts.includes('lawyer_exemption_scope_review'));
  }
});

test('F06 each verified alternative route survives false direct-business prerequisites',()=>{
  for(const route of ['related_entity_business_route','joint_venture_business_route','voluntary_cppa_certification']){
    const facts=coveredFacts();facts.find(f=>f.fact_key==='for_profit')!.value=false;facts.find(f=>f.fact_key===route)!.value=true;
    assert.equal(assess(facts).outcome,'covered',route);
  }
  const facts=coveredFacts();facts.find(f=>f.fact_key==='for_profit')!.value=false;
  assert.equal(assess(facts).outcome,'not_covered');
  facts.find(f=>f.fact_key==='voluntary_cppa_certification')!.value=true;facts.find(f=>f.fact_key==='does_business_in_california')!.knowledge='unknown';
  assert.equal(assess(facts).outcome,'needs_information');
});

test('F09 blocked campaigns remain scheduled and expire through the ordinary worker',()=>isolated(async()=>{
  const w=await start();await transaction(s=>{s.workflows[0].model_mode='openai';enqueueAutomaticImprovementInState(s,{workflow_id:w.workflow_id,trigger_id:id(),origin:'validation',codes:['FACT_VALUE_MISMATCH']});});
  await processAutomaticImprovementStep();let s=await readState();assert.equal(hasAutomaticWork(s),true);assert.equal(hasPendingWorkerWork(s),true);
  await transaction(s=>{const receipt=Object.values(s.receipts).find(r=>(r.result as any)?.kind==='automatic_improvement')!;(receipt.result as any).deadline_at='2000-01-01T00:00:00Z';receipt.hash=hash(receipt.result);});
  await processWorkerStep(s.reset_epoch);s=await readState();const campaign=Object.values(s.receipts).map(r=>r.result as any).find(r=>r?.kind==='automatic_improvement');assert.equal(campaign.status,'inconclusive');assert.equal(hasAutomaticWork(s),false);
}));

test('F10 sending-only notification keeps watchdog alive then resolves to unknown without another send',()=>isolated(async()=>{
  const w=await start();await review(w.workflow_id,'founder',{action:'approved',expected_reset_epoch:w.reset_epoch,expected_state_version:w.state_version,bundle_hash:w.bundle_hash!,note:''},id());
  await transaction(s=>{const n=s.notifications[0];n.mode='delivery';n.status='sending';n.lease_until=new Date(Date.now()+60000).toISOString();});
  let s=await readState();assert.equal(hasPendingWorkerWork(s),true);assert.equal(await processWorkerStep(s.reset_epoch),true);
  await transaction(s=>{s.notifications[0].lease_until='2000-01-01T00:00:00Z';});await processWorkerStep(s.reset_epoch);s=await readState();assert.equal(s.notifications[0].status,'unknown_delivery');assert.equal(s.notifications[0].attempts,0);assert.equal(hasPendingWorkerWork(s),false);
}));

test('F11 count rejection creates no generation attempt and supports explicit settled retry',()=>isolated(async()=>{
  const w=await start();await transaction(s=>{const w=s.workflows[0];w.model_mode='openai';w.state='drafting';w.model_status='pending';w.candidate_revision_id=null;});let creates=0;
  await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>{throw Object.assign(new Error('Rate limited'),{status:429});},create:async()=>{creates++;throw new Error('Must not create');}});
  const s=await readState();assert.equal(s.workflows[0].failure,'MODEL_TOKEN_COUNT_FAILED');assert.equal(creates,0);assert.equal(s.workflows[0].model_attempts,0);assert.equal(s.workflows[0].unknown_charge,false);
  assert.equal((await retryBlockedModel(w.workflow_id,w.reset_epoch)).state,'drafting');
}));

test('F13 selected suggestion has its own exact campaign and repeated requests retain identity',()=>isolated(async()=>{
  const w=await start(),proposal_id=id(),strategy={schema_version:1,prompt_modules:['minimal_edits'],retrieval_order:'facts_first'};
  await transaction(s=>{const w=s.workflows[0];w.model_mode='openai';w.validations.push({validation_id:id(),created_at:new Date().toISOString(),stage:'proposal',passed:false,codes:['UNRELATED_CLAUSE_MODIFIED'],explanation:'Injected diagnosed failure',repaired:false});const value={kind:'model_harness_proposal',proposal_id,workflow_id:w.workflow_id,tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,context_epoch:s.context_epoch,champion_version:s.champion_version,champion_generation:s.champion_generation,strategy_hash:hash(strategy),strategy,status:'suggested'};s.receipts[`${s.reset_epoch}:model_harness_proposal:${proposal_id}`]={hash:hash(value),result:value};});
  const s=await readState(),options={expected_reset_epoch:s.reset_epoch,expected_champion_generation:s.champion_generation};
  const first=await evaluateModelSuggestion(proposal_id,options),second=await evaluateModelSuggestion(proposal_id,options);assert.deepEqual(first,second);assert.equal(first.status,'queued');assert.equal(first.evaluation_id,null);
  const after=await readState(),campaign=Object.values(after.receipts).map(r=>r.result as any).find(r=>r?.kind==='automatic_improvement');assert.equal(campaign.requested_suggestion.proposal_id,proposal_id);assert.equal(hash(campaign.candidate_strategy),hash(strategy));assert.equal((after.receipts[`${s.reset_epoch}:model_proposal_resolution:${proposal_id}`].result as any).status,'queued');
}));

test('F15 signed out-of-order callbacks converge and never downgrade delivery or bounce',()=>isolated(async()=>{
  const w=await start();await review(w.workflow_id,'founder',{action:'approved',expected_reset_epoch:w.reset_epoch,expected_state_version:w.state_version,bundle_hash:w.bundle_hash!,note:''},id());
  const secret=Buffer.alloc(32,7);process.env.RESEND_WEBHOOK_SECRET='whsec_'+secret.toString('base64');await transaction(s=>{s.notifications[0].provider_message_id='email-regression';s.notifications[0].status='sent';});
  async function deliver(type:string,created_at:string,eventID=id()){
    const body=JSON.stringify({type,created_at,data:{email_id:'email-regression'}}),timestamp=String(Math.floor(Date.now()/1000)),signature='v1,'+createHmac('sha256',secret).update(`${eventID}.${timestamp}.${body}`).digest('base64');
    await webhook(new Request('http://localhost/api/webhooks/resend',{method:'POST',body,headers:{'svix-id':eventID,'svix-timestamp':timestamp,'svix-signature':signature}}));
  }
  await deliver('email.delivered','2026-09-27T12:00:00Z');await deliver('email.failed','2026-09-27T11:00:00Z');assert.equal((await readState()).notifications[0].status,'delivered');
  await deliver('email.bounced','2026-09-27T13:00:00Z');await deliver('email.delivered','2026-09-27T12:00:00Z');assert.equal((await readState()).notifications[0].status,'bounced');assert.equal((await readState()).workflows[0].state,'awaiting_lawyer');
}));

test('F17 paid operation scripts cannot raise configured authorization',async()=>{
  for(const file of ['provider-probe.ts','live-acceptance.ts','live-status.ts'])assert.doesNotMatch(await readFile(join(process.cwd(),'scripts',file),'utf8'),/KIARA_OPENAI_BUDGET_USD\s*[:=]\s*['"]50/);
});

test('F18 strategies use supplied complete facts and baseline without mandatory rereads',()=>{
  const instruction=strategyInstructions({schema_version:1,prompt_modules:['fact_consistency','minimal_edits'],retrieval_order:'facts_first'});
  assert.match(instruction,/supplied complete company facts/);assert.match(instruction,/supplied complete baseline/);assert.doesNotMatch(instruction,/Retrieve (?:the relevant facts|the existing policy|company facts)/);
});
