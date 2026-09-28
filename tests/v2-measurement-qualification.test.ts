import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {caseEvidenceBindingHash,caseOutcomeHash,qualifyPairedCases,type PairedCaseManifest,type QualificationReason} from '../src/v2/measurement-qualification';
import {applyMeasurementCommand,effortComparisons} from '../src/v2/measurement';
import {snapshotFromState} from '../src/v2/service';
import {digest,emptyWorkspace} from '../src/v2/store';
import {valueView,type ValueGoal,type ValueReceipt,type ValueSession} from '../src/v2/value';
import type {EffortBaseline,EffortEntry} from '../src/v2/measurement';
import type {Action,ActorContext,Matter,Proposal,RecordBase,WorkspaceState} from '../src/v2/contracts';

const scope={kind:'team' as const,actorIds:[]};
const closedAt='2026-09-27T12:00:00.000Z',reviewedAt='2026-09-27T13:00:00.000Z';
function base(s:WorkspaceState,id:string,actorId='owner'):RecordBase{return {id,tenantId:s.tenantId,version:1,createdAt:'2026-09-27T09:00:00.000Z',updatedAt:closedAt,scope,provenance:{actorId,sourceIds:[],description:'Synthetic qualification fixture'}};}
function matter(s:WorkspaceState,id:string):Matter{return {...base(s,id),title:id,objective:'Review the same fictional support-summary change',entityId:s.entityId,state:'closed',ownerId:'owner',conversationIds:[],scenarioId:null,eventIds:[],sourceIds:[],factIds:[],documentIds:[],proposalId:null,tasks:[{id:`${id}-task`,title:'Review exact fictional outcome',ownerId:'owner',status:'done',kind:'business',dueAt:null,deadlineType:'undated',evidenceIds:[`${id}-receipt`]}],blockers:[],outcome:'Fictional reviewed work completed.',closedAt,ruleVersion:1};}
function action(s:WorkspaceState,matterId:string):Action{return {...base(s,`${matterId}-action`,'publisher'),matterId,proposalId:`${matterId}-proposal`,kind:'internal_document',title:'Fictional exact output',content:'Synthetic reviewed text',contentHash:digest('Synthetic reviewed text'),recipients:[],destination:null,status:'verified',authorizationId:null,providerIdempotencyKey:`${matterId}-effect`,providerReceipt:'synthetic-readback',completion:{kind:'readback',artifact:`${matterId}-receipt`,verifierId:'publisher',verifiedAt:closedAt},executionOwner:'v2',leaseUntil:null};}
function proposal(s:WorkspaceState,matterId:string):Proposal{const body=`Synthetic reviewed proposal for ${matterId}`;return {...base(s,`${matterId}-proposal`),matterId,title:`Proposal ${matterId}`,body,contentHash:digest(body),baselineRevisionIds:[],dependencies:{sourceVersions:{},factVersions:{},documentHashes:{},policyVersion:1,scopeHash:digest(scope)},status:'current',route:'legal_review',noticeMatrix:[],inventoryComplete:false,unknowns:[],supersedesId:null};}
function effort(s:WorkspaceState,id:string,matterId:string,actorId:string,stage:EffortEntry['stage'],minutes:number):EffortEntry{return {...base(s,id,actorId),matterId,actorId,stage,method:'human_report',minutes,startedAt:'2026-09-27T10:00:00.000Z',stoppedAt:'2026-09-27T10:00:00.000Z',evidence:`Fictional independent timesheet reference ${id}`,voidReason:null};}
function fixture(){
 const s=emptyWorkspace('paired-cases-fixture');
 for(const [actorId,roles] of [['owner',['member','business_owner']],['publisher',['member','publisher']],['counsel',['member','legal_reviewer']],['evaluator',['member','evaluator']]] as const)s.memberships.push({actorId,roles:[...roles],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
 s.matters.push(matter(s,'before'),matter(s,'after'));s.actions.push(action(s,'before'),action(s,'after'));s.proposals.push(proposal(s,'before'),proposal(s,'after'));for(const item of s.matters)item.proposalId=`${item.id}-proposal`;
 s.counsel.push({...base(s,'counsel-review','counsel'),matterId:'after',route:'existing',status:'returned',counselActorId:'counsel'} as WorkspaceState['counsel'][number]);
 s.effortEntries=[effort(s,'before-owner','before','owner','setup',20),effort(s,'before-publisher','before','publisher','execution',40),effort(s,'after-owner','after','owner','setup',10),effort(s,'after-publisher','after','publisher','execution',20),effort(s,'after-counsel','after','counsel','review',10),effort(s,'after-correction','after','owner','correction',5)];
 const comparisonScope='Same fictional objective, audience, review standard and completion definition';
 const baseline:EffortBaseline={...base(s,'baseline-record'),matterId:'after',minutes:60,method:'observed_comparable_work',comparisonScope,evidence:'Fictional attributed timesheet for exact before matter.',observedMatterId:'before',observedCaseBindingHash:caseEvidenceBindingHash(s,'before'),current:true,supersedesId:null};s.effortBaselines=[baseline];
 const privateBase=(id:string):RecordBase=>({...base(s,id),scope:{kind:'private',actorIds:['owner']}});
 const session:ValueSession={...privateBase('value-session'),ownerId:'owner',observedStartedAt:'2026-09-27T09:00:00.000Z',baselineKind:'observed_command',measurement:'observed',firstGeneratedAt:'2026-09-27T09:00:00.000Z',firstUsefulReceiptId:'before-useful'};s.valueSessions=[session];
 s.valueGoals=(['before','after'] as const).map(id=>({...privateBase(`${id}-goal`),ownerId:'owner',sessionId:session.id,title:`Useful ${id} packet`,successCriteria:'Owner reports this exact reviewed packet useful.',conversationId:null,status:'working',outcomeNote:null,outcomeReceiptId:null}) satisfies ValueGoal);
 const actor:ActorContext={tenantId:s.tenantId,actorId:'owner',mode:'authenticated',expiresAt:Date.now()+60_000},outputs=valueView(s,actor).outputs;
 s.valueReceipts=(['before','after'] as const).map(id=>{const output=outputs.find(item=>item.id===`${id}-proposal`)!;return {...privateBase(`${id}-useful`),ownerId:'owner',sessionId:session.id,goalId:`${id}-goal`,outputKind:'proposal',outputId:output.id,outputVersion:output.version,outputHash:output.hash,outputTitle:output.title,outputCreatedAt:output.createdAt,disposition:'useful',reason:`Fictional owner report of useful ${id} packet.`,status:'current',withdrawalReason:null} satisfies ValueReceipt;});
 const manifest:PairedCaseManifest={tenantId:s.tenantId,comparisonScope,baselineRecordId:baseline.id,baseline:{matterId:'before',outcomeHash:caseOutcomeHash(s,'before')!,usefulnessReceiptId:'before-useful',actionIds:['before-action'],participantIds:['owner','publisher'],effortEntryIds:['before-owner','before-publisher']},current:{matterId:'after',outcomeHash:caseOutcomeHash(s,'after')!,usefulnessReceiptId:'after-useful',actionIds:['after-action'],participantIds:['owner','publisher','counsel'],effortEntryIds:['after-owner','after-publisher','after-counsel','after-correction']},quality:{reviewerId:'evaluator',reviewerMembershipVersion:1,reviewedAt,artifactDigest:digest('Synthetic independently reviewed quality artifact'),comparisonScope,baselineOutcomeHash:caseOutcomeHash(s,'before')!,currentOutcomeHash:caseOutcomeHash(s,'after')!,verdict:'equivalent_quality'}};
 return {s,manifest};
}
function incomplete(change:(s:WorkspaceState,manifest:PairedCaseManifest)=>void,reason:QualificationReason){const {s,manifest}=fixture();change(s,manifest);const result=qualifyPairedCases(s,manifest);assert.equal(result.status,'incomplete');assert.ok(result.reasons.includes(reason),`${reason}: ${result.reasons.join(', ')}`);assert.equal(result.recordedMinutes,null);}

test('exact observed pair is structurally ready, counts correction once and never claims savings',()=>{
 const {s,manifest}=fixture(),before=digest(s),result=qualifyPairedCases(s,manifest);
 assert.equal(result.status,'evidence_ready');assert.deepEqual(result.reasons,[]);assert.deepEqual(result.recordedMinutes,{baseline:60,current:45,baselineCorrection:0,currentCorrection:5});assert.match(result.interpretation,/not verified customer value|not.*savings/);assert.equal(digest(s),before,'qualification is read-only');
});
test('open work, pending effects and unfulfilled obligations fail closed',()=>{
 incomplete(s=>{s.matters[1].state='verifying';},'OUTCOME_OPEN');
 incomplete(s=>{s.actions[1].status='pending_manual';s.actions[1].completion=null;},'ACTIONS_PENDING');
 incomplete(s=>{s.matters[1].tasks[0].status='pending';},'TASKS_PENDING');
 incomplete(s=>{s.obligations!.push({...base(s,'pending-obligation'),matterId:'after',status:'active',completion:null} as NonNullable<WorkspaceState['obligations']>[number]);},'OBLIGATIONS_PENDING');
});
test('exact roster and all effort entries are required, including counsel and correction work',()=>{
 incomplete(s=>{s.effortEntries=s.effortEntries!.filter(item=>item.id!=='after-counsel');},'EFFORT_MISSING');
 incomplete((_s,m)=>{m.current.participantIds=['owner','publisher'];},'PARTICIPANT_ROSTER_INCOMPLETE');
 incomplete((_s,m)=>{m.current.effortEntryIds=['after-owner','after-publisher','after-counsel'];},'EFFORT_SET_CHANGED');
 incomplete(s=>{s.effortEntries![0].stoppedAt=null;},'EFFORT_INCOMPLETE');
 incomplete(s=>{s.effortEntries![0].voidReason='Duplicate entry';},'EFFORT_INCOMPLETE');
 incomplete(s=>{s.effortEntries!.push({...s.effortEntries![0],id:'duplicate-timesheet'});},'EFFORT_DUPLICATE');
 incomplete(s=>{s.effortEntries![0].method='elapsed_timer';s.effortEntries![0].startedAt='2026-09-27T10:00:00.000Z';s.effortEntries![0].stoppedAt='2026-09-27T10:30:00.000Z';s.effortEntries![1].method='elapsed_timer';s.effortEntries![1].actorId='owner';s.effortEntries![1].startedAt='2026-09-27T10:15:00.000Z';s.effortEntries![1].stoppedAt='2026-09-27T10:45:00.000Z';},'EFFORT_DUPLICATE');
 incomplete(s=>{const before=s.effortEntries!.find(item=>item.id==='before-owner')!,after=s.effortEntries!.find(item=>item.id==='after-owner')!;before.method='elapsed_timer';before.startedAt='2026-09-27T10:00:00.000Z';before.stoppedAt='2026-09-27T10:20:00.000Z';after.method='elapsed_timer';after.startedAt='2026-09-27T10:10:00.000Z';after.stoppedAt='2026-09-27T10:20:00.000Z';},'EFFORT_DUPLICATE');
 incomplete(s=>{const after=s.effortEntries!.find(item=>item.id==='after-owner')!;after.method='elapsed_timer';after.startedAt='2026-09-27T10:00:00.000Z';after.stoppedAt='2026-09-27T10:20:00.000Z';},'EFFORT_DURATION_CHANGED');
 incomplete(s=>{s.counsel[0].counselActorId=null;},'COUNSEL_EFFORT_UNACCOUNTED');
 incomplete(s=>{s.memberships.push({actorId:'intake-owner',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});s.counsel[0].intakeRecordedBy='intake-owner';},'EFFORT_MISSING');
 incomplete(s=>{s.memberships.push({actorId:'terms-owner',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});s.counsel[0].engagementApproval={actorId:'terms-owner',membershipVersion:1,termsHash:digest('terms'),approvedAt:closedAt};},'EFFORT_MISSING');
 incomplete(s=>{s.effortEntries!.push({...effort(s,'goal-only-work','after','owner','setup',12),matterId:null,goalId:'after-goal'});},'GOAL_EFFORT_UNRECONCILED');
});
test('missing, withdrawn or stale exact usefulness receipts cannot qualify a completed pair',()=>{
 incomplete((_s,m)=>{m.current.usefulnessReceiptId='absent';},'USEFULNESS_RECEIPT_MISSING');
 incomplete(s=>{s.valueReceipts!.find(item=>item.id==='after-useful')!.status='withdrawn';},'USEFULNESS_RECEIPT_CHANGED');
 incomplete(s=>{s.proposals.find(item=>item.id==='after-proposal')!.version++;},'USEFULNESS_RECEIPT_CHANGED');
 incomplete(s=>{s.valueReceipts!.find(item=>item.id==='after-useful')!.outputHash='stale';},'USEFULNESS_RECEIPT_CHANGED');
 incomplete(s=>{
  s.memberships.push({actorId:'assessor',roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
  s.valueSessions!.push({...s.valueSessions![0],id:'assessor-session',ownerId:'assessor'});
  s.valueGoals!.push({...s.valueGoals!.find(item=>item.id==='after-goal')!,id:'assessor-goal',ownerId:'assessor',sessionId:'assessor-session'});
  const receipt=s.valueReceipts!.find(item=>item.id==='after-useful')!;receipt.ownerId='assessor';receipt.sessionId='assessor-session';receipt.goalId='assessor-goal';
 },'EFFORT_MISSING');
});
test('estimated or unmatched baselines, changed outcomes and incomparable scopes fail closed',()=>{
 incomplete(s=>{s.effortBaselines![0].method='estimate';},'BASELINE_NOT_OBSERVED');
 incomplete(s=>{s.effortBaselines![0].minutes=55;},'BASELINE_NOT_PAIRED');
 incomplete(s=>{s.effortBaselines![0].observedCaseBindingHash=null;},'BASELINE_NOT_PAIRED');
 incomplete(s=>{s.effortBaselines![0].observedMatterId='after';},'BASELINE_NOT_PAIRED');
 incomplete(s=>{s.effortBaselines![0].observedCaseBindingHash=caseEvidenceBindingHash(s,'after');},'BASELINE_NOT_PAIRED');
 incomplete(s=>{s.matters[1].scope={kind:'private',actorIds:['owner']};},'SCOPE_NOT_COMPARABLE');
 incomplete(s=>{s.matters[1].outcome='Different final result';},'OUTCOME_CHANGED');
 incomplete((_s,m)=>{m.baseline.matterId=m.current.matterId;},'TENANT_OR_PAIR_CHANGED');
 incomplete(s=>{s.rehearsal=true;},'REHEARSAL_EXCLUDED');
});
test('recording an observed baseline binds the exact completed case and all its attributed effort',()=>{
 const {s,manifest}=fixture(),actor:ActorContext={tenantId:s.tenantId,actorId:'owner',mode:'authenticated',expiresAt:Date.now()+60_000};
 s.effortBaselines=[];
 const result=applyMeasurementCommand(s,actor,{type:'baseline.record',matterId:'after',observedMatterId:'before',minutes:60,method:'observed_comparable_work',comparisonScope:manifest.comparisonScope,evidence:'Attributed timesheet for the selected completed comparison case.'});
 manifest.baselineRecordId=String(result.baselineId);
 assert.equal(s.effortBaselines[0].observedCaseBindingHash,caseEvidenceBindingHash(s,'before'));
 assert.equal(s.effortBaselines[0].observedMatterId,'before');
 assert.equal(qualifyPairedCases(s,manifest).status,'evidence_ready');
 s.matters[0].objective='A corrected historical outcome basis';
 manifest.baseline.outcomeHash=caseOutcomeHash(s,'before')!;manifest.quality!.baselineOutcomeHash=manifest.baseline.outcomeHash;
 assert.ok(qualifyPairedCases(s,manifest).reasons.includes('BASELINE_NOT_PAIRED'));
 assert.throws(()=>applyMeasurementCommand(s,actor,{type:'baseline.record',matterId:'after',observedMatterId:'after',minutes:60,method:'observed_comparable_work',comparisonScope:manifest.comparisonScope,evidence:'Wrong case.'}),{code:'INVALID_OBSERVED_CASE'});
 assert.throws(()=>applyMeasurementCommand(s,actor,{type:'baseline.record',matterId:'after',observedMatterId:'before',minutes:59,method:'observed_comparable_work',comparisonScope:manifest.comparisonScope,evidence:'Wrong amount.'}),{code:'OBSERVED_MINUTES_CHANGED'});
});
test('an observed case cannot widen its audience and changed or inaccessible cases lose their comparison',()=>{
 const {s,manifest}=fixture(),owner:ActorContext={tenantId:s.tenantId,actorId:'owner',mode:'authenticated',expiresAt:Date.now()+60_000};
 s.matters[0].scope={kind:'private',actorIds:['owner']};
 assert.throws(()=>applyMeasurementCommand(s,owner,{type:'baseline.record',matterId:'after',observedMatterId:'before',minutes:60,method:'observed_comparable_work',comparisonScope:manifest.comparisonScope,evidence:'Private historical work.'}),{code:'OBSERVED_CASE_AUDIENCE'});
 const other=fixture(),publisher:ActorContext={tenantId:other.s.tenantId,actorId:'publisher',mode:'authenticated',expiresAt:Date.now()+60_000};
 other.s.effortEntries![0].evidence='Corrected historical time record.';
 assert.equal(effortComparisons(other.s,owner)[1].baselineBindingStatus,'stale');
 assert.equal(effortComparisons(other.s,owner)[1].differenceMinutes,null);
 other.s.memberships.find(member=>member.actorId==='publisher')!.matterIds=['after'];
 other.s.effortBaselines![0].scope={kind:'matter',matterId:'after',actorIds:[]};
 assert.equal(effortComparisons(other.s,publisher)[0].baselineMinutes,null);
 assert.equal(snapshotFromState(other.s,publisher).effortBaselines?.some(item=>item.id===other.s.effortBaselines![0].id),false);
 const hiddenEffort=fixture();hiddenEffort.s.effortEntries![0].scope={kind:'private',actorIds:['owner']};
 assert.equal(effortComparisons(hiddenEffort.s,publisher).find(item=>item.matterId==='after')?.baselineMinutes,null);
 assert.equal(snapshotFromState(hiddenEffort.s,publisher).effortBaselines?.some(item=>item.id===hiddenEffort.s.effortBaselines![0].id),false);
});
test('independent, exact-basis quality adjudication is mandatory',()=>{
 incomplete((_s,m)=>{m.quality=null;},'QUALITY_REVIEW_MISSING');
 incomplete((_s,m)=>{m.quality!.reviewerId='owner';},'QUALITY_REVIEW_NOT_INDEPENDENT');
 incomplete(s=>{s.memberships.find(member=>member.actorId==='evaluator')!.matterIds=['before'];},'QUALITY_REVIEW_NOT_INDEPENDENT');
 incomplete(s=>{s.memberships.find(member=>member.actorId==='evaluator')!.entityIds=['another-entity'];},'QUALITY_REVIEW_NOT_INDEPENDENT');
 incomplete((_s,m)=>{m.quality!.artifactDigest='not-a-digest';},'QUALITY_REVIEW_MISSING');
 incomplete((_s,m)=>{m.quality!.currentOutcomeHash='stale';},'QUALITY_REVIEW_CHANGED');
 incomplete((_s,m)=>{m.quality!.reviewedAt='2026-09-27T11:00:00.000Z';},'QUALITY_REVIEW_CHANGED');
});
test('read-only operator CLI reports a bounded result and exits nonzero for incomplete evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'kiara-paired-gate-'));
 try{
  const {s,manifest}=fixture(),tenantDir=join(root,digest(s.tenantId)),manifestPath=join(root,'manifest.json');
  await mkdir(tenantDir);await writeFile(join(tenantDir,'workspace.json'),JSON.stringify({format:2,hash:digest(s),state:s}));
  const script=join(dirname(fileURLToPath(import.meta.url)),'../scripts/v2-measurement-qualification.ts');
  const run=()=>spawnSync(process.execPath,['--import','tsx',script,s.tenantId,manifestPath],{cwd:join(dirname(fileURLToPath(import.meta.url)),'..'),env:{...process.env,KIARA_V2_DATA_DIR:root,KIARA_V2_STORE_MODE:'',MONGODB_URI:'',VERCEL:''},encoding:'utf8'});
  await writeFile(manifestPath,JSON.stringify(manifest));
  const ready=run();assert.equal(ready.status,0,ready.stderr);assert.equal(JSON.parse(ready.stdout).status,'evidence_ready');
  manifest.quality=null;await writeFile(manifestPath,JSON.stringify(manifest));
  const incompleteResult=run();assert.equal(incompleteResult.status,1,incompleteResult.stderr);assert.deepEqual(JSON.parse(incompleteResult.stdout).reasons,['QUALITY_REVIEW_MISSING']);
  assert.equal(digest(s),JSON.parse(await readFile(join(tenantDir,'workspace.json'),'utf8')).hash);
 }finally{await rm(root,{recursive:true,force:true});}
});
