import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readState,transaction} from '../src/data/store';
import {signup,tick,verifyModelFact,feedback,verifyFact} from '../src/workflow/engine';
import {hash,id} from '../src/server/hash';
import {FACT_LIMITS,validateProposedFactValue} from '../src/server/fact-values';
import type {Fact} from '../src/server/contracts';

test('new model and human facts remain untrusted until founder verification; all prior context is retained',async()=>{
 const beforeEnv={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-new-facts-'));
 delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_AUTH_MODE;
 Object.assign(process.env,{KIARA_DATA_DIR:dir,KIARA_MODEL_MODE:'scripted',KIARA_EMAIL_MODE:'preview'});
 try{
  const initial=await readState(),created=await signup({customer_name:'Fact review fixture',residence:'US-CA',scenario:'covered',expected_reset_epoch:initial.reset_epoch},id());
  for(let i=0;i<10;i++)await tick();
  const before=await readState(),w=before.workflows[0],proposalId=id(),key=`${before.reset_epoch}:model_fact_proposal:${proposalId}`;
  const proposal={kind:'model_fact_proposal',proposal_id:proposalId,workflow_id:created.workflow_id,tenant_id:before.tenant_id,reset_epoch:before.reset_epoch,context_epoch:before.context_epoch,fact_value_hash:hash(null),fact_key:'privacy_request_form_url',proposed_value:'https://fixture.example/privacy/requests',reason:'Unverified example supplied for review',status:'unverified',authority:'founder_review_required',created_at:new Date().toISOString()};
  await transaction(s=>{s.receipts[key]={hash:hash(proposal),result:proposal};});
  assert.deepEqual((await readState()).facts,before.facts);assert.equal((await readState()).context_epoch,before.context_epoch);
  await assert.rejects(verifyModelFact(proposalId,'lawyer',before.reset_epoch,before.context_epoch),/Only the founder/);
  await verifyModelFact(proposalId,'founder',before.reset_epoch,before.context_epoch);
  const after=await readState();assert.equal(after.facts.find(f=>f.fact_key===proposal.fact_key)?.value,proposal.proposed_value);
  assert.equal(after.context_epoch,before.context_epoch+1);assert.deepEqual(after.receipts[key].result,proposal);
  assert.equal(after.workflows[0].state,'queued');assert.equal(after.workflows[0].bundle_hash,null);assert.equal(after.workflows[0].candidate_revision_id,null);
  assert.ok(after.revisions.some(r=>r.revision_id===w.candidate_revision_id));
  const changes=Object.values(after.receipts).map(x=>x.result).filter((x:any)=>x?.kind==='verified_fact_context_change') as any[];
  assert.equal(changes.length,1);assert.equal(changes[0].previous,null);assert.equal(changes[0].next.fact_key,proposal.fact_key);assert.equal(changes[0].role,'founder');
  const human=await feedback(created.workflow_id,'lawyer',{type:'fact_correction',fact_key:'notice_at_collection_contact',proposed_value:{email:'privacy@fixture.example',active:true},text:'Please verify this additional operational contact.',expected_reset_epoch:after.reset_epoch},id());
  assert.equal((await readState()).facts.some(f=>f.fact_key==='notice_at_collection_contact'),false);
  await assert.rejects(verifyFact(human.feedback_id,'lawyer',after.reset_epoch),/Only the founder/);
  await verifyFact(human.feedback_id,'founder',after.reset_epoch);
  assert.deepEqual((await readState()).facts.find(f=>f.fact_key==='notice_at_collection_contact')?.value,{email:'privacy@fixture.example',active:true});
 }finally{for(const key of Object.keys(process.env))if(!(key in beforeEnv))delete process.env[key];Object.assign(process.env,beforeEnv);await rm(dir,{recursive:true,force:true});}
});

test('new fact values cannot bypass key, size, nesting, or count limits',()=>{
 for(const key of ['constructor','__proto__','Privacy URL','x'.repeat(81)])assert.throws(()=>validateProposedFactValue(key,true,[]));
 for(const value of [Infinity,'a'.repeat(8193),JSON.parse('{"__proto__":{"polluted":true}}'),[[[[[[[true]]]]]]]])assert.throws(()=>validateProposedFactValue('new_fact',value,[]));
 const facts=Array.from({length:FACT_LIMITS.count},(_,i)=>({fact_id:String(i),fact_key:'fact_'+i,knowledge:'known',value:true,provenance:'test'})) as Fact[];
 assert.throws(()=>validateProposedFactValue('another_fact',true,facts),/128-fact/);
 assert.doesNotThrow(()=>validateProposedFactValue('fact_0',false,facts));
});
