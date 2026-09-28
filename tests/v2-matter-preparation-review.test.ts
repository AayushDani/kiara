import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {emptyWorkspace,digest,timestamp,transactWorkspace,closeV2Store} from '../src/v2/store';
import {command,snapshot} from '../src/v2/service';
import {processConversationRun,type ConversationProvider} from '../src/v2/ai';
import {canRead} from '../src/v2/authority';
import {buildMatterPreparation,matterPreparationPacket,adoptMatterPreparation,assertMatterPreparation} from '../src/v2/matter-preparation';
import {retainDraftProposal,type DraftProposal,type DraftRequest} from '../src/v2/drafting';
import {recheckEvidence,type EvidencePacket} from '../src/v2/retrieval';
import {sourceDependencyHash} from '../src/v2/tasks';
import type {ActorContext,Conversation,Matter,RecordBase,Source,WorkspaceCommand} from '../src/v2/contracts';

function fixture(){
 const s=emptyWorkspace('independent-matter-preparation'),a:ActorContext={tenantId:s.tenantId,actorId:'owner',mode:'local_demo',expiresAt:Date.now()+3600000};
 s.memberships.push({actorId:a.actorId,roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
 const base=(id:string,sourceIds:string[]=[]):RecordBase=>({id,tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:{kind:'team',actorIds:[]},provenance:{actorId:a.actorId,sourceIds,description:'Synthetic independently supplied preparation basis'}});
 const source=(id:string,text:string):Source=>({...base(id),title:id,kind:'manual',externalId:null,externalRevision:null,text,contentHash:digest(text),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'unknown',originalObjectRef:null});
 const planSource=source('plan-source','PLAN_BASIS_CANARY'),taskSource=source('task-source','COMPLETED_WORK_CANARY');s.sources.push(planSource,taskSource);
 const c:Conversation={...base('conversation'),title:'Accepted work',entityId:s.entityId,reuse:'propose_memory',matterId:'matter',scenarioId:null};s.conversations.push(c);
 const m:Matter={...base('matter',[planSource.id,taskSource.id]),title:'Accepted plan',objective:'Plan objective derived from PLAN_BASIS_CANARY',entityId:s.entityId,state:'needs_facts',ownerId:a.actorId,conversationIds:[c.id],scenarioId:null,eventIds:[],sourceIds:[planSource.id,taskSource.id],factIds:[],documentIds:[],proposalId:null,tasks:[{id:'work',title:'Complete negotiations',kind:'business',purpose:'work',ownerId:a.actorId,status:'done',dueAt:null,deadlineType:'undated',evidenceIds:[taskSource.id],completion:{kind:'human_attestation',actorId:a.actorId,membershipVersion:1,at:timestamp(),note:'Negotiated COMPLETED_WORK_CANARY',sourceIds:[taskSource.id],sourceVersions:{[taskSource.id]:1},proofHash:sourceDependencyHash(s,[taskSource.id])}}],blockers:[],outcome:null,closedAt:null,ruleVersion:1,correlationKeys:[]};s.matters.push(m);
 const request:DraftRequest={kind:'plan',instruction:'Prepare a work plan',baseRevisionId:null,baseHash:null,templateApprovalId:null,templateApprovalHash:null,fieldFactIds:{},factHashes:{},missingFields:[],amendment:false};
 const plan:DraftProposal={...base('accepted-plan',[planSource.id]),conversationId:c.id,requesterId:a.actorId,request,title:'Plan',body:m.objective,contentHash:digest(m.objective),changes:[],questions:[],tasks:[],status:'accepted',acceptedDocumentId:null,acceptedMatterId:m.id,runId:null,standingEligible:false,rejectionReason:null,evidenceReferences:[]};s.drafts=[plan];
 const ranked:EvidencePacket={version:'v2-atlas-hybrid-1',question:'Prepare the accepted plan',history:[],evidence:[],references:[],sourceIds:[],factIds:[],hypotheses:[],agreementInventory:[],inventoryStatement:'No agreements selected in this synthetic ranking.',coverage:[],limitations:['Synthetic empty retrieval ranking; basis text is still sent in requestedDraft.']};
 return {s,a,c,m,planSource,taskSource,ranked};
}

test('accepted objective and completed-task lineage survive an empty retrieval ranking and adoption',()=>{
 const {s,a,c,m,planSource,taskSource,ranked}=fixture(),request=buildMatterPreparation(s,a,m,c),packet=matterPreparationPacket(s,a,c,request,ranked);
 for(const source of [planSource,taskSource]){assert.ok(packet.sourceIds.includes(source.id),`Missing frozen basis source ${source.id}`);assert.ok(packet.references.some(r=>r.kind==='source'&&r.id===source.id));}
 const draft=retainDraftProposal(s,a,c,request,{title:'Prepared artifact',body:'Proposed artifact derived from COMPLETED_WORK_CANARY',changes:[],questions:[],tasks:[],citationIds:[]},packet,'synthetic-run');
 adoptMatterPreparation(s,a,draft,'synthetic-adoption');
 for(const source of [planSource,taskSource])assert.ok(m.provenance.sourceIds.includes(source.id));
 taskSource.status='revoked';taskSource.version++;
 assert.equal(canRead(s,a,draft),false);assert.equal(canRead(s,a,m),false);
});

test('unranked accepted-basis source revision invalidates the packet before further model work',()=>{
 const {s,a,c,m,taskSource,ranked}=fixture(),request=buildMatterPreparation(s,a,m,c),packet=matterPreparationPacket(s,a,c,request,ranked);
 taskSource.version++;
 assert.throws(()=>recheckEvidence(s,a,c.id,packet),{code:'EVIDENCE_CHANGED'});
});

test('a source audience narrowed after preparation invalidates frozen task text despite owner read access',()=>{
 const {s,a,c,m,taskSource}=fixture(),request=buildMatterPreparation(s,a,m,c);
 taskSource.scope={kind:'private',actorIds:[a.actorId]};taskSource.version++;
 assert.equal(canRead(s,a,taskSource),true);
 assert.throws(()=>assertMatterPreparation(s,a,request),{code:'MATTER_BASIS_CHANGED'});
});

test('named counsel may attest only the exact shared substantive legal task; changed work requires renewed packet access',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kiara-preparation-review-')),keys=['MONGODB_URI','VERCEL','KIARA_V2_DATA_DIR','KIARA_GLOBAL_BUDGET_DIR','KIARA_V2_AI_MODE','KIARA_V2_RETRIEVAL_MODE','KIARA_V2_STORE_MODE','OPENAI_API_KEY','KIARA_OPENAI_BUDGET_USD','KIARA_MODEL','KIARA_REVIEW_MODEL','KIARA_REASONING_EFFORT'],prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  await closeV2Store();for(const key of keys)delete process.env[key];Object.assign(process.env,{KIARA_V2_DATA_DIR:dir,KIARA_GLOBAL_BUDGET_DIR:join(dir,'budget'),KIARA_V2_AI_MODE:'openai',KIARA_V2_RETRIEVAL_MODE:'local',OPENAI_API_KEY:'mock-only',KIARA_OPENAI_BUDGET_USD:'1',KIARA_MODEL:'gpt-6-sol',KIARA_REVIEW_MODEL:'gpt-6-sol',KIARA_REASONING_EFFORT:'low'});
  const owner:ActorContext={tenantId:'independent-counsel-task',actorId:'owner',mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','business_owner','admin']},counsel:ActorContext={...owner,actorId:'counsel',bootstrapRoles:['member','legal_reviewer']},future=new Date(Date.now()+3600000).toISOString();
  const send=async(a:ActorContext,c:WorkspaceCommand)=>command(a,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(a)).version,command:c});
  await snapshot(counsel);await send(owner,{type:'conversation.create',title:'PRIVATE_UNSHARED_HISTORY',scope:{kind:'private',actorIds:['owner']}});
  const added=await send(owner,{type:'document.add',title:'Exact retained review evidence',body:'The named reviewer must review the complete supplied notice terms.',authority:'executed',scope:{kind:'private',actorIds:['owner']}}),sourceId=String(added.result.sourceId);
  const created=await send(owner,{type:'matter.create',title:'Private substantive analysis',objective:'Complete the named specialist analysis',scope:{kind:'private',actorIds:['owner']}}),matterId=String(created.result.matterId);
  await transactWorkspace(owner.tenantId,s=>{const m=s.matters.find(x=>x.id===matterId)!;m.tasks.push({id:'specialist-work',title:'Complete specialist regulatory analysis',kind:'legal',purpose:'work',requiredFactPredicates:[],ownerId:owner.actorId,status:'pending',dueAt:null,deadlineType:'undated',evidenceIds:[]});m.version++;});
  let state=await snapshot(owner);const queued=await send(owner,{type:'matter.prepare',matterId,expectedRecordVersion:state.matters[0].version});
  const provider:ConversationProvider={count:async()=>1000,create:async request=>{const data=JSON.parse(String(request.input));const output=data.items?{safe:true,checks:data.items.map((x:{id:string})=>({paragraphId:x.id,supported:true,reason:'Exact source and pending specialist work are retained.'}))}:{title:'Specialist review packet',body:'Review the supplied notice terms and complete the named specialist analysis before any external action.',changes:[],questions:['What legal applicability is confirmed?'],tasks:[],citationIds:[]};return {id:randomUUID(),status:'completed',model:String(request.model),output_text:JSON.stringify(output),usage:{input_tokens:100,output_tokens:100,total_tokens:200,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}};}};
  assert.equal((await processConversationRun(owner.tenantId,String(queued.result.runId),{provider})).status,'complete');const draft=(await snapshot(owner)).drafts[0];await send(owner,{type:'draft.accept',draftId:draft.id,expectedRecordVersion:draft.version,expectedContentHash:draft.contentHash});
  let engagement=(await send(owner,{type:'counsel.request',matterId,route:'existing',providerName:'Synthetic named counsel'})).snapshot.counsel[0];
  engagement=(await send(owner,{type:'counsel.intake',engagementId:engagement.id,expectedRecordVersion:engagement.version,counselActorId:counsel.actorId,conflictsCleared:true,intakeEvidence:'Synthetic independent intake fixture'})).snapshot.counsel[0];
  engagement=(await send(owner,{type:'counsel.engage',engagementId:engagement.id,expectedRecordVersion:engagement.version,terms:'Review the exact supplied terms and complete the specialist analysis',feeCap:0,currency:'USD',responseDueAt:future})).snapshot.counsel[0];
  await send(owner,{type:'counsel.share',engagementId:engagement.id,expectedRecordVersion:engagement.version,packetHash:engagement.packetHash!,recipientActorId:counsel.actorId,validUntil:future});
  const visible=await snapshot(counsel),m=visible.matters[0],source=visible.sources.find(x=>x.id===sourceId)!;
  assert.equal(visible.conversations.length,0);assert.equal(m.tasks.find(t=>t.id==='specialist-work')!.ownerId,counsel.actorId);assert.ok(source.evidenceDependencyHash);
  await send(counsel,{type:'matter.task_complete',matterId,taskId:'specialist-work',expectedRecordVersion:m.version,evidenceSourceIds:[sourceId],evidenceSourceVersions:{[sourceId]:source.version},evidenceSourceHashes:{[sourceId]:source.contentHash},evidenceSourceDependencyHashes:{[sourceId]:source.evidenceDependencyHash!},note:'Named counsel attests the completed specialist analysis against the exact retained source.'});
  state=await snapshot(owner);assert.equal(state.matters[0].tasks.find(t=>t.id==='specialist-work')!.completion!.actorId,counsel.actorId);assert.equal(state.proposals[0].status,'invalidated');assert.equal(state.approvals.some(x=>x.capacity==='legal'&&x.status==='active'),false);
  const after=await snapshot(counsel);assert.equal(after.matters.length,0);assert.equal(after.conversations.length,0);assert.ok(!JSON.stringify(after).includes('PRIVATE_UNSHARED_HISTORY'));
 }finally{await closeV2Store();for(const key of keys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}await rm(dir,{recursive:true,force:true});}
});
