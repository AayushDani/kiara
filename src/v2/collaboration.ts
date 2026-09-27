import {randomUUID} from 'node:crypto';
import {canRead,membership,readRecord,requireRole} from './authority';
import {V2Error,type ActorContext,type Matter,type MatterTask,type Membership,type RecordBase,type Role,type WorkspaceState} from './contracts';
import {digest,timestamp} from './store';

export type RoutingTopic='product_facts'|'business_decisions'|'legal_questions';
const topicRole:Record<RoutingTopic,Role>={product_facts:'fact_owner',business_decisions:'business_owner',legal_questions:'legal_reviewer'};
const topicTask:Record<RoutingTopic,MatterTask['kind']>={product_facts:'fact',business_decisions:'business',legal_questions:'legal'};
export interface ScenarioShare extends RecordBase {
 scenarioId:string;scenarioVersion:number;grantorId:string;grantorMembershipVersion:number;
 recipients:{actorId:string;membershipVersion:number}[];
 title:string;assumptions:string[];questions:string[];snapshotHash:string;validUntil:string;revokedAt:string|null;
 sourceVersions:Record<string,number>;factVersions:Record<string,number>;
}
export interface RoutingDelegation extends RecordBase {matterId:string;grantorId:string;recipientActorId:string;grantorMembershipVersion:number;recipientMembershipVersion:number;topics:RoutingTopic[];validUntil:string;acceptedAt:string|null;revokedAt:string|null;revocationReason:string|null}
export interface RoutingRule extends RecordBase {matterId:string;delegationId:string;topic:RoutingTopic;ownerId:string;active:boolean}
export type ScenarioShareStatus='active'|'expired'|'revoked'|'stale';
/** Recipients never receive the private origin ID, its history or source provenance. */
export interface ScenarioShareView {id:string;version:number;title:string;assumptions:string[];questions:string[];grantorId:string;recipientActorIds:string[];snapshotHash:string;validUntil:string;sharedAt:string;status:ScenarioShareStatus;originScenarioId?:string}
export interface RoutingDelegationView extends RoutingDelegation {status:'offered'|'accepted'|'expired'|'revoked'|'ineligible'}
export interface RoutingRuleView extends RoutingRule {effective:boolean}
export type CollaborationCommand=
 |{type:'scenario.share';scenarioId:string;expectedRecordVersion:number;title:string;assumptionIndexes:number[];includeQuestions:boolean;recipientActorIds:string[];validUntil:string}
 |{type:'scenario.share_revoke';shareId:string;expectedRecordVersion:number;reason:string}
 |{type:'delegation.offer';matterId:string;expectedMatterVersion:number;recipientActorId:string;topics:RoutingTopic[];validUntil:string}
 |{type:'delegation.accept';delegationId:string;expectedRecordVersion:number}
 |{type:'delegation.revoke';delegationId:string;expectedRecordVersion:number;reason:string}
 |{type:'routing.set';delegationId:string;expectedRecordVersion:number;topic:RoutingTopic}
 |{type:'routing.clear';ruleId:string;expectedRecordVersion:number;reason:string}
 |{type:'conversation.link_matter';conversationId:string;matterId:string;expectedConversationVersion:number;expectedMatterVersion:number};
