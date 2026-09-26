import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GET,POST} from '../src/app/api/[...path]/route';
import {readState} from '../src/data/store';
import {processWorkerStep} from '../src/server/worker-step';
import {withDemoScope,type DemoScope} from '../src/server/demo-context';
import type {State,Session,Workflow} from '../src/server/contracts';

const origin='https://kiara.example';
const context=(path:string)=>({params:Promise.resolve({path:path.split('/')})});
test('public visitors have isolated, repeatable demos without passwords',async t=>{
 const old={...process.env},directory=await mkdtemp(join(tmpdir(),'kiara-public-test-'));
 delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_WORKER_MODE;
 Object.assign(process.env,{KIARA_DATA_DIR:directory,KIARA_AUTH_MODE:'public_demo',KIARA_SESSION_SECRET:'b'.repeat(64),KIARA_MODEL_MODE:'scripted',KIARA_EMAIL_MODE:'preview',KIARA_ALLOW_LIVE_EMAIL:'false'});
 t.after(async()=>{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);await rm(directory,{recursive:true,force:true});});
 async function visitor(){
  let cookie='',session:Session;
  async function get(){const response=await GET(new Request(origin+'/api/workspace',{headers:{cookie}}),context('workspace'));assert.equal(response.status,200);const payload=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0];session=payload.session;return payload.state as State;}
  async function post(path:string,body:unknown,extra:Record<string,string>={}){const response=await POST(new Request(origin+'/api/'+path,{method:'POST',headers:{origin,cookie,'x-csrf-token':session.csrf,'content-type':'application/json','idempotency-key':crypto.randomUUID(),...extra},body:JSON.stringify(body)}),context(path));const payload=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0];return {status:response.status,payload};}
  const initial=await get();return {get,post,initial,scope:()=>({id:session.demo_id!,expires_at:session.expires_at}),session:()=>session};
 }
 const [a,b]=await Promise.all([visitor(),visitor()]);
 const baseline=(s:State)=>{assert.deepEqual(s.facts,a.initial.facts);assert.deepEqual(s.revisions,a.initial.revisions);assert.deepEqual(s.harnesses,a.initial.harnesses);assert.equal(s.champion_version,1);assert.equal(s.context_epoch,1);assert.equal(s.workflows.length,0);assert.equal(s.events.length,0);assert.equal(s.feedback.length,0);assert.equal(s.notifications.length,0);assert.equal(s.evaluations.length,0);assert.equal(s.worker_heartbeat,null);assert.deepEqual(s.receipts,{});};
 const signup=(name:string,epoch:number)=>({customer_name:name,residence:'US-CA',scenario:'covered',expected_reset_epoch:epoch});
 let workflowId='';
 await t.test('public bootstrap isolates signed sessions and refuses unscoped access',async()=>{
  assert.notEqual(a.scope().id,b.scope().id);baseline(a.initial);baseline(b.initial);
  await assert.rejects(readState(),/Open the demo/);
  assert.equal((await a.post('events',signup('Cross origin',1),{origin:'https://attacker.example'})).status,403);
  assert.equal((await a.post('events',{...signup('Injection',1),demo_id:b.scope().id})).status,400);
  const created=await a.post('events',signup('Visitor A',1));assert.equal(created.status,201);workflowId=created.payload.workflow_id;
  baseline(await b.get());
 });
 async function drain(scope:DemoScope){await withDemoScope(scope,async()=>{let count=0;while(await processWorkerStep((await readState()).reset_epoch))assert.ok(++count<30);});}
 const approve=(w:Workflow)=>({action:'approved',expected_state_version:w.state_version,expected_reset_epoch:w.reset_epoch,bundle_hash:w.bundle_hash,note:'Synthetic demo test approval'});
 await t.test('role switching is self-service but review order is still required',async()=>{
  await drain(a.scope());let w=(await a.get()).workflows.find(w=>w.workflow_id===workflowId)!;assert.equal(w.state,'awaiting_founder');
  assert.equal((await a.post('session',{role:'lawyer'})).status,200);await a.get();
  assert.equal((await a.post('workflows/'+workflowId+'/review',approve(w))).status,409);
  assert.equal((await a.post('events',signup('Wrong role',1))).status,403);
  assert.equal((await a.post('session',{role:'founder'})).status,200);await a.get();
  assert.equal((await a.post('workflows/'+workflowId+'/review',approve(w))).status,200);
  w=(await a.get()).workflows.find(w=>w.workflow_id===workflowId)!;assert.equal(w.state,'awaiting_lawyer');assert.equal(w.approvals.length,1);
 });
 await t.test('final lawyer approval retains the completed run and isolates visitor history',async()=>{
  const other=await b.post('events',signup('Visitor B',1));assert.equal(other.status,201);
  const beforeB=await b.get();
  const w=(await a.get()).workflows.find(w=>w.workflow_id===workflowId)!;
  await a.post('session',{role:'lawyer'});await a.get();
  const result=await a.post('workflows/'+workflowId+'/review',approve(w));assert.equal(result.status,200);assert.equal(result.payload.demo_reset,undefined);assert.equal(result.payload.state,'finalized');
  const after=await a.get();assert.equal(after.workflows[0].state,'finalized');assert.equal(after.workflows[0].approvals.length,2);assert.ok(after.events.length>0);assert.equal(after.reset_epoch,1);assert.equal(a.session().role,'lawyer');assert.deepEqual(await b.get(),beforeB);
  await withDemoScope(a.scope(),async()=>{const before=await readState();assert.equal(await processWorkerStep(0),false);assert.deepEqual(await readState(),before);});
  await a.post('session',{role:'founder'});await a.get();const again=await a.post('events',signup('Second complete run',1));assert.equal(again.status,201);
 });
 await t.test('manual reset works in lawyer role and old requests cannot revive cleared data',async()=>{
  await a.post('session',{role:'lawyer'});await a.get();
  const result=await a.post('reset',{expected_reset_epoch:1});assert.equal(result.status,200);
  const after=await a.get();baseline(after);assert.equal(after.reset_epoch,2);assert.equal(a.session().role,'founder');
  assert.equal((await a.post('events',signup('Old epoch',1))).status,409);
  assert.equal((await b.get()).workflows.length,1);
 });
 await t.test('public mode fails closed if paid generation or delivery is enabled',async()=>{
  process.env.KIARA_MODEL_MODE='openai';const response=await GET(new Request(origin+'/api/health'),context('health'));assert.equal(response.status,503);process.env.KIARA_MODEL_MODE='scripted';
 });
});
