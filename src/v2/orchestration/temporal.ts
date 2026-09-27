import {Client,Connection,WorkflowExecutionAlreadyStartedError} from '@temporalio/client';
import {V2Error} from '../contracts';
import {digest,readWorkspace,transactWorkspace} from '../store';
import {changedSignalName,type OutboxReference} from './contracts';
export interface TemporalConfig {address:string;namespace:string;taskQueue:string;apiKey:string}
export function temporalConfig():TemporalConfig {const {KIARA_TEMPORAL_ADDRESS:address,KIARA_TEMPORAL_NAMESPACE:namespace,KIARA_TEMPORAL_TASK_QUEUE:taskQueue,KIARA_TEMPORAL_API_KEY:apiKey}=process.env;if(!address||!namespace||!taskQueue||!apiKey)throw new V2Error('ORCHESTRATION_UNAVAILABLE','Managed Temporal requires address, namespace, task queue and a server credential.',503);return {address,namespace,taskQueue,apiKey};}
export const matterWorkflowId=(tenantId:string,aggregateId:string)=>`kiara-v2-${digest({tenantId,aggregateId})}`;
export interface OutboxDispatcher {signal(ref:OutboxReference,kind?:'matter_changed'|'conversation_answer'|'effect_reconcile'):Promise<void>}
export async function connectTemporal():Promise<{dispatcher:OutboxDispatcher;close:()=>Promise<void>}>{
 const config=temporalConfig();const connection=await Connection.connect({address:config.address,tls:true,apiKey:config.apiKey,connectTimeout:'10 seconds'});const client=new Client({connection,namespace:config.namespace});return {dispatcher:{async signal(ref,kind='matter_changed'){if(kind==='conversation_answer'||kind==='effect_reconcile'){try{await client.workflow.start(kind==='conversation_answer'?'kiaraConversationWorkflow':'kiaraEffectWorkflow',{workflowId:`${kind==='conversation_answer'?'conversation':'effect'}-${matterWorkflowId(ref.tenantId,ref.aggregateId)}`,taskQueue:config.taskQueue,args:[ref],workflowIdConflictPolicy:'USE_EXISTING',workflowIdReusePolicy:'REJECT_DUPLICATE'});}catch(e){if(!(e instanceof WorkflowExecutionAlreadyStartedError))throw e;}return;}await client.workflow.signalWithStart('kiaraMatterWorkflow',{workflowId:matterWorkflowId(ref.tenantId,ref.aggregateId),taskQueue:config.taskQueue,args:[{tenantId:ref.tenantId,aggregateId:ref.aggregateId}],signal:changedSignalName,signalArgs:[ref],workflowIdConflictPolicy:'USE_EXISTING',workflowIdReusePolicy:'ALLOW_DUPLICATE'});}},close:()=>connection.close()};
}
/** Network acknowledgement precedes CAS marking; a lost acknowledgement retries the stable workflow signal. */
export async function dispatchOutbox(tenantId:string,dispatcher?:OutboxDispatcher,limit=100){
 const owned=dispatcher?null:await connectTemporal();const target=dispatcher||owned!.dispatcher;let dispatched=0;
 try{const pending=(await readWorkspace(tenantId)).outbox.filter(o=>o.status==='pending'&&o.owner==='v2'&&['matter_changed','conversation_answer','effect_reconcile'].includes(o.kind)).slice(0,Math.min(Math.max(limit,1),100));for(const item of pending){
   // Re-read immediately before signaling. Cancellation is rechecked again by the activity.
   const current=(await readWorkspace(tenantId)).outbox.find(o=>o.id===item.id);if(!current||current.status!=='pending'||current.owner!=='v2'||!['matter_changed','conversation_answer','effect_reconcile'].includes(current.kind))continue;
   await target.signal({tenantId,aggregateId:item.aggregateId,outboxId:item.id},item.kind as 'matter_changed'|'conversation_answer'|'effect_reconcile');
   const marked=await transactWorkspace(tenantId,s=>{const entry=s.outbox.find(o=>o.id===item.id&&o.owner==='v2');if(!entry||entry.status!=='pending')return false;entry.status='dispatched';return true;});if(marked.result)dispatched++;
  }return {dispatched,remaining:(await readWorkspace(tenantId)).outbox.filter(o=>o.status==='pending'&&o.owner==='v2'&&['matter_changed','conversation_answer','effect_reconcile'].includes(o.kind)).length};
 }finally{await owned?.close();}
}
