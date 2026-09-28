import {randomUUID} from 'node:crypto';
import {canRead,readRecord,requireRole} from './authority';
import {mayControlOwnEffort} from './recovery';
import {V2Error,type ActorContext,type RecordBase,type WorkspaceState} from './contracts';
import {timestamp} from './store';
import {valueView} from './value';
export type EffortStage='setup'|'research'|'drafting'|'review'|'correction'|'coordination'|'execution';
export interface EffortEntry extends RecordBase {matterId:string|null;goalId?:string|null;actorId:string;stage:EffortStage;method:'elapsed_timer'|'human_report';minutes:number|null;startedAt:string;stoppedAt:string|null;evidence:string;voidReason:string|null}
export interface EffortBaseline extends RecordBase {matterId:string|null;goalId?:string|null;minutes:number;method:'observed_comparable_work'|'estimate';comparisonScope:string;evidence:string;current:boolean;supersedesId:string|null}
export interface EffortComparison {matterId:string;baselineMinutes:number|null;recordedMinutes:number;correctionMinutes:number;correctionIntervals:number;differenceMinutes:number|null;baselineMethod:EffortBaseline['method']|null;runningTimers:number;matterClosed:boolean;interpretation:string}
export interface GoalEffortComparison extends Omit<EffortComparison,'matterId'|'matterClosed'> {goalId:string;goalReportedAchieved:boolean}
export type MeasurementCommand=
 | {type:'effort.start';matterId?:string;goalId?:string;stage:EffortStage}
 | {type:'effort.stop';entryId:string;expectedRecordVersion:number;evidence:string}
 | {type:'effort.log';matterId?:string;goalId?:string;stage:EffortStage;minutes:number;evidence:string}
 | {type:'effort.void';entryId:string;expectedRecordVersion:number;reason:string}
 | {type:'baseline.record';matterId?:string;goalId?:string;minutes:number;method:EffortBaseline['method'];comparisonScope:string;evidence:string};
