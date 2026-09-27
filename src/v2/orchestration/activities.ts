import {V2Error} from '../contracts';
import {digest,transactWorkspace} from '../store';
import type {OutboxReference,ReconcileResult} from './contracts';
/** Re-read authoritative state on every wake. This activity grants no human approval or provider write. */
export async function reconcileReference(ref:OutboxReference):Promise<ReconcileResult>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped record references are accepted.',400);
 return (await transactWorkspace(ref.tenantId,s=>{
  const outbox=s.outbox.find(o=>o.id===ref.outboxId&&o.aggregateId===ref.aggregateId&&o.tenantId===ref.tenantId);if(!outbox)throw new V2Error('OUTBOX_NOT_FOUND','The durable event reference is unavailable.',404);
  const matter=s.matters.find(m=>m.id===ref.aggregateId),effects=s.actions.filter(a=>a.matterId===ref.aggregateId&&['uncertain','dispatching','verifying'].includes(a.status));
  const result:ReconcileResult={status:outbox.owner==='legacy'||matter?.legacyWorkflowId?'legacy_owned':effects.length?'reconciliation_required':matter&&['closed','canceled'].includes(matter.state)?'terminal':matter?'waiting':'unavailable',version:matter?.version||s.version,unresolvedEffects:effects.length};
  const key=`orchestration:handled:${ref.outboxId}`;if(!s.receipts[key])s.receipts[key]={hash:digest(ref),result:{status:result.status,version:result.version}};
  return result;
 })).result;
}
