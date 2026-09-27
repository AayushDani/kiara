import {randomUUID} from 'node:crypto';
import type {Matter,Proposal,WorkspaceState} from './contracts';
/** Required review work remains assigned even when no qualified reviewer is available yet. */
export function resetReviewTasks(s:WorkspaceState,m:Matter,_proposal?:Proposal){
 for(const kind of ['business','legal'] as const){let task=m.tasks.find(t=>t.kind===kind);const reviewer=s.memberships.find(member=>member.roles.includes('legal_reviewer')&&!member.revokedAt&&(!member.expiresAt||Date.parse(member.expiresAt)>Date.now())&&(!member.matterIds||member.matterIds.includes(m.id))&&(!member.entityIds||member.entityIds.includes(m.entityId)));
  if(!task){task={id:randomUUID(),title:kind==='business'?'Review the exact business proposal':'Obtain qualified legal review of the exact proposal',ownerId:kind==='legal'?reviewer?.actorId||m.ownerId:m.ownerId,status:'pending',kind,dueAt:null,deadlineType:'undated',evidenceIds:[]};m.tasks.push(task);}else{task.status='pending';task.evidenceIds=[];}
 }
}
