import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,snapshot} from '../src/v2/service';
import {processConversationRun,type ConversationProvider} from '../src/v2/ai';
import {closeV2Store,readWorkspace} from '../src/v2/store';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';

let dir:string;const keys=['KIARA_V2_DATA_DIR','KIARA_GLOBAL_BUDGET_DIR','MONGODB_URI','VERCEL','KIARA_V2_AI_MODE','OPENAI_API_KEY','KIARA_OPENAI_BUDGET_USD','KIARA_MODEL','KIARA_REVIEW_MODEL','KIARA_REASONING_EFFORT'];const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'kiara-short-answer-'));process.env.KIARA_V2_DATA_DIR=join(dir,'workspace');process.env.KIARA_GLOBAL_BUDGET_DIR=join(dir,'budget');process.env.MONGODB_URI='';delete process.env.VERCEL;process.env.KIARA_V2_AI_MODE='local';process.env.OPENAI_API_KEY='injected-test-only';process.env.KIARA_OPENAI_BUDGET_USD='1';process.env.KIARA_MODEL='gpt-6-sol';process.env.KIARA_REVIEW_MODEL='gpt-6-sol';process.env.KIARA_REASONING_EFFORT='low';});
afterEach(async()=>{await closeV2Store();for(const key of keys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}await rm(dir,{recursive:true,force:true});});
const actor=(id='owner'):ActorContext=>({tenantId:'answer-preference',actorId:id,mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:id==='owner'?['member','business_owner','fact_owner']:['member']});
async function send(a:ActorContext,c:WorkspaceCommand){return command(a,{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(a)).version,command:c});}
function injectedProvider(overlong=false){let calls=0;const instructions:string[]=[];const adapter:ConversationProvider={count:async()=>1000,create:async request=>{calls++;instructions.push(String(request.instructions));const data=JSON.parse(String(request.input));const output=data.answer?{safe:true,checks:data.answer.paragraphs.map((paragraph:{id:string})=>({paragraphId:paragraph.id,supported:true,reason:'The exact supplied policy supports the bounded answer.'}))}:{paragraphs:[{id:'lead',kind:'grounded',text:overlong?'The policy says '+ 'support transcripts are retained for thirty days. '.repeat(17):'The policy retains support transcripts for thirty days.',citationIds:[data.evidence.find((item:{kind:string})=>item.kind==='document').id]},{id:'limits',kind:'limitation',text:'Check exceptions and current applicability; jurisdiction-specific legal coverage remains unverified.',citationIds:[]}]};return {id:'response-'+calls,model:String(request.model),status:'completed',output_text:JSON.stringify(output),usage:{input_tokens:100,output_tokens:100,total_tokens:200,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}};}};return {adapter,instructions,get calls(){return calls;}};}

test('exact short-answer preference adds a clear lead while keeping evidence and uncertainty personal',async()=>{
 const owner=actor(),other=actor('other');await snapshot(other);
 await send(owner,{type:'document.add',title:'Team retention policy',body:'The selected team record says support transcripts are retained for thirty days.',authority:'effective',scope:{kind:'team',actorIds:[]}});
 const preference=await send(owner,{type:'message.send',text:'Give me the short answer first'});assert.equal(preference.snapshot.preferences.find(p=>p.ownerId==='owner')?.value,'short answer first');
 const answer=await send(owner,{type:'message.send',text:'What does the team retention policy say?'}),message=answer.snapshot.messages.at(-1)!;
 assert.match(message.text,/^Short answer:/);assert.match(message.text,/Details and evidence:/);assert.match(message.text,/thirty days/);assert.match(message.text,/Jurisdiction-specific legal coverage is unverified/);assert.equal(message.citations.length,1);
 const otherAnswer=await send(other,{type:'message.send',text:'What does the team retention policy say?'});assert.doesNotMatch(otherAnswer.snapshot.messages.at(-1)!.text,/^Short answer:/);assert.equal(otherAnswer.snapshot.messages.at(-1)!.citations.length,1);
});

