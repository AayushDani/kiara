import {V2Error} from '../contracts';
import {readWorkspace} from '../store';
import {processLegalWatch} from '../legal-maintenance';
import type {OutboxReference} from './contracts';
export type LegalProgress={status:'waiting'|'complete';nextCheckMs:number};
/** Source fetching is bound to a retained approved watch, never a workflow-supplied URL. */
export async function processLegalReference(ref:OutboxReference,processor:typeof processLegalWatch=processLegalWatch):Promise<LegalProgress>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped record references are accepted.',400);
 const state=await readWorkspace(ref.tenantId),watch=state.legalWatches?.find(w=>w.id===ref.aggregateId),entry=state.outbox.find(o=>o.id===ref.outboxId&&o.tenantId===ref.tenantId&&o.aggregateId===ref.aggregateId&&o.kind==='legal_watch'&&o.owner==='v2'&&o.commandId===ref.aggregateId);
 if(!entry||!watch||watch.tenantId!==ref.tenantId)throw new V2Error('OUTBOX_NOT_FOUND','The retained source watch is unavailable.',404);if(entry.status==='canceled')return {status:'complete',nextCheckMs:0};
 const result=await processor(ref.tenantId,ref.aggregateId);return result.complete?{status:'complete',nextCheckMs:0}:{status:'waiting',nextCheckMs:Number.isFinite(result.nextCheckMs)?Math.max(60000,Math.min(result.nextCheckMs,24*3600000)):3600000};
}
