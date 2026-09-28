import {digest} from './store';
import {canRead} from './authority';
import type {EffortEntry} from './measurement';
import {valueView} from './value';
import type {Matter,WorkspaceState} from './contracts';

/** An offline evidence manifest. Supplying it grants no workspace authority or quality approval. */
export interface CaseEvidenceRef {
 matterId:string;
 outcomeHash:string;
 usefulnessReceiptId:string;
 actionIds:string[];
 participantIds:string[];
 effortEntryIds:string[];
}
export interface PairedCaseManifest {
 tenantId:string;
 comparisonScope:string;
 baselineRecordId:string;
 baseline:CaseEvidenceRef;
 current:CaseEvidenceRef;
 quality:{reviewerId:string;reviewerMembershipVersion:number;reviewedAt:string;artifactDigest:string;comparisonScope:string;baselineOutcomeHash:string;currentOutcomeHash:string;verdict:'equivalent_quality'|'not_equivalent'|'unresolved'}|null;
}
export type QualificationReason=
 |'TENANT_OR_PAIR_CHANGED'|'REHEARSAL_EXCLUDED'|'MATTER_UNAVAILABLE'|'OUTCOME_OPEN'|'TASKS_PENDING'|'ACTIONS_PENDING'|'OBLIGATIONS_PENDING'|'OUTCOME_CHANGED'
 |'ACTION_SET_CHANGED'|'PARTICIPANT_ROSTER_INCOMPLETE'|'EFFORT_SET_CHANGED'|'EFFORT_MISSING'|'EFFORT_INCOMPLETE'|'EFFORT_DURATION_CHANGED'|'EFFORT_DUPLICATE'
 |'COUNSEL_EFFORT_UNACCOUNTED'|'USEFULNESS_RECEIPT_MISSING'|'USEFULNESS_RECEIPT_CHANGED'|'GOAL_EFFORT_UNRECONCILED'
 |'BASELINE_NOT_OBSERVED'|'BASELINE_NOT_PAIRED'|'SCOPE_NOT_COMPARABLE'|'QUALITY_REVIEW_MISSING'|'QUALITY_REVIEW_NOT_INDEPENDENT'|'QUALITY_REVIEW_CHANGED';
export interface PairedCaseQualification {
 status:'evidence_ready'|'incomplete';
 reasons:QualificationReason[];
 recordedMinutes:{baseline:number;current:number;baselineCorrection:number;currentCorrection:number}|null;
 interpretation:string;
}
const sameIds=(left:string[],right:string[])=>Array.isArray(left)&&Array.isArray(right)&&left.length===new Set(left).size&&right.length===new Set(right).size&&digest([...left].sort())===digest([...right].sort());
const decimal=(n:number)=>Math.round(n*10)/10;
const validTime=(value:string)=>typeof value==='string'&&Number.isFinite(Date.parse(value));

/** Hash only the selected historical outcome basis, never a mutable view projection. */
export function caseOutcomeHash(s:WorkspaceState,matterId:string):string|null {
 const matter=s.matters.find(item=>item.id===matterId);if(!matter)return null;
 const actions=s.actions.filter(item=>item.matterId===matterId).sort((a,b)=>a.id.localeCompare(b.id));
 const obligations=(s.obligations||[]).filter(item=>item.matterId===matterId).sort((a,b)=>a.id.localeCompare(b.id));
 return digest({tenantId:s.tenantId,matter:{id:matter.id,version:matter.version,objective:matter.objective,scope:matter.scope,state:matter.state,outcome:matter.outcome,closedAt:matter.closedAt,tasks:matter.tasks.map(task=>({id:task.id,status:task.status,evidenceIds:task.evidenceIds,completion:task.completion||null}))},actions:actions.map(action=>({id:action.id,version:action.version,status:action.status,kind:action.kind,contentHash:action.contentHash,completion:action.completion})),obligations:obligations.map(item=>({id:item.id,version:item.version,status:item.status,completion:item.completion}))});
}

function intervalsDuplicate(entries:EffortEntry[]):boolean {
 const reported=new Set<string>();
 for(const entry of entries){
  if(entry.method==='human_report'){const key=digest({actorId:entry.actorId,stage:entry.stage,minutes:entry.minutes,evidence:entry.evidence});if(reported.has(key))return true;reported.add(key);}
 }
 const byActor=new Map<string,EffortEntry[]>();for(const entry of entries.filter(item=>item.method==='elapsed_timer'))byActor.set(entry.actorId,[...byActor.get(entry.actorId)||[],entry]);
 for(const rows of byActor.values()){rows.sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt));for(let i=1;i<rows.length;i++)if(Date.parse(rows[i].startedAt)<Date.parse(rows[i-1].stoppedAt!))return true;}
 return false;
}

