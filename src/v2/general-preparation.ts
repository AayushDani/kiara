import {randomUUID} from 'node:crypto';
import {canRead,readRecord,requireRole} from './authority';
import {currentEvidenceLineage} from './source-lifecycle';
import {documentHeads} from './document-lifecycle';
import {factCurrentlyConfirmed} from './fact-validity';
import {currentInventory,inventoryBinding} from './inventory';
import {applicabilityMatrix} from './applicability';
import {procedureAssessment} from './procedures';
import {withinConversationAudience} from './retrieval';
import {resetReviewTasks} from './tasks';
import {setActionTaskStatus} from './execution/action-tasks';
import {scopeAudienceHash} from './integrations/slack-scope';
import {digest,timestamp} from './store';
import {V2Error,type ActorContext,type Conversation,type Matter,type Proposal,type WorkspaceState} from './contracts';
import type {DraftRequest} from './drafting';
import type {MatterPreparationBasis} from './matter-preparation';
export const OBJECTIVE_PREPARATION_INSTRUCTION='Prepare a concrete proposed review artifact for this owner-requested matter objective and its exact current tasks. The objective and scenario assumptions are instructions for work, not evidence that a practice is live or legally required. Propose bounded objective-specific factual, business and specialist-review tasks, alternatives and open decisions. Use only current evidence within this exact audience; identify missing agreements, applicability and legal coverage. Do not substitute a generic notice or data-flow checklist. No task, legal decision or external action is completed by this preparation. The owner must inspect and accept the exact artifact before it becomes a matter proposal.';

/** A human owner can request preparation from a matter objective without first accepting a model plan. */
export function buildGeneralMatterPreparation(s:WorkspaceState,a:ActorContext,m:Matter,c:Conversation):DraftRequest {
 requireRole(s,a,'business_owner',m);
 if(m.legacyWorkflowId||['closed','canceled'].includes(m.state))throw new V2Error('MATTER_TERMINAL','This matter cannot accept new preparation.');
 if(s.actions.some(x=>x.matterId===m.id&&['dispatching','uncertain','verifying'].includes(x.status)))throw new V2Error('RECONCILIATION_REQUIRED','Resolve outstanding effects before preparing a replacement packet.');
 if(c.matterId!==m.id||!m.conversationIds.includes(c.id)||scopeAudienceHash(c.scope)!==scopeAudienceHash(m.scope)||!canRead(s,a,c)||!currentEvidenceLineage(s,c)||!currentEvidenceLineage(s,m))throw new V2Error('MATTER_CONTEXT_CHANGED','Select a current conversation with the exact matter audience.');
 for(const id of m.sourceIds){const source=readRecord(s,a,s.sources,id);if(scopeAudienceHash(source.scope)!==scopeAudienceHash(m.scope)||!currentEvidenceLineage(s,source))throw new V2Error('MATTER_CONTEXT_CHANGED','Event and source evidence must have the exact matter audience.');}
 let scenarioHash:string|null=null;
 if(m.scenarioId){const scenario=readRecord(s,a,s.scenarios,m.scenarioId);if(scenario.conversationId!==c.id||scenario.adoptedMatterId!==m.id||scopeAudienceHash(scenario.scope)!==scopeAudienceHash(m.scope)||!currentEvidenceLineage(s,scenario))throw new V2Error('MATTER_CONTEXT_CHANGED','The adopted scenario changed or left this audience.');scenarioHash=digest(scenario);}
 if(!m.tasks.some(t=>t.kind==='business'&&t.purpose==='artifact_review')){m.tasks.push({id:randomUUID(),title:'Review the prepared artifact against the stated objective',kind:'business',purpose:'artifact_review',ownerId:m.ownerId,status:'pending',dueAt:null,deadlineType:'undated',evidenceIds:[]});m.version++;m.updatedAt=timestamp();}
 const basis:MatterPreparationBasis={route:'matter_objective',matterId:m.id,matterVersion:m.version,matterHash:digest(m),planId:'',planHash:'',conversationId:c.id,scenarioId:m.scenarioId,scenarioHash,objective:m.objective,tasks:structuredClone(m.tasks),ruleVersion:s.ruleVersion};
 return {kind:'matter_packet',matter:basis,instruction:OBJECTIVE_PREPARATION_INSTRUCTION,baseRevisionId:null,baseHash:null,templateApprovalId:null,templateApprovalHash:null,fieldFactIds:{},factHashes:{},missingFields:[],amendment:false};
}

