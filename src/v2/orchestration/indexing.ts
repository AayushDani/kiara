import {V2Error} from '../contracts';
import {readWorkspace} from '../store';
import {processIndexJob,type IndexJobView} from '../index-maintenance';
import type {OutboxReference} from './contracts';
export type IndexProgress={status:'waiting'|'complete';nextCheckMs:number};
/** Accepted standing-policy maintenance can only process its retained job, never select new evidence. */
export async function processIndexReference(ref:OutboxReference,processor:(tenantId:string,jobId:string)=>Promise<IndexJobView>=processIndexJob):Promise<IndexProgress>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped record references are accepted.',400);
 const s=await readWorkspace(ref.tenantId),entry=s.outbox.find(o=>o.id===ref.outboxId&&o.tenantId===ref.tenantId&&o.aggregateId===ref.aggregateId&&o.kind==='index_maintenance'&&o.owner==='v2'),job=s.receipts[`index-maintenance:${ref.aggregateId}`]?.result.job as {id?:string}|undefined;
 if(!entry||job?.id!==ref.aggregateId)throw new V2Error('OUTBOX_NOT_FOUND','The durable indexing reference is unavailable.',404);
 if(entry.status==='canceled')return {status:'complete',nextCheckMs:0};
 const result=await processor(ref.tenantId,ref.aggregateId);if(result.id!==ref.aggregateId)throw new V2Error('INDEX_IDENTITY_MISMATCH','The index processor returned a different operation.',500);
 if(['complete','blocked','unknown'].includes(result.status))return {status:'complete',nextCheckMs:0};
 const until=result.nextAttemptAt?Date.parse(result.nextAttemptAt)-Date.now():5*60000;
 return {status:'waiting',nextCheckMs:Number.isFinite(until)?Math.max(60000,Math.min(until,5*60000)):5*60000};
}