function inspectUsefulness(s:WorkspaceState,matter:Matter,receiptId:string,reasons:Set<QualificationReason>){
 const receipt=s.valueReceipts?.find(item=>item.id===receiptId&&item.tenantId===s.tenantId);
 if(!receipt){reasons.add('USEFULNESS_RECEIPT_MISSING');return null;}
 const proposal=s.proposals.find(item=>item.id===receipt.outputId&&item.matterId===matter.id);
 const goal=s.valueGoals?.find(item=>item.id===receipt.goalId&&item.ownerId===receipt.ownerId&&item.sessionId===receipt.sessionId);
 const session=s.valueSessions?.find(item=>item.id===receipt.sessionId&&item.ownerId===receipt.ownerId&&item.measurement==='observed');
 if(receipt.status!=='current'||receipt.disposition!=='useful'||receipt.outputKind!=='proposal'||!proposal||!goal||!session||!receipt.reason.trim()){reasons.add('USEFULNESS_RECEIPT_CHANGED');return receipt.ownerId;}
 try{
  const actor={tenantId:s.tenantId,actorId:receipt.ownerId,mode:'authenticated' as const,expiresAt:Date.now()+60_000},view=valueView(s,actor);
  const available=view.receipts.some(item=>item.id===receipt.id&&item.outputHash===receipt.outputHash&&item.status==='current');
  const currentOutput=view.outputs.some(item=>item.kind==='proposal'&&item.id===proposal.id&&item.version===receipt.outputVersion&&item.hash===receipt.outputHash);
  if(!available||!currentOutput)reasons.add('USEFULNESS_RECEIPT_CHANGED');
 }catch{reasons.add('USEFULNESS_RECEIPT_CHANGED');}
 return receipt.ownerId;
}

function inspectCase(s:WorkspaceState,ref:CaseEvidenceRef,reasons:Set<QualificationReason>){
 const matter=s.matters.find(item=>item.id===ref.matterId&&item.tenantId===s.tenantId);if(!matter){reasons.add('MATTER_UNAVAILABLE');return null;}
 if(matter.state!=='closed'||!matter.closedAt||!matter.outcome)reasons.add('OUTCOME_OPEN');
 if(matter.tasks.some(task=>task.status!=='done'||task.evidenceIds.length===0))reasons.add('TASKS_PENDING');
 const actions=s.actions.filter(item=>item.matterId===matter.id);
 if(!sameIds(ref.actionIds,actions.map(item=>item.id)))reasons.add('ACTION_SET_CHANGED');
 const noAction=s.approvals.some(item=>item.matterId===matter.id&&item.capacity==='no_action'&&item.status==='active');
 if(!actions.length&&!noAction||actions.some(item=>item.status!=='verified'&&!(item.status==='canceled'&&noAction)||item.status==='verified'&&!item.completion))reasons.add('ACTIONS_PENDING');
 if((s.obligations||[]).some(item=>item.matterId===matter.id&&item.status!=='fulfilled'&&item.status!=='canceled'||item.matterId===matter.id&&item.status==='fulfilled'&&!item.completion))reasons.add('OBLIGATIONS_PENDING');
 if(caseOutcomeHash(s,matter.id)!==ref.outcomeHash)reasons.add('OUTCOME_CHANGED');
 const usefulnessActorId=inspectUsefulness(s,matter,ref.usefulnessReceiptId,reasons);
 const usefulnessReceipt=s.valueReceipts?.find(item=>item.id===ref.usefulnessReceiptId&&item.tenantId===s.tenantId);
 if(usefulnessReceipt&&(s.effortEntries||[]).some(item=>item.goalId===usefulnessReceipt.goalId&&!item.matterId))reasons.add('GOAL_EFFORT_UNRECONCILED');

 const entries=(s.effortEntries||[]).filter(item=>item.matterId===matter.id);
 if(!sameIds(ref.effortEntryIds,entries.map(item=>item.id)))reasons.add('EFFORT_SET_CHANGED');
 const participants=new Set<string>([matter.ownerId,matter.provenance.actorId,...entries.map(item=>item.actorId),...s.approvals.filter(item=>item.matterId===matter.id).map(item=>item.actorId),...actions.map(item=>item.provenance.actorId),...s.proposals.filter(item=>item.matterId===matter.id).map(item=>item.provenance.actorId),...s.events.filter(item=>item.matterId===matter.id).map(item=>item.provenance.actorId),...matter.tasks.flatMap(task=>task.completion?[task.completion.actorId]:[])]);
 if(usefulnessActorId)participants.add(usefulnessActorId);
 for(const engagement of s.counsel.filter(item=>item.matterId===matter.id)){
  for(const actorId of [engagement.ownerId,engagement.provenance.actorId,engagement.intakeRecordedBy,engagement.engagementApproval?.actorId])if(actorId)participants.add(actorId);
  if(engagement.route==='existing'){if(engagement.counselActorId)participants.add(engagement.counselActorId);else reasons.add('COUNSEL_EFFORT_UNACCOUNTED');}
  if(engagement.status==='unavailable'||engagement.route==='existing'&&!['returned','complete'].includes(engagement.status))reasons.add('OUTCOME_OPEN');
 }
 for(const action of actions)if(action.completion&&s.memberships.some(member=>member.actorId===action.completion!.verifierId))participants.add(action.completion.verifierId);
 if(!sameIds(ref.participantIds,[...participants]))reasons.add('PARTICIPANT_ROSTER_INCOMPLETE');
 if(!entries.length||[...participants].some(actorId=>!entries.some(item=>item.actorId===actorId)))reasons.add('EFFORT_MISSING');
 if(entries.some(item=>item.tenantId!==s.tenantId||item.voidReason||!validTime(item.startedAt)||!item.stoppedAt||!validTime(item.stoppedAt)||Date.parse(item.stoppedAt)<Date.parse(item.startedAt)||!Number.isFinite(item.minutes)||item.minutes===null||item.minutes<=0||!item.evidence.trim()))reasons.add('EFFORT_INCOMPLETE');
 if(entries.some(item=>item.method==='elapsed_timer'&&item.stoppedAt&&validTime(item.startedAt)&&validTime(item.stoppedAt)&&item.minutes!==decimal((Date.parse(item.stoppedAt)-Date.parse(item.startedAt))/60_000)))reasons.add('EFFORT_DURATION_CHANGED');
 if(entries.length!==new Set(entries.map(item=>item.id)).size||intervalsDuplicate(entries))reasons.add('EFFORT_DUPLICATE');
 return {matter,minutes:decimal(entries.reduce((sum,item)=>sum+(item.voidReason?0:item.minutes||0),0)),correction:decimal(entries.filter(item=>item.stage==='correction'&&!item.voidReason).reduce((sum,item)=>sum+(item.minutes||0),0))};
}

