import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Response} from 'openai/resources/responses/responses';
import {fixture,bindings,candidate,provisions} from '../src/data/fixtures';
import {scriptedCandidate} from '../src/workflow/documents';
import {readState,transaction} from '../src/data/store';
import {signup,tick,reset} from '../src/workflow/engine';
import {assess,fixtureFacts} from '../src/workflow/legal';
import {validateProposal,revisionDigest} from '../src/validation/proposal';
import {executeModel,recoverModelRuns,type ModelProvider} from '../src/runtime/index';
import {initializeLedger,reserveAttempt,getLedger,saveLedger,syncCounters} from '../src/runtime/budget';
import {reserveAuthorizedSpend,settleAuthorizedSpend,AUTHORIZATION_RECEIPT_KEY} from '../src/runtime/budget';
import {runtimeConfigurationStatus,runtimeConfig} from '../src/runtime/config';
import {evaluateFrozenCase} from '../src/runtime/index';
import {hash} from '../src/server/hash';
const response=(output:any[],text=''):Response=>({id:'resp_test',status:'completed',output,output_text:text,usage:{input_tokens:1000,output_tokens:200,total_tokens:1200,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}} as Response);
async function setup(){const dir=await mkdtemp(join(tmpdir(),'kiara-runtime-'));process.env.KIARA_DATA_DIR=dir;delete process.env.MONGODB_URI;process.env.KIARA_MODEL_MODE='openai';delete process.env.OPENAI_API_KEY;const s=await readState();const out=await signup({customer_name:'Synthetic runtime test',residence:'US-CA',scenario:'supplied',expected_reset_epoch:s.reset_epoch,expected_context_epoch:s.context_epoch},'runtime-event');await transaction(state=>{state.workflows.find(w=>w.workflow_id===out.workflow_id)!.freshness_valid_until=new Date(Date.now()+86400000).toISOString();});for(let i=0;i<12;i++){const task=await tick();if(task)break;}const state=await readState();return {dir,state,w:state.workflows.find(w=>w.workflow_id===out.workflow_id)!};}