export const collaborationCommandFields:Record<CollaborationCommand['type'],string[]>={
 'scenario.share':['scenarioId','expectedRecordVersion','title','assumptionIndexes','includeQuestions','recipientActorIds','validUntil'],
 'scenario.share_revoke':['shareId','expectedRecordVersion','reason'],
 'delegation.offer':['matterId','expectedMatterVersion','recipientActorId','topics','validUntil'],
 'delegation.accept':['delegationId','expectedRecordVersion'],
 'delegation.revoke':['delegationId','expectedRecordVersion','reason'],
 'routing.set':['delegationId','expectedRecordVersion','topic'],
 'routing.clear':['ruleId','expectedRecordVersion','reason'],
 'conversation.link_matter':['conversationId','matterId','expectedConversationVersion','expectedMatterVersion'],
};
function ensure(value:unknown,code:string,message:string,status=409):asserts value{if(!value)throw new V2Error(code,message,status)}
function text(value:unknown,label:string,max=2000){ensure(typeof value==='string'&&value.trim()&&value.length<=max,'INVALID_INPUT',`Provide ${label} (up to ${max} characters).`,400);return value.trim()}
function version(record:RecordBase,expected:number){ensure(Number.isSafeInteger(expected)&&record.version===expected,'VERSION_CONFLICT','Inspect the current exact record before deciding.')}
function touch(record:RecordBase){record.version++;record.updatedAt=timestamp()}
function future(value:string){const date=Date.parse(value);ensure(typeof value==='string'&&Number.isFinite(date)&&date>Date.now()&&date<=Date.now()+30*86400000,'INVALID_EXPIRY','Choose an expiry within the next 30 days.',400);return new Date(date).toISOString()}
function memberActor(s:WorkspaceState,id:string):ActorContext{return {tenantId:s.tenantId,actorId:id,mode:'authenticated',expiresAt:Date.now()+60000}}
function activeMember(s:WorkspaceState,id:string):Membership|null{try{return membership(s,memberActor(s,id))}catch{return null}}
function base(s:WorkspaceState,a:ActorContext,scope:RecordBase['scope'],sourceIds:string[]=[]):RecordBase{return {id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:structuredClone(scope),provenance:{actorId:a.actorId,sourceIds:[...new Set(sourceIds)],description:'Explicit bounded collaboration decision; no authority, company fact or conversation access inferred'}}}
function event(s:WorkspaceState,a:ActorContext,record:RecordBase,type:string,title:string,matterId:string|null=null){s.events.push({...base(s,a,record.scope,record.provenance.sourceIds),type,title,detail:'Exact scope and attributed decision retained. Required capacities and source access remain unchanged.',matterId,recordId:record.id,measurement:s.rehearsal?'fictional_rehearsal':'observed'})}
function readable(s:WorkspaceState,id:string,record:RecordBase){try{return canRead(s,memberActor(s,id),record)}catch{return false}}

