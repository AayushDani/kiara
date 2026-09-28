import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,snapshot} from '../src/v2/service';
import {closeV2Store,readWorkspace} from '../src/v2/store';
import {interpretVoice,type VoiceInterpretationReview} from '../src/v2/voice-interpretation';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';

let dir:string;const previous={data:process.env.KIARA_V2_DATA_DIR,mongo:process.env.MONGODB_URI,ai:process.env.KIARA_V2_AI_MODE};
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'kiara-voice-review-'));process.env.KIARA_V2_DATA_DIR=dir;process.env.MONGODB_URI='';process.env.KIARA_V2_AI_MODE='local';});
afterEach(async()=>{await closeV2Store();if(previous.data===undefined)delete process.env.KIARA_V2_DATA_DIR;else process.env.KIARA_V2_DATA_DIR=previous.data;if(previous.mongo===undefined)delete process.env.MONGODB_URI;else process.env.MONGODB_URI=previous.mongo;if(previous.ai===undefined)delete process.env.KIARA_V2_AI_MODE;else process.env.KIARA_V2_AI_MODE=previous.ai;await rm(dir,{recursive:true,force:true});});
const actor=():ActorContext=>({tenantId:'voice-review',actorId:'owner',mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','business_owner','fact_owner','admin']});
const send=async(c:WorkspaceCommand)=>command(actor(),{idempotencyKey:randomUUID(),expectedVersion:(await snapshot(actor())).version,command:c});
function review(transcript:string,subjectId='',subjectHash='',names:{id:string;name:string}[]=[]):VoiceInterpretationReview {const parsed=interpretVoice(transcript,subjectId);return {transcriptHash:createHash('sha256').update(transcript,'utf8').digest('hex'),subjectId,subjectHash,names,dates:parsed.dates,amounts:parsed.amounts,ambiguityResolved:true};}

test('confirmed voice requires frozen exact bytes, subject and resolved names/dates/amounts before instruction handling',async()=>{
 const transcript='Draft a supplier notice for 2026-09-10 with a $5,000 cap.';
 await assert.rejects(send({type:'message.send',text:transcript,channel:'voice',voiceConfirmed:true}),{code:'VOICE_INTERPRETATION_REQUIRED'});
 await assert.rejects(send({type:'message.send',text:transcript.replace('$5,000','$50,000'),channel:'voice',voiceConfirmed:true,voiceInterpretation:review(transcript)}),{code:'VOICE_INTERPRETATION_CHANGED'});
 await assert.rejects(send({type:'message.send',text:transcript,channel:'voice',voiceConfirmed:true,voiceInterpretation:{...review(transcript),amounts:['$50,000']}}),{code:'VOICE_INTERPRETATION_CHANGED'});
 const result=await send({type:'message.send',text:transcript,channel:'voice',voiceConfirmed:true,voiceInterpretation:review(transcript)});
 const user=result.snapshot.messages.find(m=>m.role==='user')!;assert.equal(user.voiceConfirmed,true);assert.deepEqual(user.voiceInterpretation?.dates,['2026-09-10']);assert.deepEqual(user.voiceInterpretation?.amounts,['$5,000']);
 assert.equal(result.snapshot.actions.length,0);assert.equal(result.snapshot.approvals.length,0);
});

test('ambiguous spoken date and unresolved interpretation cannot become confirmed voice work',async()=>{
 const transcript='Draft the notice for 09/10 and $5,000.';
 await assert.rejects(send({type:'message.send',text:transcript,channel:'voice',voiceConfirmed:true,voiceInterpretation:review(transcript)}),{code:'VOICE_INTERPRETATION_CHANGED'});
 await assert.rejects(send({type:'message.send',text:'Discuss the date 2026-09-10.',channel:'voice',voiceConfirmed:true,voiceInterpretation:{...review('Discuss the date 2026-09-10.'),ambiguityResolved:false} as never}),{code:'VOICE_INTERPRETATION_CHANGED'});
 const unconfirmed=await send({type:'message.send',text:transcript,channel:'voice',voiceConfirmed:false});assert.equal(unconfirmed.snapshot.messages.find(m=>m.role==='user')?.voiceConfirmed,false);assert.equal(unconfirmed.snapshot.facts.length,0);
});

test('relative spoken dates require transcript correction before confirmed work',async()=>{
 const transcript='Draft the supplier notice next Friday for RelayAI.';
 assert.deepEqual(interpretVoice(transcript,'').dates,[]);
 assert.deepEqual(interpretVoice(transcript,'').ambiguous,['next Friday']);
 assert.deepEqual(interpretVoice('Send it Friday or in two business days.','').ambiguous,['Friday','in two business days']);
 assert.deepEqual(interpretVoice('Send it Friday, October 2, 2026.','').ambiguous,[]);
 assert.deepEqual(interpretVoice('Send it Friday, October 3, 2026.','').ambiguous,['Friday']);
 assert.deepEqual(interpretVoice('Send it within 30 days of signing or by the end of the month.','').ambiguous,['within 30 days','by the end of the month']);
 assert.deepEqual(interpretVoice('Send it by the end of next quarter or in two calendar weeks.','').ambiguous,['by the end of next quarter','in two calendar weeks']);
 assert.deepEqual(interpretVoice('Review today’s signed contract.','').ambiguous,[]);
 assert.deepEqual(interpretVoice('Draft the Monday.com agreement.','').ambiguous,[]);
 assert.deepEqual(interpretVoice('Send it February 30, 2026.','').ambiguous,['February 30, 2026']);
 await assert.rejects(send({type:'message.send',text:transcript,channel:'voice',voiceConfirmed:true,voiceInterpretation:review(transcript)}),{code:'VOICE_INTERPRETATION_CHANGED'});
 const unchanged=await readWorkspace(actor().tenantId);
 assert.equal(unchanged.messages.length,0);assert.equal(unchanged.facts.length,0);assert.equal(unchanged.actions.length,0);
 const corrected='Draft the supplier notice for 2026-10-02 for RelayAI.';
 const accepted=await send({type:'message.send',text:corrected,channel:'voice',voiceConfirmed:true,voiceInterpretation:review(corrected)});
 assert.equal(accepted.snapshot.messages.find(m=>m.role==='user')?.voiceConfirmed,true);
 assert.equal(accepted.snapshot.actions.length,0);
});

test('declared name review binds exact subject identity and current audience',async()=>{
 const team={kind:'team' as const,actorIds:[]},entity=(await send({type:'memory.entity.declare',kind:'vendor',name:'RelayAI',aliases:[],ownerId:'owner',scope:team})).snapshot.companyMemory.entities[0];
 const c=(await send({type:'conversation.create',title:'Vendor review',scope:team,subjectEntityId:entity.id})).snapshot.conversations[0],transcript='Discuss RelayAI on 2026-09-10 for $5,000.';
 const frozen=review(transcript,entity.id,entity.entityHash,[{id:entity.id,name:entity.name}]);
 await assert.rejects(send({type:'message.send',conversationId:c.id,text:transcript,channel:'voice',voiceConfirmed:true,subjectEntityId:entity.id,voiceInterpretation:{...frozen,subjectHash:'stale'}}),{code:'VOICE_INTERPRETATION_CHANGED'});
 await assert.rejects(send({type:'message.send',conversationId:c.id,text:transcript,channel:'voice',voiceConfirmed:true,subjectEntityId:entity.id,voiceInterpretation:{...frozen,names:[]}}),{code:'VOICE_INTERPRETATION_CHANGED'});
 const accepted=await send({type:'message.send',conversationId:c.id,text:transcript,channel:'voice',voiceConfirmed:true,subjectEntityId:entity.id,voiceInterpretation:frozen});assert.equal(accepted.snapshot.messages.find(m=>m.role==='user')?.voiceInterpretation?.subjectId,entity.id);
 const current=(await snapshot(actor())).companyMemory.entities.find(e=>e.id===entity.id)!;await send({type:'memory.entity.archive',entityId:current.id,expectedRecordVersion:current.version,entityHash:current.entityHash,reason:'Identity withdrawn'});
 await assert.rejects(send({type:'message.send',conversationId:c.id,text:transcript,channel:'voice',voiceConfirmed:true,subjectEntityId:entity.id,voiceInterpretation:frozen}),{code:'NOT_FOUND'});
});

test('deleting a current declaration source scrubs its frozen voice interpretation',async()=>{
 const team={kind:'team' as const,actorIds:[]},entity=(await send({type:'memory.entity.declare',kind:'vendor',name:'RelayAI',aliases:[],ownerId:'owner',scope:team})).snapshot.companyMemory.entities[0];
 const c=(await send({type:'conversation.create',title:'Vendor review',scope:team,subjectEntityId:entity.id})).snapshot.conversations[0],transcript='Discuss RelayAI on 2026-09-10 for $5,000.';
 await send({type:'message.send',conversationId:c.id,text:transcript,channel:'voice',voiceConfirmed:true,subjectEntityId:entity.id,voiceInterpretation:review(transcript,entity.id,entity.entityHash,[{id:entity.id,name:entity.name}])});
 await send({type:'source.revoke',sourceId:entity.declarationSourceId,delete:true,reason:'Erase declaration and derived voice review'});
 const raw=await readWorkspace(actor().tenantId);assert.equal(raw.messages.find(m=>m.role==='user')!.voiceInterpretation,null);assert.equal(raw.messages.find(m=>m.role==='user')!.text,'');
});