test('eleven frozen legal cases execute with unknown/conflict preservation',()=>{for(const f of fixture<any>('legal/legal-fixtures.json').fixtures){assert.equal(assess(fixtureFacts(f.facts)).outcome,f.facts.declaredLegalResidence?.value!=='US-CA'?'needs_information':f.expected.applicability,f.fixtureId);}const f=fixtureFacts(fixture<any>('legal/legal-fixtures.json').fixtures[0].facts);f.find(f=>f.fact_key==='for_profit')!.value='false';assert.equal(assess(f).outcome,'needs_information');});
test('actual citation span, complete evidence, clauses, unknown facts and semantic rules are validated',async()=>{const {dir,state,w}=await setup();try{const r=scriptedCandidate(state.revisions[0],w);w.citation_offset=1134;assert.deepEqual(validateProposal(w,r,state.revisions[0]),[]);w.citation_offset=1135;assert.ok(validateProposal(w,r).includes('CITATION_SPAN_MISMATCH'));w.citation_offset=1134;const tampered=structuredClone(r);tampered.clauses[0].body+=' Fully compliant.';tampered.content_hash=revisionDigest(tampered);assert.ok(validateProposal(w,tampered).includes('UNSUPPORTED_COMPLIANCE_CLAIM'));assert.ok(validateProposal(w,tampered).includes('UNCHANGED_CLAUSE_MODIFIED'));const source=structuredClone(provisions());source[0].text+=' injected';assert.ok(validateProposal(w,r,state.revisions[0],source).includes('SOURCE_HASH_MISMATCH'));const missing=structuredClone(r);missing.clauses=missing.clauses.filter(c=>c.heading!=='California privacy rights');missing.content_hash=revisionDigest(missing);assert.ok(validateProposal(w,missing).includes('REQUIRED_DISCLOSURE_MISSING'));}finally{await rm(dir,{recursive:true,force:true});}});
test('live mode without credentials blocks instead of substituting the scripted revision',async()=>{const {dir,w}=await setup();try{await executeModel(w.workflow_id,w.reset_epoch);const s=await readState();assert.equal(s.workflows[0].failure,'OPENAI_API_KEY_MISSING');assert.equal(s.revisions.length,1);assert.equal(s.workflows[0].model_attempts,0);}finally{await rm(dir,{recursive:true,force:true});}});
test('timeout retains pre-dispatch reservation and prevents reset',async()=>{const {dir,w}=await setup();try{let calls=0;const api:ModelProvider={count:async()=>1000,create:async()=>{calls++;const s=await readState();assert.equal(s.workflows[0].model_attempts,1);assert.ok(s.workflows[0].reserved_cost>0);throw new Error('timeout');}};await executeModel(w.workflow_id,w.reset_epoch,api);const s=await readState();assert.equal(calls,1);assert.equal(s.workflows[0].unknown_charge,true);assert.ok(s.workflows[0].reserved_cost>0);assert.equal(s.workflows[0].state,'needs_human_review');await assert.rejects(()=>reset(w.reset_epoch),/in-flight|reconcil|Resolve|retain run/i);}finally{await rm(dir,{recursive:true,force:true});}});
test('crashed dispatched run recovers once without replaying model or discarding charge',async()=>{const {dir,w}=await setup();try{await transaction(s=>{const run=s.workflows[0],l=initializeLedger(s,run);const a=reserveAttempt(l,'draft',1000,4000);a.status='dispatched';run.model_status='running';run.lease_owner='lost-worker';run.lease_until='2000-01-01T00:00:00Z';saveLedger(s,run,l);syncCounters(run,l);});assert.equal(await recoverModelRuns(),1);assert.equal(await recoverModelRuns(),0);const s=await readState();assert.equal(s.workflows[0].unknown_charge,true);assert.equal(getLedger(s,s.workflows[0])!.attempts[0].status,'unknown');}finally{await rm(dir,{recursive:true,force:true});}});
test('budget deadline, request ceiling and unknown-charge reservation cannot reset on reuse',async()=>{const {dir,state,w}=await setup();try{const l=initializeLedger(state,w);l.deadline_at='2000-01-01T00:00:00Z';assert.throws(()=>reserveAttempt(l,'draft',1000,4000),/deadline/);l.deadline_at=new Date(Date.now()+300000).toISOString();assert.throws(()=>reserveAttempt(l,'draft',32001,4000),/capacity/);const a=reserveAttempt(l,'draft',1000,4000);a.status='unknown';assert.throws(()=>reserveAttempt(l,'draft',1000,4000),/unresolved/);}finally{await rm(dir,{recursive:true,force:true});}});
test('provider adapter exercises scoped tools, exact citations, full-law semantic hydration and immutable generated revision',async()=>{const {dir,state,w}=await setup();try{const target=scriptedCandidate(state.revisions[0],w);const rows=bindings();const keys=[...new Set(rows.flatMap(b=>b.legal_refs.map(r=>r.provision_key)))];const changes=target.clauses.filter(c=>rows.some(b=>b.clause_ids.includes(c.clause_id))).map(c=>{const relevant=rows.filter(b=>b.clause_ids.includes(c.clause_id));return {...c,fact_keys:[...new Set(relevant.flatMap(b=>b.fact_refs.map(r=>r.fact_key)))],legal_refs:[...new Set(relevant.flatMap(b=>b.legal_refs.map(r=>r.provision_key)))].map(key=>{const p=provisions().find(p=>p.provision_key===key)!;return {provision_key:key,source_version_id:p.source_version_id,start_utf16:0,end_utf16:64,quote_text:p.text.slice(0,64)};}),rationale:'Adapter test grounded clause mapping'};});let calls=0;const api:ModelProvider={count:async()=>2000,create:async req=>{calls++;assert.equal(req.model,'gpt-6-astra');assert.equal(req.reasoning?.effort,'medium');assert.equal(req.store,false);assert.equal(req.parallel_tool_calls,false);if(calls===1)return response(keys.map((key,i)=>({type:'function_call',call_id:'call_'+i,name:'read_legal_evidence',arguments:JSON.stringify({provision_key:key,start_utf16:0,length:64})})));if(calls===2)return response([],JSON.stringify({changes}));const review=JSON.parse((req.input as any[])[0].content);assert.ok(review.authoritative_provisions.some((p:any)=>p.text.length>30000),'checker gets complete law, not only 64-character model citations');return response([],JSON.stringify({passed:true,codes:[],explanation:'Test provider, not live legal proof'}));}};await executeModel(w.workflow_id,w.reset_epoch,api);const s=await readState();const run=s.workflows[0];assert.equal(run.state,'validating',run.failure||'');assert.equal(run.model_status,'complete');assert.equal(s.revisions.length,2);const r=s.revisions[1];assert.equal(r.generation,'openai');assert.equal(r.semantic_validation?.passed,true);assert.equal(r.semantic_validation?.reviewed_content_hash,r.content_hash);assert.equal(run.reserved_cost,0);assert.deepEqual(validateProposal(run,r,s.revisions[0]),[]);assert.equal(getLedger(s,run)!.tools.length,16);}finally{await rm(dir,{recursive:true,force:true});}});
test('an out-of-scope model tool is blocked before it can mutate state',async()=>{const {dir,w}=await setup();try{await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async()=>response([{type:'function_call',call_id:'evil',name:'delete_tenant',arguments:'{}'}])});const s=await readState();assert.equal(s.workflows[0].failure,'TOOL_FORBIDDEN');assert.equal(s.revisions.length,1);assert.equal(s.workflows[0].unknown_charge,false);}finally{await rm(dir,{recursive:true,force:true});}});
test('verified human edit after a settled run deadline starts a linked child and retains immutable costs; automatic repair cannot rotate',async()=>{const {dir,state,w}=await setup();try{const {feedback}=await import('../src/workflow/engine');const {hash}=await import('../src/server/hash');let parentId='',parentScope='';await transaction(s=>{const current=s.workflows[0];const revision=candidate(s.revisions[0]);s.revisions.push(revision);current.candidate_revision_id=revision.revision_id;current.state='awaiting_founder';current.model_status='complete';current.citation_offset=1134;const ledger=initializeLedger(s,current);const a=reserveAttempt(ledger,'draft',10000,4000);a.status='complete';a.input_tokens=10000;a.output_tokens=1000;a.cost_usd=0.15;ledger.started_at=new Date(Date.now()-600000).toISOString();ledger.deadline_at=new Date(Date.now()-300000).toISOString();parentId=ledger.run_id;parentScope=ledger.budget_scope_id;saveLedger(s,current,ledger);syncCounters(current,ledger);});const before=await readState();const current=before.workflows[0],draft=before.revisions.find(r=>r.revision_id===current.candidate_revision_id)!;const clause=draft.clauses.find(c=>c.heading==='California privacy rights')!;const f=await feedback(w.workflow_id,'lawyer',{type:'document_edit',text:clause.body+' Contact us with questions.',clause_id:clause.clause_id,expected_reset_epoch:w.reset_epoch,expected_candidate_revision_id:current.candidate_revision_id!,expected_state_version:current.state_version},'human-resolution');let calls=0;await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async()=>{calls++;const live=await readState();const child=getLedger(live,live.workflows[0])!;assert.equal(child.parent_run_id,parentId);assert.equal(child.parent_budget_scope_id,parentScope);assert.equal(child.human_resolution_id,f.feedback_id);assert.ok(Date.parse(child.deadline_at)>Date.now());assert.equal(live.workflows[0].cost_usd,0.15);return response([],JSON.stringify({passed:true,codes:[],explanation:'Injected semantic checker'}));}},'validate');assert.equal(calls,1);const after=await readState(),child=getLedger(after,after.workflows[0])!;assert.notEqual(child.run_id,parentId);assert.equal(after.workflows[0].model_attempts,2);assert.equal(after.workflows[0].input_tokens,11000);assert.equal(after.workflows[0].output_tokens,1200);assert.ok(Math.abs(after.workflows[0].cost_usd-0.17)<1e-9);const history=Object.entries(after.receipts).find(([,r])=>(r.result as any)?.kind==='runtime_history')!;assert.equal((history[1].result as any).ledger.run_id,parentId);assert.equal(history[1].hash,hash(history[1].result));await assert.rejects(()=>transaction(s=>{(s.receipts[history[0]].result as any).ledger.attempts=[];}),/immutable/i);await transaction(s=>{const run=s.workflows[0],ledger=getLedger(s,run)!;ledger.deadline_at=new Date(Date.now()-1).toISOString();saveLedger(s,run,ledger);run.state='repairing';run.repair_count=0;});let repairCalls=0;await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>{repairCalls++;return 1000;},create:async()=>response([], '{}')},'repair');assert.equal(repairCalls,0);const stopped=await readState();assert.equal(getLedger(stopped,stopped.workflows[0])!.run_id,child.run_id);assert.equal(Object.values(stopped.receipts).filter(r=>(r.result as any)?.kind==='runtime_history').length,1);}finally{await rm(dir,{recursive:true,force:true});}});
test('founder verification of an attributed model fact proposal authorizes a settled expired child scope without fabricating human feedback',async()=>{const {dir,w}=await setup();try{const {verifyModelFact}=await import('../src/workflow/engine');let firstCalls=0;await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async()=>{firstCalls++;if(firstCalls===1)return response([{type:'function_call',call_id:'propose-fact',name:'propose_company_fact',arguments:JSON.stringify({fact_key:'annual_gross_revenue_usd',proposed_value_json:'31000000',reason:'Synthetic correction requiring founder verification'})}]);throw Object.assign(new Error('Explicit test rejection'),{status:400});}});let s=await readState();const proposal=Object.values(s.receipts).map(r=>r.result as any).find(r=>r?.kind==='model_fact_proposal');assert.ok(proposal);const parent=getLedger(s,s.workflows[0])!;const initialCost=s.workflows[0].cost_usd;await transaction(state=>{const ledger=getLedger(state,state.workflows[0])!;ledger.started_at=new Date(Date.now()-600000).toISOString();ledger.deadline_at=new Date(Date.now()-300000).toISOString();saveLedger(state,state.workflows[0],ledger);});await verifyModelFact(proposal.proposal_id,'founder',s.reset_epoch,s.context_epoch);for(let i=0;i<12;i++)if(await tick())break;let childCalls=0;await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>{childCalls++;return 1000;},create:async()=>{const during=await readState(),child=getLedger(during,during.workflows[0])!;assert.equal(child.parent_run_id,parent.run_id);assert.equal(child.human_resolution_id,`${w.reset_epoch}:model_proposal_resolution:${proposal.proposal_id}`);assert.ok(Date.parse(child.deadline_at)>Date.now());throw Object.assign(new Error('Explicit test rejection'),{status:400});}});assert.equal(childCalls,1);s=await readState();assert.equal(s.feedback.length,0,'Model attribution must not be rewritten as founder feedback');assert.equal(s.workflows[0].cost_usd,initialCost);assert.equal(s.workflows[0].model_attempts,3);assert.equal(Object.values(s.receipts).filter(r=>(r.result as any)?.kind==='runtime_history').length,1);assert.equal((s.receipts[`${w.reset_epoch}:model_fact_proposal:${proposal.proposal_id}`].result as any).status,'unverified','Original model proposal is immutable; separate receipt carries the founder resolution');}finally{await rm(dir,{recursive:true,force:true});}});

