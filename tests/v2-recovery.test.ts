import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,snapshot} from '../src/v2/service';
import {closeV2Store,transactWorkspace,readWorkspace} from '../src/v2/store';
import {recoveryViews,applyRecoveryCommand} from '../src/v2/recovery';
import type {ActorContext,Role,WorkspaceCommand} from '../src/v2/contracts';
const dirs:string[]=[];let sequence=0;
beforeEach(async()=>{await closeV2Store();const dir=await mkdtemp(join(tmpdir(),'kiara-recovery-'));dirs.push(dir);process.env.KIARA_V2_DATA_DIR=dir;delete process.env.MONGODB_URI;process.env.KIARA_V2_AI_MODE='local';});
after(async()=>{await closeV2Store();await Promise.all(dirs.map(d=>rm(d,{recursive:true,force:true})));});
const actor=(id:string,roles:Role[]):ActorContext=>({tenantId:'recovery-test',actorId:id,mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:roles});
const send=async(a:ActorContext,c:WorkspaceCommand)=>command(a,{idempotencyKey:`recovery-${++sequence}`,expectedVersion:(await snapshot(a)).version,command:c});
const code=(value:string)=>(e:unknown)=>(e as {code:string}).code===value;
async function setup(){const a=actor('owner',['member','business_owner','fact_owner','admin']),b=actor('peer',['member','business_owner']);await snapshot(b);const d=await send(a,{type:'document.add',title:'SECRET evidence title',body:'SECRET source contents',authority:'executed',kind:'agreement'});let r=await send(a,{type:'matter.create',title:'SECRET matter title',objective:'SECRET objective',scope:{kind:'team',actorIds:[]}});const m=r.snapshot.matters[0];r=await send(a,{type:'matter.prepare',matterId:m.id,expectedRecordVersion:m.version});const p=r.snapshot.proposals[0];const planned=await send(a,{type:'action.plan',matterId:m.id,proposalId:p.id,kind:'send',title:'SECRET action',content:p.body,recipients:['hidden@example.test']});const action=planned.snapshot.actions[0];const timer=await send(a,{type:'effort.start',matterId:m.id,stage:'review'});await send(a,{type:'source.revoke',sourceId:String(d.result.sourceId),reason:'Removed'});return {a,b,m,action,timer:timer.snapshot.effortEntries![0]};}
test('removed evidence has a minimal owner control view and another member cannot infer it',async()=>{
 const {a,b,m,timer}=await setup();let s=await readWorkspace(a.tenantId);const v=recoveryViews(s,a);assert.equal(v.matters[0].id,m.id);assert.equal(v.timers[0].id,timer.id);assert.doesNotMatch(JSON.stringify(v),/SECRET|example.test|source contents/);assert.equal(recoveryViews(s,b).matters.length,0);assert.equal(recoveryViews(s,b).timers.length,0);assert.equal((await snapshot(a)).matters.length,0);
 await send(a,{type:'effort.stop',entryId:timer.id,expectedRecordVersion:timer.version,evidence:'Stopped my elapsed timer after evidence access changed.'});assert.ok((await readWorkspace(a.tenantId)).effortEntries![0].stoppedAt);await send(a,{type:'effort.void',entryId:timer.id,expectedRecordVersion:timer.version+1,reason:'Exclude this unavailable work from comparisons.'});s=await readWorkspace(a.tenantId);assert.equal(recoveryViews(s,a).timers.length,0);
});
test('withdrawal cancels future effects while preserving uncertain effects and reconciliation',async()=>{
 const {a,b,m,action}=await setup();await transactWorkspace(a.tenantId,s=>{const uncertain={...structuredClone(s.actions[0]),id:'uncertain-effect',status:'uncertain' as const};s.actions.push(uncertain);s.outbox.push({id:'reconcile',tenantId:s.tenantId,kind:'effect_reconcile',aggregateId:uncertain.id,commandId:'test',status:'pending',owner:'v2',createdAt:new Date().toISOString()});});let s=await readWorkspace(a.tenantId);const row=recoveryViews(s,a).matters[0];assert.equal(row.unresolvedEffects,1);assert.throws(()=>applyRecoveryCommand(s,b,{type:'recovery.withdraw',matterId:m.id,expectedRecordVersion:row.version,reason:'Not my work'}),code('NOT_FOUND'));
 await transactWorkspace(a.tenantId,s=>applyRecoveryCommand(s,a,{type:'recovery.withdraw',matterId:m.id,expectedRecordVersion:row.version,reason:'Withdraw only future work.'}));s=await readWorkspace(a.tenantId);assert.equal(s.actions.find(x=>x.id===action.id)!.status,'canceled');assert.equal(s.actions.find(x=>x.id==='uncertain-effect')!.status,'uncertain');assert.equal(s.outbox.find(x=>x.id==='reconcile')!.status,'pending');assert.equal(s.matters[0].state,'canceled');assert.match(s.matters[0].blockers[0],/reconciliation/);
});
test('revoked or narrowed membership cannot use recovery controls',async()=>{
 const {a,m,timer}=await setup();await transactWorkspace(a.tenantId,s=>{s.memberships.find(x=>x.actorId===a.actorId)!.entityIds=['different-entity'];});const s=await readWorkspace(a.tenantId);assert.equal(recoveryViews(s,a).matters.length,0);assert.equal(recoveryViews(s,a).timers.length,0);assert.throws(()=>applyRecoveryCommand(s,a,{type:'recovery.withdraw',matterId:m.id,expectedRecordVersion:s.matters[0].version,reason:'No current access'}),code('NOT_FOUND'));await assert.rejects(()=>send(a,{type:'effort.stop',entryId:timer.id,expectedRecordVersion:timer.version,evidence:'No current access'}),code('NOT_FOUND'));
});