test('queued model answer pins the owner short preference and keeps supported limits after a later preference change',async()=>{
 const owner=actor(),other=actor('other');await snapshot(other);
 await send(owner,{type:'document.add',title:'Team retention policy',body:'The selected team record says support transcripts are retained for thirty days.',authority:'effective',scope:{kind:'team',actorIds:[]}});
 await send(owner,{type:'message.send',text:'Give me the short answer first'});process.env.KIARA_V2_AI_MODE='openai';
 const queued=await send(owner,{type:'message.send',text:'What does the team retention policy say?'}),id=String(queued.result.runId);
 const retained=(await readWorkspace(owner.tenantId)).receipts['conversation-run:'+id].result.run as {responseLength:string};assert.equal(retained.responseLength,'short');
 await send(owner,{type:'preference.set',key:'response_length',value:'detailed',target:'personal'});
 const model=injectedProvider();assert.equal((await processConversationRun(owner.tenantId,id,{provider:model.adapter})).status,'complete');assert.match(model.instructions[0],/short answer first/);assert.doesNotMatch(model.instructions[0],/prefers a detailed explanation/);
 const answer=(await snapshot(owner)).messages.find(message=>message.role==='assistant'&&message.generation==='model')!;assert.match(answer.text,/^Short answer: The policy retains support transcripts for thirty days\. \[Team retention policy\]/);assert.match(answer.text,/Details and limits:/);assert.match(answer.text,/jurisdiction-specific legal coverage remains unverified/);assert.equal(answer.citations.length,1);assert.ok(answer.text.length<600);
 const otherQueue=await send(other,{type:'message.send',text:'What does the team retention policy say?'}),otherModel=injectedProvider();assert.equal((await processConversationRun(other.tenantId,String(otherQueue.result.runId),{provider:otherModel.adapter})).status,'complete');assert.doesNotMatch(otherModel.instructions[0],/short answer first/);assert.doesNotMatch((await snapshot(other)).messages.filter(message=>message.generation==='model').at(-1)!.text,/^Short answer:/);
});

test('overlong model output cannot silently defeat the accepted short preference',async()=>{
 const owner=actor();await send(owner,{type:'document.add',title:'Team retention policy',body:'Support transcripts are retained for thirty days.',authority:'effective'});await send(owner,{type:'preference.set',key:'response_length',value:'short',target:'personal'});process.env.KIARA_V2_AI_MODE='openai';
 const queued=await send(owner,{type:'message.send',text:'What does the team retention policy say?'}),model=injectedProvider(true),result=await processConversationRun(owner.tenantId,String(queued.result.runId),{provider:model.adapter});assert.equal(result.status,'blocked');assert.equal(result.reason,'ANSWER_LENGTH_PREFERENCE');assert.equal(model.calls,1);assert.equal((await snapshot(owner)).messages.filter(message=>message.generation==='model').length,0);
});

test('bare assent asks one linked-matter clarification without approving or acting',async()=>{
 const owner=actor(),matter=(await send(owner,{type:'matter.create',title:'Supplier renewal',objective:'Review the renewal options.',scope:{kind:'team',actorIds:[]}})).snapshot.matters[0];
 const conversation=(await send(owner,{type:'conversation.create',title:'Renewal discussion',scope:matter.scope})).snapshot.conversations[0];
 await send(owner,{type:'conversation.link_matter',conversationId:conversation.id,matterId:matter.id,expectedConversationVersion:conversation.version,expectedMatterVersion:matter.version});
 const reply=await send(owner,{type:'message.send',conversationId:conversation.id,text:'go ahead'}),answer=reply.snapshot.messages.at(-1)!;
 assert.match(answer.text,/Do you want to prepare the review packet for “Supplier renewal”\?/);assert.equal((answer.text.match(/\?/g)||[]).length,1);assert.match(answer.text,/does not authorize/);assert.equal(reply.snapshot.proposals.length,0);assert.equal(reply.snapshot.approvals.length,0);assert.equal(reply.snapshot.actions.length,0);
 const generic=await send(owner,{type:'message.send',text:'go ahead'});assert.match(generic.snapshot.messages.at(-1)!.text,/Which existing matter or exact action/);
});
