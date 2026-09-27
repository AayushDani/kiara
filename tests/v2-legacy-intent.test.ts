import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readState,transaction} from '../src/data/store';
import {signup,tick,feedback,verifyFact,verifyModelFact,cancelWorkflow} from '../src/workflow/engine';
import {importCompanyContext} from '../src/server/context';
import {operationalEvidence} from '../src/server/operations';
import {hash,id} from '../src/server/hash';
import {ACTORS} from '../src/data/fixtures';

async function isolated(run:()=>Promise<void>){const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-legacy-'));delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_AUTH_MODE;Object.assign(process.env,{KIARA_DATA_DIR:dir,KIARA_MODEL_MODE:'scripted',KIARA_EMAIL_MODE:'preview'});try{await run();}finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}}
async function start(supplied=false){const s=await readState();const r=await signup({customer_name:'Guard regression',residence:'US-CA',scenario:supplied?'supplied':'covered',expected_reset_epoch:s.reset_epoch,expected_context_epoch:s.context_epoch},id());for(let i=0;i<8;i++)await tick();return (await readState()).workflows.find(w=>w.workflow_id===r.workflow_id)!;}

test('F07 supplied context lineage survives an attributed fact correction and later supplied work',()=>isolated(async()=>{
 const s=await readState(),document=s.revisions.find(r=>r.revision_id===s.current_revision_id)!;
 await importCompanyContext({company_name:'Supplied company',facts:s.facts.map(({fact_key,knowledge,value,provenance})=>({fact_key,knowledge,value,provenance})),document:{title:document.title,policy_updated_on:document.policy_updated_on,clauses:document.clauses},expected_reset_epoch:s.reset_epoch,expected_context_epoch:s.context_epoch},{actor_id:ACTORS.founder,role:'founder',tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,csrf:'test',expires_at:Date.now()+60000},id());
 const w=await start(true),before=await readState();const correction=await feedback(w.workflow_id,'founder',{type:'fact_correction',fact_key:'annual_gross_revenue_usd',proposed_value:42_000_000,text:'Verified newer revenue evidence',expected_reset_epoch:before.reset_epoch},id());
 await verifyFact(correction.feedback_id,'founder',before.reset_epoch);
 const after=await readState();assert.equal(operationalEvidence(after).scope.source,'founder_supplied');const lineage=after.receipts[`${after.reset_epoch}:company_context:${after.context_epoch}`].result as any;assert.equal(lineage.parent_context_epoch,before.context_epoch);assert.equal(lineage.facts_hash,hash(after.facts));assert.ok(after.receipts[`${after.reset_epoch}:company_context:${before.context_epoch}`]);
 const next=await signup({customer_name:'Later supplied event',residence:'US-CA',scenario:'supplied',expected_reset_epoch:after.reset_epoch,expected_context_epoch:after.context_epoch},id());assert.equal(next.context_epoch,after.context_epoch);
}));

test('F08 model fact verification rejects an originating snapshot made stale by human correction',()=>isolated(async()=>{
 const w=await start(),s=await readState(),pid=id();const proposal={kind:'model_fact_proposal',proposal_id:pid,workflow_id:w.workflow_id,tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,context_epoch:s.context_epoch,fact_value_hash:hash(s.facts.find(f=>f.fact_key==='annual_gross_revenue_usd')??null),fact_key:'annual_gross_revenue_usd',proposed_value:31_000_000};
 await transaction(state=>{state.receipts[`${state.reset_epoch}:model_fact_proposal:${pid}`]={hash:hash(proposal),result:proposal};});
 const f=await feedback(w.workflow_id,'founder',{type:'fact_correction',fact_key:'annual_gross_revenue_usd',proposed_value:42_000_000,text:'Current owner evidence',expected_reset_epoch:s.reset_epoch},id());await verifyFact(f.feedback_id,'founder',s.reset_epoch);
 const after=await readState();await assert.rejects(verifyModelFact(pid,'founder',s.reset_epoch,after.context_epoch),/predates/);assert.equal((await readState()).facts.find(f=>f.fact_key==='annual_gross_revenue_usd')?.value,42_000_000);
}));

test('F12 blocked work can be withdrawn once without dropping uncertain effects or permitting stale intent',()=>isolated(async()=>{
 const w=await start();await transaction(s=>{const target=s.workflows.find(x=>x.workflow_id===w.workflow_id)!;target.state='needs_human_review';target.state_version++;});
 const current=(await readState()).workflows[0];await assert.rejects(cancelWorkflow(w.workflow_id,'founder',{expected_reset_epoch:w.reset_epoch,expected_state_version:w.state_version,reason:'Withdraw'},id()),/changed/);
 await transaction(s=>{s.workflows[0].unknown_charge=true;});await assert.rejects(cancelWorkflow(w.workflow_id,'founder',{expected_reset_epoch:w.reset_epoch,expected_state_version:current.state_version,reason:'Withdraw'},id()),/reconciled/);
 await transaction(s=>{s.workflows[0].unknown_charge=false;});const key=id(),input={expected_reset_epoch:w.reset_epoch,expected_state_version:current.state_version,reason:'Launch withdrawn by owner'};const first=await cancelWorkflow(w.workflow_id,'founder',input,key);assert.deepEqual(await cancelWorkflow(w.workflow_id,'founder',input,key),first);assert.equal(first.state,'rejected');assert.equal((await readState()).events.filter(e=>e.type==='workflow.withdrawn').length,1);
}));
