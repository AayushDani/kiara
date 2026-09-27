import {membership,canRead,scopeVisible} from './authority';
import {V2Error,type ActorContext,type RecordBase,type WorkspaceState} from './contracts';
import {timestamp} from './store';

/** This projection contains no titles, evidence, excerpts, recipients or free-form history. */
export interface RecoveryView {
 matters:{id:string;version:number;state:string;unresolvedEffects:number;completedEffects:number;canWithdraw:boolean}[];
 timers:{id:string;version:number;startedAt:string;stoppedAt:string|null;canStop:boolean}[];
 sources:{id:string;version:number;status:'revoked'|'deleted'}[];
}
export type RecoveryCommand={type:'recovery.withdraw';matterId:string;expectedRecordVersion:number;reason:string};
export const recoveryCommandFields={'recovery.withdraw':['matterId','expectedRecordVersion','reason']};
function controlScope(s:WorkspaceState,a:ActorContext,r:RecordBase){
 const member=membership(s,a);
 return r.tenantId===a.tenantId&&(!member.entityIds||member.entityIds.includes(s.entityId))&&scopeVisible(s,a,r.scope)&&(!member.matterIds||('matterId' in r&&typeof r.matterId==='string'&&member.matterIds.includes(r.matterId))||member.matterIds.includes(r.id)||(r.scope.kind==='private'&&r.scope.actorIds.includes(a.actorId)));
}
export function mayControlOwnEffort(s:WorkspaceState,a:ActorContext,r:RecordBase&{actorId:string}){return r.actorId===a.actorId&&controlScope(s,a,r);}
export function mayDeleteRemovedSource(s:WorkspaceState,a:ActorContext,id:string){const r=s.sources.find(x=>x.id===id);return !!r&&r.status!=='active'&&membership(s,a).roles.includes('admin')&&controlScope(s,a,r);}
export function recoveryViews(s:WorkspaceState,a:ActorContext):RecoveryView{
 const member=membership(s,a);
 return {
  matters:s.matters.filter(m=>m.ownerId===a.actorId&&controlScope(s,a,m)&&!canRead(s,a,m)).map(m=>({id:m.id,version:m.version,state:m.state,unresolvedEffects:s.actions.filter(x=>x.matterId===m.id&&['dispatching','uncertain','verifying'].includes(x.status)).length,completedEffects:s.actions.filter(x=>x.matterId===m.id&&x.status==='verified').length,canWithdraw:member.roles.includes('business_owner')&&!m.legacyWorkflowId&&m.state!=='canceled'})),
  timers:(s.effortEntries||[]).filter(e=>!e.voidReason&&mayControlOwnEffort(s,a,e)&&!canRead(s,a,e)).map(e=>({id:e.id,version:e.version,startedAt:e.startedAt,stoppedAt:e.stoppedAt,canStop:e.method==='elapsed_timer'&&!e.stoppedAt})),
  sources:s.sources.filter(src=>src.status!=='active'&&(src.provenance.actorId===a.actorId||member.roles.includes('admin'))&&controlScope(s,a,src)).map(src=>({id:src.id,version:src.version,status:src.status as 'revoked'|'deleted'})),
 };
}
export function applyRecoveryCommand(s:WorkspaceState,a:ActorContext,c:RecoveryCommand):Record<string,unknown>{
 const member=membership(s,a),m=s.matters.find(x=>x.id===c.matterId);
 if(!m||m.ownerId!==a.actorId||!controlScope(s,a,m)||canRead(s,a,m))throw new V2Error('NOT_FOUND','Unavailable work can only be controlled by its current scoped owner.',404);
 if(!member.roles.includes('business_owner')||m.legacyWorkflowId)throw new V2Error('FORBIDDEN','Current business-owner authority over v2 work is required.',403);
 if(m.version!==c.expectedRecordVersion)throw new V2Error('VERSION_CONFLICT','Inspect the current recovery status.');
 if(typeof c.reason!=='string'||!c.reason.trim()||c.reason.length>2000)throw new V2Error('INVALID_INPUT','Provide a withdrawal reason of up to 2,000 characters.',400);
 const touch=(r:RecordBase)=>{r.version++;r.updatedAt=timestamp();};
 for(const p of s.proposals.filter(p=>p.matterId===m.id&&p.status==='current')){p.status='invalidated';touch(p);}
 for(const approval of s.approvals.filter(p=>p.matterId===m.id&&p.status==='active')){approval.status='revoked';touch(approval);}
 for(const e of s.counsel.filter(e=>e.matterId===m.id&&e.sharing&&!e.sharing.revokedAt)){e.sharing!.revokedAt=timestamp();touch(e);}
 for(const action of s.actions.filter(x=>x.matterId===m.id&&!['verified','dispatching','uncertain','verifying'].includes(x.status))){action.status='canceled';action.authorizationId=null;touch(action);}
 // Reconciliation must continue, including after withdrawal or loss of evidence access.
 for(const o of s.outbox.filter(o=>o.aggregateId===m.id&&o.status==='pending'&&o.kind==='matter_changed'))o.status='canceled';
 m.state='canceled';m.outcome=c.reason.trim();m.blockers=s.actions.some(x=>x.matterId===m.id&&['dispatching','uncertain','verifying'].includes(x.status))?['Future work withdrawn. Previously submitted actions still require provider reconciliation.']:[];touch(m);
 return {matterId:m.id,withdrawn:true,retainedEffects:s.actions.filter(x=>x.matterId===m.id&&['verified','dispatching','uncertain','verifying'].includes(x.status)).length};
}
