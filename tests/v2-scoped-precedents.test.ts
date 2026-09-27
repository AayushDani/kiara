import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCompanyMemoryCommand} from '../src/v2/company-memory';
import {applyScopedPrecedentCommand,matchingPrecedents,matchingPrecedentsForMatter,precedentAvailable,precedentBasisHash,precedentTargetCurrent,precedentTargetView,scopedPrecedentView,type PrecedentState} from '../src/v2/scoped-precedents';
import {digest,emptyWorkspace,timestamp,readWorkspace} from '../src/v2/store';
import {transactWorkspace} from '../src/v2/store';
import {command,snapshot} from '../src/v2/service';
import {normalizeWorkspace,hydrateWorkspace} from '../src/v2/normalized-store';
import {redactedRecord} from '../src/v2/retention';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ActorContext,Approval,DocumentRecord,Matter,Proposal,RecordBase,Scope,Source} from '../src/v2/contracts';

const scope:Scope={kind:'team',actorIds:[]};
function fixture(){
 const state:PrecedentState=emptyWorkspace('precedent-synthetic'),owner:ActorContext={tenantId:state.tenantId,actorId:'owner',mode:'local_demo',expiresAt:Date.now()+3600000},lawyer={...owner,actorId:'lawyer'},member={...owner,actorId:'member'};
 state.memberships=[{actorId:'owner',roles:['member','fact_owner','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null},{actorId:'lawyer',roles:['member','legal_reviewer','fact_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null},{actorId:'member',roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null}];
 const base=(id:string,sourceIds:string[]=[]):RecordBase=>({id,tenantId:state.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope,provenance:{actorId:'owner',sourceIds,description:'Synthetic precedent fixture'}});
 const counterpartyId=String(applyCompanyMemoryCommand(state,owner,{type:'memory.entity.declare',kind:'counterparty',name:'Acme',aliases:[],ownerId:'owner',scope}).entityId);
 const productId=String(applyCompanyMemoryCommand(state,owner,{type:'memory.entity.declare',kind:'product',name:'Widget',aliases:[],ownerId:'owner',scope}).entityId);
 const body='Service terms. Negotiated liability cap: fees paid in twelve months. Other terms.';
 const source:Source={...base('source'),title:'Executed Acme agreement',kind:'manual',externalId:null,externalRevision:null,text:body,contentHash:digest(body),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'executed',originalObjectRef:null};state.sources.push(source);
 const document:DocumentRecord={...base('agreement-v1',[source.id]),documentId:'agreement',title:'Executed Acme agreement',body,contentHash:digest(body),authority:'executed',sourceId:source.id,revision:1,parentRevisionId:null,amendsDocumentId:null,status:'current',kind:'agreement'};state.documents.push(document);
 const matter:Matter={...base('matter',[source.id]),title:'Negotiate Acme agreement',objective:'Review liability cap',entityId:state.entityId,state:'closed',ownerId:'owner',conversationIds:[],scenarioId:null,eventIds:[],sourceIds:[source.id],factIds:[],documentIds:[document.id],proposalId:'proposal',tasks:[],blockers:[],outcome:'Negotiated and executed',closedAt:timestamp(),ruleVersion:1};state.matters.push(matter);
 const proposal:Proposal={...base('proposal',[source.id]),matterId:matter.id,title:'Acme negotiated terms',body:'Review negotiated liability cap',contentHash:digest('Review negotiated liability cap'),baselineRevisionIds:[document.id],dependencies:{sourceVersions:{[source.id]:source.version},factVersions:{},documentHashes:{[document.id]:document.contentHash},policyVersion:1,scopeHash:digest(scope)},status:'current',route:'legal_review',noticeMatrix:[],inventoryComplete:false,unknowns:[],supersedesId:null};state.proposals.push(proposal);
 const approval=(id:string,capacity:'business'|'legal',actorId:string):Approval=>({...base(id,[source.id]),matterId:matter.id,proposalId:proposal.id,proposalHash:proposal.contentHash,actionId:null,actionHash:null,capacity,actorId,membershipVersion:1,dependencies:structuredClone(proposal.dependencies),conditions:[],recipients:[],destination:null,validUntil:new Date(Date.now()+86400000).toISOString(),status:'active',note:'Synthetic exact decision'});
 const business=approval('business','business','owner'),legal=approval('legal','legal','lawyer');state.approvals.push(business,legal);
 const clauseText='Negotiated liability cap: fees paid in twelve months.',start=body.indexOf(clauseText);
 const propose=()=>String(applyScopedPrecedentCommand(state,owner,{type:'precedent.propose',inspectedVersion:state.version,originMatterId:matter.id,originProposalId:proposal.id,businessApprovalId:business.id,legalApprovalId:legal.id,documentId:document.id,counterpartyEntityId:counterpartyId,clause:{start,end:start+clauseText.length,quote:clauseText},context:{jurisdiction:'California',transaction:'B2B SaaS subscription',effectiveFrom:'2026-01-01',reuseUntil:'2026-12-31',productEntityIds:[productId],factIds:[]}}).precedentId);
 return {state,owner,lawyer,member,source,document,matter,proposal,business,legal,counterpartyId,productId,propose};
}
function adoptedFixture(){const f=fixture(),id=f.propose(),item=f.state.scopedPrecedents![0];applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.legal_review',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});applyScopedPrecedentCommand(f.state,f.owner,{type:'precedent.adopt',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});return f;}
function targetMatter(f:ReturnType<typeof fixture>){const target:Matter={...structuredClone(f.matter),id:'target-matter',title:'Review new Acme agreement',objective:'Assess a new Acme subscription',state:'needs_facts',proposalId:null,outcome:null,closedAt:null};f.state.matters.push(target);return target;}
function setTarget(f:ReturnType<typeof fixture>,matter:Matter,overrides:Partial<{inspectedVersion:number;counterpartyEntityId:string;jurisdiction:string;transaction:string;asOfDate:string;productEntityIds:string[];factIds:string[]}>={}){return applyScopedPrecedentCommand(f.state,f.owner,{type:'precedent.target.set',inspectedVersion:f.state.version,matterId:matter.id,expectedMatterVersion:matter.version,counterpartyEntityId:f.counterpartyId,jurisdiction:'California',transaction:'B2B SaaS subscription',asOfDate:'2026-09-27',productEntityIds:[f.productId],factIds:[],...overrides});}

test('target-matter matching requires owner-confirmed exact context and remains a suggestion',()=>{
 const f=adoptedFixture(),matter=targetMatter(f);
 assert.equal(matchingPrecedentsForMatter(f.state,f.member,matter.id).length,0);
 const exploratory=matchingPrecedents(f.state,f.member,{counterpartyEntityId:f.counterpartyId,jurisdiction:'California',transaction:'B2B SaaS subscription',asOfDate:'2026-09-27',productEntityIds:[f.productId],factIds:[]});assert.equal(exploratory.length,1);assert.equal(exploratory[0].matchStatus,'unverified_query');
 assert.throws(()=>setTarget(f,matter,{inspectedVersion:f.state.version-1}),{code:'PRECEDENT_INSPECTION_CHANGED'});
 assert.throws(()=>applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.target.set',inspectedVersion:f.state.version,matterId:matter.id,expectedMatterVersion:matter.version,counterpartyEntityId:f.counterpartyId,jurisdiction:'California',transaction:'B2B SaaS subscription',asOfDate:'2026-09-27',productEntityIds:[f.productId],factIds:[]}),{code:'FORBIDDEN'});
 const created=setTarget(f,matter),target=f.state.precedentTargets![0];assert.equal(created.targetContextId,target.id);assert.equal(precedentTargetCurrent(f.state,f.member,target),true);assert.equal(precedentTargetView(f.state,f.member)[0].current,true);
 const matches=matchingPrecedentsForMatter(f.state,f.member,matter.id);assert.equal(matches.length,1);assert.equal(matches[0].matchStatus,'verified_target_suggestion');assert.equal(matches[0].targetContextId,target.id);assert.match(matches[0].limitation,/fresh matter-specific business and legal review/);
 setTarget(f,matter,{jurisdiction:'New York'});assert.equal(f.state.precedentTargets![0].status,'superseded');assert.equal(matchingPrecedentsForMatter(f.state,f.member,matter.id).length,0);
});

test('target matching fails closed on changed owner, matter, source, subject and fact evidence',()=>{
 for(const changed of ['matter','source','owner','owner_scope','subject','fact'] as const){const f=adoptedFixture(),matter=targetMatter(f);if(changed==='fact'){const fact={id:'target-fact',tenantId:f.state.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope,provenance:{actorId:'owner',sourceIds:[f.source.id],description:'Confirmed target fact'},entityId:f.state.entityId,predicate:'contract_context',value:'Current subscription',status:'confirmed' as const,practice:'live' as const,ownerId:'owner',observedAt:timestamp(),validFrom:null,validUntil:null,confirmedBy:'owner',confirmedAt:timestamp(),supersedesId:null,originVersion:f.state.version,reuse:'company' as const,conversationId:null};f.state.facts.push(fact);matter.factIds.push(fact.id);setTarget(f,matter,{factIds:[fact.id]});}else setTarget(f,matter);
  const target=f.state.precedentTargets![0];assert.equal(precedentTargetCurrent(f.state,f.member,target),true);
  if(changed==='matter')matter.version++;
  if(changed==='source')f.source.version++;
  if(changed==='owner')f.state.memberships.find(m=>m.actorId==='owner')!.version++;
  if(changed==='owner_scope')f.state.memberships.find(m=>m.actorId==='owner')!.matterIds=['another-matter'];
  if(changed==='subject')f.state.memoryEntities!.find(e=>e.id===f.productId)!.version++;
  if(changed==='fact')f.state.facts.find(x=>x.id==='target-fact')!.value='Changed subscription';
  assert.equal(precedentTargetCurrent(f.state,f.member,target),false,`${changed} must stale the frozen target`);assert.equal(matchingPrecedentsForMatter(f.state,f.member,matter.id).length,0);
 }
});

test('target context rejects unbound facts and narrower recursive source audiences',()=>{
 const f=adoptedFixture(),matter=targetMatter(f);assert.throws(()=>setTarget(f,matter,{factIds:['unknown-fact']}),{code:'PRECEDENT_TARGET_FACT_SET'});
 const fact={id:'bound-fact',tenantId:f.state.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope,provenance:{actorId:'owner',sourceIds:[f.source.id],description:'Confirmed target fact'},entityId:f.state.entityId,predicate:'customer_segment',value:'Businesses',status:'confirmed' as const,practice:'live' as const,ownerId:'owner',observedAt:timestamp(),validFrom:null,validUntil:null,confirmedBy:'owner',confirmedAt:timestamp(),supersedesId:null,originVersion:f.state.version,reuse:'company' as const,conversationId:null};f.state.facts.push(fact);matter.factIds.push(fact.id);
 assert.throws(()=>setTarget(f,matter),{code:'PRECEDENT_TARGET_FACT_SET'},'omitting a confirmed matter fact cannot claim a matching context');
 setTarget(f,matter,{factIds:[fact.id]});
 f.source.scope={kind:'private',actorIds:['owner']};assert.throws(()=>setTarget(f,matter,{factIds:[fact.id]}),{code:'PRECEDENT_TARGET_SCOPE'});
});
test('scoped precedent requires exact historical decisions, legal review and owner adoption before reuse',()=>{
 const f=fixture(),id=f.propose(),item=f.state.scopedPrecedents![0];assert.equal(precedentAvailable(f.state,f.owner,item),false);assert.equal(matchingPrecedents(f.state,f.member,{counterpartyEntityId:f.counterpartyId,jurisdiction:'California',transaction:'B2B SaaS subscription',asOfDate:'2026-09-27',productEntityIds:[f.productId],factIds:[]}).length,0);
 assert.throws(()=>applyScopedPrecedentCommand(f.state,f.owner,{type:'precedent.legal_review',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)}),/legal reviewer/);
 applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.legal_review',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});
 assert.throws(()=>applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.adopt',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)}),/business owner/);
 applyScopedPrecedentCommand(f.state,f.owner,{type:'precedent.adopt',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});
 assert.equal(precedentAvailable(f.state,f.member,item),true);
 assert.equal(matchingPrecedents(f.state,f.member,{counterpartyEntityId:f.counterpartyId,jurisdiction:'California',transaction:'B2B SaaS subscription',asOfDate:'2026-09-27',productEntityIds:[f.productId],factIds:[]}).length,1);
 assert.equal(matchingPrecedents(f.state,f.member,{counterpartyEntityId:f.counterpartyId,jurisdiction:'New York',transaction:'B2B SaaS subscription',asOfDate:'2026-09-27',productEntityIds:[f.productId],factIds:[]}).length,0);
 assert.equal(matchingPrecedents(f.state,f.member,{counterpartyEntityId:f.counterpartyId,jurisdiction:'California',transaction:'B2B SaaS subscription',asOfDate:'2027-01-01',productEntityIds:[f.productId],factIds:[]}).length,0);
 assert.match(scopedPrecedentView(f.state,f.member)[0].limitation,/no standing or external-action authority/);
 f.document.status='superseded';assert.equal(precedentAvailable(f.state,f.member,item),true,'an unchanged historical agreement revision remains valid context');
 f.source.status='revoked';assert.equal(precedentAvailable(f.state,f.member,item),false,'revoked origin source fences derived reuse');
});
test('revoked decision and changed clause block promotion; a stale review hash cannot pass',()=>{
 const f=fixture();f.business.status='revoked';assert.throws(f.propose,/unavailable|exact active business and legal decisions/);f.business.status='active';
 const id=f.propose(),item=f.state.scopedPrecedents![0];assert.throws(()=>applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.legal_review',precedentId:id,expectedRecordVersion:item.version,basisHash:'wrong'}),/exact current precedent basis/);
 f.document.body+=' Changed';assert.throws(()=>applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.legal_review',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)}),/exact executed agreement clause/);
});
test('withdrawal removes reuse without erasing attributed history',()=>{
 const f=fixture(),id=f.propose(),item=f.state.scopedPrecedents![0];applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.legal_review',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});applyScopedPrecedentCommand(f.state,f.owner,{type:'precedent.adopt',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});
 applyScopedPrecedentCommand(f.state,f.owner,{type:'precedent.withdraw',precedentId:id,expectedRecordVersion:item.version,reason:'Context changed.'});assert.equal(item.status,'withdrawn');assert.equal(precedentAvailable(f.state,f.owner,item),false);assert.equal(scopedPrecedentView(f.state,f.owner).length,1);
});
test('a post-approval executed agreement requires exact retrospective review and adoption',()=>{
 const f=fixture();f.proposal.baselineRevisionIds=[];delete f.proposal.dependencies.documentHashes[f.document.id];
 const id=f.propose(),item=f.state.scopedPrecedents![0];assert.equal(precedentAvailable(f.state,f.member,item),false);
 applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.legal_review',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});assert.equal(precedentAvailable(f.state,f.member,item),false);
 applyScopedPrecedentCommand(f.state,f.owner,{type:'precedent.adopt',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});assert.equal(precedentAvailable(f.state,f.member,item),true);
});
test('revoked named subject owner removes an adopted precedent from reuse',()=>{
 const f=fixture(),id=f.propose(),item=f.state.scopedPrecedents![0];applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.legal_review',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});applyScopedPrecedentCommand(f.state,f.owner,{type:'precedent.adopt',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});
 assert.equal(precedentAvailable(f.state,f.member,item),true);f.state.memberships.find(m=>m.actorId==='owner')!.revokedAt=timestamp();assert.equal(precedentAvailable(f.state,f.member,item),false);
});
test('retrospective legal or business review loses reuse eligibility when reviewer authority is revoked',()=>{
 const f=fixture(),id=f.propose(),item=f.state.scopedPrecedents![0];applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.legal_review',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});applyScopedPrecedentCommand(f.state,f.owner,{type:'precedent.adopt',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});
 assert.equal(precedentAvailable(f.state,f.member,item),true);f.state.memberships.find(m=>m.actorId==='lawyer')!.revokedAt=timestamp();assert.equal(precedentAvailable(f.state,f.member,item),false);f.state.memberships.find(m=>m.actorId==='lawyer')!.revokedAt=null;
 f.state.memberships.find(m=>m.actorId==='owner')!.version++;assert.equal(precedentAvailable(f.state,f.member,item),false);
});
test('shared command and snapshot retain the exact scoped precedent through local storage',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kiara-precedent-test-')),priorDir=process.env.KIARA_V2_DATA_DIR,priorMongo=process.env.MONGODB_URI;
 process.env.KIARA_V2_DATA_DIR=dir;process.env.MONGODB_URI='';
 try{const f=fixture();await transactWorkspace(f.state.tenantId,s=>{Object.assign(s,structuredClone(f.state));return null;});const before=await snapshot(f.owner);
  const body=f.document.body,quote='Negotiated liability cap: fees paid in twelve months.',start=body.indexOf(quote);
  await assert.rejects(command(f.owner,{idempotencyKey:'stale-precedent-inspection',expectedVersion:before.version,command:{type:'precedent.propose',inspectedVersion:before.version-1,originMatterId:f.matter.id,originProposalId:f.proposal.id,businessApprovalId:f.business.id,legalApprovalId:f.legal.id,documentId:f.document.id,counterpartyEntityId:f.counterpartyId,clause:{start,end:start+quote.length,quote},context:{jurisdiction:'California',transaction:'B2B SaaS subscription',effectiveFrom:'2026-01-01',reuseUntil:'2026-12-31',productEntityIds:[f.productId],factIds:[]}}}),{code:'PRECEDENT_INSPECTION_CHANGED'});
  const proposed=await command(f.owner,{idempotencyKey:'propose-precedent',expectedVersion:before.version,command:{type:'precedent.propose',inspectedVersion:before.version,originMatterId:f.matter.id,originProposalId:f.proposal.id,businessApprovalId:f.business.id,legalApprovalId:f.legal.id,documentId:f.document.id,counterpartyEntityId:f.counterpartyId,clause:{start,end:start+quote.length,quote},context:{jurisdiction:'California',transaction:'B2B SaaS subscription',effectiveFrom:'2026-01-01',reuseUntil:'2026-12-31',productEntityIds:[f.productId],factIds:[]}}});
  assert.equal(proposed.snapshot.scopedPrecedents.length,1);assert.equal(proposed.snapshot.scopedPrecedents[0].reusable,false);
  const p=proposed.snapshot.scopedPrecedents[0],reviewed=await command(f.lawyer,{idempotencyKey:'legal-precedent',expectedVersion:proposed.snapshot.version,command:{type:'precedent.legal_review',precedentId:p.id,expectedRecordVersion:p.version,basisHash:p.basisHash}});
  const r=reviewed.snapshot.scopedPrecedents[0],adopted=await command(f.owner,{idempotencyKey:'adopt-precedent',expectedVersion:reviewed.snapshot.version,command:{type:'precedent.adopt',precedentId:r.id,expectedRecordVersion:r.version,basisHash:r.basisHash}});
  assert.equal(adopted.snapshot.scopedPrecedents[0].reusable,true);assert.equal((await snapshot(f.member)).scopedPrecedents[0].reusable,true);
 }finally{if(priorDir===undefined)delete process.env.KIARA_V2_DATA_DIR;else process.env.KIARA_V2_DATA_DIR=priorDir;if(priorMongo===undefined)delete process.env.MONGODB_URI;else process.env.MONGODB_URI=priorMongo;await rm(dir,{recursive:true,force:true});}
});
test('target command, snapshot match and source deletion remain bound across local persistence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kiara-precedent-target-')),priorDir=process.env.KIARA_V2_DATA_DIR,priorMongo=process.env.MONGODB_URI;
 process.env.KIARA_V2_DATA_DIR=dir;process.env.MONGODB_URI='';
 try{const f=adoptedFixture(),matter=targetMatter(f);f.state.memberships.find(member=>member.actorId==='owner')!.roles.push('admin');await transactWorkspace(f.state.tenantId,s=>{Object.assign(s,structuredClone(f.state));return null;});const before=await snapshot(f.owner);
  const set=await command(f.owner,{idempotencyKey:'target-context',expectedVersion:before.version,command:{type:'precedent.target.set',inspectedVersion:before.version,matterId:matter.id,expectedMatterVersion:matter.version,counterpartyEntityId:f.counterpartyId,jurisdiction:'California',transaction:'B2B SaaS subscription',asOfDate:'2026-09-27',productEntityIds:[f.productId],factIds:[]}});
  assert.equal(set.snapshot.precedentTargets[0].current,true);assert.equal(set.snapshot.matterPrecedentMatches.find(item=>item.matterId===matter.id)?.matches[0]?.matchStatus,'verified_target_suggestion');
  const removed=await command(f.owner,{idempotencyKey:'delete-precedent-source',expectedVersion:set.snapshot.version,command:{type:'source.revoke',sourceId:f.source.id,expectedRecordVersion:f.source.version,reason:'Synthetic source deletion test',delete:true}});
  assert.equal(removed.snapshot.matterPrecedentMatches.find(item=>item.matterId===matter.id)?.matches.length??0,0);assert.equal((await readWorkspace(f.state.tenantId)).precedentTargets?.[0].status,'superseded');
 }finally{if(priorDir===undefined)delete process.env.KIARA_V2_DATA_DIR;else process.env.KIARA_V2_DATA_DIR=priorDir;if(priorMongo===undefined)delete process.env.MONGODB_URI;else process.env.MONGODB_URI=priorMongo;await rm(dir,{recursive:true,force:true});}
});
test('normalized persistence retains precedent identity and deletion redacts clause/context',()=>{
 const f=fixture(),id=f.propose(),item=f.state.scopedPrecedents![0];applyScopedPrecedentCommand(f.state,f.lawyer,{type:'precedent.legal_review',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});applyScopedPrecedentCommand(f.state,f.owner,{type:'precedent.adopt',precedentId:id,expectedRecordVersion:item.version,basisHash:precedentBasisHash(item)});
 const image=normalizeWorkspace(f.state,'precedent_test'),restored=hydrateWorkspace(image);assert.equal(restored.scopedPrecedents?.[0].id,item.id);assert.equal(precedentAvailable(restored,f.member,restored.scopedPrecedents![0]),true);
 const redacted=redactedRecord('scopedPrecedents',item as unknown as RecordBase&Record<string,unknown>,f.source.id);assert.equal((redacted.clause as {quote:string}).quote,'');assert.equal((redacted.context as {transaction:string;effectiveFrom:string;reuseUntil:string}).transaction,'');assert.equal((redacted.context as {effectiveFrom:string}).effectiveFrom,'');assert.equal((redacted.context as {reuseUntil:string}).reuseUntil,'');assert.equal(redacted.status,'withdrawn');
});
