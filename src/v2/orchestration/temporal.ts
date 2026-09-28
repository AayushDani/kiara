import {Client,Connection,WorkflowExecutionAlreadyStartedError} from '@temporalio/client';
import {V2Error,type OutboxEntry} from '../contracts';
import {digest,readWorkspace,transactWorkspace} from '../store';
import {changedSignalName,type OutboxReference} from './contracts';
export interface TemporalConfig {address:string;namespace:string;taskQueue:string;apiKey:string}
export function temporalConfig():TemporalConfig {const {KIARA_TEMPORAL_ADDRESS:address,KIARA_TEMPORAL_NAMESPACE:namespace,KIARA_TEMPORAL_TASK_QUEUE:taskQueue,KIARA_TEMPORAL_API_KEY:apiKey}=process.env;if(!address||!namespace||!taskQueue||!apiKey)throw new V2Error('ORCHESTRATION_UNAVAILABLE','Managed Temporal requires address, namespace, task queue and a server credential.',503);return {address,namespace,taskQueue,apiKey};}
export const matterWorkflowId=(tenantId:string,aggregateId:string)=>`kiara-v2-${digest({tenantId,aggregateId})}`;
export const withdrawalWorkflowId=(ref:OutboxReference)=>`withdrawal-kiara-v2-${digest({tenantId:ref.tenantId,aggregateId:ref.aggregateId,outboxId:ref.outboxId})}`;
const backgroundWorkflows={conversation_answer:['kiaraConversationWorkflow','conversation'],effect_reconcile:['kiaraEffectWorkflow','effect'],retention_cleanup:['kiaraRetentionWorkflow','retention'],artifact_cleanup:['kiaraArtifactWorkflow','artifact'],index_maintenance:['kiaraIndexWorkflow','index'],slack_reply:['kiaraSlackWorkflow','slack'],legal_watch:['kiaraLegalWorkflow','legal'],email_intake:['kiaraEmailWorkflow','email'],notification_watch:['kiaraNotificationWatchWorkflow','notification-watch'],notification_delivery:['kiaraNotificationDeliveryWorkflow','notification-delivery'],source_withdrawal:['kiaraWithdrawalWorkflow','withdrawal']} as const;
type DispatchKind='matter_changed'|keyof typeof backgroundWorkflows;
const supported=(kind:OutboxEntry['kind']):kind is DispatchKind=>kind==='matter_changed'||kind in backgroundWorkflows;
export interface OutboxDispatcher {signal(ref:OutboxReference,kind?:DispatchKind):Promise<void>}
export async function connectTemporal():Promise<{dispatcher:OutboxDispatcher;close:()=>Promise<void>}>{
 const config=temporalConfig(),connection=await Connection.connect({address:config.address,tls:true,apiKey:config.apiKey,connectTimeout:'10 seconds'}),client=new Client({connection,namespace:config.namespace});return {dispatcher:{async signal(ref,kind='matter_changed'){
  if(kind!=='matter_changed'){const [name,prefix]=backgroundWorkflows[kind];try{await client.workflow.start(name,{workflowId:kind==='source_withdrawal'?withdrawalWorkflowId(ref):`${prefix}-${matterWorkflowId(ref.tenantId,ref.aggregateId)}`,taskQueue:config.taskQueue,args:[ref],workflowIdConflictPolicy:'USE_EXISTING',workflowIdReusePolicy:'REJECT_DUPLICATE'});}catch(error){if(!(error instanceof WorkflowExecutionAlreadyStartedError))throw error;}return;}
  await client.workflow.signalWithStart('kiaraMatterWorkflow',{workflowId:matterWorkflowId(ref.tenantId,ref.aggregateId),taskQueue:config.taskQueue,args:[{tenantId:ref.tenantId,aggregateId:ref.aggregateId}],signal:changedSignalName,signalArgs:[ref],workflowIdConflictPolicy:'USE_EXISTING',workflowIdReusePolicy:'ALLOW_DUPLICATE'});
 }},close:()=>connection.close()};
}
/** Network acknowledgement precedes CAS marking; a lost acknowledgement retries the same stable identity. */
export async function dispatchOutbox(tenantId:string,dispatcher?:OutboxDispatcher,limit=100){
 const owned=dispatcher?null:await connectTemporal(),target=dispatcher||owned!.dispatcher;let dispatched=0;
 try{const pending=(await readWorkspace(tenantId)).outbox.filter(o=>o.status==='pending'&&o.owner==='v2'&&supported(o.kind)).slice(0,Math.min(Math.max(limit,1),100));for(const item of pending){
  const current=(await readWorkspace(tenantId)).outbox.find(o=>o.id===item.id);if(!current||current.status!=='pending'||current.owner!=='v2'||!supported(current.kind))continue;
  await target.signal({tenantId,aggregateId:current.aggregateId,outboxId:current.id},current.kind);const marked=await transactWorkspace(tenantId,s=>{const entry=s.outbox.find(o=>o.id===item.id&&o.owner==='v2');if(!entry||entry.status!=='pending')return false;entry.status='dispatched';return true;});if(marked.result)dispatched++;
 }return {dispatched,remaining:(await readWorkspace(tenantId)).outbox.filter(o=>o.status==='pending'&&o.owner==='v2'&&supported(o.kind)).length};}finally{await owned?.close();}
}
