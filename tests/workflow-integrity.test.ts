import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signup,tick,review,feedback,verifyFact,reset} from '../src/workflow/engine';
import {contextSnapshotKey,documentRedline,textChanges} from '../src/workflow/documents';
import {assess} from '../src/workflow/legal';
import {validateProposal,revisionDigest,missingDisclosureTopics} from '../src/validation/proposal';
import {readState,transaction} from '../src/data/store';
import {hash,id} from '../src/server/hash';
import type {Workflow} from '../src/server/contracts';

async function isolated(run:()=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),'kiara-context-integrity-')),before={...process.env};
  process.env.KIARA_DATA_DIR=dir;delete process.env.MONGODB_URI;
  process.env.KIARA_MODEL_MODE='scripted';process.env.KIARA_EMAIL_MODE='preview';
  try{await run();}finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
}
async function advance(wid:string){
  for(let step=0;step<20;step++){
    await tick();const current=(await readState()).workflows.find(w=>w.workflow_id===wid)!;
    if(['awaiting_founder','needs_information','needs_human_review','closed_no_change'].includes(current.state))return current;
  }
  throw new Error('Run did not reach a boundary');
}
async function start(){const s=await readState(),accepted=await signup({customer_name:'Unseen context test',residence:'US-CA',scenario:'covered',expected_reset_epoch:s.reset_epoch},id());return advance(accepted.workflow_id);}
const approve=(w:Workflow)=>({action:'approved' as const,expected_state_version:w.state_version,expected_reset_epoch:w.reset_epoch,bundle_hash:w.bundle_hash!,note:'Test-only human approval'});

test('unseen request email and URL cannot pass by citing the right fact ID with the wrong prose',()=>isolated(async()=>{
  const w=await start(),s=await readState(),r=s.revisions.find(r=>r.revision_id===w.candidate_revision_id)!,base=s.revisions.find(r=>r.revision_id===w.base_revision_id)!;
  const changed=structuredClone(w);
  changed.facts.find(f=>f.fact_key==='consumer_request_email')!.value='privacy@unseen-company.example';
  changed.facts.find(f=>f.fact_key==='consumer_request_web_path')!.value='https://unseen-company.example/rights';
  const errors=validateProposal(changed,r,base);
  assert.ok(errors.includes('CONTACT_FACT_MISMATCH'));
  assert.ok(errors.includes('CONTACT_FACT_OMITTED'));
  assert.ok(errors.includes('REQUEST_URL_FACT_MISMATCH'));
  const malicious=structuredClone(r);malicious.clauses.find(c=>/submit a privacy request/.test(c.heading))!.body+=' Visit https://unverified.example/rights.';malicious.content_hash=revisionDigest(malicious);
  assert.ok(validateProposal(changed,malicious,base).includes('UNVERIFIED_DOCUMENT_URL'));
}));

test('required disclosure validation supports arbitrary document, clause and fact identities',()=>isolated(async()=>{
  const w=await start(),s=await readState(),r=structuredClone(s.revisions.find(r=>r.revision_id===w.candidate_revision_id)!),base=structuredClone(s.revisions.find(r=>r.revision_id===w.base_revision_id)!);
  const clauseIDs=new Map([...base.clauses,...r.clauses].map(c=>[c.clause_id,id()]));
  const factIDs=new Map(w.facts.map(f=>[f.fact_id,id()]));
  const documentID=id();base.document_id=documentID;r.document_id=documentID;
  base.revision_id=id();w.base_revision_id=base.revision_id;r.base_revision_id=base.revision_id;
  for(const document of [base,r])for(const clause of document.clauses)clause.clause_id=clauseIDs.get(clause.clause_id)!;
  for(const fact of w.facts)fact.fact_id=factIDs.get(fact.fact_id)!;
  for(const binding of r.evidence_bindings!){binding.clause_ids=binding.clause_ids.map(cid=>clauseIDs.get(cid)!);binding.fact_refs=binding.fact_refs.map(f=>({...f,fact_id:factIDs.get(f.fact_id)!}));}
  base.content_hash=revisionDigest(base);r.content_hash=revisionDigest(r);r.generation='openai';w.model_mode='openai';
  // An explicit test double for this deterministic validator test, never provider execution evidence.
  r.semantic_validation={passed:true,codes:[],reviewed_content_hash:r.content_hash,model:'test-double',checked_at:new Date().toISOString()};
  assert.deepEqual(validateProposal(w,r,base),[]);
}));

