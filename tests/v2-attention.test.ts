import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyAttentionCommand,attentionView,type AttentionSettings,type AttentionDecision} from '../src/v2/attention';
import {command,snapshot} from '../src/v2/service';
import {readWorkspace,closeV2Store} from '../src/v2/store';
import type {ActorContext,WorkspaceState,WorkspaceCommand} from '../src/v2/contracts';
let sequence=0;const dirs:string[]=[];const actor=(id='owner'):ActorContext=>({tenantId:'attention',actorId:id,mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','business_owner','fact_owner']});
beforeEach(async()=>{await closeV2Store();const dir=await mkdtemp(join(tmpdir(),'kiara-attention-'));dirs.push(dir);process.env.KIARA_V2_DATA_DIR=dir;process.env.KIARA_V2_AI_MODE='local';delete process.env.MONGODB_URI;});
after(async()=>{await closeV2Store();await Promise.all(dirs.map(dir=>rm(dir,{recursive:true,force:true})));});
const send=async(c:WorkspaceCommand)=>command(actor(),{idempotencyKey:`attention-${++sequence}`,expectedVersion:(await snapshot(actor())).version,command:c});
type State=WorkspaceState&{attentionSettings?:AttentionSettings[];attentionDecisions?:AttentionDecision[]};
async function fixture(){await send({type:'matter.create',title:'Owned work',objective:'Inspect the owned next step.',scope:{kind:'team',actorIds:[]}});return await readWorkspace('attention') as State;}
const policy={type:'attention.configure',expectedRecordVersion:0,timezone:'America/New_York',quietEnabled:true,quietStart:'18:00',quietEnd:'09:00',digestAt:'09:00',approachingHours:24} as const;

test('quiet hours and digest grouping apply to ordinary work, with timezone-aware next delivery',async()=>{
 const s=await fixture();applyAttentionCommand(s,actor(),policy);const evening=attentionView(s,actor(),Date.parse('2030-01-15T00:00:00Z'));assert.equal(evening.quietNow,true);assert.ok(evening.items.length);assert.ok(evening.items.every(i=>i.placement==='digest'));assert.equal(evening.nextDigestAt,'2030-01-15T14:00:00.000Z');
 const morning=attentionView(s,actor(),Date.parse('2030-01-15T15:00:00Z'));assert.equal(morning.quietNow,false);assert.equal(morning.digestReady,true);assert.equal(morning.delivery,'in_app');assert.throws(()=>applyAttentionCommand(s,actor(),policy),{code:'VERSION_CONFLICT'});assert.throws(()=>applyAttentionCommand(s,actor(),{...policy,expectedRecordVersion:1,timezone:'not/a/timezone'}),{code:'INVALID_TIMEZONE'});
});
test('required overdue work stays visible after acknowledgment in quiet hours',async()=>{
 const s=await fixture(),m=s.matters[0];m.tasks[0].dueAt='2020-01-01T00:00:00Z';m.tasks[0].deadlineType='response_target';applyAttentionCommand(s,actor(),policy);const first=attentionView(s,actor()).items.find(i=>i.id===`task:${m.tasks[0].id}`)!;assert.equal(first.required,true);assert.equal(first.placement,'now');assert.throws(()=>applyAttentionCommand(s,actor(),{type:'attention.decide',itemId:first.id,fingerprint:first.fingerprint,decision:'dismissed',reason:'Ignore it'}),{code:'REQUIRED_ATTENTION'});
 applyAttentionCommand(s,actor(),{type:'attention.decide',itemId:first.id,fingerprint:first.fingerprint,decision:'acknowledged',reason:'I have inspected the target; work remains pending.'});const after=attentionView(s,actor()).items.find(i=>i.id===first.id)!;assert.equal(after.acknowledged,true);assert.equal(after.placement,'now');assert.equal(m.tasks[0].status,'pending');assert.equal(s.attentionDecisions?.[0].reason,'I have inspected the target; work remains pending.');
});
test('dismissal requires an exact visible item and reappears after the underlying work changes',async()=>{
 const s=await fixture(),first=attentionView(s,actor()).items[0];applyAttentionCommand(s,actor(),{type:'attention.decide',itemId:first.id,fingerprint:first.fingerprint,decision:'dismissed',reason:'Track this in my planned work session.'});assert.ok(!attentionView(s,actor()).items.some(i=>i.id===first.id));assert.equal(attentionView(s,actor()).dismissedCount,1);s.matters[0].version++;assert.ok(attentionView(s,actor()).items.some(i=>i.id===first.id));assert.throws(()=>applyAttentionCommand(s,actor(),{type:'attention.decide',itemId:first.id,fingerprint:first.fingerprint,decision:'dismissed',reason:'Stale decision'}),{code:'ATTENTION_CHANGED'});
});
test('attention hides another owner’s tasks and withdrawn-source content',async()=>{
 const s=await fixture(),m=s.matters[0];await snapshot(actor('other'));s.memberships.push({actorId:'other',roles:['member','fact_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});assert.equal(attentionView(s,actor('other')).items.length,0);
 const source={...m,id:'source',title:'Private source',kind:'manual' as const,externalId:null,externalRevision:null,text:'Hidden payload',contentHash:'fixture',url:null,status:'revoked' as const,aclVersion:2,observedAt:m.createdAt,effectiveAt:null,authority:'unknown' as const,originalObjectRef:null};s.sources.push(source);m.provenance.sourceIds.push(source.id);assert.equal(attentionView(s,actor()).items.length,0);assert.doesNotMatch(JSON.stringify(attentionView(s,actor())),/Hidden payload|Owned work/);
});
