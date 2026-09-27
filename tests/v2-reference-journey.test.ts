import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,snapshot} from '../src/v2/service';
import {closeV2Store,readWorkspace,transactWorkspace} from '../src/v2/store';
import {canRead} from '../src/v2/authority';
import {currentEvidenceLineage} from '../src/v2/source-lifecycle';
import {scopeAudienceHash} from '../src/v2/integrations/slack-scope';
import {acceptWebhook} from '../src/v2/integrations/intake';
import {processSlackReply} from '../src/v2/integrations/slack-replies';
import type {Installation} from '../src/v2/integrations/config';
import type {ProviderFetch} from '../src/v2/integrations/read';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';

const tenantId='northstar-relayai-reference';
const owner:ActorContext={tenantId,actorId:'founder',mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','business_owner','fact_owner','admin','publisher']};
const counsel:ActorContext={...owner,actorId:'counsel',bootstrapRoles:['member','legal_reviewer']};
const newMember:ActorContext={...owner,actorId:'support-owner',bootstrapRoles:['member']};
const audience={kind:'team' as const,actorIds:[]};
const later=()=>new Date(Date.now()+2*3600000).toISOString();
const code=(wanted:string)=>(error:unknown)=>(error as {code:string}).code===wanted;
async function send(actor:ActorContext,value:WorkspaceCommand){const state=await snapshot(actor);return command(actor,{idempotencyKey:randomUUID(),expectedVersion:state.version,command:value});}
function signedGitHub(payload:unknown){const raw=Buffer.from(JSON.stringify(payload));return {raw,headers:new Headers({'x-github-event':'pull_request','x-github-delivery':'northstar-pr-21','x-hub-signature-256':`sha256=${createHmac('sha256','journey-secret').update(raw).digest('hex')}`})};}
function signedSlack(payload:unknown){const raw=Buffer.from(JSON.stringify(payload)),stamp=String(Math.floor(Date.now()/1000));return {raw,headers:new Headers({'x-slack-request-timestamp':stamp,'x-slack-signature':`v0=${createHmac('sha256','journey-secret').update(`v0:${stamp}:`).update(raw).digest('hex')}`})};}
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('one synthetic Northstar/RelayAI tenant retains the journey from question through later comparable work',async()=>{
 const before={...process.env},previousFetch=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'kiara-reference-journey-'));
 for(const key of Object.keys(process.env))if(/KIARA|MONGO|VERCEL|OPENAI|RESEND|TEMPORAL/.test(key))delete process.env[key];
 Object.assign(process.env,{KIARA_V2_DATA_DIR:dir,KIARA_V2_AI_MODE:'local',KIARA_PUBLIC_ORIGIN:'https://kiara.example.test',JOURNEY_PROVIDER_TOKEN:'synthetic-token',JOURNEY_WEBHOOK_SECRET:'journey-secret'});
 globalThis.fetch=async()=>{throw Error('The reference journey must not call a live provider.');};
 try{
  await snapshot(owner);await snapshot(counsel);await snapshot(newMember);
  await transactWorkspace(tenantId,state=>{state.memberships.push({actorId:'integration',roles:['integration'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
  await send(owner,{type:'company.configure',name:'Northstar'});

  // J01–J03: the founder's scenario is not company truth until an explicit adoption.
  const question=await send(owner,{type:'message.send',text:'What if Northstar added RelayAI support summaries using synthetic data only?',scope:audience});
  const scenario=question.snapshot.scenarios[0];assert.ok(scenario);assert.equal(question.snapshot.matters.length,0);assert.equal(question.snapshot.facts.length,0);
  const explored=await send(owner,{type:'scenario.update',scenarioId:scenario.id,expectedRecordVersion:scenario.version,assumptions:['Synthetic-only exploration; no production transfer or deployment is asserted.','Possible later customer transcript processing needs separate review.']});
  assert.equal(explored.snapshot.facts.length,0);
  const adopted=await send(owner,{type:'scenario.adopt',scenarioId:scenario.id,expectedRecordVersion:explored.snapshot.scenarios[0].version,objective:'Assess a planned RelayAI support-summary feature using customer transcripts.'});
  const matterId=String(adopted.result.matterId);assert.equal(adopted.snapshot.matters.length,1);assert.equal(adopted.snapshot.facts.length,0);

  // J04: independently signed PR and launch messages are retained before the named owner links them.
  const github:Installation={id:'journey-github',provider:'github',tenantId,actorId:'integration',enabled:true,tokenEnv:'JOURNEY_PROVIDER_TOKEN',webhookSecretEnv:'JOURNEY_WEBHOOK_SECRET',resources:['northstar/support'],scope:audience,providerInstallationId:'777'};
  const slack:Installation={id:'journey-slack',provider:'slack',tenantId,actorId:'integration',enabled:true,tokenEnv:'JOURNEY_PROVIDER_TOKEN',webhookSecretEnv:'JOURNEY_WEBHOOK_SECRET',resources:['C1'],scope:audience,slackTeamId:'T1'};
  process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([github,slack]);
  const pull=signedGitHub({installation:{id:777},repository:{full_name:'northstar/support'},action:'closed',pull_request:{number:21,title:'Add planned RelayAI summary client',body:'Proposed code path; no production deployment evidence.',head:{sha:'sha21'},updated_at:new Date().toISOString(),merged:true}});
  const pr=await acceptWebhook(github.id,pull.headers,pull.raw);
  const launch=signedSlack({type:'event_callback',team_id:'T1',event_id:'launch-thread',event:{type:'message',channel:'C1',user:'UENG',ts:'1770000000.100',text:'Target launch discussion only; production transcript flow and date remain unconfirmed.'}});
  const thread=await acceptWebhook(slack.id,launch.headers,launch.raw);
  assert.equal(pr.matterId,null);assert.equal(thread.matterId,null);
  for(const sourceId of [String(pr.sourceId),String(thread.sourceId)]){const view=await snapshot(owner),matter=view.matters.find(item=>item.id===matterId)!,source=view.sources.find(item=>item.id===sourceId)!;await send(owner,{type:'event.link_matter',matterId,expectedMatterVersion:matter.version,sourceId,expectedSourceVersion:source.version});}
  let view=await snapshot(owner);assert.equal(view.matters.length,1);assert.deepEqual(new Set(view.matters[0].sourceIds),new Set([pr.sourceId,thread.sourceId]));assert.equal(view.facts.length,0,'signed PR and discussion do not prove a live deployment');

  // J06: a newly mapped member gets one short answer and the same matter link.
  const conversation=await send(owner,{type:'conversation.create',title:'RelayAI launch question',scope:audience});
  const conversationId=String(conversation.result.conversationId),linkedConversation=conversation.snapshot.conversations.find(item=>item.id===conversationId)!,linkedMatter=conversation.snapshot.matters.find(item=>item.id===matterId)!;
  await send(owner,{type:'conversation.link_matter',conversationId,matterId,expectedConversationVersion:linkedConversation.version,expectedMatterVersion:linkedMatter.version});
  const slackReply:Installation={...slack,id:'journey-slack-reply',slackReplies:{botUserId:'UBOT',validUntil:later(),bindings:[{channel:'C1',threadTs:'1770000001.000',conversationId,matterId,actorId:newMember.actorId,slackUserId:'UNEW'}]}};
  process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([github,slack,slackReply]);
  await send(owner,{type:'document.add',title:'Owner-only unrelated agreement',body:'PRIVATE_PRICE_938 belongs only to the founder.',authority:'executed',kind:'agreement',scope:{kind:'private',actorIds:[owner.actorId]}});
  {const state=await readWorkspace(tenantId),matter=state.matters.find(item=>item.id===matterId)!,selected=state.conversations.find(item=>item.id===conversationId)!;assert.equal(selected.matterId,matter.id);assert.ok(matter.conversationIds.includes(conversationId));assert.equal(scopeAudienceHash(matter.scope),scopeAudienceHash(selected.scope));assert.equal(canRead(state,newMember,matter),true);assert.equal(canRead(state,{...owner,mode:'authenticated'},matter),true);assert.equal(currentEvidenceLineage(state,matter),true);}
  const why=signedSlack({type:'event_callback',team_id:'T1',event_id:'new-user-why',event:{type:'message',channel:'C1',thread_ts:'1770000001.000',ts:'1770000001.100',user:'UNEW',text:'Why does this matter?'}});
  const answerIntent=await acceptWebhook(slackReply.id,why.headers,why.raw);assert.equal(answerIntent.continued,true);
  const answer=(await readWorkspace(tenantId)).messages.find(item=>item.channel==='slack'&&item.role==='assistant')!;
  assert.match(answer.text,new RegExp(`https://kiara\\.example\\.test/\\?matter=${matterId}`));assert.match(answer.text,/planned RelayAI/);assert.doesNotMatch(answer.text,/PRIVATE_PRICE_938/);assert.ok(answer.text.length<600);
  const posts:Record<string,unknown>[]=[];
  const provider:ProviderFetch=async(url,init)=>{const u=new URL(String(url));assert.equal(u.origin,'https://slack.com');if(u.pathname==='/api/auth.test')return json({ok:true,team_id:'T1',user_id:'UBOT',bot_id:'B1'});if(u.pathname==='/api/conversations.info')return json({ok:true,channel:{id:'C1',is_member:true,is_archived:false}});if(u.pathname==='/api/chat.postMessage'){const body=JSON.parse(String(init?.body));posts.push(body);return json({ok:true,channel:'C1',ts:'1770000001.200'});}if(u.pathname==='/api/conversations.replies'){const body=posts[0];return json({ok:true,messages:body?[{user:'UBOT',ts:'1770000001.200',thread_ts:body.thread_ts,text:body.text,metadata:body.metadata}]:[]});}throw Error(`Unexpected synthetic Slack route ${u.pathname}`);};
  assert.equal((await processSlackReply(tenantId,String(answerIntent.replyId),{fetcher:provider})).status,'verified');assert.equal(posts.length,1);

  // J04–J05: source-linked owner confirmation, complete supplied register, and a named clause assessment.
  const agreementBody='Acme may require 30 days prior notice before a new subprocessor receives customer transcript text.';
  const agreement=await send(owner,{type:'document.add',title:'Fictional Acme executed DPA',body:agreementBody,authority:'executed',kind:'agreement'});
  await send(owner,{type:'document.add',title:'Fictional Northstar privacy notice',body:'Current notice; applicability to a proposed RelayAI feature requires review.',authority:'effective',kind:'notice'});
  const counterparty=await send(owner,{type:'memory.entity.declare',kind:'counterparty',name:'Acme',aliases:[],ownerId:owner.actorId,scope:audience});
  async function confirm(predicate:string,value:string,sourceIds:string[]=[]){const proposed=await send(owner,{type:'fact.propose',predicate,value,practice:'planned',sourceIds}),fact=proposed.snapshot.facts.at(-1)!;const confirmed=await send(owner,{type:'fact.confirm',factId:fact.id,expectedRecordVersion:fact.version,expectedOriginVersion:fact.originVersion});return confirmed.snapshot.facts.find(item=>item.id===fact.id)!;}
  const objective=await confirm('business_objective',adopted.snapshot.matters[0].objective);
  const deployment=await confirm('relayai_deployment','Planned only; production deployment is not confirmed.',[String(pr.sourceId)]);
  await confirm('relayai_transcript_flow','Customer transcript text is proposed for the feature; live transfer is unconfirmed.',[String(thread.sourceId)]);
  view=await snapshot(owner);const firstPreparation=await send(owner,{type:'matter.prepare',matterId,expectedRecordVersion:view.matters[0].version});
  assert.ok(firstPreparation.snapshot.proposals[0].unknowns.some(item=>/legal|applicab/i.test(item)));
  const candidate=firstPreparation.snapshot.inventoryCandidates.find(item=>item.matterId===matterId)!;
  const attested=await send(owner,{type:'inventory.attest',matterId,expectedMatterVersion:firstPreparation.snapshot.matters[0].version,title:'Supplied Acme agreement register',scopeDescription:'The one fictional Acme agreement supplied for this test, not an external discovery.',documentIds:candidate.documentIds,sourceIds:[String(agreement.result.sourceId)],validUntil:later()});
  const inventory=attested.snapshot.inventories[0];
  const assessment:Extract<WorkspaceCommand,{type:'applicability.record'}>={type:'applicability.record',inspectedVersion:attested.snapshot.version,inventoryId:inventory.id,target:{transaction:adopted.snapshot.matters[0].objective,jurisdiction:'California',counterpartyEntityId:String(counterparty.result.entityId),productEntityIds:[],factIds:[objective.id,deployment.id]},rows:[{documentId:String(agreement.result.documentId),assessment:'notice_required',clause:{start:0,end:agreementBody.length,quote:agreementBody},reason:'Synthetic legal-review decision for this fictional agreement and proposed transcript transfer only.',notice:{trigger:'Proposed live customer transcript transfer to a new subprocessor, if confirmed.',recipients:['Fictional Acme legal contact'],channel:'Contractually reviewed channel, pending exact destination.',timing:'30 days before a confirmed applicable change, subject to qualified review.'}}]};
  const reviewed=await send(counsel,assessment);
  assert.equal(reviewed.snapshot.applicabilityAssessments[0].current,true);
  view=await snapshot(owner);const prepared=await send(owner,{type:'matter.prepare',matterId,expectedRecordVersion:view.matters[0].version});
  let proposal=prepared.snapshot.proposals.find(item=>item.id===prepared.result.proposalId)!;
  assert.equal(prepared.snapshot.applicabilityAssessments[0].current,true);assert.equal(proposal.applicability?.id,reviewed.snapshot.applicabilityAssessments[0].id);
  assert.equal(proposal.noticeMatrix[0].assessment,'notice_required');assert.equal(proposal.noticeMatrix[0].clauseOffsets?.start,0);assert.equal(proposal.inventoryComplete,true);assert.ok(proposal.unknowns.length);

  // J07–J08: selected packet, explicit engagement, and returned text create a new proposal.
  let engagement=(await send(owner,{type:'counsel.request',matterId,route:'existing',providerName:'Fictional existing counsel'})).snapshot.counsel[0];
  engagement=(await send(owner,{type:'counsel.intake',engagementId:engagement.id,expectedRecordVersion:engagement.version,counselActorId:counsel.actorId,conflictsCleared:true,intakeEvidence:'Synthetic human intake approval for this local test.'})).snapshot.counsel[0];
  engagement=(await send(owner,{type:'counsel.engage',engagementId:engagement.id,expectedRecordVersion:engagement.version,terms:'Review only the selected fictional packet; no sending authority.',feeCap:0,currency:'USD',responseDueAt:later()})).snapshot.counsel[0];
  engagement=(await send(owner,{type:'counsel.share',engagementId:engagement.id,expectedRecordVersion:engagement.version,packetHash:engagement.packetHash!,recipientActorId:counsel.actorId,validUntil:later()})).snapshot.counsel[0];
  const returned=await send(counsel,{type:'counsel.return',engagementId:engagement.id,expectedRecordVersion:engagement.version,proposalId:proposal.id,proposalHash:proposal.contentHash,disposition:'revised_proposal',body:'Fictional counsel revision: review the proposed RelayAI data flow and exact Acme clause before any customer notice. No legal conclusion or external send is claimed.',note:'Local test return; independently qualified legal review is not evidenced.'});
  proposal=returned.snapshot.proposals.find(item=>item.id===returned.snapshot.matters[0].proposalId)!;
  assert.notEqual(proposal.id,prepared.result.proposalId);assert.equal(returned.snapshot.proposals.find(item=>item.id===prepared.result.proposalId)!.status,'superseded');

  // J09: explicit human decisions bind returned bytes and a future start; nothing executes early.
  await send(owner,{type:'approval.record',proposalId:proposal.id,proposalHash:proposal.contentHash,capacity:'business',validUntil:later()});
  await send(counsel,{type:'approval.record',proposalId:proposal.id,proposalHash:proposal.contentHash,capacity:'legal',validUntil:later(),note:'Synthetic role decision for control-path testing; not professional legal clearance.'});
  const notBefore=new Date(Date.now()+10*60000).toISOString();
  const planned=await send(owner,{type:'action.plan',matterId,proposalId:proposal.id,kind:'send',title:'Fictional reviewed notice',content:proposal.body,recipients:['acme-legal@example.test'],timing:{mode:'not_before',notBefore,reason:'Wait for an explicit fictional launch checkpoint.'}});
  let action=planned.snapshot.actions.find(item=>item.id===planned.result.actionId)!;
  const authorized=await send(owner,{type:'action.authorize',actionId:action.id,expectedRecordVersion:action.version,contentHash:action.contentHash,validUntil:later()});
  action=authorized.snapshot.actions.find(item=>item.id===action.id)!;assert.equal(action.status,'pending_manual');assert.equal(action.completion,null);assert.equal(action.timing?.notBefore,notBefore);
  await assert.rejects(()=>send(owner,{type:'action.attest',actionId:action.id,expectedRecordVersion:action.version,artifact:'Premature fictional completion',completionKind:'human_attestation'}),code('ACTION_NOT_BEFORE'));

  // J10: a scoped correction and feedback stay separate from automatically promoted policy.
  const correction=await send(owner,{type:'fact.propose',predicate:deployment.predicate,value:'Still planned; a merged PR is not deployment evidence.',practice:'planned',sourceIds:[String(pr.sourceId)],supersedesId:deployment.id});
  const corrected=correction.snapshot.facts.find(item=>item.id===correction.result.factId)!;
  await send(owner,{type:'fact.confirm',factId:corrected.id,expectedRecordVersion:corrected.version,expectedOriginVersion:corrected.originVersion});
  assert.equal((await snapshot(owner)).proposals.find(item=>item.id===proposal.id)!.status,'invalidated');
  const answerTarget=(await snapshot(owner)).strategies.targets.find(item=>item.kind==='message'&&item.id===answer.id);
  assert.ok(answerTarget,'the attributed answer must support scoped feedback');
  const feedback=await send(owner,{type:'feedback.record',subjectKind:'message',subjectId:answer.id,expectedRecordVersion:answer.version,subjectHash:answerTarget.hash,category:'wording_preference',detail:'Keep the explanation concise and label planned deployment explicitly.'});
  assert.equal(feedback.snapshot.strategies.feedback.length,1);
  const comparable=await send(owner,{type:'matter.create',title:'Comparable fictional support summary review',objective:'Assess a later RelayAI support-summary expansion.',scope:audience});
  const laterMatter=comparable.snapshot.matters.find(item=>item.id===comparable.result.matterId)!;
  await confirm('business_objective',laterMatter.objective);
  const laterPrepared=await send(owner,{type:'matter.prepare',matterId:laterMatter.id,expectedRecordVersion:laterMatter.version});
  const laterProposal=laterPrepared.snapshot.proposals.find(item=>item.id===laterPrepared.result.proposalId)!;
  assert.ok(laterProposal.body.includes('Still planned; a merged PR is not deployment evidence.'));
  assert.ok(laterProposal.unknowns.length,'a comparable matter still needs its own legal and business review');
  assert.equal((await snapshot(owner)).matters.length,2);
 }finally{await closeV2Store();globalThis.fetch=previousFetch;for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});