export const measurementCommandFields:Record<MeasurementCommand['type'],string[]>={'effort.start':['matterId','goalId','stage'],'effort.stop':['entryId','expectedRecordVersion','evidence'],'effort.log':['matterId','goalId','stage','minutes','evidence'],'effort.void':['entryId','expectedRecordVersion','reason'],'baseline.record':['matterId','goalId','minutes','method','comparisonScope','evidence']};
const stages:EffortStage[]=['setup','research','drafting','review','correction','coordination','execution'];
function ensure(v:unknown,code:string,message:string):asserts v {if(!v)throw new V2Error(code,message);}
function text(v:unknown,label:string){ensure(typeof v==='string'&&v.trim()&&v.length<=3000,'INVALID_INPUT',`Provide ${label} (up to 3,000 characters).`);return v.trim();}
function minutes(v:number){ensure(Number.isFinite(v)&&v>0&&v<=100000,'INVALID_DURATION','Record positive minutes within the supported range.');return Math.round(v*10)/10;}
function base(s:WorkspaceState,a:ActorContext,r:RecordBase):RecordBase{return {id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:structuredClone(r.scope),provenance:{actorId:a.actorId,sourceIds:[...r.provenance.sourceIds],factIds:[...(r.provenance.factIds||[])],description:'Attributed human effort evidence, separate from outcome and savings claims'}};}
function target(s:WorkspaceState,a:ActorContext,c:{matterId?:string;goalId?:string}){
 ensure((c.matterId===undefined||typeof c.matterId==='string'&&!!c.matterId)&&(c.goalId===undefined||typeof c.goalId==='string'&&!!c.goalId),'INVALID_EFFORT_TARGET','Select exactly one current matter or your own value goal.');
 const matter=typeof c.matterId==='string'&&!!c.matterId,goal=typeof c.goalId==='string'&&!!c.goalId;
 ensure(matter!==goal,'INVALID_EFFORT_TARGET','Select exactly one current matter or your own value goal.');
 if(matter)return {record:readRecord(s,a,s.matters,c.matterId!),matterId:c.matterId!,goalId:null};
 const record=readRecord(s,a,s.valueGoals||[],c.goalId!);
 ensure(record.ownerId===a.actorId&&(!record.conversationId||s.conversations.some(conversation=>conversation.id===record.conversationId&&canRead(s,a,conversation))),'VALUE_GOAL_UNAVAILABLE','Choose your own currently available goal.');
 return {record,matterId:null,goalId:record.id};
}
function totals(entries:EffortEntry[]){const recordedMinutes=Math.round(entries.reduce((n,e)=>n+(e.minutes||0),0)*10)/10,corrections=entries.filter(e=>e.stage==='correction'&&e.stoppedAt);return {recordedMinutes,correctionMinutes:Math.round(corrections.reduce((n,e)=>n+(e.minutes||0),0)*10)/10,correctionIntervals:corrections.length,runningTimers:entries.filter(e=>!e.stoppedAt).length};}
export function effortComparisons(s:WorkspaceState,a:ActorContext):EffortComparison[]{
 return s.matters.filter(m=>canRead(s,a,m)).map(m=>{const entries=(s.effortEntries||[]).filter(e=>e.matterId===m.id&&!e.voidReason&&canRead(s,a,e)),baseline=(s.effortBaselines||[]).find(b=>b.matterId===m.id&&b.current&&canRead(s,a,b)),sum=totals(entries);return {matterId:m.id,baselineMinutes:baseline?.minutes??null,...sum,differenceMinutes:baseline?Math.round((baseline.minutes-sum.recordedMinutes)*10)/10:null,baselineMethod:baseline?.method||null,matterClosed:m.state==='closed',interpretation:'Matter-only comparable baseline minus recorded matter effort. Pre-matter goal effort is shown separately and must not be silently counted twice. Correction minutes are a subset already included once. Coverage may be incomplete; timers include idle time and manual reports are attributed assertions. A difference is not validated customer or financial savings.'};});
}
export function goalEffortComparisons(s:WorkspaceState,a:ActorContext):GoalEffortComparison[]{
 return valueView(s,a).goals.map(g=>{
  const entries=(s.effortEntries||[]).filter(e=>e.goalId===g.id&&!e.matterId&&!e.voidReason&&canRead(s,a,e)),baseline=(s.effortBaselines||[]).find(b=>b.goalId===g.id&&!b.matterId&&b.current&&canRead(s,a,b)),sum=totals(entries);
  const achieved=g.status==='reported_achieved'&&g.outcomeAvailable&&!s.rehearsal;
  return {goalId:g.id,baselineMinutes:baseline?.minutes??null,...sum,differenceMinutes:baseline&&achieved&&!sum.runningTimers?Math.round((baseline.minutes-sum.recordedMinutes)*10)/10:null,baselineMethod:baseline?.method||null,goalReportedAchieved:achieved,interpretation:'Goal-only comparable baseline minus recorded goal effort. No matter effort is included. A numeric difference requires a current available user-reported achieved goal, no running timer and non-fictional work; it is not validated customer or financial savings. Setup, review, correction and idle time must be reported honestly; unrecorded work can make coverage incomplete.'};
 });
}
export function applyMeasurementCommand(s:WorkspaceState,a:ActorContext,c:MeasurementCommand):Record<string,unknown>{
 const entries=s.effortEntries||=[];const baselines=s.effortBaselines||=[];requireRole(s,a,'member');
 if(c.type==='effort.stop'||c.type==='effort.void'){
  const e=entries.find(e=>e.id===c.entryId);if(e&&canRead(s,a,e)&&e.actorId!==a.actorId)throw new V2Error('EFFORT_OWNER_REQUIRED','Only the person who recorded effort can stop or void it.');if(!e||!mayControlOwnEffort(s,a,e))throw new V2Error('NOT_FOUND','Your effort record is unavailable.',404);ensure(e.version===c.expectedRecordVersion,'VERSION_CONFLICT','Inspect the current effort record.');ensure(e.actorId===a.actorId,'EFFORT_OWNER_REQUIRED','Only the person who recorded effort can stop or void it.');
  if(c.type==='effort.stop'){ensure(e.method==='elapsed_timer'&&!e.stoppedAt&&!e.voidReason,'TIMER_NOT_RUNNING','This effort timer is no longer running.');const elapsed=(Date.now()-Date.parse(e.startedAt))/60000;ensure(elapsed>=0&&elapsed<=1080,'TIMER_REVIEW_REQUIRED','This timer is outside the 18-hour bound. Void it with a reason and record the corrected effort.');e.minutes=Math.round(elapsed*10)/10;e.stoppedAt=timestamp();e.evidence=text(c.evidence,'what the elapsed time covers, including any idle time');}
  else{ensure(!e.voidReason,'EFFORT_ALREADY_VOID','This record is already excluded from comparisons.');e.voidReason=text(c.reason,'the reason this time should not be counted');if(!e.stoppedAt)e.stoppedAt=timestamp();}
  e.version++;e.updatedAt=timestamp();return {entryId:e.id,matterId:e.matterId,goalId:e.goalId??null};
 }
 const selected=target(s,a,c),m=selected.record;
 if(c.type==='baseline.record'){
  if(selected.matterId)requireRole(s,a,'business_owner',m);ensure(['observed_comparable_work','estimate'].includes(c.method),'INVALID_BASELINE','Choose observed comparable work or an explicit estimate.');const prior=baselines.find(b=>b.matterId===selected.matterId&&(b.goalId||null)===selected.goalId&&b.current);if(prior){prior.current=false;prior.version++;prior.updatedAt=timestamp();}const b:EffortBaseline={...base(s,a,m),matterId:selected.matterId,goalId:selected.goalId,minutes:minutes(c.minutes),method:c.method,comparisonScope:text(c.comparisonScope,'the equivalent work, scope and quality being compared'),evidence:text(c.evidence,'the baseline evidence or explicit estimating assumptions'),current:true,supersedesId:prior?.id||null};baselines.push(b);return {baselineId:b.id,matterId:selected.matterId,goalId:selected.goalId};
 }
 ensure(stages.includes(c.stage),'INVALID_STAGE','Choose the kind of human work being measured.');ensure(!entries.some(e=>e.actorId===a.actorId&&!e.stoppedAt&&!e.voidReason),'TIMER_ALREADY_RUNNING','Stop the running timer before starting or separately logging time.');
 const e:EffortEntry={...base(s,a,m),matterId:selected.matterId,goalId:selected.goalId,actorId:a.actorId,stage:c.stage,method:c.type==='effort.start'?'elapsed_timer':'human_report',minutes:c.type==='effort.log'?minutes(c.minutes):null,startedAt:timestamp(),stoppedAt:c.type==='effort.log'?timestamp():null,evidence:c.type==='effort.log'?text(c.evidence,'the actual work and source of this time report'):'Elapsed timer; no active-attention inference.',voidReason:null};entries.push(e);return {entryId:e.id,matterId:selected.matterId,goalId:selected.goalId};
}
