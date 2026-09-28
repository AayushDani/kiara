import test from 'node:test';
import assert from 'node:assert/strict';
import {completeQueuedWithdrawal} from './support/withdrawal';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {command,snapshot} from '../src/v2/service';
import {closeV2Store,readWorkspace} from '../src/v2/store';
import {normalizeWorkspace,hydrateWorkspace} from '../src/v2/normalized-store';
import {retrieveConversationEvidence} from '../src/v2/retrieval';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';

test('declared subjects flow through commands, scoped facts, retrieval, normalized storage and deletion',async()=>{
 const old={data:process.env.KIARA_V2_DATA_DIR,mongo:process.env.MONGODB_URI,ai:process.env.KIARA_V2_AI_MODE};
 const dir=await mkdtemp(join(tmpdir(),'kiara-memory-integration-'));
 process.env.KIARA_V2_DATA_DIR=dir;process.env.MONGODB_URI='';process.env.KIARA_V2_AI_MODE='local';
 const a:ActorContext={tenantId:`memory-integration-${randomUUID()}`,actorId:'owner',mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','fact_owner','business_owner','admin']};
 const send=async(c:WorkspaceCommand)=>{const result=await command(a,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(a)).version,command:c});if(c.type==='source.revoke'){await completeQueuedWithdrawal(a.tenantId,c.sourceId);return {...result,snapshot:await snapshot(a)};}return result;};
 const team={kind:'team' as const,actorIds:[]};
 try{
  const product=(await send({type:'memory.entity.declare',kind:'product',name:'Support assistant',aliases:[],ownerId:a.actorId,scope:team})).snapshot.companyMemory.entities[0];
  const vendor=(await send({type:'memory.entity.declare',kind:'vendor',name:'RelayAI',aliases:[],ownerId:a.actorId,scope:team})).snapshot.companyMemory.entities[1];
  const doc=(await send({type:'document.add',title:'Sandbox evidence',body:'Support assistant uses RelayAI only in a planned sandbox.',authority:'draft',scope:team})).snapshot.documents[0];
  const proposed=await send({type:'memory.relationship.propose',fromId:product.id,toId:vendor.id,kind:'uses_vendor',description:'Sandbox vendor use',practice:'planned',sourceIds:[doc.sourceId],factIds:[],documentIds:[doc.id],inspectedVersion:(await snapshot(a)).version});
  const candidate=proposed.snapshot.companyMemory.relationships[0];assert.equal(candidate.current,false);
  const confirmed=await send({type:'memory.relationship.confirm',relationshipId:candidate.id,expectedRecordVersion:candidate.version,basisHash:candidate.basisHash});assert.equal(confirmed.snapshot.companyMemory.relationships[0].current,true);
  const conversation=(await send({type:'conversation.create',title:'Vendor use',scope:team,subjectEntityId:product.id})).snapshot.conversations[0];
  const sent=await send({type:'message.send',conversationId:conversation.id,text:'Which vendor does the support assistant use?'});
  assert.match(sent.snapshot.messages.at(-1)!.text,/relationship\.uses_vendor/);
  const state=await readWorkspace(a.tenantId),userMessage=state.messages.find(m=>m.conversationId===conversation.id&&m.role==='user')!,packet=retrieveConversationEvidence(state,a,state.conversations[0],userMessage.id);
  assert.ok(packet.evidence.some(e=>e.factId===confirmed.result.factId));
  const image=normalizeWorkspace(state,'memory_integration');assert.equal(image.rows.memoryEntities.length,2);assert.equal(image.rows.memoryRelationships.length,1);assert.equal(hydrateWorkspace(image).memoryRelationships![0].id,candidate.id);
  await assert.rejects(()=>send({type:'fact.propose',predicate:`relationship.uses_vendor.${vendor.id}`,value:'Bypass',subjectEntityId:product.id}),e=>(e as {code:string}).code==='MEMORY_RELATIONSHIP_RESERVED');
  const rootFact=(await send({type:'fact.propose',predicate:'deployment',value:'Root-only',practice:'live'})).snapshot.facts.at(-1)!;
  const scopedFact=(await send({type:'fact.propose',predicate:'deployment',value:'Sandbox-only',practice:'planned',conversationId:conversation.id,subjectEntityId:product.id})).snapshot.facts.at(-1)!;
  assert.notEqual(rootFact.subjectEntityId,scopedFact.subjectEntityId);
  await assert.rejects(()=>send({type:'fact.propose',predicate:'deployment',value:'Wrong subject',conversationId:conversation.id,subjectEntityId:vendor.id}),e=>(e as {code:string}).code==='MEMORY_SUBJECT_CHANGED');
  const deleted=await send({type:'source.revoke',sourceId:doc.sourceId,delete:true,reason:'Remove sandbox evidence'});
  assert.equal(deleted.snapshot.companyMemory.relationships.length,0);
  const raw=await readWorkspace(a.tenantId);assert.equal(raw.memoryRelationships![0].description,'');assert.equal(raw.facts.find(f=>f.id===confirmed.result.factId)!.value,null);
 }finally{await closeV2Store();if(old.data===undefined)delete process.env.KIARA_V2_DATA_DIR;else process.env.KIARA_V2_DATA_DIR=old.data;if(old.mongo===undefined)delete process.env.MONGODB_URI;else process.env.MONGODB_URI=old.mongo;if(old.ai===undefined)delete process.env.KIARA_V2_AI_MODE;else process.env.KIARA_V2_AI_MODE=old.ai;await rm(dir,{recursive:true,force:true});}
});
