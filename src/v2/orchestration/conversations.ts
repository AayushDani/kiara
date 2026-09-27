import {V2Error,type ConversationRunView} from '../contracts';
import {readWorkspace,transactWorkspace} from '../store';
import type {OutboxReference} from './contracts';
export type ConversationProcessor=(tenantId:string,runId:string)=>Promise<ConversationRunView>;
export type ConversationProgress={status:ConversationRunView['status']|'canceled'};
const defaultProcessor:ConversationProcessor=async(tenantId,runId)=>(await import('../ai')).processConversationRun(tenantId,runId);
/** Activity output deliberately omits answer, question, reason, citations and actor identity. */
export async function processConversationReference(ref:OutboxReference,processor:ConversationProcessor=defaultProcessor):Promise<ConversationProgress>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped record references are accepted.',400);
 const state=await readWorkspace(ref.tenantId),outbox=state.outbox.find(o=>o.id===ref.outboxId&&o.aggregateId===ref.aggregateId&&o.kind==='conversation_answer'&&o.owner==='v2');
 if(!outbox)throw new V2Error('OUTBOX_NOT_FOUND','The conversation outbox reference is unavailable.',404);
 if(outbox.status==='canceled')return {status:'canceled'};
 const run=await processor(ref.tenantId,ref.aggregateId);if(run.id!==ref.aggregateId)throw new V2Error('RUN_IDENTITY_MISMATCH','The conversation processor returned a different run.',500);
 return {status:run.status};
}
/** Local recovery requires no Temporal config and never claims managed orchestration. */
export async function processLocalOutboxOnce(tenantId:string,options:{processor?:ConversationProcessor;deferred?:Map<string,number>;effectProcessor?:(ref:OutboxReference)=>Promise<import('./effects').EffectProgress>;retentionProcessor?:(ref:OutboxReference)=>Promise<import('./retention').RetentionProgress>;artifactProcessor?:(ref:OutboxReference)=>Promise<import('./artifacts').ArtifactProgress>;indexProcessor?:(ref:OutboxReference)=>Promise<import('./indexing').IndexProgress>;slackProcessor?:(ref:OutboxReference)=>Promise<import('./slack').SlackProgress>;legalProcessor?:(ref:OutboxReference)=>Promise<import('./legal').LegalProgress>;emailProcessor?:(ref:OutboxReference)=>Promise<import('./email').EmailProgress>;notificationWatchProcessor?:(ref:OutboxReference)=>Promise<import('./notifications').NotificationProgress>;notificationDeliveryProcessor?:(ref:OutboxReference)=>Promise<import('./notifications').NotificationProgress>}={}){
 if(process.env.KIARA_V2_ORCHESTRATION_MODE==='temporal')throw new V2Error('ORCHESTRATION_OWNER','This workspace is configured for Temporal processing.',409);
 const entries=(await readWorkspace(tenantId)).outbox.filter(o=>o.owner==='v2'&&o.status==='pending'&&['conversation_answer','matter_changed','effect_reconcile','retention_cleanup','artifact_cleanup','index_maintenance','slack_reply','legal_watch','email_intake','notification_watch','notification_delivery'].includes(o.kind)&&(options.deferred?.get(o.id)||0)<=Date.now()).slice(0,100);let completed=0,waiting=0;
 for(const item of entries){if((options.deferred?.get(item.id)||0)>Date.now()){waiting++;continue;}
  const ref={tenantId,aggregateId:item.aggregateId,outboxId:item.id};
  try{
  if(item.kind==='conversation_answer'){
   const result=await processConversationReference(ref,options.processor);
   if(['queued','running','cancel_requested'].includes(result.status)){options.deferred?.set(item.id,Date.now()+5*60*1000);waiting++;continue;}
  }else if(item.kind==='effect_reconcile'){const result=await (options.effectProcessor||(await import('./effects')).processEffectReference)(ref);if(result.status==='waiting'){options.deferred?.set(item.id,Date.now()+result.nextCheckMs);waiting++;continue;}}
  else if(item.kind==='retention_cleanup'){const result=await (options.retentionProcessor||(await import('./retention')).processRetentionReference)(ref);if(result.status==='waiting'){options.deferred?.set(item.id,Date.now()+result.nextCheckMs);waiting++;continue;}}
  else if(item.kind==='artifact_cleanup'){const result=await (options.artifactProcessor||(await import('./artifacts')).processArtifactReference)(ref);if(result.status==='waiting'){options.deferred?.set(item.id,Date.now()+result.nextCheckMs);waiting++;continue;}}
  else if(item.kind==='index_maintenance'){const result=await (options.indexProcessor||(await import('./indexing')).processIndexReference)(ref);if(result.status==='waiting'){options.deferred?.set(item.id,Date.now()+result.nextCheckMs);waiting++;continue;}}
  else if(item.kind==='slack_reply'){const result=await (options.slackProcessor||(await import('./slack')).processSlackReference)(ref);if(result.status==='waiting'){options.deferred?.set(item.id,Date.now()+result.nextCheckMs);waiting++;continue;}}
  else if(item.kind==='legal_watch'){const result=await (options.legalProcessor||(await import('./legal')).processLegalReference)(ref);if(result.status==='waiting'){options.deferred?.set(item.id,Date.now()+result.nextCheckMs);waiting++;continue;}}
  else if(item.kind==='email_intake'){const result=await (options.emailProcessor||(await import('./email')).processEmailReference)(ref);if(result.status==='waiting'){options.deferred?.set(item.id,Date.now()+result.nextCheckMs);waiting++;continue;}}
  else if(item.kind==='notification_watch'){const result=await (options.notificationWatchProcessor||(await import('./notifications')).processNotificationWatchReference)(ref);if(result.status==='waiting'){options.deferred?.set(item.id,Date.now()+result.nextCheckMs);waiting++;continue;}}
  else if(item.kind==='notification_delivery'){const result=await (options.notificationDeliveryProcessor||(await import('./notifications')).processNotificationDeliveryReference)(ref);if(result.status==='waiting'){options.deferred?.set(item.id,Date.now()+result.nextCheckMs);waiting++;continue;}}
  else if(item.kind==='matter_changed'){await (await import('./activities')).reconcileReference(ref);}else {waiting++;continue;}
  await transactWorkspace(tenantId,s=>{const o=s.outbox.find(o=>o.id===item.id&&o.owner==='v2');if(o?.status==='pending')o.status='dispatched';});options.deferred?.delete(item.id);completed++;
  }catch{
   // One unavailable provider/configuration must not block unrelated accepted work.
   options.deferred?.set(item.id,Date.now()+(item.kind==='retention_cleanup'||item.kind==='effect_reconcile'||item.kind==='artifact_cleanup'||item.kind==='slack_reply'?6*3600000:5*60000));waiting++;
  }
 }
 return {completed,waiting};
}
