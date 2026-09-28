import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFactualCorrection,parsePersonalPreference} from '../src/v2/natural-language';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {command,snapshot} from '../src/v2/service';
import {closeV2Store} from '../src/v2/store';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';

test('explicit natural corrections become bounded typed proposals with planned versus live kept separate',()=>{
 assert.deepEqual(parseFactualCorrection('Actually, RelayAI is only in staging.'),{predicate:'relayai_deployment_status',value:'only in staging',practice:'planned',confidence:'explicit',subjectPhrase:'RelayAI'});
 assert.deepEqual(parseFactualCorrection('Our retention setting is 30 days.'),{predicate:'retention_setting',value:'30 days',practice:'unknown',confidence:'explicit',subjectPhrase:'retention setting'});
 assert.equal(parseFactualCorrection('RelayAI is not in production.')?.practice,'unknown');
 assert.equal(parseFactualCorrection('RelayAI is not deployed.')?.practice,'unknown');
 assert.equal(parseFactualCorrection('RelayAI isn’t live.')?.practice,'unknown');
 assert.equal(parseFactualCorrection('Actually, that is only in staging.'),null);
 assert.equal(parseFactualCorrection('What if RelayAI is in production?'),null);
 assert.equal(parseFactualCorrection('What is the next step?'),null);
 assert.equal(parseFactualCorrection('Who is the owner.'),null);
 assert.equal(parseFactualCorrection('Looks good'),null);
});
test('explicit personal presentation preferences are parsed without team or legal authority',()=>{
 assert.deepEqual(parsePersonalPreference('Please keep my answers concise.'),{key:'response_length',value:'short answer first',target:'personal'});
 assert.deepEqual(parsePersonalPreference('Give me the short answer first.'),{key:'response_length',value:'short answer first',target:'personal'});
 assert.deepEqual(parsePersonalPreference('I prefer more detailed explanations.'),{key:'response_length',value:'detailed answer',target:'personal'});
 assert.equal(parsePersonalPreference('Send product questions to Alex'),null);
 assert.equal(parsePersonalPreference('Please draft a short NDA'),null);
});
test('conversation proposes an attributed candidate while ambiguity and personal presentation stay separate',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kiara-natural-correction-')),prior=process.env.KIARA_V2_DATA_DIR,priorMode=process.env.KIARA_V2_AI_MODE;
 process.env.KIARA_V2_DATA_DIR=dir;process.env.KIARA_V2_AI_MODE='local';
 const alice:ActorContext={tenantId:'natural-correction',actorId:'alice',mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','fact_owner','business_owner']},bob:ActorContext={...alice,actorId:'bob',bootstrapRoles:['member']};
 const send=async(actor:ActorContext,value:WorkspaceCommand)=>command(actor,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(actor)).version,command:value});
 try{
  await snapshot(bob);const corrected=await send(alice,{type:'message.send',text:'Actually, RelayAI is only in staging.'});
  const fact=corrected.snapshot.facts[0],message=corrected.snapshot.messages.find(item=>item.role==='user')!;
  assert.equal(fact.status,'candidate');assert.equal(fact.practice,'planned');assert.equal(fact.predicate,'relayai_deployment_status');assert.equal(fact.provenance.messageId,message.id);assert.ok(message.artifactIds.includes(fact.id));assert.equal(corrected.snapshot.matters.length,0);
  await send(alice,{type:'message.send',conversationId:String(corrected.result.conversationId),text:'Actually, that is only in staging.'});assert.equal((await snapshot(alice)).facts.length,1);
  const declared=await send(alice,{type:'memory.entity.declare',kind:'vendor',name:'RelayAI',aliases:[],ownerId:'alice',scope:{kind:'private',actorIds:['alice']}});
  await send(alice,{type:'message.send',conversationId:String(corrected.result.conversationId),text:'RelayAI is not in production.'});assert.equal((await snapshot(alice)).facts.length,1,'a declared vendor is not silently relabeled as the workspace company');
  const subjectConversation=await send(alice,{type:'conversation.create',title:'RelayAI status',scope:{kind:'private',actorIds:['alice']},subjectEntityId:String(declared.result.entityId)});
  const subjectCorrection=await send(alice,{type:'message.send',conversationId:String(subjectConversation.result.conversationId),text:'RelayAI isn’t live.'});assert.equal(subjectCorrection.snapshot.facts.length,2);assert.equal(subjectCorrection.snapshot.facts[1].subjectEntityId,declared.result.entityId);assert.equal(subjectCorrection.snapshot.facts[1].practice,'unknown');assert.equal(subjectCorrection.snapshot.facts[1].value,'not live');
  const preference=await send(alice,{type:'message.send',text:'I prefer more detailed explanations.'});assert.equal(preference.snapshot.preferences.find(item=>item.ownerId==='alice')?.value,'detailed answer');assert.equal((await snapshot(bob)).preferences.length,0);
  assert.equal((await snapshot(bob)).facts.length,0,'a private conversation correction cannot leak to another member');
 }finally{await closeV2Store();if(prior===undefined)delete process.env.KIARA_V2_DATA_DIR;else process.env.KIARA_V2_DATA_DIR=prior;if(priorMode===undefined)delete process.env.KIARA_V2_AI_MODE;else process.env.KIARA_V2_AI_MODE=priorMode;await rm(dir,{recursive:true,force:true});}
});
