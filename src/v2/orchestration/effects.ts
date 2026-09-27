import {V2Error} from '../contracts';
import {readWorkspace} from '../store';
import {reconcileEffect} from '../execution/broker';
import type {ExecutionAdapter,EffectIntent} from '../execution/contracts';
import type {OutboxReference} from './contracts';
export type EffectProgress={status:'waiting'|'complete';nextCheckMs:number};
/** Read-back only: a worker cannot admit an effect, approve it or issue a provider write. */
export async function processEffectReference(ref:OutboxReference,options:{adapter?:ExecutionAdapter}={}):Promise<EffectProgress>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped record references are accepted.',400);
 const s=await readWorkspace(ref.tenantId),outbox=s.outbox.find(o=>o.id===ref.outboxId&&o.aggregateId===ref.aggregateId&&o.tenantId===ref.tenantId&&o.kind==='effect_reconcile'&&o.owner==='v2'),intent=s.receipts[`execution:${ref.aggregateId}`]?.result.intent as EffectIntent|undefined;
 if(!outbox||!intent||intent.owner!=='v2'||intent.tenantId!==ref.tenantId||intent.actionId!==ref.aggregateId||outbox.commandId!==intent.id)throw new V2Error('OUTBOX_NOT_FOUND','The durable effect reference is unavailable.',404);
 if(outbox.status==='canceled')return {status:'complete',nextCheckMs:0};
 const effect=await reconcileEffect(ref.tenantId,ref.aggregateId,options);
 if(effect.status==='failed'||effect.status==='verified'&&intent.executionDecision.mode!=='email'||intent.executionDecision.mode==='preview')return {status:'complete',nextCheckMs:0};
 // Continue low-frequency read-back after email delivery to detect later bounce/complaint.
 // Unknown/no-receipt outcomes do not perform a provider call or authorize another send.
 return {status:'waiting',nextCheckMs:effect.status==='verified'||effect.status==='uncertain'&&!effect.providerReceipt?6*3600000:5*60000};
}
