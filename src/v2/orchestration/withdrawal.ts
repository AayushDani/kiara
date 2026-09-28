import {V2Error,type ActorContext} from '../contracts';
import {applySourceDeletion} from '../retention';
import {resumeSourceWithdrawalInState} from '../source-corrective';
import {readWorkspace,timestamp,transactWorkspace} from '../store';
import type {OutboxReference} from './contracts';

export interface WithdrawalProgress {status:'waiting'|'complete';remaining:number;nextCheckMs:number}
function progressFor(s:import('../contracts').WorkspaceState,ref:OutboxReference){
 const outbox=s.outbox.find(item=>item.id===ref.outboxId&&item.tenantId===ref.tenantId&&item.aggregateId===ref.aggregateId&&item.commandId===ref.aggregateId&&item.kind==='source_withdrawal'&&item.owner==='v2');
 if(!outbox||outbox.status==='canceled')throw new V2Error('OUTBOX_NOT_FOUND','The source withdrawal reference is unavailable.',404);
 const receipt=s.receipts[`source-withdrawal-progress:${ref.aggregateId}`];
 if(!receipt)throw new V2Error('WITHDRAWAL_NOT_PENDING','The source withdrawal progress receipt is unavailable.',409);
 return receipt.result as {status:'pending'|'complete';actorId:string;deleteRequested:boolean;deletionApplied:boolean;pendingMatterIds:string[];pendingProposalIds:string[];updatedAt:string};
}

/** A durable source reference, never retained evidence bytes, drives bounded corrective work. */
export async function processWithdrawalReference(ref:OutboxReference):Promise<WithdrawalProgress>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(value=>typeof value==='string'&&value.length>0&&value.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped source references are accepted.',400);
 // The accepting command already committed the access fence. Deletion runs in its own
 // transaction so a failed redaction cannot make the source readable again.
 const initial=progressFor(await readWorkspace(ref.tenantId),ref);
 if(initial.status==='pending'&&initial.deleteRequested&&!initial.deletionApplied)await transactWorkspace(ref.tenantId,s=>{
  const progress=progressFor(s,ref);
  if(progress.status==='complete'||!progress.deleteRequested||progress.deletionApplied)return false;
  const source=s.sources.find(item=>item.id===ref.aggregateId);
  if(!source||!['revoked','deleted'].includes(source.status))throw new V2Error('WITHDRAWAL_FENCE_MISSING','The committed source access fence is unavailable.',503);
  const actor:ActorContext={tenantId:ref.tenantId,actorId:progress.actorId,mode:'authenticated',expiresAt:Date.now()+60_000};
  applySourceDeletion(s,actor,ref.aggregateId);
  progress.deletionApplied=true;progress.updatedAt=timestamp();
  if(!progress.pendingMatterIds.length&&!progress.pendingProposalIds.length)progress.status='complete';
  return true;
 });
 return (await transactWorkspace(ref.tenantId,s=>{
  const progress=progressFor(s,ref);
  if(progress.status==='complete')return {status:'complete' as const,remaining:0,nextCheckMs:0};
  const result=resumeSourceWithdrawalInState(s,20,new Set([ref.aggregateId]));
  return {status:progress.status==='pending'?'waiting' as const:'complete' as const,remaining:result.remaining,nextCheckMs:1000};
 })).result;
}
