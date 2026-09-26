import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../src/data/fixtures';
import type {Workflow} from '../src/server/contracts';
import {freshLedger,reserveAttempt,pinReviewBudget,protectedReviewBudget,LIMITS,type Ledger} from '../src/runtime/budget';
import {tokenCost} from '../src/runtime/config';
function ledger(){process.env.KIARA_MODEL='gpt-6-sol';process.env.KIARA_REVIEW_MODEL='gpt-6-sol';const s=seed();return freshLedger(s,{workflow_id:'headroom-test',reset_epoch:s.reset_epoch,facts:s.facts,base_revision_id:s.current_revision_id,context_epoch:s.context_epoch,harness_version:1} as Workflow);}
function complete(l:Ledger,phase:string,input:number,output:number){const a=reserveAttempt(l,phase,input,output);a.status='complete';a.input_tokens=input;a.output_tokens=output;a.cost_usd=tokenCost(l.model,input,output);}
test('observed draft plus three complete checks and two checked repairs fit finite window without raising money limits',()=>{
 const l=ledger();assert.equal(LIMITS.cost,3);assert.equal(LIMITS.repairs,2);
 for(const [input,output] of [[8720,119],[12094,116],[15153,82],[16087,4114],[20466,3835],[24354,3736]])complete(l,'draft',input,output);
 for(let round=0;round<3;round++){
  pinReviewBudget(l,{input_tokens:58340,output_tokens:12000,requests:3});
  for(const input of [18913,19538,19121])complete(l,'semantic_validation',input+256,400);
  if(round<2){complete(l,'repair',15000,150);complete(l,'repair',16000,4000);}
 }
 assert.equal(l.attempts.length,19);assert.ok(l.attempts.reduce((n,a)=>n+a.cost_usd,0)<3);assert.ok(l.attempts.reduce((n,a)=>n+a.input_tokens,0)<LIMITS.input);
});
test('every repair reserves complete checker input/output/cost and request slots before dispatch',()=>{
 const l=ledger();pinReviewBudget(l,{input_tokens:58340,output_tokens:12000,requests:3});assert.deepEqual(protectedReviewBudget(l),{input_tokens:72925,output_tokens:12000,requests:3});
 complete(l,'semantic_validation',1000,100);l.attempts[0].input_tokens=LIMITS.input-72925-500;l.attempts[0].cost_usd=0;
 assert.throws(()=>reserveAttempt(l,'repair',1000,1000),/protected request and repair reserve/);assert.equal(l.attempts.length,1);
 const slots=ledger();slots.max_attempts=4;complete(slots,'draft',1000,1000);assert.throws(()=>reserveAttempt(slots,'repair',1000,1000),/protected independent-review slots/);
});
test('review planning cannot change hard dollar ceilings or inject unbounded planning values',()=>{
 const l=ledger();assert.throws(()=>pinReviewBudget(l,{input_tokens:1000,output_tokens:12000,requests:4}),/three protected/);assert.throws(()=>pinReviewBudget(l,{input_tokens:Infinity,output_tokens:1000,requests:1}),/three protected/);
 complete(l,'semantic_validation',1000,1000);l.attempts[0].cost_usd=2.99;assert.throws(()=>reserveAttempt(l,'repair',1000,1000),/protected request and repair reserve/);
});
