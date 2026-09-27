import {canRead,readRecord,requireRole} from '../authority';
import {V2Error,type Action,type ActorContext,type Approval,type DependencySnapshot,type Proposal,type Role,type WorkspaceState} from '../contracts';
import {digest} from '../store';
import {procedureAssessment} from '../procedures';
import {assertObligationsReady} from '../obligations';
import {assertProposalInventory} from '../inventory';
import {standingPolicyCurrent} from '../drafting';
import {factCurrentlyConfirmed} from '../fact-validity';
import {currentEvidenceLineage} from '../source-lifecycle';
const ensure=(ok:unknown,code:string,message:string)=>{if(!ok)throw new V2Error(code,message);};
const capacityRole:Record<Approval['capacity'],Role>={business:'business_owner',legal:'legal_reviewer',sharing:'business_owner',publication:'publisher',signature:'signatory',no_action:'business_owner'};
export function actionContentHash(action:Action){return digest({content:action.content,recipients:action.recipients,destination:action.destination,kind:action.kind,proposalId:action.proposalId,title:action.title});}
export function assertDecision(s:WorkspaceState,approval:Approval,p:Proposal){
 const member=s.memberships.find(m=>m.actorId===approval.actorId),actor:ActorContext={tenantId:s.tenantId,actorId:approval.actorId,mode:'authenticated',expiresAt:Date.now()+60000};
 ensure(approval.status==='active'&&Date.parse(approval.validUntil)>Date.now()&&approval.conditions.length===0&&member&&!member.revokedAt&&(!member.expiresAt||Date.parse(member.expiresAt)>Date.now())&&member.version===approval.membershipVersion&&member.roles.includes(capacityRole[approval.capacity]),'AUTHORIZATION_EXPIRED','The authorizing role, conditions or expiry no longer permit this action.');
 ensure(approval.proposalId===p.id&&approval.proposalHash===p.contentHash&&digest(approval.dependencies)===digest(p.dependencies)&&canRead(s,actor,p),'AUTHORIZATION_CHANGED','The authorizing decision no longer matches eligible evidence.');
}
/** Shared checks run again in the final dispatch transaction, after all asynchronous preparation. */
export function assertExecutable(s:WorkspaceState,actor:ActorContext,action:Action){
 requireRole(s,actor,action.kind==='signature_request'?'signatory':action.kind==='no_action'?'business_owner':'publisher',action);
 const matter=readRecord(s,actor,s.matters,action.matterId),p=readRecord(s,actor,s.proposals,action.proposalId);
 ensure(action.executionOwner==='v2'&&!matter.legacyWorkflowId,'LEGACY_EXECUTION_OWNER','This action belongs to another execution owner.');
 ensure(!['closed','canceled'].includes(matter.state),'MATTER_TERMINAL','Canceled or closed work cannot dispatch new effects.');
 ensure(procedureAssessment(s,actor,matter).blockers.length===0,'PROCEDURE_REQUIREMENTS_PENDING','An applicable approved procedure requires current evidence or owner review.');
 assertObligationsReady(s,actor,matter.id);
 assertProposalInventory(s,p);
 ensure(currentEvidenceLineage(s,p)&&currentEvidenceLineage(s,action),'SOURCE_OBSERVATION_STALE','The action depends on historical, conflicting or withdrawn provider evidence.');
 ensure(p.route!=='standing_policy'||standingPolicyCurrent(s,actor,p)&&action.kind==='internal_document'&&action.recipients.length===0&&action.destination===null,'STANDING_POLICY_CHANGED','Only an unchanged approved template can use the internal standing route.');
 ensure(p.matterId===matter.id&&matter.proposalId===p.id&&p.status==='current'&&p.contentHash===digest(p.body)&&action.content===p.body&&action.contentHash===actionContentHash(action),'STALE_ACTION','The exact action or proposal bytes changed.');
 const sources=matter.sourceIds.map(id=>readRecord(s,actor,s.sources,id)),facts=matter.factIds.map(id=>readRecord(s,actor,s.facts,id)),docs=matter.documentIds.map(id=>readRecord(s,actor,s.documents,id));
 ensure(facts.every(f=>factCurrentlyConfirmed(f)&&currentEvidenceLineage(s,f)),'FACTS_CHANGED','Current confirmed facts are required.');
 ensure(matter.tasks.filter(t=>t.kind==='fact'&&t.requiredFactPredicates!==undefined).every(t=>t.requiredFactPredicates!.length>0&&t.requiredFactPredicates!.every(predicate=>facts.some(f=>f.predicate===predicate&&factCurrentlyConfirmed(f)))),'PLAN_FACTS_PENDING','The accepted work plan requires its explicitly named current facts.');
 const current:DependencySnapshot={sourceVersions:Object.fromEntries(sources.map(x=>[x.id,x.version])),factVersions:Object.fromEntries(facts.map(x=>[x.id,x.version])),documentHashes:Object.fromEntries(docs.map(x=>[x.id,x.contentHash])),policyVersion:s.ruleVersion,scopeHash:digest(matter.scope)};
 ensure(digest(current)===digest(p.dependencies),'DEPENDENCIES_CHANGED','Source, fact, document, scope or procedure versions changed.');
 for(const capacity of (p.route==='standing_policy'?['business']:['business','legal']) as ('business'|'legal')[]){const valid=s.approvals.filter(a=>a.proposalId===p.id&&a.capacity===capacity).some(a=>{try{assertDecision(s,a,p);return true;}catch{return false;}});ensure(valid,'REVIEW_REQUIRED','Current business and legal decisions are required immediately before dispatch.');}
 const authorization=s.approvals.find(a=>a.id===action.authorizationId);ensure(authorization,'ACTION_AUTHORIZATION_REQUIRED','Authorize the exact action before dispatch.');const approval=authorization!;assertDecision(s,approval,p);
 ensure(approval.actionId===action.id&&approval.actionHash===action.contentHash&&approval.capacity===(action.kind==='signature_request'?'signature':action.kind==='no_action'?'no_action':'publication')&&digest(approval.recipients)===digest(action.recipients)&&approval.destination===action.destination,'ACTION_AUTHORIZATION_CHANGED','The approval does not match the exact action, recipients and destination.');
 return {matter,proposal:p,authorization:approval};
}