/** Explicit local fallback: structure the owner's objective and scoped records without pretending to plan or interpret law. */
export function prepareLocalObjectivePacket(s:WorkspaceState,a:ActorContext,m:Matter):Proposal {
 requireRole(s,a,'business_owner',m);
 if(m.legacyWorkflowId||['closed','canceled'].includes(m.state))throw new V2Error('MATTER_TERMINAL','This matter cannot accept new preparation.');
 if(s.actions.some(x=>x.matterId===m.id&&['dispatching','uncertain','verifying'].includes(x.status)))throw new V2Error('RECONCILIATION_REQUIRED','Resolve outstanding effects before replacing this packet.');
 const audience=scopeAudienceHash(m.scope),same=(scope:{kind:'private'|'team'|'matter';actorIds:string[];matterId?:string})=>scopeAudienceHash(scope)===audience;
 const inAudience=(record:Parameters<typeof withinConversationAudience>[2])=>withinConversationAudience(s,m as unknown as Conversation,record);
 const documents=documentHeads(s.documents).filter(d=>same(d.scope)&&inAudience(d)&&canRead(s,a,d)&&currentEvidenceLineage(s,d));
 const selectedSources=[...new Set([...documents.map(d=>d.sourceId),...m.sourceIds])].map(id=>readRecord(s,a,s.sources,id));
 if(selectedSources.some(source=>!same(source.scope)||!inAudience(source)||!currentEvidenceLineage(s,source)))throw new V2Error('MATTER_CONTEXT_CHANGED','Related source evidence changed audience or validity.');
 const facts=s.facts.filter(f=>same(f.scope)&&inAudience(f)&&f.entityId===m.entityId&&f.reuse==='company'&&factCurrentlyConfirmed(f)&&canRead(s,a,f)&&currentEvidenceLineage(s,f));
 m.documentIds=documents.map(d=>d.id);m.sourceIds=selectedSources.map(x=>x.id);m.factIds=facts.map(f=>f.id);m.provenance.sourceIds=m.sourceIds;m.provenance.factIds=m.factIds;
 for(const task of m.tasks.filter(t=>t.kind==='fact')){if(task.title==='Confirm the intended business change and factual scope'&&!task.requiredFactPredicates)task.requiredFactPredicates=['business_objective'];const required=task.requiredFactPredicates||[],matched=facts.filter(f=>required.includes(f.predicate)),objectiveFact=facts.find(f=>f.predicate==='business_objective'&&typeof f.value==='string'&&f.value.trim()===m.objective.trim());task.status=required.length&&required.every(predicate=>predicate==='business_objective'?!!objectiveFact:matched.some(f=>f.predicate===predicate))?'done':'pending';task.evidenceIds=task.status==='done'?matched.filter(f=>f.predicate!=='business_objective').map(f=>f.id).concat(objectiveFact?[objectiveFact.id]:[]):[];}
 const procedure=procedureAssessment(s,a,m);for(const lesson of procedure.lessons){(lesson.appliedMatterIds||=[]);if(!lesson.appliedMatterIds.includes(m.id))lesson.appliedMatterIds.push(m.id);}m.ruleVersion=s.ruleVersion;
 const candidateInventory=currentInventory(s,a,m),inventory=candidateInventory&&inAudience(candidateInventory)?candidateInventory:null;if(inventory){m.sourceIds=[...new Set([...m.sourceIds,...inventory.provenance.sourceIds])];m.provenance.sourceIds=m.sourceIds;}
 const matrix=applicabilityMatrix(s,a,m.id,documents);
 const unknowns=['Objective-specific legal and commercial analysis is unavailable in local mode. This is a structured record for human review, not a generated work plan.','Qualified legal domain coverage remains unverified.','The relevance of listed audience facts and documents to this objective remains for the owner to verify.',...(!facts.length?['No current confirmed company facts in this exact audience.']:[]),...(!documents.length?['No current supplied documents in this exact audience.']:[]),...(!inventory?['Agreement inventory completeness has not been attested.']:[]),...matrix.unknowns,...procedure.blockers];
 const lines=['Objective',m.objective,'','Current confirmed facts',facts.length?facts.map(f=>`${f.predicate}: ${JSON.stringify(f.value)} (${f.practice})`).join('\n'):'Facts remain unconfirmed.','','Existing owned work',...m.tasks.map(t=>`• ${t.title} · ${t.kind} · ${t.status}`),'','Options and remedies for owner review','Identify the available business, product/process, contractual and no-action options for this objective. No option is selected by this packet.','','Supplied agreement register',inventory?`Named human attestation by ${inventory.ownerId} covers ${inventory.documentIds.length} current agreement/amendment heads for: ${inventory.scopeDescription}. Expires ${inventory.validUntil}; external discovery remains unverified.`:'Completeness remains unverified.','','Per-agreement applicability',...matrix.rows.map(row=>`• ${row.title} · ${row.assessment||'review_required'} · ${row.clause}`),'','Open questions',...unknowns.map(x=>`• ${x}`),'','Local structured packet only. No legal clearance, deployment proof, approval, publication or external effect is claimed.'];
 const body=lines.join('\n'),now=timestamp();
 const p:Proposal={id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(m.scope),provenance:{actorId:a.actorId,sourceIds:[...new Set([...m.sourceIds,...(matrix.assessment?.provenance.sourceIds||[])])],factIds:m.factIds,description:'Owner-requested local structured packet from exact audience records; no semantic planning or legal clearance.'},matterId:m.id,title:`Review packet · ${m.title}`,body,contentHash:digest(body),baselineRevisionIds:m.documentIds,dependencies:{sourceVersions:Object.fromEntries(m.sourceIds.map(id=>[id,s.sources.find(x=>x.id===id)!.version])),factVersions:Object.fromEntries(facts.map(f=>[f.id,f.version])),documentHashes:Object.fromEntries(documents.map(d=>[d.id,d.contentHash])),policyVersion:s.ruleVersion,scopeHash:digest(m.scope)},status:'current',route:'legal_review',noticeMatrix:matrix.rows,inventoryComplete:!!inventory,...(inventory?{inventory:inventoryBinding(inventory)}:{}),...(matrix.binding?{applicability:matrix.binding}:{}),unknowns,supersedesId:m.proposalId};
 if(m.proposalId){const old=s.proposals.find(x=>x.id===m.proposalId);if(old){old.status='superseded';old.version++;old.updatedAt=now;}for(const approval of s.approvals.filter(x=>x.proposalId===m.proposalId&&x.status==='active')){approval.status='invalidated';approval.version++;approval.updatedAt=now;}for(const action of s.actions.filter(x=>x.proposalId===m.proposalId&&!['verified','uncertain','dispatching','verifying','canceled'].includes(x.status))){action.status='planned';action.authorizationId=null;action.version++;action.updatedAt=now;setActionTaskStatus(m,action,'blocked');}}
 s.proposals.push(p);m.proposalId=p.id;resetReviewTasks(s,m,p);m.state=procedure.blockers.length?'needs_facts':'business_review';m.blockers=[...procedure.blockers,'Business decision and qualified legal review remain pending.'];m.version++;m.updatedAt=now;return p;
}