function shareStatus(s:WorkspaceState,share:ScenarioShare):ScenarioShareStatus{
 if(share.revokedAt)return 'revoked';if(!Number.isFinite(Date.parse(share.validUntil))||Date.parse(share.validUntil)<=Date.now())return 'expired';
 const member=activeMember(s,share.grantorId),origin=s.scenarios.find(record=>record.id===share.scenarioId);
 if(!member||member.version!==share.grantorMembershipVersion||!origin||origin.version!==share.scenarioVersion||!readable(s,share.grantorId,origin))return 'stale';
 for(const [id,sourceVersion] of Object.entries(share.sourceVersions)){const source=s.sources.find(record=>record.id===id);if(!source||source.version!==sourceVersion||!readable(s,share.grantorId,source))return 'stale'}
 for(const [id,factVersion] of Object.entries(share.factVersions)){const fact=s.facts.find(record=>record.id===id);if(!fact||fact.version!==factVersion||!readable(s,share.grantorId,fact))return 'stale'}
 return 'active';
}
export function scenarioShareViews(s:WorkspaceState,a:ActorContext):ScenarioShareView[]{
 const member=membership(s,a),views:ScenarioShareView[]=[];
 for(const share of s.scenarioShares??[]){
  const owner=share.grantorId===a.actorId,status=shareStatus(s,share);
  const origin=owner?s.scenarios.find(record=>record.id===share.scenarioId):undefined;
  if(owner){if(!origin||!canRead(s,a,origin))continue}else{
   if(status!=='active'||!share.recipients.some(recipient=>recipient.actorId===a.actorId&&recipient.membershipVersion===member.version)||member.entityIds&&!member.entityIds.includes(s.entityId))continue;
   // Reading a selected scenario never grants underlying source access.
   if(Object.keys(share.sourceVersions).some(id=>{const source=s.sources.find(record=>record.id===id);return !source||!canRead(s,a,source)}))continue;
   if(Object.keys(share.factVersions).some(id=>{const fact=s.facts.find(record=>record.id===id);return !fact||!canRead(s,a,fact)}))continue;
   if(member.matterIds&&(!share.scope.matterId||!member.matterIds.includes(share.scope.matterId)))continue;
  }
  views.push({id:share.id,version:share.version,title:share.title,assumptions:structuredClone(share.assumptions),questions:structuredClone(share.questions),grantorId:share.grantorId,recipientActorIds:share.recipients.map(recipient=>recipient.actorId),snapshotHash:share.snapshotHash,validUntil:share.validUntil,sharedAt:share.createdAt,status,...(owner?{originScenarioId:share.scenarioId}:{})});
 }
 return views;
}
function delegationStatus(s:WorkspaceState,d:RoutingDelegation):RoutingDelegationView['status']{
 if(d.revokedAt)return 'revoked';if(!Number.isFinite(Date.parse(d.validUntil))||Date.parse(d.validUntil)<=Date.now())return 'expired';
 const grantor=activeMember(s,d.grantorId),recipient=activeMember(s,d.recipientActorId),matter=s.matters.find(record=>record.id===d.matterId);
 if(!grantor||!recipient||grantor.version!==d.grantorMembershipVersion||recipient.version!==d.recipientMembershipVersion||!grantor.roles.includes('business_owner')||!matter||['closed','canceled'].includes(matter.state)||!readable(s,d.grantorId,matter)||!readable(s,d.recipientActorId,matter)||d.topics.some(topic=>!Object.hasOwn(topicRole,topic)||!recipient.roles.includes(topicRole[topic])))return 'ineligible';
 return d.acceptedAt?'accepted':'offered';
}
export function routingDelegationViews(s:WorkspaceState,a:ActorContext):RoutingDelegationView[]{membership(s,a);return (s.routingDelegations??[]).filter(d=>{const matter=s.matters.find(record=>record.id===d.matterId);return matter&&canRead(s,a,matter)&&(d.grantorId===a.actorId||d.recipientActorId===a.actorId)}).map(d=>({...structuredClone(d),status:delegationStatus(s,d)}))}
function ruleEffective(s:WorkspaceState,rule:RoutingRule){const delegation=s.routingDelegations?.find(record=>record.id===rule.delegationId);return !!rule.active&&!!delegation&&delegationStatus(s,delegation)==='accepted'&&delegation.topics.includes(rule.topic)}
export function routingRuleViews(s:WorkspaceState,a:ActorContext):RoutingRuleView[]{membership(s,a);return (s.routingRules??[]).filter(rule=>{const matter=s.matters.find(record=>record.id===rule.matterId);return matter&&canRead(s,a,matter)}).map(rule=>({...structuredClone(rule),effective:ruleEffective(s,rule)}))}
/** Derive current ownership at use time; expiry restores the recorded base owner. */
export function routedTaskOwner(s:WorkspaceState,matter:Matter,task:MatterTask){if(task.status==='done')return task.ownerId;const rule=[...(s.routingRules??[])].reverse().find(rule=>rule.matterId===matter.id&&topicTask[rule.topic]===task.kind&&ruleEffective(s,rule));const delegation=rule&&s.routingDelegations?.find(record=>record.id===rule.delegationId);return delegation?.recipientActorId??task.ownerId}
export function routedMatterViews(s:WorkspaceState,matters:Matter[]):Matter[]{return matters.map(matter=>({...matter,tasks:matter.tasks.map(task=>({...task,ownerId:routedTaskOwner(s,matter,task)}))}))}

