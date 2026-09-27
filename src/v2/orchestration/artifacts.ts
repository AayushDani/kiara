import {V2Error} from '../contracts';
import {readWorkspace} from '../store';
import {processIntakeJob} from '../artifact-intake';
import type {OutboxReference} from './contracts';
export type ArtifactProgress={status:'waiting'|'complete';nextCheckMs:number};
/** Intake expiry is a reference-only background job; uncertain object writes remain explicit. */
export async function processArtifactReference(ref:OutboxReference,processor:typeof processIntakeJob=processIntakeJob):Promise<ArtifactProgress>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped record references are accepted.',400);
 const s=await readWorkspace(ref.tenantId),entry=s.outbox.find(o=>o.id===ref.outboxId&&o.tenantId===ref.tenantId&&o.aggregateId===ref.aggregateId&&o.commandId===ref.aggregateId&&o.kind==='artifact_cleanup'&&o.owner==='v2'),intake=s.receipts[`artifact-intake:${ref.aggregateId}`]?.result.intake as {id?:string}|undefined;
 if(!entry||intake?.id!==ref.aggregateId)throw new V2Error('OUTBOX_NOT_FOUND','The durable intake reference is unavailable.',404);
 if(entry.status==='canceled')return {status:'complete',nextCheckMs:0};
 const result=await processor(ref.tenantId,ref.aggregateId);
 return result.complete?{status:'complete',nextCheckMs:0}:{status:'waiting',nextCheckMs:Number.isFinite(result.nextCheckMs)?Math.max(60000,Math.min(result.nextCheckMs,24*3600000)):6*3600000};
}
