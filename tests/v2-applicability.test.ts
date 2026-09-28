import test from 'node:test';
import assert from 'node:assert/strict';
import {applyApplicabilityCommand,applicabilityCurrent,applicabilityViews} from '../src/v2/applicability';
import {applyCompanyMemoryCommand} from '../src/v2/company-memory';
import {applyInventoryCommand} from '../src/v2/inventory';
import {digest,emptyWorkspace,timestamp} from '../src/v2/store';
import {closeV2Store,readWorkspace} from '../src/v2/store';
import {command,snapshot} from '../src/v2/service';
import {normalizeWorkspace,hydrateWorkspace} from '../src/v2/normalized-store';
import {redactedRecord} from '../src/v2/retention';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ActorContext,DocumentRecord,FactAssertion,Matter,RecordBase,Scope,Source,WorkspaceCommand} from '../src/v2/contracts';

const audience:Scope={kind:'team',actorIds:[]};
const notice={trigger:'Adding a new subprocessor for customer personal data',recipients:['Acme privacy contact'],channel:'Written notice',timing:'At least 30 days before the addition'};
function fixture(){
 const state=emptyWorkspace('applicability-synthetic'),owner:ActorContext={tenantId:state.tenantId,actorId:'owner',mode:'local_demo',expiresAt:Date.now()+3600000},lawyer={...owner,actorId:'lawyer'};
 state.memberships=[{actorId:'owner',roles:['member','fact_owner','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null},{actorId:'lawyer',roles:['member','legal_reviewer'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null}];
 const base=(id:string,sourceIds:string[]=[]):RecordBase=>({id,tenantId:state.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:audience,provenance:{actorId:'owner',sourceIds,description:'Synthetic exact register fixture'}});
 const body='New subprocessors require 30 days prior notice. Synthetic test data is excluded.';
 const source:Source={...base('source'),title:'Executed customer agreement',kind:'manual',externalId:null,externalRevision:null,text:body,contentHash:digest(body),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'executed',originalObjectRef:null};state.sources.push(source);
 const document:DocumentRecord={...base('agreement',[source.id]),documentId:'agreement',title:'Executed customer agreement',body,contentHash:digest(body),authority:'executed',sourceId:source.id,revision:1,parentRevisionId:null,amendsDocumentId:null,status:'current',kind:'agreement'};state.documents.push(document);
 const counterpartyId=String(applyCompanyMemoryCommand(state,owner,{type:'memory.entity.declare',kind:'counterparty',name:'Acme',aliases:[],ownerId:'owner',scope:audience}).entityId);
 const fact:FactAssertion={...base('target-fact',[source.id]),entityId:state.entityId,predicate:'proposed_subprocessor',value:'New transcript vendor',status:'confirmed',practice:'planned',ownerId:'owner',observedAt:timestamp(),validFrom:null,validUntil:null,confirmedBy:'owner',confirmedAt:timestamp(),supersedesId:null,originVersion:state.version,reuse:'company',conversationId:null};state.facts.push(fact);
 const matter:Matter={...base('matter',[source.id]),title:'Subprocessor notice review',objective:'Determine obligations for the proposed new subprocessor',entityId:state.entityId,state:'legal_review',ownerId:'owner',conversationIds:[],scenarioId:null,eventIds:[],sourceIds:[source.id],factIds:[fact.id],documentIds:[document.id],proposalId:null,tasks:[],blockers:[],outcome:null,closedAt:null,ruleVersion:1};state.matters.push(matter);
 const inventoryId=String(applyInventoryCommand(state,owner,{type:'inventory.attest',matterId:matter.id,expectedMatterVersion:matter.version,title:'Supplied customer register',scopeDescription:'All current agreement heads supplied for this synthetic customer population.',documentIds:[document.id],sourceIds:[source.id],validUntil:new Date(Date.now()+3600000).toISOString()}).inventoryId);
 const clause={start:0,end:43,quote:body.slice(0,43)};
 const target={transaction:matter.objective,jurisdiction:'California',counterpartyEntityId:counterpartyId,productEntityIds:[],factIds:[fact.id]};
 const record=(assessment:'notice_required'|'no_notice'|'unknown',selectedClause:typeof clause|null=clause)=>String(applyApplicabilityCommand(state,lawyer,{type:'applicability.record',inspectedVersion:state.version,inventoryId,target,rows:[{documentId:document.id,assessment,clause:selectedClause,reason:'Exact supplied contract wording reviewed for the stated proposed change.',...(assessment==='notice_required'?{notice}:{})}]}).assessmentId);
 return {state,owner,lawyer,source,document,matter,fact,counterpartyId,target,inventoryId,clause,record};
}
test('a named legal reviewer must assess every supplied agreement against exact wording',()=>{
 const f=fixture();assert.throws(()=>applyApplicabilityCommand(f.state,f.owner,{type:'applicability.record',inspectedVersion:f.state.version,inventoryId:f.inventoryId,target:f.target,rows:[{documentId:f.document.id,assessment:'notice_required',clause:f.clause,reason:'Review'}]}),/legal reviewer/);
 assert.throws(()=>applyApplicabilityCommand(f.state,f.lawyer,{type:'applicability.record',inspectedVersion:f.state.version,inventoryId:f.inventoryId,target:f.target,rows:[]}),/every agreement and amendment/);
 assert.throws(()=>applyApplicabilityCommand(f.state,f.lawyer,{type:'applicability.record',inspectedVersion:f.state.version,inventoryId:f.inventoryId,target:f.target,rows:[null] as never}),/every agreement and amendment/);
 assert.throws(()=>applyApplicabilityCommand(f.state,f.lawyer,{type:'applicability.record',inspectedVersion:f.state.version,inventoryId:f.inventoryId,target:f.target,rows:[{documentId:f.document.id,assessment:'notice_required',clause:{start:0,end:4,quote:null} as never,reason:'Review'}]}),/exact clause/);
 assert.throws(()=>applyApplicabilityCommand(f.state,f.lawyer,{type:'applicability.record',inspectedVersion:f.state.version,inventoryId:f.inventoryId,target:f.target,rows:[{documentId:f.document.id,assessment:'notice_required',clause:f.clause,reason:'Review'}]}),/trigger, recipients, channel and timing/);
 assert.throws(()=>applyApplicabilityCommand(f.state,f.lawyer,{type:'applicability.record',inspectedVersion:f.state.version,inventoryId:f.inventoryId,target:f.target,rows:[{documentId:f.document.id,assessment:'notice_required',clause:f.clause,reason:'Review',notice:{...notice,recipients:['Acme Legal',' Acme Legal ']}}]}),/distinct recipient descriptions/);
 const id=f.record('notice_required'),item=f.state.applicabilityAssessments![0];assert.equal(id,item.id);assert.equal(applicabilityCurrent(f.state,f.lawyer,item),true);assert.equal(applicabilityViews(f.state,f.owner)[0].rows[0].clause?.quote,f.clause.quote);
});
test('drafts and unquoted conclusions stay unresolved; changed evidence or reviewer removes currentness',()=>{
 const f=fixture();assert.throws(()=>applyApplicabilityCommand(f.state,f.lawyer,{type:'applicability.record',inspectedVersion:f.state.version,inventoryId:f.inventoryId,target:f.target,rows:[{documentId:f.document.id,assessment:'no_notice',clause:{start:0,end:7,quote:'wrong'},reason:'Review'}]}),/exact clause/);
 f.document.authority='draft';assert.throws(()=>f.record('no_notice'),/supplied agreement register is no longer current/);f.document.authority='executed';
 f.record('unknown',null);const item=f.state.applicabilityAssessments![0];assert.equal(item.rows[0].assessment,'unknown');assert.equal(applicabilityCurrent(f.state,f.owner,item),true);
 f.state.memberships.find(member=>member.actorId==='lawyer')!.version++;assert.equal(applicabilityCurrent(f.state,f.owner,item),false);f.state.memberships.find(member=>member.actorId==='lawyer')!.version--;
 f.source.status='revoked';assert.equal(applicabilityCurrent(f.state,f.owner,item),false);
});
test('later agreement revision and explicit withdrawal invalidate reuse',()=>{
 const f=fixture();f.record('notice_required');const item=f.state.applicabilityAssessments![0];f.document.body+=' New amendment.';assert.equal(applicabilityCurrent(f.state,f.owner,item),false);f.document.body=f.source.text;
 applyApplicabilityCommand(f.state,f.lawyer,{type:'applicability.withdraw',assessmentId:item.id,expectedRecordVersion:item.version,reason:'Fresh amendment requires new review.'});assert.equal(applicabilityCurrent(f.state,f.owner,item),false);
});
test('withdrawal of a later review never resurrects an earlier matrix',()=>{
 const f=fixture();f.record('notice_required');const first=f.state.applicabilityAssessments![0];f.record('unknown',null);const later=f.state.applicabilityAssessments![1];assert.equal(applicabilityCurrent(f.state,f.owner,first),false);
 applyApplicabilityCommand(f.state,f.lawyer,{type:'applicability.withdraw',assessmentId:later.id,expectedRecordVersion:later.version,reason:'Withdraw this unresolved review; new legal review is required.'});
 assert.equal(applicabilityCurrent(f.state,f.owner,first),false);assert.equal(applicabilityCurrent(f.state,f.owner,later),false);
});
test('a changed target fact or matter population stales a no-notice legal conclusion',()=>{
 const f=fixture();f.record('no_notice');const item=f.state.applicabilityAssessments![0];assert.equal(applicabilityCurrent(f.state,f.owner,item),true);
 f.fact.value='Different vendor and data flow';assert.equal(applicabilityCurrent(f.state,f.owner,item),false,'exact selected fact content is bound');f.fact.value='New transcript vendor';
 f.matter.factIds=[];assert.equal(applicabilityCurrent(f.state,f.owner,item),false,'the matter factual population is bound');f.matter.factIds=[f.fact.id];
 f.matter.objective='Different transaction';assert.equal(applicabilityCurrent(f.state,f.owner,item),false,'the target transaction is bound');
});
test('a team assessment refuses a fact with a transitive private source',()=>{
 const f=fixture(),privateSource:Source={...f.source,id:'lawyer-private-evidence',scope:{kind:'private',actorIds:['lawyer']},provenance:{actorId:'lawyer',sourceIds:[],description:'Private review note'},title:'Private reviewer note'};f.state.sources.push(privateSource);f.fact.provenance.sourceIds.push(privateSource.id);
 assert.throws(()=>f.record('unknown',null),/same-audience dependencies/);
});
test('typed command, scoped snapshot, local restart, normalized storage and deletion retain only eligible assessment',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kiara-applicability-integration-')),old=process.env.KIARA_V2_DATA_DIR,mode=process.env.KIARA_V2_AI_MODE;
 process.env.KIARA_V2_DATA_DIR=dir;process.env.KIARA_V2_AI_MODE='local';
 const owner:ActorContext={tenantId:'applicability-integration',actorId:'owner',mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','fact_owner','business_owner','admin']},reviewer:ActorContext={...owner,actorId:'reviewer',bootstrapRoles:['member','legal_reviewer']},other:ActorContext={...owner,tenantId:'other-tenant'};
 const send=async(actor:ActorContext,value:WorkspaceCommand)=>command(actor,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(actor)).version,command:value});
 try{
  await snapshot(reviewer);const doc=await send(owner,{type:'document.add',title:'Exact Acme agreement',body:'Customer notice requires 30 days.',kind:'agreement',authority:'executed'}),matter=await send(owner,{type:'matter.create',title:'Notice review',objective:'Assess the proposed change'}),m=matter.snapshot.matters[0],candidate=matter.snapshot.inventoryCandidates[0];
  const declared=await send(owner,{type:'memory.entity.declare',kind:'counterparty',name:'Acme',aliases:[],ownerId:'owner',scope:audience}),factProposed=await send(owner,{type:'fact.propose',predicate:'business_objective',value:m.objective}),fact=factProposed.snapshot.facts[0];await send(owner,{type:'fact.confirm',factId:fact.id,expectedRecordVersion:fact.version,expectedOriginVersion:fact.originVersion});
  const initial=await send(owner,{type:'matter.prepare',matterId:m.id,expectedRecordVersion:m.version}),currentMatter=initial.snapshot.matters[0];
  const attested=await send(owner,{type:'inventory.attest',matterId:m.id,expectedMatterVersion:currentMatter.version,title:'Supplied Acme register',scopeDescription:'Exact uploaded Acme customer agreements only.',documentIds:candidate.documentIds,sourceIds:[String(doc.result.sourceId)],validUntil:new Date(Date.now()+3600000).toISOString()}),inventory=attested.snapshot.inventories[0],body=doc.snapshot.documents[0].body,target={transaction:m.objective,jurisdiction:'California',counterpartyEntityId:String(declared.result.entityId),productEntityIds:[],factIds:[fact.id]};
  const assessed=await send(reviewer,{type:'applicability.record',inspectedVersion:attested.snapshot.version,inventoryId:inventory.id,target,rows:[{documentId:String(doc.result.documentId),assessment:'notice_required',clause:{start:0,end:body.length,quote:body},reason:'Exact source wording for this proposed change.',notice}]});
  assert.equal(assessed.snapshot.applicabilityAssessments[0].current,true);assert.equal(assessed.snapshot.applicabilityAssessments[0].rows[0].clause?.quote,body);assert.equal((await snapshot(other)).applicabilityAssessments.length,0);
  const prepared=await send(owner,{type:'matter.prepare',matterId:m.id,expectedRecordVersion:currentMatter.version}),proposal=prepared.snapshot.proposals.at(-1)!;assert.equal(proposal.applicability?.id,assessed.snapshot.applicabilityAssessments[0].id);assert.equal(proposal.noticeMatrix[0].assessment,'notice_required');assert.equal(proposal.noticeMatrix[0].clause.includes(body),true);assert.equal(proposal.noticeMatrix[0].documentHash,digest(body));assert.deepEqual(proposal.noticeMatrix[0].notice,notice);assert.equal(prepared.snapshot.applicabilityAssessments[0].current,true,'preparing the proposal must not mutate the matter context that the legal review inspected');assert.deepEqual(prepared.snapshot.matters[0].sourceIds,assessed.snapshot.matters[0].sourceIds);await send(owner,{type:'approval.record',proposalId:proposal.id,proposalHash:proposal.contentHash,capacity:'business',validUntil:new Date(Date.now()+3600000).toISOString()});
  const revised=await send(reviewer,{type:'applicability.record',inspectedVersion:(await snapshot(reviewer)).version,inventoryId:inventory.id,target,rows:[{documentId:String(doc.result.documentId),assessment:'unknown',clause:null,reason:'New legal question requires renewed review.'}]});assert.equal(revised.snapshot.applicabilityAssessments[0].current,false);assert.equal(revised.snapshot.applicabilityAssessments[1].current,true);
  await assert.rejects(()=>send(owner,{type:'approval.record',proposalId:proposal.id,proposalHash:proposal.contentHash,capacity:'business',validUntil:new Date(Date.now()+3600000).toISOString()}),{code:'APPLICABILITY_CHANGED'});
  const withdrawn=await send(reviewer,{type:'applicability.withdraw',assessmentId:revised.snapshot.applicabilityAssessments[1].id,expectedRecordVersion:revised.snapshot.applicabilityAssessments[1].version,reason:'Requires fresh assessment.'});assert.equal(withdrawn.snapshot.applicabilityAssessments[0].current,false);assert.equal(withdrawn.snapshot.applicabilityAssessments[1].current,false);
  await assert.rejects(()=>send(owner,{type:'approval.record',proposalId:proposal.id,proposalHash:proposal.contentHash,capacity:'business',validUntil:new Date(Date.now()+3600000).toISOString()}),{code:'APPLICABILITY_CHANGED'});
  await closeV2Store();assert.equal((await snapshot(owner)).applicabilityAssessments[0].current,false);
  const raw=await readWorkspace(owner.tenantId),normalized=normalizeWorkspace(raw,'assessment-generation');assert.equal(hydrateWorkspace(normalized).applicabilityAssessments?.[0].rows[0].assessment,'notice_required');
  const redacted=redactedRecord('applicabilityAssessments',raw.applicabilityAssessments![0] as never,String(doc.result.sourceId));assert.deepEqual(redacted.rows,[]);assert.equal((redacted.target as {transaction:string}).transaction,'');assert.equal(redacted.status,'withdrawn');
  await send(owner,{type:'source.revoke',sourceId:String(doc.result.sourceId),reason:'Delete reviewed source',delete:true});assert.equal((await snapshot(owner)).applicabilityAssessments.length,0);
 }finally{await closeV2Store();if(old===undefined)delete process.env.KIARA_V2_DATA_DIR;else process.env.KIARA_V2_DATA_DIR=old;if(mode===undefined)delete process.env.KIARA_V2_AI_MODE;else process.env.KIARA_V2_AI_MODE=mode;await rm(dir,{recursive:true,force:true});}
});
