import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {recoverGlobalSpend,reserveGlobalSpend,settleGlobalSpend,globalSpendStatus,conservativelyAccountUnknownCharge} from '../src/server/global-spend';
import {withDemoScope} from '../src/server/demo-context';

const execute=promisify(execFile);
const envKeys=['MONGODB_URI','VERCEL','KIARA_GLOBAL_BUDGET_DIR','KIARA_DATA_DIR','KIARA_OPENAI_BUDGET_USD'] as const;
async function isolated(fn:(dir:string)=>Promise<void>,budget='50'){
  const prior=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  const dir=await mkdtemp(join(tmpdir(),'kiara-global-spend-test-'));
  delete process.env.MONGODB_URI;delete process.env.VERCEL;
  process.env.KIARA_GLOBAL_BUDGET_DIR=dir;process.env.KIARA_DATA_DIR=join(dir,'workspace');process.env.KIARA_OPENAI_BUDGET_USD=budget;
  try{await fn(dir);}finally{for(const key of envKeys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}await rm(dir,{recursive:true,force:true});}
}
const code=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code===expected;

test('shared operator cap atomically admits at most two concurrent visitors and survives process boundaries',async()=>isolated(async dir=>{
  const attempts=await Promise.allSettled(Array.from({length:8},(_,i)=>withDemoScope({id:i.toString(16).padStart(32,'0'),expires_at:Date.now()+60000},()=>reserveGlobalSpend(`concurrent_visitor_${i}`,20))));
  assert.equal(attempts.filter(a=>a.status==='fulfilled').length,2);
  assert.equal(attempts.filter(a=>a.status==='rejected').length,6);
  const initial=await globalSpendStatus();assert.equal(initial.reserved_usd,40);assert.equal(initial.inflight,2);assert.equal(initial.request_count,2);
  const charges=JSON.parse(await readFile(join(dir,'provider-spend.json'),'utf8')).charges;
  for(const id of Object.keys(charges))await settleGlobalSpend(id,20);
  // Separate processes cannot each acquire the remaining $10 authorization.
  const source="import {reserveGlobalSpend} from './src/server/global-spend.ts';try{await reserveGlobalSpend(process.argv[1],6);console.log('reserved')}catch(e){console.log(e.code)}";
  const children=await Promise.all(Array.from({length:4},(_,i)=>execute(process.execPath,['--import','tsx','--input-type=module','-e',source,`cross_process_${i}`],{cwd:process.cwd(),env:{...process.env},timeout:15000})));
  assert.equal(children.filter(c=>c.stdout.trim()==='reserved').length,1);
  assert.equal(children.filter(c=>c.stdout.trim()==='GLOBAL_BUDGET_EXHAUSTED').length,3);
  assert.deepEqual(await globalSpendStatus(),{budget_usd:50,spent_usd:40,actual_spent_usd:40,conservative_spent_usd:0,reserved_usd:6,unknown_charges:0,covered_unknown_charges:0,blocking_unknown_charges:0,inflight:1,request_count:3,scope:'all_visitors_and_evaluations'});
}));

test('settled IDs cannot dispatch twice, repeat exact settlement is safe, and history cannot lower a charge',async()=>isolated(async()=>{
  await reserveGlobalSpend('immutable_charge',2);
  await settleGlobalSpend('immutable_charge',.75);
  await settleGlobalSpend('immutable_charge',.75);
  await assert.rejects(()=>reserveGlobalSpend('immutable_charge',2),code('SPEND_ID_CONFLICT'));
  await assert.rejects(()=>settleGlobalSpend('immutable_charge',0),code('SPEND_SETTLEMENT_CONFLICT'));
  await assert.rejects(()=>settleGlobalSpend('immutable_charge',.75,true),code('SPEND_SETTLEMENT_CONFLICT'));
  assert.equal((await globalSpendStatus()).spent_usd,.75);
}));