export function applyCollaborationCommand(s:WorkspaceState,a:ActorContext,c:CollaborationCommand):Record<string,unknown>{
 const member=membership(s,a);s.scenarioShares??=[];s.routingDelegations??=[];s.routingRules??=[];
 if(c.type==='scenario.share'){
  const origin=readRecord(s,a,s.scenarios,c.scenarioId),conversation=readRecord(s,a,s.conversations,origin.conversationId);version(origin,c.expectedRecordVersion);
  ensure(origin.provenance.actorId===a.actorId&&conversation.provenance.actorId===a.actorId,'SHARING_OWNER_REQUIRED','Only the originating conversation owner can share a selected scenario snapshot.',403);
  ensure(origin.status==='exploring','SCENARIO_NOT_EXPLORING','Share only a current exploratory scenario; adopted work has its own review scope.');
  ensure(Array.isArray(c.assumptionIndexes)&&c.assumptionIndexes.length>0&&c.assumptionIndexes.length<=30&&new Set(c.assumptionIndexes).size===c.assumptionIndexes.length&&c.assumptionIndexes.every(index=>Number.isSafeInteger(index)&&index>=0&&index<origin.assumptions.length),'INVALID_SELECTION','Select exact current scenario assumptions.',400);
  ensure(typeof c.includeQuestions==='boolean','INVALID_SELECTION','Choose whether the displayed open questions are included.',400);
  ensure(Array.isArray(c.recipientActorIds)&&c.recipientActorIds.length>0&&c.recipientActorIds.length<=20&&new Set(c.recipientActorIds).size===c.recipientActorIds.length,'INVALID_RECIPIENTS','Name one to twenty distinct current workspace recipients.',400);
  const sources=[...new Set([...origin.provenance.sourceIds,...conversation.provenance.sourceIds])].map(id=>readRecord(s,a,s.sources,id));
  const facts=[...new Set([...(origin.provenance.factIds??[]),...(conversation.provenance.factIds??[])])].map(id=>readRecord(s,a,s.facts,id));
  const recipients=c.recipientActorIds.map(id=>{const recipient=activeMember(s,id);ensure(typeof id==='string'&&id!==a.actorId&&recipient,'RECIPIENT_UNAVAILABLE','Select another provisioned current workspace member.',404);ensure((!recipient.entityIds||recipient.entityIds.includes(s.entityId))&&(!recipient.matterIds||!!origin.scope.matterId&&recipient.matterIds.includes(origin.scope.matterId)),'RECIPIENT_SCOPE','The recipient does not have the required entity/matter scope.',403);ensure(sources.every(source=>readable(s,id,source))&&facts.every(fact=>readable(s,id,fact)),'SOURCE_SHARING_DENIED','A selected scenario depends on evidence outside this recipient’s access. Share a permitted independent scenario instead.',403);return {actorId:id,membershipVersion:recipient.version}});
  const selected=c.assumptionIndexes.map(index=>origin.assumptions[index]),questions=c.includeQuestions?[...origin.questions]:[],title=text(c.title,'a shared snapshot title',300),validUntil=future(c.validUntil);
  const record:ScenarioShare={...base(s,a,{kind:'team',actorIds:[a.actorId,...c.recipientActorIds],...(origin.scope.matterId?{matterId:origin.scope.matterId}:{})},sources.map(source=>source.id)),scenarioId:origin.id,scenarioVersion:origin.version,grantorId:a.actorId,grantorMembershipVersion:member.version,recipients,title,assumptions:selected,questions,snapshotHash:digest({title,assumptions:selected,questions,recipientActorIds:c.recipientActorIds,validUntil,scenarioVersion:origin.version}),validUntil,revokedAt:null,sourceVersions:Object.fromEntries(sources.map(source=>[source.id,source.version])),factVersions:Object.fromEntries(facts.map(fact=>[fact.id,fact.version]))};record.provenance.factIds=facts.map(fact=>fact.id);s.scenarioShares.push(record);
  // Audit is private to the grantor: no origin reference enters recipients' event history.
  event(s,a,{...record,scope:{kind:'private',actorIds:[a.actorId]}},c.type,'Selected scenario snapshot shared');return {shareId:record.id,snapshotHash:record.snapshotHash};
 }
 if(c.type==='scenario.share_revoke'){
  const record=s.scenarioShares.find(record=>record.id===c.shareId&&record.grantorId===a.actorId);ensure(record,'NOT_FOUND','This sharing decision is unavailable.',404);version(record,c.expectedRecordVersion);text(c.reason,'the withdrawal reason');record.revokedAt=timestamp();touch(record);event(s,a,{...record,scope:{kind:'private',actorIds:[a.actorId]}},c.type,'Scenario sharing withdrawn');return {shareId:record.id};
 }
 if(c.type==='conversation.link_matter'){
  const conversation=readRecord(s,a,s.conversations,c.conversationId),matter=readRecord(s,a,s.matters,c.matterId);requireRole(s,a,'business_owner',matter);version(conversation,c.expectedConversationVersion);version(matter,c.expectedMatterVersion);
  ensure(matter.ownerId===a.actorId,'MATTER_OWNER_REQUIRED','The named matter owner must link this conversation to existing work.',403);
  ensure(!['closed','canceled'].includes(matter.state)&&!matter.legacyWorkflowId,'MATTER_TERMINAL','Choose current v2 work.');ensure(!conversation.matterId||conversation.matterId===matter.id,'CONVERSATION_ALREADY_LINKED','This conversation already belongs to other work.');
  ensure(digest(conversation.scope)===digest(matter.scope),'LINK_SCOPE_MISMATCH','Conversation and matter visibility must match exactly. A private conversation cannot be linked into broader work.',403);
  conversation.matterId=matter.id;if(!matter.conversationIds.includes(conversation.id))matter.conversationIds.push(conversation.id);touch(conversation);touch(matter);event(s,a,matter,c.type,'Conversation linked to existing work',matter.id);return {conversationId:conversation.id,matterId:matter.id};
 }
 if(c.type==='delegation.offer'){
  const matter=readRecord(s,a,s.matters,c.matterId);const grantor=requireRole(s,a,'business_owner',matter);version(matter,c.expectedMatterVersion);ensure(!['closed','canceled'].includes(matter.state)&&!matter.legacyWorkflowId,'MATTER_TERMINAL','Choose current v2 work.');
  ensure(Array.isArray(c.topics)&&c.topics.length>0&&c.topics.length<=3&&new Set(c.topics).size===c.topics.length&&c.topics.every(topic=>Object.hasOwn(topicRole,topic)),'INVALID_ROUTING_TOPIC','Choose bounded factual, business or legal question routing.',400);
  const recipient=activeMember(s,c.recipientActorId);ensure(recipient&&c.recipientActorId!==a.actorId&&readable(s,c.recipientActorId,matter),'RECIPIENT_UNAVAILABLE','The recipient must already have current access to this matter.',404);ensure(c.topics.every(topic=>recipient.roles.includes(topicRole[topic])),'RECIPIENT_CAPACITY','The recipient must already hold each required capacity. A delegation cannot grant authority.',403);
  const delegation:RoutingDelegation={...base(s,a,matter.scope,matter.provenance.sourceIds),matterId:matter.id,grantorId:a.actorId,recipientActorId:c.recipientActorId,grantorMembershipVersion:grantor.version,recipientMembershipVersion:recipient.version,topics:[...c.topics],validUntil:future(c.validUntil),acceptedAt:null,revokedAt:null,revocationReason:null};s.routingDelegations.push(delegation);event(s,a,delegation,c.type,'Bounded routing delegation offered',matter.id);return {delegationId:delegation.id};
 }
 if(c.type==='routing.clear'){
  const rule=readRecord(s,a,s.routingRules,c.ruleId);requireRole(s,a,'business_owner',rule);version(rule,c.expectedRecordVersion);ensure(rule.ownerId===a.actorId,'ROUTING_OWNER_REQUIRED','Only the owner of this routing decision may clear it.',403);text(c.reason,'the routing withdrawal reason');rule.active=false;touch(rule);event(s,a,rule,c.type,'Question routing cleared',rule.matterId);return {ruleId:rule.id};
 }
 const delegation=readRecord(s,a,s.routingDelegations,c.delegationId);version(delegation,c.expectedRecordVersion);
 if(c.type==='delegation.revoke'){ensure([delegation.grantorId,delegation.recipientActorId].includes(a.actorId),'DELEGATION_PARTY_REQUIRED','Only a party to this delegation can withdraw it.',403);delegation.revocationReason=text(c.reason,'the delegation withdrawal reason');delegation.revokedAt=timestamp();touch(delegation);event(s,a,delegation,c.type,'Routing delegation withdrawn',delegation.matterId);return {delegationId:delegation.id};}
 if(c.type==='delegation.accept'){ensure(delegation.recipientActorId===a.actorId,'RECIPIENT_ACCEPTANCE_REQUIRED','The named recipient must accept this exact delegation.',403);ensure(delegationStatus(s,delegation)==='offered','DELEGATION_INELIGIBLE','This delegation is expired, withdrawn, accepted or its access/capacity changed.');delegation.acceptedAt=timestamp();touch(delegation);event(s,a,delegation,c.type,'Bounded routing delegation accepted',delegation.matterId);return {delegationId:delegation.id};}
 requireRole(s,a,'business_owner',delegation);ensure(delegation.grantorId===a.actorId,'ROUTING_OWNER_REQUIRED','The grantor must choose this routing rule.',403);ensure(delegationStatus(s,delegation)==='accepted'&&delegation.topics.includes(c.topic),'DELEGATION_REQUIRED','Choose an accepted current delegation covering this question type.');
 for(const old of s.routingRules.filter(rule=>rule.matterId===delegation.matterId&&rule.topic===c.topic&&rule.active)){old.active=false;touch(old)}
 const rule:RoutingRule={...base(s,a,delegation.scope,delegation.provenance.sourceIds),matterId:delegation.matterId,delegationId:delegation.id,topic:c.topic,ownerId:a.actorId,active:true};s.routingRules.push(rule);event(s,a,rule,c.type,'Question routing applied',rule.matterId);return {ruleId:rule.id};
}
