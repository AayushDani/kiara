import {V2Error} from '../contracts';
import {readWorkspace} from '../store';
import {processEmailIntake,type EmailIntake} from '../integrations/email';
import type {OutboxReference} from './contracts';
export type EmailProgress={status:'waiting'|'complete';nextCheckMs:number};
/** History contains intake references only. Original bytes, email identity and private preview stay in application storage. */
export async function processEmailReference(ref:OutboxReference,processor:typeof processEmailIntake=processEmailIntake):Promise<EmailProgress>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped record references are accepted.',400);
 const state=await readWorkspace(ref.tenantId),job=state.receipts[`email-intake:${ref.aggregateId}`]?.result.intake as unknown as EmailIntake|undefined,entry=state.outbox.find(o=>o.id===ref.outboxId&&o.tenantId===ref.tenantId&&o.aggregateId===ref.aggregateId&&o.commandId===ref.aggregateId&&o.kind==='email_intake'&&o.owner==='v2');if(!job||job.id!==ref.aggregateId||!entry)throw new V2Error('OUTBOX_NOT_FOUND','The retained email intake is unavailable.',404);if(entry.status==='canceled')return {status:'complete',nextCheckMs:0};
 const progress=await processor(ref.tenantId,ref.aggregateId);return ['queued','running'].includes(progress.status)?{status:'waiting',nextCheckMs:Number.isFinite(progress.nextCheckMs)?Math.max(60000,Math.min(progress.nextCheckMs,21600000)):300000}:{status:'complete',nextCheckMs:0};
}
