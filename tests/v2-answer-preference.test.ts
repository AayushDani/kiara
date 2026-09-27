import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,snapshot} from '../src/v2/service';
import {closeV2Store} from '../src/v2/store';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';

let dir:string;const prior={data:process.env.KIARA_V2_DATA_DIR,mongo:process.env.MONGODB_URI,ai:process.env.KIARA_V2_AI_MODE};
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'kiara-short-answer-'));process.env.KIARA_V2_DATA_DIR=dir;process.env.MONGODB_URI='';process.env.KIARA_V2_AI_MODE='local';});
afterEach(async()=>{await closeV2Store();if(prior.data===undefined)delete process.env.KIARA_V2_DATA_DIR;else process.env.KIARA_V2_DATA_DIR=prior.data;if(prior.mongo===undefined)delete process.env.MONGODB_URI;else process.env.MONGODB_URI=prior.mongo;if(prior.ai===undefined)delete process.env.KIARA_V2_AI_MODE;else process.env.KIARA_V2_AI_MODE=prior.ai;await rm(dir,{recursive:true,force:true});});
const actor=(id='owner'):ActorContext=>({tenantId:'answer-preference',actorId:id,mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:id==='owner'?['member','business_owner','fact_owner']:['member']});
async function send(a:ActorContext,c:WorkspaceCommand){return command(a,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(a)).version,command:c});}

test('exact short-answer preference adds a clear lead while keeping evidence and uncertainty personal',async()=>{
 const owner=actor(),other=actor('other');await snapshot(other);
 await send(owner,{type:'document.add',title:'Team retention policy',body:'The selected team record says support transcripts are retained for thirty days.',authority:'effective',scope:{kind:'team',actorIds:[]}});
 const preference=await send(owner,{type:'message.send',text:'Give me the short answer first'});assert.equal(preference.snapshot.preferences.find(p=>p.ownerId==='owner')?.value,'short answer first');
 const answer=await send(owner,{type:'message.send',text:'What does the team retention policy say?'}),message=answer.snapshot.messages.at(-1)!;
 assert.match(message.text,/^Short answer:/);assert.match(message.text,/Details and evidence:/);assert.match(message.text,/thirty days/);assert.match(message.text,/Jurisdiction-specific legal coverage is unverified/);assert.equal(message.citations.length,1);
 const otherAnswer=await send(other,{type:'message.send',text:'What does the team retention policy say?'});assert.doesNotMatch(otherAnswer.snapshot.messages.at(-1)!.text,/^Short answer:/);assert.equal(otherAnswer.snapshot.messages.at(-1)!.citations.length,1);
});

test('bare assent asks one linked-matter clarification without approving or acting',async()=>{
 const owner=actor(),matter=(await send(owner,{type:'matter.create',title:'Supplier renewal',objective:'Review the renewal options.',scope:{kind:'team',actorIds:[]}})).snapshot.matters[0];
 const conversation=(await send(owner,{type:'conversation.create',title:'Renewal discussion',scope:matter.scope})).snapshot.conversations[0];
 await send(owner,{type:'conversation.link_matter',conversationId:conversation.id,matterId:matter.id,expectedConversationVersion:conversation.version,expectedMatterVersion:matter.version});
 const reply=await send(owner,{type:'message.send',conversationId:conversation.id,text:'go ahead'}),answer=reply.snapshot.messages.at(-1)!;
 assert.match(answer.text,/Do you want to prepare the review packet for “Supplier renewal”\?/);assert.equal((answer.text.match(/\?/g)||[]).length,1);assert.match(answer.text,/does not authorize/);assert.equal(reply.snapshot.proposals.length,0);assert.equal(reply.snapshot.approvals.length,0);assert.equal(reply.snapshot.actions.length,0);
 const generic=await send(owner,{type:'message.send',text:'go ahead'});assert.match(generic.snapshot.messages.at(-1)!.text,/Which existing matter or exact action/);
});
