import test from 'node:test';
import assert from 'node:assert/strict';
import type {State} from '../src/server/contracts';
import {reserveWorker,recordWorkerStart,claimWorkerStep,releaseWorkerStep,ownsWorker,workerOwner} from '../src/server/worker-ownership';
const state=()=>({reset_epoch:1,receipts:{}} as State);
test('hosted scheduling deduplicates starts and records the exact run',()=>{
 const s=state(),a=reserveWorker(s,'deploy-a',1)!;
 assert.equal(reserveWorker(s,'deploy-a',2),undefined);
 assert.equal(recordWorkerStart(s,a,'wrun-a',3),true);
 assert.equal(workerOwner(s)?.run_id,'wrun-a');
 assert.equal(reserveWorker(s,'deploy-a',4),undefined);
});
test('new deployment fences old claims but waits for its dispatched step to settle',()=>{
 const s=state(),a=reserveWorker(s,'deploy-a',1)!;
 recordWorkerStart(s,a,'wrun-a',2);
 const first=claimWorkerStep(s,a,3);assert.equal(first.kind,'claimed');
 const b=reserveWorker(s,'deploy-b',4)!;
 assert.equal(ownsWorker(s,a),false);assert.equal(claimWorkerStep(s,a,5).kind,'stale');
 assert.equal(claimWorkerStep(s,b,5).kind,'busy');
 assert.equal(recordWorkerStart(s,a,'late-old-run',6),false);
 assert.ok(first.kind==='claimed');releaseWorkerStep(s,a,first.step_id,true,7);
 assert.equal(claimWorkerStep(s,b,8).kind,'claimed');
 assert.deepEqual(workerOwner(s)?.previous_run_ids,['wrun-a']);
});
test('completed workers can restart and crashed starts recover after a bounded wait',()=>{
 const s=state(),a=reserveWorker(s,'deploy-a',1)!;
 assert.equal(reserveWorker(s,'deploy-a',120000),undefined);
 const b=reserveWorker(s,'deploy-a',120002)!;assert.equal(b.generation,2);
 recordWorkerStart(s,b,'wrun-b',120003);const step=claimWorkerStep(s,b,120004);assert.ok(step.kind==='claimed');
 releaseWorkerStep(s,b,step.step_id,false,120005);
 assert.equal(workerOwner(s)?.status,'idle');assert.ok(reserveWorker(s,'deploy-a',120006));
 assert.equal(ownsWorker(s,a),false);
});
test('new epoch cannot inherit a worker ticket',()=>{
 const s=state(),a=reserveWorker(s,'deploy-a',1)!;s.reset_epoch=2;
 assert.equal(claimWorkerStep(s,a,2).kind,'stale');assert.equal(workerOwner(s),undefined);
});