/** Structural readiness only. External adjudication authenticity and customer outcomes require separate verification. */
export function qualifyPairedCases(s:WorkspaceState,manifest:PairedCaseManifest):PairedCaseQualification {
 const reasons=new Set<QualificationReason>();
 if(s.rehearsal)reasons.add('REHEARSAL_EXCLUDED');
 if(manifest.tenantId!==s.tenantId||manifest.baseline.matterId===manifest.current.matterId)reasons.add('TENANT_OR_PAIR_CHANGED');
 const baseline=inspectCase(s,manifest.baseline,reasons),current=inspectCase(s,manifest.current,reasons);
 if(baseline&&current){
  const pairedEntries=(s.effortEntries||[]).filter(item=>item.matterId===baseline.matter.id||item.matterId===current.matter.id);
  if(intervalsDuplicate(pairedEntries))reasons.add('EFFORT_DUPLICATE');
  if(digest(baseline.matter.scope)!==digest(current.matter.scope)||!manifest.comparisonScope?.trim())reasons.add('SCOPE_NOT_COMPARABLE');
  const record=(s.effortBaselines||[]).find(item=>item.id===manifest.baselineRecordId&&item.matterId===current.matter.id&&item.current);
  if(!record||record.method!=='observed_comparable_work')reasons.add('BASELINE_NOT_OBSERVED');
  if(!record||record.minutes!==baseline.minutes||record.comparisonScope!==manifest.comparisonScope||!record.evidence.trim()||record.tenantId!==s.tenantId)reasons.add('BASELINE_NOT_PAIRED');
 }
 const quality=manifest.quality;
 if(!quality||quality.verdict!=='equivalent_quality'||!validTime(quality.reviewedAt)||Date.parse(quality.reviewedAt)>Date.now()||!/^[a-f0-9]{64}$/.test(quality.artifactDigest))reasons.add('QUALITY_REVIEW_MISSING');
 else {
  const reviewer=s.memberships.find(item=>item.actorId===quality.reviewerId),participants=new Set([...manifest.baseline.participantIds,...manifest.current.participantIds]);
  const reviewerActor={tenantId:s.tenantId,actorId:quality.reviewerId,mode:'authenticated' as const,expiresAt:Date.now()+60_000};
  const canInspectCases=!!reviewer&&!!baseline&&!!current&&[baseline.matter,current.matter].every(matter=>{
   try{return canRead(s,reviewerActor,matter);}catch{return false;}
  });
  if(!reviewer||reviewer.revokedAt||reviewer.expiresAt&&Date.parse(reviewer.expiresAt)<=Date.now()||reviewer.version!==quality.reviewerMembershipVersion||!reviewer.roles.includes('evaluator')||participants.has(quality.reviewerId)||!canInspectCases)reasons.add('QUALITY_REVIEW_NOT_INDEPENDENT');
  if(quality.comparisonScope!==manifest.comparisonScope||quality.baselineOutcomeHash!==manifest.baseline.outcomeHash||quality.currentOutcomeHash!==manifest.current.outcomeHash||baseline&&Date.parse(quality.reviewedAt)<Date.parse(baseline.matter.closedAt||'')||current&&Date.parse(quality.reviewedAt)<Date.parse(current.matter.closedAt||''))reasons.add('QUALITY_REVIEW_CHANGED');
 }
 const ready=reasons.size===0;
 return {status:ready?'evidence_ready':'incomplete',reasons:[...reasons].sort(),recordedMinutes:ready&&baseline&&current?{baseline:baseline.minutes,current:current.minutes,baselineCorrection:baseline.correction,currentCorrection:current.correction}:null,interpretation:'Read-only structural evidence check. An evidence-ready packet is not verified customer value, independent artifact authentication, legal quality, time savings or financial savings.'};
}
