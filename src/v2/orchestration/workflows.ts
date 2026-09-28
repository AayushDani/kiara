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

const conversations=proxyActivities<{processConversationReference:(ref:OutboxReference)=>Promise<{status:'queued'|'running'|'complete'|'blocked'|'unknown'|'cancel_requested'|'canceled'}>}>({startToCloseTimeout:'4 minutes',retry:{initialInterval:'5 seconds',maximumInterval:'1 minute',backoffCoefficient:2}});
/** Durable continuation delegates reservation and lease safety to the authoritative run processor. */
export async function kiaraConversationWorkflow(ref:OutboxReference):Promise<void>{
 let turns=0;
 while(true){const result=await conversations.processConversationReference(ref);if(!['queued','running','cancel_requested'].includes(result.status))return;await sleep('5 minutes');if(++turns>=100)await continueAsNew<typeof kiaraConversationWorkflow>(ref);}
}

const effects=proxyActivities<{processEffectReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>}>({startToCloseTimeout:'1 minute',retry:{initialInterval:'10 seconds',maximumInterval:'5 minutes',backoffCoefficient:2}});
/** Durable read-back of a previously admitted effect. This workflow never starts a send. */
export async function kiaraEffectWorkflow(ref:OutboxReference):Promise<void>{
 let turns=0;
 while(true){const progress=await effects.processEffectReference(ref);if(progress.status==='complete')return;await sleep(Math.max(60000,Math.min(progress.nextCheckMs,6*3600000)));if(++turns>=100)await continueAsNew<typeof kiaraEffectWorkflow>(ref);}
}

const retention=proxyActivities<{processRetentionReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>}>({startToCloseTimeout:'5 minutes',retry:{initialInterval:'1 minute',maximumInterval:'6 hours',backoffCoefficient:2}});
/** Application erasure remains pending during retention holds and unresolved effects. */
export async function kiaraRetentionWorkflow(ref:OutboxReference):Promise<void>{
 let turns=0;
 while(true){const progress=await retention.processRetentionReference(ref);if(progress.status==='complete')return;await sleep(Math.max(60000,Math.min(progress.nextCheckMs,24*3600000)));if(++turns>=100)await continueAsNew<typeof kiaraRetentionWorkflow>(ref);}
}

const artifacts=proxyActivities<{processArtifactReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>}>({startToCloseTimeout:'2 minutes',retry:{initialInterval:'1 minute',maximumInterval:'6 hours',backoffCoefficient:2}});
/** Abandoned uploads retain a durable cleanup owner, including a missing write acknowledgement. */
export async function kiaraArtifactWorkflow(ref:OutboxReference):Promise<void>{
 let turns=0;
 while(true){const progress=await artifacts.processArtifactReference(ref);if(progress.status==='complete')return;await sleep(Math.max(60000,Math.min(progress.nextCheckMs,24*3600000)));if(++turns>=100)await continueAsNew<typeof kiaraArtifactWorkflow>(ref);}
}

const indexing=proxyActivities<{processIndexReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>}>({startToCloseTimeout:'4 minutes',retry:{initialInterval:'10 seconds',maximumInterval:'5 minutes',backoffCoefficient:2}});
/** The job owns the exact standing grant, budget and chunks; workflow history contains references only. */
export async function kiaraIndexWorkflow(ref:OutboxReference):Promise<void>{
 let turns=0;
 while(true){const progress=await indexing.processIndexReference(ref);if(progress.status==='complete')return;await sleep(Math.max(60000,Math.min(progress.nextCheckMs,5*60000)));if(++turns>=100)await continueAsNew<typeof kiaraIndexWorkflow>(ref);}
}

const slack=proxyActivities<{processSlackReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>}>({startToCloseTimeout:'3 minutes',retry:{initialInterval:'1 minute',maximumInterval:'6 hours',backoffCoefficient:2}});
/** Explicit selected-thread grants admit one post; activity retries reconcile its retained identity. */
export async function kiaraSlackWorkflow(ref:OutboxReference):Promise<void>{
 let turns=0;
 while(true){const progress=await slack.processSlackReference(ref);if(progress.status==='complete')return;await sleep(Math.max(60000,Math.min(progress.nextCheckMs,6*3600000)));if(++turns>=100)await continueAsNew<typeof kiaraSlackWorkflow>(ref);}
}

const legal=proxyActivities<{processLegalReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>}>({startToCloseTimeout:'3 minutes',retry:{initialInterval:'1 minute',maximumInterval:'1 hour',backoffCoefficient:2}});
/** Observations create review work; source applicability is never a workflow decision. */
export async function kiaraLegalWorkflow(ref:OutboxReference):Promise<void>{
 let turns=0;
 while(true){const progress=await legal.processLegalReference(ref);if(progress.status==='complete')return;await sleep(Math.max(60000,Math.min(progress.nextCheckMs,24*3600000)));if(++turns>=100)await continueAsNew<typeof kiaraLegalWorkflow>(ref);}
}

const email=proxyActivities<{processEmailReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>}>({startToCloseTimeout:'3 minutes',retry:{initialInterval:'1 minute',maximumInterval:'5 minutes',backoffCoefficient:2}});
/** Intake is a bounded read; explicit human review owns quarantine admission. */
export async function kiaraEmailWorkflow(ref:OutboxReference):Promise<void>{
 let turns=0;while(true){const progress=await email.processEmailReference(ref);if(progress.status==='complete')return;await sleep(Math.max(60000,Math.min(progress.nextCheckMs,21600000)));if(++turns>=100)await continueAsNew<typeof kiaraEmailWorkflow>(ref);}
}

const notifications=proxyActivities<{processNotificationWatchReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>;processNotificationDeliveryReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>}>({startToCloseTimeout:'3 minutes',retry:{initialInterval:'1 minute',maximumInterval:'5 minutes',backoffCoefficient:2}});
export async function kiaraNotificationWatchWorkflow(ref:OutboxReference):Promise<void>{let turns=0;while(true){const progress=await notifications.processNotificationWatchReference(ref);if(progress.status==='complete')return;await sleep(Math.max(60000,Math.min(progress.nextCheckMs,86400000)));if(++turns>=100)await continueAsNew<typeof kiaraNotificationWatchWorkflow>(ref);}}
export async function kiaraNotificationDeliveryWorkflow(ref:OutboxReference):Promise<void>{let turns=0;while(true){const progress=await notifications.processNotificationDeliveryReference(ref);if(progress.status==='complete')return;await sleep(Math.max(1000,Math.min(progress.nextCheckMs,21600000)));if(++turns>=100)await continueAsNew<typeof kiaraNotificationDeliveryWorkflow>(ref);}}

const withdrawals=proxyActivities<{processWithdrawalReference:(ref:OutboxReference)=>Promise<{status:'waiting'|'complete';nextCheckMs:number}>}>({startToCloseTimeout:'3 minutes',retry:{initialInterval:'1 second',maximumInterval:'1 minute',backoffCoefficient:2}});
export async function kiaraWithdrawalWorkflow(ref:OutboxReference):Promise<void>{let turns=0;while(true){const progress=await withdrawals.processWithdrawalReference(ref);if(progress.status==='complete')return;await sleep(Math.max(1000,Math.min(progress.nextCheckMs,60000)));if(++turns>=100)await continueAsNew<typeof kiaraWithdrawalWorkflow>(ref);}}
