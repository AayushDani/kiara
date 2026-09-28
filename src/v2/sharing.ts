import type {ActorContext, CounselEngagement, Matter, RecordBase, WorkspaceState} from './contracts';
import {digest} from './store';

/** A grant names the actual records disclosed, not a reusable role or folder ACL. */
export interface PacketGrant {
 recipientActorId:string;
 recipientMembershipVersion:number;
 approvalId:string;
 packetHash:string;
 expiresAt:string;
 revokedAt:string|null;
 records:{id:string;hash:string}[];
 sourceVersions:Record<string,number>;
 factVersions:Record<string,number>;
}
export interface CounselLifecycle {
 /** Derived snapshot review digest; never accepted from record writes. */
 packetHash?:string;
 preparedProposal?:{id:string;contentHash:string;dependenciesHash:string;matterHash:string;evidenceHash:string}|null;
 counselActorId?:string|null;
 intakeEvidence?:string|null;
 intakeRecordedBy?:string|null;
 engagementApproval?:{actorId:string;membershipVersion:number;termsHash:string;approvedAt:string}|null;
 sharing?:PacketGrant|null;
 reviewNotes?:string[];
 escalation?:{reason:'non_response'|'unavailable_expertise'|'rejected_scope'|'budget_increase';detail:string;recordedAt:string}|null;
}
export function grantRecordHash(record:RecordBase):string {
 const value={...record} as Record<string,unknown>;
 delete value.version;delete value.updatedAt;delete value.sharing;
 return digest(value);
}
export function counselPacketHash(engagement:CounselEngagement & CounselLifecycle){
 return digest({packet:engagement.packet,preparedProposal:engagement.preparedProposal,recipientActorId:engagement.counselActorId,terms:engagement.terms,feeCap:engagement.feeCap,currency:engagement.currency,responseDueAt:engagement.responseDueAt,sourceIds:engagement.provenance.sourceIds,factIds:engagement.provenance.factIds||[]});
}
export function matterPacketHash(m:Matter){return digest({...m,version:0,updatedAt:'',state:'',blockers:[],tasks:m.tasks.map(t=>({...t,status:'',ownerId:'',evidenceIds:[]}))});}
export function activePacketGrant(s:WorkspaceState,a:ActorContext,e:CounselEngagement & CounselLifecycle):PacketGrant|null {
 const g=e.sharing;if(!g||g.revokedAt||g.recipientActorId!==a.actorId||Date.parse(g.expiresAt)<=Date.now()||e.tenantId!==a.tenantId)return null;
 const recipient=s.memberships.find(m=>m.actorId===a.actorId);
 if(!recipient||recipient.revokedAt||recipient.version!==g.recipientMembershipVersion||!recipient.roles.includes('legal_reviewer')||(recipient.expiresAt&&Date.parse(recipient.expiresAt)<=Date.now())||recipient.entityIds&&!recipient.entityIds.includes(s.entityId)||recipient.matterIds&&!recipient.matterIds.includes(e.matterId))return null;
 const approval=s.approvals.find(p=>p.id===g.approvalId);
 const owner=approval&&s.memberships.find(m=>m.actorId===approval.actorId);
 if(!approval||approval.capacity!=='sharing'||approval.status!=='active'||approval.actionHash!==g.packetHash||approval.recipients.length!==1||approval.recipients[0]!==a.actorId||Date.parse(approval.validUntil)<=Date.now()||approval.conditions.length||!owner||owner.revokedAt||owner.version!==approval.membershipVersion||!owner.roles.includes('business_owner')||(owner.expiresAt&&Date.parse(owner.expiresAt)<=Date.now()))return null;
 for(const [id,v] of Object.entries(g.sourceVersions)){const source=s.sources.find(x=>x.id===id);if(!source||source.status!=='active'||source.version!==v||s.tombstones.some(t=>t.sourceId===id))return null;}
 for(const [id,v] of Object.entries(g.factVersions)){const fact=s.facts.find(x=>x.id===id);if(!fact||fact.version!==v||fact.status!=='confirmed')return null;}
 return g;
}
export function hasPacketAccess(s:WorkspaceState,a:ActorContext,r:RecordBase):boolean {
 // Conversation history is never silently included in a matter packet.
 if(s.conversations.some(c=>c.id===r.id)||s.messages.some(m=>m.id===r.id)||s.scenarios.some(x=>x.id===r.id))return false;
 return s.counsel.some(e=>activePacketGrant(s,a,e)?.records.some(x=>x.id===r.id&&x.hash===grantRecordHash(r))===true);
}
/** Only trusted approval transitions may advance visible review state. Material changes
 * to the objective, sources, conversations, task wording or proposal remain frozen. */
export function advancePacketReviewState(s:WorkspaceState,before:Matter,after:Matter){
 const material=(m:Matter)=>({...m,version:0,updatedAt:'',state:'',blockers:[],tasks:m.tasks.map(t=>({...t,status:'',ownerId:'',evidenceIds:[]}))});
 if(digest(material(before))!==digest(material(after)))return;
 const prior=grantRecordHash(before),next=grantRecordHash(after);
 for(const e of s.counsel){const grant=e.sharing?.records.find(r=>r.id===after.id&&r.hash===prior);if(grant)grant.hash=next;}
}