test('unknown provider charges retain unused reservation and block all visitors until explicit reconciliation',async()=>isolated(async()=>{
  await reserveGlobalSpend('unknown_charge',1);
  await settleGlobalSpend('unknown_charge',.1,true);
  await assert.rejects(()=>reserveGlobalSpend('another_visitor',.1),code('GLOBAL_CHARGE_UNKNOWN'));
  await assert.rejects(()=>settleGlobalSpend('unknown_charge',.1),code('GLOBAL_CHARGE_UNKNOWN'));
  await settleGlobalSpend('unknown_charge',0,true);
  const status=await globalSpendStatus();assert.equal(status.spent_usd,.1);assert.equal(status.reserved_usd,.9);assert.equal(status.unknown_charges,1);assert.equal(status.inflight,1);
}));

test('usage above reservation is auditable and closes all further spending',async()=>isolated(async()=>{
  await reserveGlobalSpend('overrun_charge',.1);
  await settleGlobalSpend('overrun_charge',.2);
  const status=await globalSpendStatus();assert.equal(status.spent_usd,.2);assert.equal(status.unknown_charges,1);
  await assert.rejects(()=>reserveGlobalSpend('after_overrun',.1),code('GLOBAL_CHARGE_UNKNOWN'));
}));

test('actual usage can settle after authorization is disabled but no new dispatch can reserve',async()=>isolated(async()=>{
  await reserveGlobalSpend('disabled_budget',.5);
  delete process.env.KIARA_OPENAI_BUDGET_USD;
  await settleGlobalSpend('disabled_budget',.2);
  await assert.rejects(()=>reserveGlobalSpend('new_disabled',.1),code('OPENAI_BUDGET_REQUIRED'));
  process.env.KIARA_OPENAI_BUDGET_USD='50';assert.equal((await globalSpendStatus()).spent_usd,.2);
}));

test('micro-dollar accounting cannot round a small reservation down through the cap',async()=>isolated(async()=>{
  await reserveGlobalSpend('fractional_first',.0000001);await settleGlobalSpend('fractional_first',.0000001);
  await reserveGlobalSpend('fractional_second',.0000001);await settleGlobalSpend('fractional_second',.0000001);
  assert.equal((await globalSpendStatus()).spent_usd,.000002);
  await assert.rejects(()=>reserveGlobalSpend('fractional_third',.0000001),code('GLOBAL_BUDGET_EXHAUSTED'));
},'0.000002'));

test('new visitor workspaces cannot reset the shared request rate ceiling',async()=>isolated(async()=>{
  for(let i=0;i<20;i++){await reserveGlobalSpend(`rate_charge_${i}`,1);await settleGlobalSpend(`rate_charge_${i}`,0);}
  await assert.rejects(()=>withDemoScope({id:'f'.repeat(32),expires_at:Date.now()+60000},()=>reserveGlobalSpend('new_demo_charge',1)),code('GLOBAL_RATE_LIMIT'));
  const status=await globalSpendStatus();assert.equal(status.request_count,20);assert.equal(status.spent_usd,0);assert.equal(status.inflight,0);
}));

test('invalid reservations, settlements, authorization and hosted ephemeral storage fail before dispatch',async()=>isolated(async()=>{
  for(const amount of [NaN,Infinity,-1,0])await assert.rejects(()=>reserveGlobalSpend('invalid_charge',amount),code('INVALID_SPEND_RESERVATION'));
  await assert.rejects(()=>reserveGlobalSpend('../outside',1),code('INVALID_SPEND_RESERVATION'));
  for(const amount of [NaN,Infinity,-1])await assert.rejects(()=>settleGlobalSpend('missing_charge',amount),code('INVALID_SPEND_SETTLEMENT'));
  process.env.KIARA_OPENAI_BUDGET_USD='50.01';await assert.rejects(()=>reserveGlobalSpend('over_user_cap',1),code('OPENAI_BUDGET_REQUIRED'));
  process.env.KIARA_OPENAI_BUDGET_USD='50';process.env.VERCEL='1';await assert.rejects(()=>reserveGlobalSpend('hosted_no_store',1),code('SPEND_STORE_REQUIRED'));
}));