test('unseen unrelated clauses remain protected even with valid citations and a passing semantic verdict',()=>isolated(async()=>{
  const w=await start(),s=await readState(),base=structuredClone(s.revisions.find(r=>r.revision_id===w.base_revision_id)!),r=structuredClone(s.revisions.find(r=>r.revision_id===w.candidate_revision_id)!);
  const unrelated={clause_id:id(),heading:'Integration service credits',body:'The customer receives a fixed service credit of 25 USD for an unavailable integration.'};
  base.clauses.push(unrelated);base.content_hash=revisionDigest(base);r.clauses.push(structuredClone(unrelated));
  r.generation='openai';w.model_mode='openai';
  const certify=()=>{r.content_hash=revisionDigest(r);r.semantic_validation={passed:true,codes:[],reviewed_content_hash:r.content_hash,model:'test-double',checked_at:new Date().toISOString()};};
  certify();assert.deepEqual(validateProposal(w,r,base),[],'The unseen clause may be carried forward unchanged.');
  r.evidence_bindings!.push({...structuredClone(r.evidence_bindings![0]),clause_ids:[unrelated.clause_id]});
  const changed=r.clauses.find(c=>c.clause_id===unrelated.clause_id)!;changed.body='The customer receives no service credits.';certify();
  assert.ok(validateProposal(w,r,base).includes('UNCHANGED_CLAUSE_MODIFIED'),'A real citation and right fact ID cannot authorize an unrelated contract change.');
  changed.heading='Information practices';certify();
  assert.ok(validateProposal(w,r,base).includes('UNCHANGED_CLAUSE_MODIFIED'),'Renaming the candidate heading must not expand the original scope.');
}));

test('live intake preserves supplied facts and blocks paid drafting until source recheck',()=>isolated(async()=>{
  await transaction(s=>{s.facts.find(f=>f.fact_key==='physical_state_at_collection')!.value='US-WA';s.facts.find(f=>f.fact_key==='ca_consumers_commercial_processing_current_year')!.value=987;s.facts.find(f=>f.fact_key==='ca_processing_initiated_on')!.value='2026-05-04';});
  const s=await readState();process.env.KIARA_MODEL_MODE='openai';
  await assert.rejects(signup({customer_name:'Live',residence:'US-CA',scenario:'covered',expected_reset_epoch:s.reset_epoch},id()),/supplied/);
  await assert.rejects(signup({customer_name:'Live',residence:'US-CA',scenario:'supplied',expected_reset_epoch:s.reset_epoch},id()),/context version/);
  const ack=await signup({customer_name:'Live',residence:'US-CA',scenario:'supplied',expected_context_epoch:s.context_epoch,expected_reset_epoch:s.reset_epoch},id());
  const w=await advance(ack.workflow_id),state=await readState();
  assert.equal(w.state,'needs_human_review');assert.equal(w.candidate_revision_id,null);assert.equal(w.model_attempts,0);assert.equal(w.repair_count,0);
  assert.equal(w.facts.find(f=>f.fact_key==='physical_state_at_collection')!.value,'US-WA');
  assert.equal(w.facts.find(f=>f.fact_key==='ca_consumers_commercial_processing_current_year')!.value,987);
  assert.equal(w.facts.find(f=>f.fact_key==='ca_processing_initiated_on')!.value,'2026-05-04');
  const snapshot=state.receipts[contextSnapshotKey(w)];assert.ok(snapshot);assert.equal(snapshot.hash,hash(snapshot.result));
  assert.ok(state.events.some(e=>e.workflow_id===w.workflow_id&&e.type==='source.recheck_required'));
  await assert.rejects(reset(w.reset_epoch),/retain run/);
}));

test('immutable redline reconstructs exact prior and candidate wording and retains unfamiliar content',()=>isolated(async()=>{
  const custom={clause_id:id(),heading:'Company-specific support promise',body:'A supplied paragraph with two  spaces,\nUnicode café and a final newline.\n'};
  await transaction(s=>{const base=s.revisions[0];base.clauses.push(custom);base.content_hash=revisionDigest(base);});
  const w=await start(),s=await readState(),base=s.revisions.find(r=>r.revision_id===w.base_revision_id)!,r=s.revisions.find(r=>r.revision_id===w.candidate_revision_id)!;
  assert.deepEqual(r.clauses.find(c=>c.clause_id===custom.clause_id),custom);
  const redline=documentRedline(base,r,w.workflow_id),receipt=s.receipts[`${s.reset_epoch}:redline:${r.revision_id}`];
  assert.equal(receipt.hash,hash(redline));assert.deepEqual(receipt.result,redline);
  for(const clause of redline.clauses){
    assert.equal(clause.body.filter(d=>d.kind!=='add').map(d=>d.text).join(''),clause.before?.body||'');
    assert.equal(clause.body.filter(d=>d.kind!=='remove').map(d=>d.text).join(''),clause.after?.body||'');
  }
  for(const [before,after] of [['abc',''],['','new'],['one  two\nthree','one\tfour\nthree'],['café 😀','café 😃']]){
    const chunks=textChanges(before,after);assert.equal(chunks.filter(c=>c.kind!=='add').map(c=>c.text).join(''),before);assert.equal(chunks.filter(c=>c.kind!=='remove').map(c=>c.text).join(''),after);
  }
}));

