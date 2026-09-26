import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readState} from '../src/data/store';
import {seed,ACTORS} from '../src/data/fixtures';
import {importCompanyContext,validateContextInput} from '../src/server/context';
import {operationalEvidence} from '../src/server/operations';
import {signup,reset} from '../src/workflow/engine';
import type {Session} from '../src/server/contracts';

test('supplied context is versioned, attributed, idempotent and cannot be silently replaced during review',async t=>{
  const old={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-intake-'));
  delete process.env.MONGODB_URI;delete process.env.VERCEL;
  Object.assign(process.env,{KIARA_DATA_DIR:dir,KIARA_AUTH_MODE:'demo_simulated',KIARA_MODEL_MODE:'scripted'});
  t.after(async()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);await rm(dir,{recursive:true,force:true});});
  const s=await readState(),base=s.revisions[0];
  const session:Session={role:'founder',actor_id:ACTORS.founder,tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,csrf:'test',expires_at:Date.now()+10000};
  const input={company_name:'Unseen Systems',expected_reset_epoch:s.reset_epoch,expected_context_epoch:s.context_epoch,facts:s.facts.map(({fact_key,knowledge,value})=>({fact_key,knowledge,value:fact_key==='consumer_request_email'?'privacy@unseen.example':value,provenance:'Founder supplied acceptance input'})),document:{title:'Unseen Systems policy',policy_updated_on:'2026-09-01',clauses:[...base.clauses,{clause_id:'unseen-contract',heading:'Contract continuity',body:'Existing customer contract terms remain unchanged.'}]}};
  await assert.rejects(importCompanyContext(input,{...session,role:'lawyer'},'wrong-role'),/founder/i);
  const imported=await importCompanyContext(input,session,'import-v2');
  assert.deepEqual(await importCompanyContext(input,session,'import-v2'),imported);
  const after=await readState();
  assert.equal(after.context_epoch,2);assert.deepEqual(after.revisions[0],base);assert.equal(after.facts.find(f=>f.fact_key==='consumer_request_email')!.value,'privacy@unseen.example');
  const evidence=operationalEvidence(after);assert.equal(evidence.scope.source,'founder_supplied');assert.equal(evidence.inference_evidence.completed_requests,0);assert.equal(evidence.runs.length,0);
  await assert.rejects(importCompanyContext({...input,company_name:'Stale'},session,'stale'),/context changed/i);
  const ack=await signup({customer_name:'Unseen event',residence:'US-CA',scenario:'supplied',expected_reset_epoch:s.reset_epoch,expected_context_epoch:2},'event-v2');
  assert.equal(ack.accepted,true);assert.ok(ack.event_id);assert.equal(ack.context_epoch,2);
  const running=await readState();assert.equal(running.workflows[0].base_revision_id,imported.document_revision_id);
  assert.equal(running.workflows[0].facts.find(f=>f.fact_key==='annual_gross_revenue_usd')!.value,after.facts.find(f=>f.fact_key==='annual_gross_revenue_usd')!.value);
  await assert.rejects(importCompanyContext({...input,expected_context_epoch:2},session,'overlap'),/active reviews/i);
  process.env.KIARA_MODEL_MODE='openai';await assert.rejects(reset(s.reset_epoch),/history|retain|reset/i);
});

test('context intake rejects duplicate facts, malformed prior document and absent provenance',()=>{
  const s=seed(),r=s.revisions[0];
  const input={company_name:'Test',facts:s.facts,document:{title:r.title,policy_updated_on:r.policy_updated_on,clauses:r.clauses},expected_context_epoch:1,expected_reset_epoch:1};
  assert.throws(()=>validateContextInput({...input,facts:[s.facts[0],s.facts[0]]}),/unique/);
  assert.throws(()=>validateContextInput({...input,facts:[{...s.facts[0],provenance:''}]}),/provenance/);
  assert.throws(()=>validateContextInput({...input,document:{...input.document,clauses:[r.clauses[0],r.clauses[0]]}}),/unique/);
});
