import {V2Error} from '../contracts';
import {readWorkspace} from '../store';
import {getSlackReply} from '../integrations/slack';
import {processSlackReply,type SlackReplyProgress} from '../integrations/slack-replies';
import type {OutboxReference} from './contracts';
export type SlackProgress={status:'waiting'|'complete';nextCheckMs:number};
/** Only retained reply identity crosses workflow history; a webhook cannot supply delivery bytes. */
export async function processSlackReference(ref:OutboxReference,processor:(tenantId:string,id:string)=>Promise<SlackReplyProgress>=processSlackReply):Promise<SlackProgress>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped record references are accepted.',400);
 const s=await readWorkspace(ref.tenantId),reply=getSlackReply(s,ref.aggregateId),entry=s.outbox.find(o=>o.id===ref.outboxId&&o.tenantId===ref.tenantId&&o.aggregateId===ref.aggregateId&&o.kind==='slack_reply'&&o.owner==='v2'&&o.commandId===reply.commandId);
 if(!entry)throw new V2Error('OUTBOX_NOT_FOUND','The selected reply outbox is unavailable.',404);if(entry.status==='canceled')return {status:'complete',nextCheckMs:0};
 const result=await processor(ref.tenantId,ref.aggregateId);if(result.id!==ref.aggregateId)throw new V2Error('SLACK_REPLY_IDENTITY_MISMATCH','The reply processor returned another identity.',500);
 return ['verified','blocked'].includes(result.status)?{status:'complete',nextCheckMs:0}:{status:'waiting',nextCheckMs:Math.max(60000,Math.min(result.nextCheckMs,6*3600000))};
}