test('lawyer interpretation feedback retains attribution and invalidates both approvals without changing facts',()=>isolated(async()=>{
  let w=await start();const initial=await readState(),original=structuredClone(initial.revisions.find(r=>r.revision_id===w.candidate_revision_id)!);
  await review(w.workflow_id,'founder',approve(w),id());w=(await readState()).workflows[0];
  const obsolete=approve(w),oldBundle=w.bundle_hash;
  const result=await feedback(w.workflow_id,'lawyer',{type:'legal_interpretation_note',text:'Review the scope of deletion exceptions against the retained text.',expected_state_version:w.state_version,expected_reset_epoch:w.reset_epoch},id());
  const intermediate=await readState();assert.equal(intermediate.workflows[0].bundle_hash,null);assert.equal(intermediate.notifications[0].status,'canceled');
  w=await advance(w.workflow_id);assert.equal(w.state,'awaiting_founder');assert.notEqual(w.bundle_hash,oldBundle);assert.equal(w.approvals.length,1);
  const after=await readState();assert.deepEqual(after.facts,initial.facts);assert.deepEqual(after.revisions.find(r=>r.revision_id===original.revision_id),original);
  const audit=after.receipts[`${w.reset_epoch}:human_feedback:${result.feedback_id}`].result as any;
  assert.equal(audit.role,'lawyer');assert.ok(audit.actor_id);assert.equal(audit.authority,'reviewer_feedback_not_verified_company_fact');
  await assert.rejects(review(w.workflow_id,'lawyer',obsolete,id()),/changed|older/);
  await assert.rejects(review(w.workflow_id,'lawyer',approve(w),id()),/Founder approval/);
  await review(w.workflow_id,'founder',approve(w),id());w=(await readState()).workflows[0];await review(w.workflow_id,'lawyer',approve(w),id());
  const final=await readState();assert.equal(final.workflows[0].state,'finalized');assert.equal(final.feedback.length,1);assert.ok(final.receipts[`${w.reset_epoch}:human_feedback:${result.feedback_id}`]);
}));

test('stale fact correction cannot overwrite a later verified company context',()=>isolated(async()=>{
  const w=await start(),input={type:'fact_correction' as const,fact_key:'annual_gross_revenue_usd',proposed_value:31000000,text:'Proposed updated financial fact',expected_reset_epoch:w.reset_epoch};
  const old=await feedback(w.workflow_id,'lawyer',input,id()),current=await feedback(w.workflow_id,'founder',{...input,proposed_value:32000000},id());
  await verifyFact(current.feedback_id,'founder',w.reset_epoch);
  await assert.rejects(verifyFact(old.feedback_id,'founder',w.reset_epoch),/stale/);
  assert.equal((await readState()).facts.find(f=>f.fact_key==='annual_gross_revenue_usd')!.value,32000000);
}));

test('pinned context tampering fails approval even if the candidate and bundle are unchanged',()=>isolated(async()=>{
  const w=await start();await transaction(s=>{s.workflows[0].facts.find(f=>f.fact_key==='consumer_request_email')!.value='attacker@unseen.example';});
  await assert.rejects(review(w.workflow_id,'founder',approve(w),id()),/Pinned facts/);
}));

test('unsupported jurisdiction and future rule period escalate instead of issuing no-change decisions',()=>isolated(async()=>{
  const s=await readState(),ack=await signup({customer_name:'New York supplied jurisdiction',residence:'US-NY',scenario:'covered',expected_reset_epoch:s.reset_epoch},id());
  const w=await advance(ack.workflow_id);assert.equal(w.state,'needs_information');assert.ok(w.assessment?.missing_facts.includes('unsupported_jurisdiction'));assert.equal(w.candidate_revision_id,null);
  const future=assess(w.facts,'2027-01-01T00:00:00Z');assert.equal(future.outcome,'needs_information');assert.ok(future.missing_facts.includes('unsupported_rule_period'));
}));


test('disclosure coverage accepts combined sections while reporting missing topics',()=>isolated(async()=>{
  const w=await start(),s=await readState(),r=structuredClone(s.revisions.find(r=>r.revision_id===w.candidate_revision_id)!);
  // The same substantive disclosures may be combined under freely chosen headings.
  r.clauses=[{clause_id:'combined',heading:'Our privacy notice',body:r.clauses.map(c=>c.heading+': '+c.body).join('\\n')}];
  assert.deepEqual(missingDisclosureTopics(r),[]);
  r.clauses[0].body='Contact us to request access to your personal information.';
  assert.ok(missingDisclosureTopics(r).includes('authorized agents'));
  assert.ok(missingDisclosureTopics(r).includes('retention periods or criteria'));
}));
