import {V2Error} from '../contracts';
import {readWorkspace} from '../store';
import {processDeletionJob} from '../retention-worker';
import type {OutboxReference} from './contracts';

export type RetentionProcessor=typeof processDeletionJob;
export type RetentionProgress={status:'waiting'|'complete';nextCheckMs:number};
/** Only opaque references and scheduling state enter workflow history, never erased content or object keys. */
export async function processRetentionReference(ref:OutboxReference,processor:RetentionProcessor=processDeletionJob):Promise<RetentionProgress>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped record references are accepted.',400);
 const state=await readWorkspace(ref.tenantId),entry=state.outbox.find(o=>o.id===ref.outboxId&&o.tenantId===ref.tenantId&&o.aggregateId===ref.aggregateId&&o.commandId===ref.aggregateId&&o.kind==='retention_cleanup'&&o.owner==='v2'),job=state.deletionJobs?.find(j=>j.id===ref.aggregateId);
 if(!entry||!job)throw new V2Error('OUTBOX_NOT_FOUND','The durable deletion reference is unavailable.',404);
 if(entry.status==='canceled')return {status:'complete',nextCheckMs:0};
 const result=await processor(ref.tenantId,job.id);
 if(result.jobId!==job.id)throw new V2Error('RETENTION_IDENTITY_MISMATCH','The deletion worker returned a different operation.',500);
 if(result.applicationCleanupComplete)return {status:'complete',nextCheckMs:0};
 const until=result.nextOriginalDueAt?Date.parse(result.nextOriginalDueAt)-Date.now():NaN;
 return {status:'waiting',nextCheckMs:result.failures.length||result.operationalExceptions||!Number.isFinite(until)||until<=0?6*3600000:Math.max(60000,Math.min(until,24*3600000))};
}