function generatedChanges(state:Awaited<ReturnType<typeof readState>>,w:(Awaited<ReturnType<typeof setup>>)['w']){
 const target=scriptedCandidate(state.revisions[0],w),rows=bindings();
 return target.clauses.filter(c=>rows.some(b=>b.clause_ids.includes(c.clause_id))).map(c=>{
  const relevant=rows.filter(b=>b.clause_ids.includes(c.clause_id));
  return {...c,fact_keys:[...new Set(relevant.flatMap(b=>b.fact_refs.map(r=>r.fact_key)))],legal_refs:[...new Set(relevant.flatMap(b=>b.legal_refs.map(r=>r.provision_key)))].map(key=>{const p=provisions().find(p=>p.provision_key===key)!;return {provision_key:key,source_version_id:p.source_version_id,start_utf16:0,end_utf16:64,quote_text:p.text.slice(0,64)};}),rationale:'Synthetic provider output grounded in pinned facts for adapter verification'};
 });
}
function evidenceBatch(){return {type:'function_call',call_id:'batch-evidence',name:'read_legal_evidence_batch',arguments:JSON.stringify({spans:[...new Set(bindings().flatMap(b=>b.legal_refs.map(r=>r.provision_key)))].map(provision_key=>({provision_key,start_utf16:0,length:64}))})};}