test('operator full-ceiling accounting preserves unknown history and hard cap while releasing independent work',async()=>isolated(async dir=>{
  await reserveGlobalSpend('operator_unknown',1);await settleGlobalSpend('operator_unknown',.1,true);
  const action={charge_id:'operator_unknown',expected_reserved_usd:1,actor:'authorized-test-operator',reason:'Conservatively charge the full request ceiling; original run must remain blocked.',confirmation:'charge_full_reservation_without_retry' as const};
  const audit=await conservativelyAccountUnknownCharge(action);assert.equal(audit.budgeted_micro,1000000);assert.equal(audit.retry_authorized,false);
  await conservativelyAccountUnknownCharge(action);
  const status=await globalSpendStatus();assert.equal(status.spent_usd,1);assert.equal(status.actual_spent_usd,.1);assert.equal(status.conservative_spent_usd,.9);assert.equal(status.unknown_charges,0);assert.equal(status.covered_unknown_charges,1);assert.equal(status.blocking_unknown_charges,0);assert.equal(status.inflight,0);assert.equal(status.reserved_usd,0);
  const charge=JSON.parse(await readFile(join(dir,'provider-spend.json'),'utf8')).charges.operator_unknown;
  assert.equal(charge.status,'unknown');assert.equal(charge.actual,100000);assert.deepEqual(charge.reconciliation,audit);
  await assert.rejects(()=>settleGlobalSpend('operator_unknown',0),code('GLOBAL_CHARGE_UNKNOWN'));
  await assert.rejects(()=>reserveGlobalSpend('operator_unknown',1),code('SPEND_ID_CONFLICT'));
  await assert.rejects(()=>conservativelyAccountUnknownCharge({...action,reason:'Rewrite the previously recorded immutable operator reason.'}),code('RECONCILIATION_IMMUTABLE'));
  await reserveGlobalSpend('independent_after_unknown',1);
  await assert.rejects(()=>reserveGlobalSpend('above_remaining_cap',.000001),code('GLOBAL_BUDGET_EXHAUSTED'));
},'2'));

test('operator coverage fails closed on wrong ceilings and late higher usage',async()=>isolated(async()=>{
  await reserveGlobalSpend('late_unknown_charge',1);await settleGlobalSpend('late_unknown_charge',0,true);
  const action={charge_id:'late_unknown_charge',expected_reserved_usd:1,actor:'authorized-test-operator',reason:'Full ceiling accounted without resolving unknown provider usage.',confirmation:'charge_full_reservation_without_retry' as const};
  await assert.rejects(()=>conservativelyAccountUnknownCharge({...action,expected_reserved_usd:.5}),code('SPEND_RESERVATION_CHANGED'));
  await conservativelyAccountUnknownCharge(action);
  await settleGlobalSpend('late_unknown_charge',1.1,true);
  const status=await globalSpendStatus();assert.equal(status.spent_usd,1.1);assert.equal(status.blocking_unknown_charges,1);
  await assert.rejects(()=>reserveGlobalSpend('after_late_overrun',.1),code('GLOBAL_CHARGE_UNKNOWN'));
  await assert.rejects(()=>conservativelyAccountUnknownCharge(action),code('SPEND_CEILING_EXCEEDED'));
}));


test('pre-dispatch recovery retires missing reservation identities before a delayed writer resumes',async()=>isolated(async()=>{
 await recoverGlobalSpend('late_reservation',false);
 await assert.rejects(()=>reserveGlobalSpend('late_reservation',0.01),code('SPEND_ID_CONFLICT'));
 const state=await globalSpendStatus();assert.equal(state.reserved_usd,0);assert.equal(state.inflight,0);assert.equal(state.actual_spent_usd,0);
 await recoverGlobalSpend('late_reservation',false);
 await reserveGlobalSpend('unrelated_request',0.01);await settleGlobalSpend('unrelated_request',0);
}));

test('missing dispatched reservation remains globally blocking without explicit reconciliation',async()=>isolated(async()=>{
 await recoverGlobalSpend('missing_dispatched',true);const state=await globalSpendStatus();assert.equal(state.blocking_unknown_charges,1);assert.equal(state.covered_unknown_charges,0);await assert.rejects(()=>reserveGlobalSpend('after_missing_dispatched',0.01),code('GLOBAL_CHARGE_UNKNOWN'));
}));
