import {sourceInstallationEligible} from './integrations/config';
import {hasPacketAccess} from './sharing';
import {V2Error, type ActorContext, type Membership, type RecordBase, type Role, type Scope, type Source, type WorkspaceState} from './contracts';
export function membership(state:WorkspaceState,actor:ActorContext):Membership {
 if(actor.tenantId!==state.tenantId||!actor.actorId||!Number.isFinite(actor.expiresAt)||actor.expiresAt<=Date.now())throw new V2Error('SESSION_EXPIRED','Sign in again before continuing.',401);
 const member=state.memberships.find(m=>m.actorId===actor.actorId);
 if(!member||member.revokedAt||(member.expiresAt&&Date.parse(member.expiresAt)<=Date.now()))throw new V2Error('MEMBERSHIP_REVOKED','Current workspace membership is required.',403);
 return member;
}
export function requireRole(state:WorkspaceState,actor:ActorContext,role:Role,record?:RecordBase){const m=membership(state,actor);if(!m.roles.includes(role))throw new V2Error('FORBIDDEN',`This decision requires the ${role.replaceAll('_',' ')} capacity.`,403);if(record&&!canRead(state,actor,record))throw new V2Error('NOT_FOUND','This record is unavailable in your current scope.',404);return m;}
export function scopeVisible(state:WorkspaceState,actor:ActorContext,scope:Scope){const m=membership(state,actor);if((scope.kind==='private'||scope.kind==='team'&&scope.actorIds.length>0)&&!scope.actorIds.includes(actor.actorId))return false;if(scope.kind==='matter'){if(!scope.matterId)return false;if(m.matterIds&&!m.matterIds.includes(scope.matterId))return false;if(scope.actorIds.length&&!scope.actorIds.includes(actor.actorId))return false;}return true;}
export function canRead(state:WorkspaceState,actor:ActorContext,record:RecordBase,visited=new Set<string>()):boolean {
 if('externalRevision' in record&&!sourceInstallationEligible(state,record as Source))return false;
 if(record.tenantId!==actor.tenantId)return false;
 const m=membership(state,actor),granted=hasPacketAccess(state,actor,record);
 if(!scopeVisible(state,actor,record.scope)&&!granted)return false;
 if(m.matterIds){const permittedMatter=record.scope.kind==='matter'&&!!record.scope.matterId&&m.matterIds.includes(record.scope.matterId);const permittedMatterRecord='objective' in record&&m.matterIds.includes(record.id);const explicitlyPrivate=record.scope.kind==='private'&&record.scope.actorIds.includes(actor.actorId);if(!granted&&!permittedMatter&&!permittedMatterRecord&&!explicitlyPrivate)return false;}if(m.entityIds&&!m.entityIds.includes(state.entityId))return false;
 if(!granted&&m.matterIds&&'matterId' in record&&typeof record.matterId==='string'&&!m.matterIds.includes(record.matterId))return false;
 if('status' in record&&['revoked','deleted'].includes(String(record.status)))return false;
 for(const sourceId of record.provenance.sourceIds){if(visited.has(sourceId))continue;const source=state.sources.find(s=>s.id===sourceId);if(!source||source.status!=='active'||state.tombstones.some(t=>t.sourceId===sourceId))return false;visited.add(sourceId);if(!canRead(state,actor,source,visited))return false;}
 // Historical assertions retain their access policy. Freshness is enforced separately by
 // proposal dependencies and retrieval; superseding truth must not hide the work to repair.
 for(const factId of record.provenance.factIds||[]){if(visited.has(factId))continue;const fact=state.facts.find(f=>f.id===factId);if(!fact)return false;visited.add(factId);if(!canRead(state,actor,fact,visited))return false;}
 return true;
}
export function readRecord<T extends RecordBase>(state:WorkspaceState,actor:ActorContext,records:T[],id:string):T {const record=records.find(r=>r.id===id);if(!record||!canRead(state,actor,record))throw new V2Error('NOT_FOUND','This record is unavailable in your current scope.',404);return record;}
export function requestedScope(state:WorkspaceState,actor:ActorContext,scope?:Scope):Scope {membership(state,actor);const value=scope||{kind:'private',actorIds:[actor.actorId]};if(!['private','team','matter'].includes(value.kind)||!Array.isArray(value.actorIds)||value.actorIds.some(id=>typeof id!=='string'||!state.memberships.some(m=>m.actorId===id&&!m.revokedAt)))throw new V2Error('INVALID_SCOPE','Choose current workspace participants.',400);if(value.kind==='private'&&(!value.actorIds.includes(actor.actorId)||value.actorIds.length!==1))throw new V2Error('SHARING_APPROVAL_REQUIRED','Private conversations remain scoped to their owner; use an explicit sharing decision.',403);if(value.kind==='matter'){const matter=state.matters.find(m=>m.id===value.matterId);if(!matter||!canRead(state,actor,matter))throw new V2Error('NOT_FOUND','Matter is unavailable.',404);}return structuredClone(value);}