test('genuine bad output from an injected provider is recorded, repaired with failure feedback, and produces correlated audit records',async()=>{
 const {dir,state,w}=await setup();
 try{
  const changes=generatedChanges(state,w);let calls=0;
  const api:ModelProvider={count:async()=>1800,create:async request=>{
   calls++;let result:Response;
   if(calls===1)result=response([evidenceBatch()]);
   else if(calls===2){const bad=structuredClone(changes);for(const c of bad)c.body=c.body.replaceAll('privacy@democo.example','privacy@unseen-company.example');result=response([],JSON.stringify({changes:bad}));}
   else if(calls===3){assert.ok(JSON.stringify(request.input).includes('CONTACT_FACT_MISMATCH'));result=response([],JSON.stringify({changes}));}
   else result=response([],JSON.stringify({passed:true,codes:[],explanation:'Injected independent checker'}));
   result.id=`resp_audit_${calls}`;return result;
  }};
  await executeModel(w.workflow_id,w.reset_epoch,api);
  const s=await readState(),run=s.workflows[0],ledger=getLedger(s,run)!;
  assert.equal(run.model_status,'complete',run.failure||'');assert.equal(run.repair_count,1);assert.equal(calls,4);
  const failure=Object.values(s.receipts).map(r=>r.result as any).find(r=>r?.kind==='model_output_failure');
  assert.equal(failure.response_id,'resp_audit_2');assert.ok(failure.output_json.includes('unseen-company'));assert.equal(failure.test_only_fault_injected,false);
  assert.ok(ledger.attempts.every(a=>a.request_hash&&a.output_hash&&a.config_version&&a.duration_ms!==undefined&&a.response_id));
  assert.equal(ledger.tools.length,1);assert.equal(ledger.tools[0].call_id,'batch-evidence');assert.ok(ledger.tools[0].arguments_hash);assert.ok(ledger.tools[0].result_hash);
  const out=Object.values(s.receipts).map(r=>r.result as any).find(r=>r?.kind==='model_output_event');
  assert.equal(out.event_id,w.event_id);assert.equal(out.harness_version,w.harness_version);assert.equal(out.provider_response_ids.length,4);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('unparseable provider output stops at the protected repair limit without saving a placeholder candidate',async()=>{
 const {dir,w}=await setup();
 try{let calls=0;await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async()=>{calls++;return response([],'not json');}});const s=await readState();assert.equal(calls,3);assert.equal(s.workflows[0].failure,'REPAIR_LIMIT_REACHED');assert.equal(s.workflows[0].repair_count,2);assert.equal(s.revisions.length,1);assert.equal(Object.values(s.receipts).filter(r=>(r.result as any)?.kind==='model_output_failure').length,3);}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('oversized legal retrieval produces a scoped tool error that the agent can correct within the same budget',async()=>{
 const {dir,state,w}=await setup();
 try{const changes=generatedChanges(state,w);let calls=0;const long=provisions().filter(p=>p.text.length>=8000).slice(0,2);assert.equal(long.length,2);
  await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async request=>{
   calls++;if(calls===1)return response([{type:'function_call',call_id:'too-large',name:'read_legal_evidence_batch',arguments:JSON.stringify({spans:long.map(p=>({provision_key:p.provision_key,start_utf16:0,length:8000}))})}]);
   if(calls===2){assert.ok(JSON.stringify(request.input).includes('TOOL_RESULT_CAPACITY'));return response([evidenceBatch()]);}
   if(calls===3)return response([],JSON.stringify({changes}));
   return response([],JSON.stringify({passed:true,codes:[],explanation:'Injected check'}));
  }});
  const s=await readState();assert.equal(s.workflows[0].model_status,'complete',s.workflows[0].failure||'');assert.equal(s.workflows[0].repair_count,1);assert.ok(Object.values(s.receipts).some(r=>(r.result as any)?.kind==='model_tool_failure'));assert.equal(getLedger(s,s.workflows[0])!.retrieved_spans.length,16,'Rejected retrieval transaction cannot leave fetched-span authority behind');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('frozen evaluation runs semantic repair and retains full audit without mutating the supplied state or live store',async()=>{
 const {dir,state,w}=await setup();
 try{const before=hash(state),changes=generatedChanges(state,w);let calls=0,checks=0;
  const result=await evaluateFrozenCase({state,workflow_id:w.workflow_id,max_cost_usd:3,max_attempts:9},{count:async()=>1000,create:async request=>{
   calls++;if(calls===1)return response([evidenceBatch()]);
   if(request.text?.format?.type==='json_schema'&&request.text.format.name==='privacy_proposal'){if(checks===1)assert.ok(JSON.stringify(request.input).includes('Controlled semantic repair regression'));return response([],JSON.stringify({changes}));}
   checks++;return response([],JSON.stringify({passed:checks>1,codes:checks>1?[]:['SYNTHETIC_SEMANTIC_FAILURE'],explanation:'Controlled semantic repair regression'}));
  }});
  assert.equal(result.passed,true,result.validation_codes.join(','));assert.equal(result.repair_count,1);assert.equal(checks,2);assert.equal(result.audit.execution_mode,'injected_test');assert.ok(result.audit.candidate_revision);assert.equal(result.audit.attempts.length,5);assert.equal(result.audit.semantic_reviews.length,2);assert.ok(result.audit.validations.some(v=>v.codes.includes('SYNTHETIC_SEMANTIC_FAILURE')));assert.equal(hash(state),before);assert.equal((await readState()).revisions.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('explicit total spending authorization includes evaluation reservations and never exposes credentials',async()=>{
 const {dir,state}=await setup();const oldBudget=process.env.KIARA_OPENAI_BUDGET_USD,oldKey=process.env.OPENAI_API_KEY,oldModel=process.env.KIARA_MODEL;
 try{
  delete process.env.KIARA_OPENAI_BUDGET_USD;assert.ok(runtimeConfigurationStatus().blockers.includes('OPENAI_BUDGET_REQUIRED'));
  process.env.KIARA_OPENAI_BUDGET_USD='50';process.env.OPENAI_API_KEY='synthetic-never-dispatched';
  assert.equal(JSON.stringify(runtimeConfigurationStatus()).includes('synthetic-never-dispatched'),false);
  for(let i=0;i<16;i++){reserveAuthorizedSpend(state,`trial-${i}`,3);settleAuthorizedSpend(state,`trial-${i}`,3);}
  assert.throws(()=>reserveAuthorizedSpend(state,'over-cap',3),/total authorized/);
  reserveAuthorizedSpend(state,'normal-call',2);delete process.env.KIARA_OPENAI_BUDGET_USD;settleAuthorizedSpend(state,'normal-call',1);
  const spend=state.receipts[AUTHORIZATION_RECEIPT_KEY].result as any;assert.equal(spend.charges['normal-call'].status,'complete');
  process.env.KIARA_OPENAI_BUDGET_USD='50';reserveAuthorizedSpend(state,'uncertain',1);settleAuthorizedSpend(state,'uncertain',0,true);assert.throws(()=>reserveAuthorizedSpend(state,'after-uncertain',0.1),/unknown/);
  process.env.KIARA_MODEL='unreviewed-model';assert.throws(()=>runtimeConfig(),/reviewed provider policy/);
 }finally{for(const [key,value] of Object.entries({KIARA_OPENAI_BUDGET_USD:oldBudget,OPENAI_API_KEY:oldKey,KIARA_MODEL:oldModel})){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(dir,{recursive:true,force:true});}
});

test('acceptance fault injection is rejected outside an explicitly enabled local test before any provider request',async()=>{
 const {dir,w}=await setup();const old=process.env.KIARA_ACCEPTANCE_TEST;
 try{delete process.env.KIARA_ACCEPTANCE_TEST;let calls=0;await assert.rejects(()=>executeModel(w.workflow_id,w.reset_epoch,{count:async()=>{calls++;return 1;},create:async()=>response([],'{}')},'draft',{transaction,transformOutput:()=>'{bad'}),/explicit local acceptance test/);assert.equal(calls,0);}
 finally{if(old===undefined)delete process.env.KIARA_ACCEPTANCE_TEST;else process.env.KIARA_ACCEPTANCE_TEST=old;await rm(dir,{recursive:true,force:true});}
});

test('provider billing failures retain safe actionable codes without retaining raw error messages',async()=>{
 const {dir,w}=await setup();
 try{await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async()=>{throw Object.assign(new Error('Unsafe raw provider message: synthetic-sensitive-value'),{status:429,code:'credit_balance_exhausted',type:'insufficient_quota'});}});const s=await readState(),attempt=getLedger(s,s.workflows[0])!.attempts[0];assert.equal(attempt.status,'rejected');assert.equal(attempt.provider_error_code,'credit_balance_exhausted');assert.equal(attempt.provider_error_type,'insufficient_quota');assert.equal(JSON.stringify(s).includes('synthetic-sensitive-value'),false);assert.ok(s.events.some(e=>e.detail.includes('credit_balance_exhausted')));}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('recovery retries a persisted unknown attempt even after its workflow was already blocked',async()=>{
 const {dir,w}=await setup();const oldBudget=process.env.KIARA_OPENAI_BUDGET_USD,oldDirectory=process.env.KIARA_GLOBAL_BUDGET_DIR;
 try{
  process.env.KIARA_OPENAI_BUDGET_USD='50';process.env.KIARA_GLOBAL_BUDGET_DIR=dir;
  const {reserveGlobalSpend,globalSpendStatus}=await import('../src/server/global-spend');
  const attemptId=await transaction(s=>{const run=s.workflows[0],ledger=initializeLedger(s,run),attempt=reserveAttempt(ledger,'draft',1000,4000);attempt.status='unknown';saveLedger(s,run,ledger);syncCounters(run,ledger);run.state='needs_human_review';run.model_status='unknown_charge';run.lease_owner=null;run.lease_until=null;return attempt.attempt_id;});
  await reserveGlobalSpend(attemptId,0.25);assert.equal((await globalSpendStatus()).unknown_charges,0);
  assert.equal(await recoverModelRuns(),0);assert.equal((await globalSpendStatus()).unknown_charges,1);
  const s=await readState(),key=`${w.reset_epoch}:global_recovery:${attemptId}`;assert.ok(s.receipts[key]);const receiptHash=s.receipts[key].hash;
  await recoverModelRuns();assert.equal((await readState()).receipts[key].hash,receiptHash);
 }finally{if(oldBudget===undefined)delete process.env.KIARA_OPENAI_BUDGET_USD;else process.env.KIARA_OPENAI_BUDGET_USD=oldBudget;if(oldDirectory===undefined)delete process.env.KIARA_GLOBAL_BUDGET_DIR;else process.env.KIARA_GLOBAL_BUDGET_DIR=oldDirectory;await rm(dir,{recursive:true,force:true});}
});

test('explicit founder retry of a settled billing rejection starts a linked run and preserves prior attempts',async()=>{
 const {dir,w}=await setup();
 try{
  const {retryBlockedModel}=await import('../src/runtime/index');
  await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async()=>{throw Object.assign(new Error('Injected billing rejection'),{status:429,code:'credit_balance_exhausted',type:'insufficient_quota'});}});
  const before=await readState(),parent=getLedger(before,before.workflows[0])!;
  await assert.rejects(()=>retryBlockedModel(w.workflow_id,w.reset_epoch,'lawyer'),/Only the founder/);
  const authorized=await retryBlockedModel(w.workflow_id,w.reset_epoch,'founder');assert.equal(authorized.state,'drafting');assert.equal(authorized.parent_run_id,parent.run_id);
  const after=await readState(),child=getLedger(after,after.workflows[0])!;assert.equal(child.parent_run_id,parent.run_id);assert.equal(after.workflows[0].model_attempts,1);assert.equal(child.attempts.length,0);assert.equal(Object.values(after.receipts).filter(r=>(r.result as any)?.kind==='runtime_history').length,1);
  let count=0;await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>{count++;return 1000;},create:async()=>{throw Object.assign(new Error('Still rejected in this injected test'),{status:429});}});assert.equal(count,1);assert.equal((await readState()).workflows[0].model_attempts,2);
  await transaction(s=>{s.workflows[0].failure='REPAIR_LIMIT_REACHED';});await assert.rejects(()=>retryBlockedModel(w.workflow_id,w.reset_epoch),/corrected inputs|weaken/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('rate backoff accepts only explicit rate rejections, caps safe headers, and preserves the absolute deadline',async()=>{
 const {rateLimitBackoff}=await import('../src/runtime/backoff');const at=1_800_000_000_000,deadline=new Date(at+240000).toISOString();
 const limited=(headers?:Headers)=>({status:429,code:'rate_limit_exceeded',headers});
 assert.equal(rateLimitBackoff(limited(new Headers({'retry-after':'120'})),0,deadline,at)?.delay_ms,30000);
 assert.equal(rateLimitBackoff(limited(new Headers({'retry-after-ms':'1250'})),0,deadline,at)?.delay_ms,1250);
 assert.equal(rateLimitBackoff(limited(new Headers({'retry-after':new Date(at+10000).toUTCString()})),0,deadline,at)?.delay_ms,10000);
 assert.equal(rateLimitBackoff(limited(),1,deadline,at)?.delay_ms,30000);
 assert.equal(rateLimitBackoff(limited(),2,deadline,at),null);
 assert.equal(rateLimitBackoff(limited(),0,new Date(at+10000).toISOString(),at),null);
 assert.equal(rateLimitBackoff({status:429,code:'credit_balance_exhausted'},0,deadline,at),null);
 assert.equal(rateLimitBackoff({status:500,code:'rate_limit_exceeded'},0,deadline,at),null);
});

test('two explicit rate rejections retry the exact request with distinct settled reservations and audited waits',async()=>{
 const {dir,w}=await setup();
 try{
  await transaction(s=>{const run=s.workflows[0],revision=scriptedCandidate(s.revisions[0],run);revision.generation='human_edit';s.revisions.push(revision);run.candidate_revision_id=revision.revision_id;run.state='validating';});
  let calls=0;const requests:string[]=[],waits:number[]=[];
  await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async req=>{calls++;requests.push(hash(req));if(calls<3)throw Object.assign(new Error('Controlled rate rejection'),{status:429,code:'rate_limit_exceeded',headers:new Headers({'retry-after':'45'})});return response([],JSON.stringify({passed:true,codes:[],explanation:'Injected review following rate retry'}));}},'validate',{transaction,waitForRateLimit:async delay=>{waits.push(delay);}});
  const s=await readState(),run=s.workflows[0],ledger=getLedger(s,run)!;
  assert.equal(run.model_status,'complete',run.failure||'');assert.equal(calls,3);assert.equal(new Set(requests).size,1);assert.deepEqual(waits,[30000,30000]);assert.deepEqual(ledger.attempts.map(a=>a.status),['rejected','rejected','complete']);assert.equal(new Set(ledger.attempts.map(a=>a.attempt_id)).size,3);assert.equal(ledger.attempts[2].retry_of_attempt_id,ledger.attempts[1].attempt_id);assert.equal(run.reserved_cost,0);assert.equal(run.unknown_charge,false);
  const retries=Object.values(s.receipts).map(r=>r.result as any).filter(r=>r?.kind==='model_rate_limit_retry');assert.equal(retries.length,2);assert.ok(retries.every(r=>r.deadline_at===ledger.deadline_at));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('repeated rate rejections stop after two retries and never extend the run deadline',async()=>{
 const {dir,w}=await setup();
 try{let calls=0,waits=0;await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async()=>{calls++;throw Object.assign(new Error('Controlled persistent rate rejection'),{status:429,code:'rate_limit_exceeded'});}},'draft',{transaction,waitForRateLimit:async()=>{waits++;}});const s=await readState(),ledger=getLedger(s,s.workflows[0])!;assert.equal(calls,3);assert.equal(waits,2);assert.equal(s.workflows[0].failure,'MODEL_REQUEST_FAILED');assert.equal(s.workflows[0].unknown_charge,false);assert.equal(ledger.attempts.length,3);assert.ok(ledger.attempts.every(a=>a.status==='rejected'&&a.cost_usd===0));assert.ok(Date.parse(ledger.deadline_at)-Date.parse(ledger.started_at)<=240000);}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('test retry wait overrides cannot bypass a real provider delay',async()=>{
 const {dir,w}=await setup();
 try{await assert.rejects(()=>executeModel(w.workflow_id,w.reset_epoch,undefined,'draft',{transaction,waitForRateLimit:async()=>{}}),/explicitly injected test provider/);}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('exact legal search computes UTF-16 offsets from pinned text and authorizes only three returned matches',async()=>{
 const {dir,w}=await setup();
 try{
  const source=structuredClone(provisions()[0]),query='exact statutory phrase';source.text='Before 😀 '+Array(4).fill(query).join(' · ');let calls=0;
  await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async request=>{
   calls++;if(calls===1)return response([{type:'function_call',call_id:'find-exact',name:'find_legal_evidence',arguments:JSON.stringify({provision_key:source.provision_key,query})}]);
   const output=(request.input as any[]).find(item=>item.type==='function_call_output');const result=JSON.parse(output.output);assert.equal(result.matches.length,3);assert.equal(result.has_more,true);assert.equal(result.source_version_id,source.source_version_id);assert.equal(result.content_hash,source.content_hash);assert.equal(result.matches[0].start_utf16,source.text.indexOf(query));assert.ok(result.matches.every((match:any)=>source.text.slice(match.start_utf16,match.end_utf16)===match.quote_text&&match.quote_text===query));
   throw Object.assign(new Error('End the synthetic tool-only test without a candidate'),{status:400});
  }},'draft',{transaction,provisions:[source]});
  const s=await readState(),ledger=getLedger(s,s.workflows[0])!;assert.equal(ledger.tools.length,1);assert.equal(ledger.tools[0].name,'find_legal_evidence');assert.deepEqual(ledger.tools[0].arguments,{provision_key:source.provision_key,query});assert.equal(ledger.retrieved_spans.length,3);assert.equal(s.revisions.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('semantic document delta reconstructs all business/legal text without duplicate citation proof metadata',async()=>{
 const {semanticDocumentPacket}=await import('../src/runtime/semantic');const {dir,state,w}=await setup();
 try{const base=state.revisions[0],candidate=scriptedCandidate(base,w);candidate.clauses=[...candidate.clauses].reverse();const packet=semanticDocumentPacket(base,candidate),mapped=new Map(base.clauses.map(c=>[c.clause_id,c]));for(const c of packet.candidate_delta.clause_patches)mapped.set(c.clause_id,c);for(const id of packet.candidate_delta.removed_clause_ids)mapped.delete(id);const reconstructed={...packet.candidate_delta.metadata,clauses:packet.candidate_delta.clause_order.map(id=>mapped.get(id)!)};assert.deepEqual(reconstructed.clauses,candidate.clauses);assert.equal(reconstructed.title,candidate.title);assert.equal(reconstructed.policy_updated_on,candidate.policy_updated_on);assert.ok(!JSON.stringify(packet).includes('evidence_bindings'));assert.ok(packet.candidate_delta.clause_patches.length<candidate.clauses.length);}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('semantic packing counts complete balanced batches once, merges when possible, and never omits text',async()=>{
 const {planSemanticBatches}=await import('../src/runtime/semantic');
 const laws=Array.from({length:16},(_,i)=>({...provisions()[0],provision_key:`synthetic-${i}`,text:(`complete source ${i} `).repeat(300)}));
 const builder=(authorities:typeof laws)=>({model:'gpt-6-sol',input:JSON.stringify({facts:'known'.repeat(50),authoritative_provisions:authorities}),max_output_tokens:4000});
 let counts=0;const seen:string[]=[];
 const plan=await planSemanticBatches(laws,builder,async request=>{counts++;const serialized=String(request.input);seen.push(hash(request));return Math.ceil(Buffer.byteLength(serialized)/4)+100;});
 assert.equal(new Set(seen).size,counts,'Identical counted requests are cached');assert.ok(counts<16,`Expected fewer counts than the sixteen-source linear scan, got ${counts}`);assert.equal(plan.count_requests,counts);assert.ok(plan.batches.length<=3);assert.deepEqual(plan.batches.flatMap(b=>b.authorities).map(p=>p.provision_key).sort(),laws.map(p=>p.provision_key).sort());for(const batch of plan.batches){assert.ok(batch.input_tokens+256<=24000);const parsed=JSON.parse(String(batch.request.input));assert.deepEqual(parsed.authoritative_provisions,batch.authorities);}
});

test('semantic packing refuses one oversized complete authority instead of truncating it',async()=>{
 const {planSemanticBatches}=await import('../src/runtime/semantic');const source={...provisions()[0],text:'mandatory text'.repeat(50000)};
 await assert.rejects(()=>planSemanticBatches([source],law=>({model:'gpt-6-sol',input:JSON.stringify(law)}),async request=>String(request.input).length),/One complete authority/);
 assert.equal(source.text.length,'mandatory text'.length*50000);
});

test('retrieval rate retries cannot consume the final proposal-emission slot',async()=>{
 const {dir,state,w}=await setup();
 try{const changes=generatedChanges(state,w);let calls=0;
  await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async request=>{
   calls++;if(calls<=2)throw Object.assign(new Error('Controlled retrieval rate rejection'),{status:429,code:'rate_limit_exceeded'});
   if(calls===3)return response([evidenceBatch()]);
   if(calls===4){assert.equal(request.tools?.length,0,'After two transport retries the next generation request must emit a proposal, not another tool call');assert.ok(request.instructions?.includes('final generation request'));return response([],JSON.stringify({changes}));}
   return response([],JSON.stringify({passed:true,codes:[],explanation:'Injected independent checker'}));
  }},'draft',{transaction,max_attempts:9,waitForRateLimit:async()=>{}});
  const s=await readState();assert.equal(s.workflows[0].model_status,'complete',s.workflows[0].failure||'');assert.equal(calls,5);assert.equal(s.workflows[0].model_attempts,5);assert.equal(s.workflows[0].repair_count,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('numeric provider rate diagnostics exclude raw messages, identifiers and unknown headers',async()=>{
 const {providerRateDiagnostics}=await import('../src/runtime/backoff');
 const info=providerRateDiagnostics({message:'Rate limit for org-private-identifier: Limit: 1000000, Used: 985000, Requested: 42000. Please try again in 1.25s. secret-other-text',headers:new Headers({'x-ratelimit-limit-tokens':'1000000','x-ratelimit-remaining-tokens':'15000','x-ratelimit-limit-requests':'5000','x-ratelimit-remaining-requests':'4999','x-ratelimit-reset-tokens':'1m2.5s','x-ratelimit-reset-requests':'invalid-private-text','openai-organization':'org-private-identifier','retry-after-ms':'1250'})});
 assert.deepEqual(info,{message_limit:1000000,message_used:985000,message_requested:42000,message_retry_after_ms:1250,header_limit_tokens:1000000,header_remaining_tokens:15000,header_limit_requests:5000,header_remaining_requests:4999,header_reset_tokens_ms:62500,header_retry_after_ms:1250});
 assert.ok(Object.values(info).every(value=>typeof value==='number'));assert.ok(!JSON.stringify(info).includes('private'));assert.deepEqual(providerRateDiagnostics({message:'Limit: NaN Used: -1 Requested: Infinity',headers:{'x-ratelimit-limit-tokens':'99999999999999999999999'}}),{});
});

test('legal citation chunks preserve literal text, surrogate offsets and explicit capacity continuations',async()=>{
 const {citationChunks,evidencePacket,CITATION_QUOTE_LIMIT}=await import('../src/runtime/evidence');
 const text='a'.repeat(399)+'😀'+(' Exact complete sentence.').repeat(250),chunks=citationChunks(text,0,text.length);
 assert.equal(chunks.map(c=>c.quote_text).join(''),text);assert.ok(chunks.every(c=>c.quote_text.length<=CITATION_QUOTE_LIMIT&&text.slice(c.start_utf16,c.end_utf16)===c.quote_text));assert.equal(chunks[0].end_utf16,399);assert.equal(chunks[1].start_utf16,399);
 const source={...provisions()[0],text:'"\\\n'.repeat(5000)},packet=evidencePacket([{provision:source,start_utf16:0,length:8000}]);
 assert.ok(JSON.stringify(packet).length<=12000);const row=packet.spans[0];assert.equal(row.capacity_limited,true);assert.equal(row.next_start_utf16,row.end_utf16);assert.equal(row.requested_end_utf16,8000);assert.ok(row.end_utf16<8000);assert.equal(row.citation_chunks.map(c=>c.quote_text).join(''),source.text.slice(0,row.end_utf16));
 const more=evidencePacket([{provision:source,start_utf16:row.next_start_utf16,length:8000-row.next_start_utf16}]);assert.equal(more.spans[0].start_utf16,row.end_utf16);assert.equal(more.spans[0].citation_chunks.map(c=>c.quote_text).join(''),source.text.slice(row.end_utf16,more.spans[0].end_utf16));
});

test('incomplete paid-shaped output retains partial bytes and allows only explicit settled founder retry',async()=>{
 const {dir,w}=await setup();
 try{
  const partial='{"changes":[{"body":"Unfinished';let calls=0;
  await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async request=>{calls++;assert.equal(request.max_output_tokens,10000);const out=response([],partial);out.id='resp_incomplete';out.status='incomplete';out.incomplete_details={reason:'max_output_tokens'};return out;}});
  const s=await readState(),run=s.workflows[0],parent=getLedger(s,run)!;assert.equal(calls,1);assert.equal(run.failure,'MODEL_OUTPUT_INCOMPLETE');assert.equal(run.unknown_charge,false);assert.equal(s.revisions.length,1);
  const failure=Object.values(s.receipts).map(r=>r.result as any).find(r=>r?.kind==='model_output_failure');assert.equal(failure.output_json,partial);assert.equal(failure.output_hash,hash(partial));assert.equal(failure.response_id,'resp_incomplete');assert.equal(failure.incomplete_reason,'max_output_tokens');assert.equal(failure.provider_status,'incomplete');
  const {retryBlockedModel}=await import('../src/runtime/index');await assert.rejects(()=>retryBlockedModel(w.workflow_id,w.reset_epoch,'lawyer'),/Only the founder/);await retryBlockedModel(w.workflow_id,w.reset_epoch,'founder');
  const retried=await readState(),child=getLedger(retried,retried.workflows[0])!;assert.equal(child.parent_run_id,parent.run_id);assert.equal(child.cumulative_before.cost_usd,parent.attempts[0].cost_usd);assert.equal(retried.workflows[0].facts[0].fact_id,run.facts[0].fact_id);assert.equal(child.attempts.length,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('repair rate retries preserve all three independent checker slots',async()=>{
 const {dir,state,w}=await setup();
 try{const changes=generatedChanges(state,w);let calls=0,waits=0;
  await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async request=>{
   calls++;if(calls<=3)return response([{...evidenceBatch(),call_id:`evidence-${calls}`}]);
   if(calls===4)return response([],'malformed output');
   assert.equal(request.tools?.length,0);throw Object.assign(new Error('Controlled repair rate rejection'),{status:429,code:'rate_limit_exceeded'});
  }},'draft',{transaction,max_attempts:9,waitForRateLimit:async()=>{waits++;}});
  const s=await readState();assert.equal(calls,6);assert.equal(waits,1);assert.equal(s.workflows[0].failure,'MODEL_REQUEST_LIMIT');assert.equal(s.workflows[0].model_attempts,6);assert.equal(s.revisions.length,1);assert.equal(s.workflows[0].unknown_charge,false);assert.equal(changes.length>0,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('checker capacity failure retains the unaccepted proposal and founder retry validates it without redrafting',async()=>{
 const {dir,state,w}=await setup();
 try{const changes=generatedChanges(state,w);let calls=0;
  await executeModel(w.workflow_id,w.reset_epoch,{count:async request=>request.text?.format?.type==='json_schema'&&request.text.format.name==='semantic_review'?100000:1000,create:async()=>{calls++;return calls===1?response([evidenceBatch()]):response([],JSON.stringify({changes}));}});
  const before=await readState(),run=before.workflows[0],pending=before.revisions.find(r=>r.revision_id===run.candidate_revision_id)!;assert.equal(run.failure,'SEMANTIC_CONTEXT_CAPACITY');assert.ok(pending);assert.equal(pending.semantic_validation,undefined);assert.equal(run.bundle_hash,null);assert.ok(Object.values(before.receipts).some(r=>(r.result as any)?.kind==='model_proposal_pending_semantic'));
  const {retryBlockedModel}=await import('../src/runtime/index');const retry=await retryBlockedModel(w.workflow_id,w.reset_epoch);assert.equal(retry.state,'validating');
  await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async request=>{assert.equal((request.text?.format as any)?.name,'semantic_review');return response([],JSON.stringify({passed:true,codes:[],explanation:'Injected full semantic check'}));}},'validate');
  const after=await readState();assert.equal(after.workflows[0].model_status,'complete');assert.equal(after.workflows[0].model_attempts,3);assert.deepEqual(after.revisions.find(r=>r.revision_id===pending.revision_id),pending,'Unaccepted proposal remains immutable');assert.equal(after.revisions.find(r=>r.revision_id===after.workflows[0].candidate_revision_id)?.semantic_validation?.passed,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('opaque citation IDs resolve only exact returned source chunks and reject guessed or changed evidence',async()=>{
 const {evidencePacket,resolveCitationReference}=await import('../src/runtime/evidence');const p=provisions()[0],packet=evidencePacket([{provision:p,start_utf16:0,length:64}]),chunk=packet.spans[0].citation_chunks[0];
 const admitted={citation_id:chunk.citation_id!,provision_key:p.provision_key,source_version_id:p.source_version_id,start_utf16:chunk.start_utf16,end_utf16:chunk.end_utf16};
 const ref=resolveCitationReference({citation_id:admitted.citation_id},[admitted],[p]);assert.equal(ref.quote_text,p.text.slice(0,64));assert.equal(ref.end_utf16,64);
 assert.throws(()=>resolveCitationReference({citation_id:'cite_invented'},[admitted],[p]),/not returned/);assert.throws(()=>resolveCitationReference({citation_id:admitted.citation_id},[],[p]),/not returned/);assert.throws(()=>resolveCitationReference({citation_id:admitted.citation_id},[admitted],[{...p,text:'altered'+p.text}]),/pinned source/);
});

test('provider-selected citation IDs become exact audited citations without model-copied offsets or quotes',async()=>{
 const {dir,state,w}=await setup();
 try{const changes=generatedChanges(state,w);let calls=0;
  await executeModel(w.workflow_id,w.reset_epoch,{count:async()=>1000,create:async request=>{
   calls++;if(calls===1)return response([evidenceBatch()]);
   if(calls===2){const output=(request.input as any[]).find(item=>item.type==='function_call_output'),packet=JSON.parse(output.output),ids=new Map(packet.spans.map((span:any)=>[span.provision_key,span.citation_chunks[0].citation_id]));const selected=changes.map(c=>({...c,legal_refs:c.legal_refs.map(ref=>({citation_id:ids.get(ref.provision_key)}))}));assert.ok(JSON.stringify(request.text).includes('citation_id'));return response([],JSON.stringify({changes:selected}));}
   return response([],JSON.stringify({passed:true,codes:[],explanation:'Injected full source semantic review'}));
  }});
  const s=await readState(),run=s.workflows[0],candidate=s.revisions.find(r=>r.revision_id===run.candidate_revision_id)!;assert.equal(run.model_status,'complete',run.failure||'');assert.equal(calls,3);assert.equal(getLedger(s,run)!.retrieved_citations?.length,16);for(const binding of candidate.evidence_bindings||[])for(const ref of binding.legal_refs as import('../src/validation/proposal').CitedRef[]){assert.ok(ref.quote_text);assert.equal(provisions().find(p=>p.provision_key===ref.provision_key)!.text.slice(ref.start_utf16,ref.end_utf16),ref.quote_text);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
