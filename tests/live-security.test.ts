import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readState,transaction} from '../src/data/store';
import {signup} from '../src/workflow/engine';
import {recoverModelRuns} from '../src/runtime';
import {initializeLedger,reserveAttempt,reserveAuthorizedSpend,saveLedger,syncCounters} from '../src/runtime/budget';
import {reserveGlobalSpend,globalSpendStatus} from '../src/server/global-spend';
import {hasPendingWorkerWork,processWorkerStep} from '../src/server/worker-step';
import {issueSession,getSession,clearSessionCookie} from '../src/server/auth';
import {withDemoScope} from '../src/server/demo-context';

async function isolated(fn:()=>Promise<void>){
  const keys=['MONGODB_URI','VERCEL','OPENAI_API_KEY','KIARA_AUTH_MODE','KIARA_MODEL_MODE','KIARA_DATA_DIR','KIARA_GLOBAL_BUDGET_DIR','KIARA_OPENAI_BUDGET_USD'] as const;
  const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const dir=await mkdtemp(join(tmpdir(),'kiara-crash-budget-test-'));
  delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.OPENAI_API_KEY;
  process.env.KIARA_AUTH_MODE='demo_simulated';process.env.KIARA_MODEL_MODE='scripted';process.env.KIARA_DATA_DIR=join(dir,'workspace');process.env.KIARA_GLOBAL_BUDGET_DIR=join(dir,'operator');process.env.KIARA_OPENAI_BUDGET_USD='50';
  try{await fn();}finally{for(const key of keys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}await rm(dir,{recursive:true,force:true});}
}

/** Crash state is constructed locally; this test never initializes a provider or sends a request. */
async function crashed(status:'reserved'|'dispatched'){
  const state=await readState();
  const ack=await signup({customer_name:'Crash recovery test only',residence:'US-CA',scenario:'covered',expected_reset_epoch:state.reset_epoch},'crash-recovery');
  const attempt=await transaction(s=>{
    const w=s.workflows.find(w=>w.workflow_id===ack.workflow_id)!;w.model_mode='openai';w.model_status='running';w.state='drafting';w.lease_owner='terminated-worker';w.lease_until='2000-01-01T00:00:00Z';
    const ledger=initializeLedger(s,w),a=reserveAttempt(ledger,'draft',1000,4000);a.status=status;
    reserveAuthorizedSpend(s,a.attempt_id,a.reserved_usd);saveLedger(s,w,ledger);syncCounters(w,ledger);return a;
  });
  await reserveGlobalSpend(attempt.attempt_id,attempt.reserved_usd);return attempt;
}

test('recovery propagates a crashed dispatched attempt to the shared unknown-charge fence',()=>isolated(async()=>{
  const attempt=await crashed('dispatched');
  assert.equal(await recoverModelRuns(),1);assert.equal(await recoverModelRuns(),0);
  const state=await readState();assert.equal(state.workflows[0].unknown_charge,true);
  const status=await globalSpendStatus();assert.equal(status.unknown_charges,1);assert.equal(status.reserved_usd,attempt.reserved_usd);assert.equal(status.inflight,1);
  await assert.rejects(()=>reserveGlobalSpend('different_visitor',.1),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='GLOBAL_CHARGE_UNKNOWN');
}));

test('recovery releases a crashed pre-dispatch shared reservation without inventing a provider charge',()=>isolated(async()=>{
  await crashed('reserved');
  assert.equal(await recoverModelRuns(),1);assert.equal(await recoverModelRuns(),0);
  const state=await readState();assert.equal(state.workflows[0].unknown_charge,false);assert.equal(state.workflows[0].reserved_cost,0);
  const status=await globalSpendStatus();assert.equal(status.unknown_charges,0);assert.equal(status.reserved_usd,0);assert.equal(status.inflight,0);assert.equal(status.spent_usd,0);assert.equal(status.request_count,1);
  await reserveGlobalSpend('different_visitor',.1);
}));

test('durable worker remains alive until a crashed model lease expires and stops after unknown-charge recovery',()=>isolated(async()=>{
  await crashed('dispatched');
  await transaction(s=>{s.workflows[0].lease_until=new Date(Date.now()+60000).toISOString();});
  const before=await readState();
  assert.equal(hasPendingWorkerWork(before),true,'Resume must schedule even when no model is currently runnable.');
  assert.equal(await processWorkerStep(before.reset_epoch),true,'A platform retry before expiry must keep its durable watchdog alive.');
  const waiting=await readState();assert.equal(waiting.workflows[0].model_status,'running');assert.equal(waiting.workflows[0].model_attempts,1);
  assert.equal((await globalSpendStatus()).unknown_charges,0,'An unexpired lease is not yet a charge uncertainty.');
  await transaction(s=>{s.workflows[0].lease_until='2000-01-01T00:00:00Z';});
  assert.equal(await processWorkerStep(before.reset_epoch),false);
  const recovered=await readState();assert.equal(recovered.workflows[0].model_status,'unknown_charge');assert.equal(recovered.workflows[0].state,'needs_human_review');
  assert.equal(hasPendingWorkerWork(recovered),false,'An unknown charge requires an operator and must not spin or redispatch.');
  assert.equal(await processWorkerStep(before.reset_epoch),false);
  const budget=await globalSpendStatus();assert.equal(budget.unknown_charges,1);assert.equal(budget.request_count,1);
}));

test('local workspaces cannot overwrite one another through cookies shared across localhost ports',()=>isolated(async()=>{
  const directory=process.env.KIARA_DATA_DIR!,first=await issueSession('founder',1);
  process.env.KIARA_DATA_DIR=join(directory,'second-workspace');
  const second=await issueSession('lawyer',1),firstCookie=first.cookie.split(';')[0],secondCookie=second.cookie.split(';')[0];
  assert.notEqual(firstCookie.split('=')[0],secondCookie.split('=')[0]);
  const sharedCookies=`${firstCookie}; ${secondCookie}`;
  assert.equal((await getSession(new Request('http://localhost:3023/api/workspace',{headers:{cookie:sharedCookies}}),1)).role,'lawyer');
  assert.ok(clearSessionCookie().startsWith(secondCookie.split('=')[0]+'='));
  process.env.KIARA_DATA_DIR=directory;
  assert.equal((await getSession(new Request('http://localhost:3000/api/workspace',{headers:{cookie:sharedCookies}}),1)).role,'founder');
  const previousSecret=process.env.KIARA_SESSION_SECRET;process.env.KIARA_SESSION_SECRET='local-test-secret-with-more-than-thirty-two-characters';
  try{
    process.env.KIARA_AUTH_MODE='hosted_password';assert.ok((await issueSession('founder',1)).cookie.startsWith('kiara_session='));
    process.env.KIARA_AUTH_MODE='public_demo';await withDemoScope({id:'a'.repeat(32),expires_at:Date.now()+60000},async()=>assert.ok((await issueSession('founder',1)).cookie.startsWith('kiara_demo_session=')));
  }finally{if(previousSecret===undefined)delete process.env.KIARA_SESSION_SECRET;else process.env.KIARA_SESSION_SECRET=previousSecret;}
}));
