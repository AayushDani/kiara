import {V2Error,type ActorContext} from '../contracts';
import {applySourceDeletion} from '../retention';
import {pendingSourceWithdrawalMatters,resumeSourceWithdrawalInState} from '../source-corrective';
import {readWorkspace,timestamp,transactWorkspace} from '../store';
import type {OutboxReference} from './contracts';

export interface WithdrawalProgress {status:'waiting'|'complete';remaining:number;nextCheckMs:number}
function progressFor(s:import('../contracts').WorkspaceState,ref:OutboxReference){
 const outbox=s.outbox.find(item=>item.id===ref.outboxId&&item.tenantId===ref.tenantId&&item.aggregateId===ref.aggregateId&&item.commandId===ref.aggregateId&&item.kind==='source_withdrawal'&&item.owner==='v2');
 if(!outbox||outbox.status==='canceled')throw new V2Error('OUTBOX_NOT_FOUND','The source withdrawal reference is unavailable.',404);
 const receipt=s.receipts[`source-withdrawal-progress:${ref.aggregateId}`];
 if(!receipt)throw new V2Error('WITHDRAWAL_NOT_PENDING','The source withdrawal progress receipt is unavailable.',409);
 return receipt.result as {status:'pending'|'complete';phase:'matters'|'proposals'|'deletion'|'complete';actorId:string;deleteRequested:boolean;deletionApplied:boolean;updatedAt:string};
}

/** A durable source reference, never retained evidence bytes, drives bounded corrective work. */
export async function processWithdrawalReference(ref:OutboxReference):Promise<WithdrawalProgress>{
 if(!ref||Object.keys(ref).sort().join(',')!=='aggregateId,outboxId,tenantId'||![ref.tenantId,ref.aggregateId,ref.outboxId].every(value=>typeof value==='string'&&value.length>0&&value.length<=200))throw new V2Error('INVALID_WORKFLOW_REFERENCE','Only scoped source references are accepted.',400);
 // Keep provenance until bounded matter and proposal passes finish. The accepting
 // command already committed the access fence, so neither pass can restore access.
 let state=await readWorkspace(ref.tenantId),progress=progressFor(state,ref);
 if(progress.phase==='matters'||progress.phase==='proposals'){
  state=(await transactWorkspace(ref.tenantId,s=>{progressFor(s,ref);resumeSourceWithdrawalInState(s,20,new Set([ref.aggregateId]));return null;})).state;
  progress=progressFor(state,ref);
 }
 if(progress.phase==='deletion'){
  await transactWorkspace(ref.tenantId,s=>{
   const pending=progressFor(s,ref);
   if(pending.phase!=='deletion'||!pending.deleteRequested||pending.deletionApplied)return false;
  const source=s.sources.find(item=>item.id===ref.aggregateId);
  if(!source||!['revoked','deleted'].includes(source.status))throw new V2Error('WITHDRAWAL_FENCE_MISSING','The committed source access fence is unavailable.',503);
  const actor:ActorContext={tenantId:ref.tenantId,actorId:pending.actorId,mode:'authenticated',expiresAt:Date.now()+60_000};
  applySourceDeletion(s,actor,ref.aggregateId);
  pending.deletionApplied=true;pending.phase='complete';pending.status='complete';pending.updatedAt=timestamp();
  return true;
  });
  return {status:'complete',remaining:0,nextCheckMs:0};
 }
 const source=state.sources.find(item=>item.id===ref.aggregateId);
 return {status:progress.status==='complete'?'complete':'waiting',remaining:source?pendingSourceWithdrawalMatters(state,source):0,nextCheckMs:progress.status==='complete'?0:1000};
}
