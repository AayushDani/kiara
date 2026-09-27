import {condition,continueAsNew,defineSignal,proxyActivities,setHandler,sleep} from '@temporalio/workflow';
import type {reconcileReference} from './activities';
import {changedSignalName,type OutboxReference,type MatterReference} from './contracts';
const changed=defineSignal<[OutboxReference]>(changedSignalName);
const activities=proxyActivities<{reconcileReference:typeof reconcileReference}>({startToCloseTimeout:'30 seconds',retry:{initialInterval:'1 second',maximumInterval:'1 minute',backoffCoefficient:2}});
/** Durable wakeups read current state, so duplicate and late signals cannot replay stale decisions. */
export async function kiaraMatterWorkflow(reference:MatterReference,carry:OutboxReference[]=[]):Promise<void>{
 const pending=[...carry];let last:OutboxReference|undefined;let turns=0;
 setHandler(changed,ref=>{if(ref.tenantId===reference.tenantId&&ref.aggregateId===reference.aggregateId&&!pending.some(p=>p.outboxId===ref.outboxId))pending.push({tenantId:ref.tenantId,aggregateId:ref.aggregateId,outboxId:ref.outboxId});});
 while(true){
  await condition(()=>pending.length>0,'5 minutes');const next=pending.shift()||last;if(!next)continue;
  last=next;const state=await activities.reconcileReference(next);turns++;
  if(['terminal','legacy_owned','unavailable'].includes(state.status)&&pending.length===0)return;
  if(turns>=200)await continueAsNew<typeof kiaraMatterWorkflow>(reference,pending.length?pending:[next]);
 }
}

const conversations=proxyActivities<{processConversationReference:(ref:OutboxReference)=>Promise<{status:'queued'|'running'|'complete'|'blocked'|'unknown'|'canceled'}>}>({startToCloseTimeout:'4 minutes',retry:{initialInterval:'5 seconds',maximumInterval:'1 minute',backoffCoefficient:2}});
/** Durable continuation delegates reservation and lease safety to the authoritative run processor. */
export async function kiaraConversationWorkflow(ref:OutboxReference):Promise<void>{
 let turns=0;
 while(true){const result=await conversations.processConversationReference(ref);if(!['queued','running'].includes(result.status))return;await sleep('5 minutes');if(++turns>=100)await continueAsNew<typeof kiaraConversationWorkflow>(ref);}
}

const effects=proxyActivities<{processEffectReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>}>({startToCloseTimeout:'1 minute',retry:{initialInterval:'10 seconds',maximumInterval:'5 minutes',backoffCoefficient:2}});
/** Durable read-back of a previously admitted effect. This workflow never starts a send. */
export async function kiaraEffectWorkflow(ref:OutboxReference):Promise<void>{
 let turns=0;
 while(true){const progress=await effects.processEffectReference(ref);if(progress.status==='complete')return;await sleep(Math.max(60000,Math.min(progress.nextCheckMs,6*3600000)));if(++turns>=100)await continueAsNew<typeof kiaraEffectWorkflow>(ref);}
}
