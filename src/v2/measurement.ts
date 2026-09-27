import {randomUUID} from 'node:crypto';
import {canRead,readRecord,requireRole} from './authority';
import {V2Error,type ActorContext,type RecordBase,type WorkspaceState} from './contracts';
import {timestamp} from './store';
export type EffortStage='setup'|'research'|'drafting'|'review'|'correction'|'coordination'|'execution';
export interface EffortEntry extends RecordBase {matterId:string;actorId:string;stage:EffortStage;method:'elapsed_timer'|'human_report';minutes:number|null;startedAt:string;stoppedAt:string|null;evidence:string;voidReason:string|null}
export interface EffortBaseline extends RecordBase {matterId:string;minutes:number;method:'observed_comparable_work'|'estimate';comparisonScope:string;evidence:string;current:boolean;supersedesId:string|null}
export interface EffortComparison {matterId:string;baselineMinutes:number|null;recordedMinutes:number;differenceMinutes:number|null;baselineMethod:EffortBaseline['method']|null;runningTimers:number;matterClosed:boolean;interpretation:string}
export type MeasurementCommand=
 | {type:'effort.start';matterId:string;stage:EffortStage}
 | {type:'effort.stop';entryId:string;expectedRecordVersion:number;evidence:string}
 | {type:'effort.log';matterId:string;stage:EffortStage;minutes:number;evidence:string}
 | {type:'effort.void';entryId:string;expectedRecordVersion:number;reason:string}
 | {type:'baseline.record';matterId:string;minutes:number;method:EffortBaseline['method'];comparisonScope:string;evidence:string};
export const measurementCommandFields:Record<MeasurementCommand['type'],string[]>={'effort.start':['matterId','stage'],'effort.stop':['entryId','expectedRecordVersion','evidence'],'effort.log':['matterId','stage','minutes','evidence'],'effort.void':['entryId','expectedRecordVersion','reason'],'baseline.record':['matterId','minutes','method','comparisonScope','evidence']};
const stages:EffortStage[]=['setup','research','drafting','review','correction','coordination','execution'];
function ensure(v:unknown,code:string,message:string):asserts v {if(!v)throw new V2Error(code,message);}
function text(v:unknown,label:string){ensure(typeof v==='string'&&v.trim()&&v.length<=3000,'INVALID_INPUT',`Provide ${label} (up to 3,000 characters).`);return v.trim();}
function minutes(v:number){ensure(Number.isFinite(v)&&v>0&&v<=100000,'INVALID_DURATION','Record positive minutes within the supported range.');return Math.round(v*10)/10;}
function base(s:WorkspaceState,a:ActorContext,r:RecordBase):RecordBase{return {id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:structuredClone(r.scope),provenance:{actorId:a.actorId,sourceIds:[...r.provenance.sourceIds],factIds:[...(r.provenance.factIds||[])],description:'Attributed human effort evidence, separate from outcome and savings claims'}};}
export function effortComparisons(s:WorkspaceState,a:ActorContext):EffortComparison[]{
 return s.matters.filter(m=>canRead(s,a,m)).map(m=>{const entries=(s.effortEntries||[]).filter(e=>e.matterId===m.id&&!e.voidReason&&canRead(s,a,e)),baseline=(s.effortBaselines||[]).find(b=>b.matterId===m.id&&b.current&&canRead(s,a,b));const actual=Math.round(entries.reduce((n,e)=>n+(e.minutes||0),0)*10)/10;return {matterId:m.id,baselineMinutes:baseline?.minutes??null,recordedMinutes:actual,differenceMinutes:baseline?Math.round((baseline.minutes-actual)*10)/10:null,baselineMethod:baseline?.method||null,runningTimers:entries.filter(e=>!e.stoppedAt).length,matterClosed:m.state==='closed',interpretation:'Comparable baseline minus all recorded setup, research, drafting, review, correction, coordination and execution time. Coverage may be incomplete; elapsed timers include idle time and manual reports are attributed assertions. A difference is not validated customer or financial savings.'};});
}
export function applyMeasurementCommand(s:WorkspaceState,a:ActorContext,c:MeasurementCommand):Record<string,unknown>{
 const entries=s.effortEntries||=[];const baselines=s.effortBaselines||=[];requireRole(s,a,'member');
 if(c.type==='effort.stop'||c.type==='effort.void'){
  const e=readRecord(s,a,entries,c.entryId);ensure(e.version===c.expectedRecordVersion,'VERSION_CONFLICT','Inspect the current effort record.');ensure(e.actorId===a.actorId,'EFFORT_OWNER_REQUIRED','Only the person who recorded effort can stop or void it.');
  if(c.type==='effort.stop'){ensure(e.method==='elapsed_timer'&&!e.stoppedAt&&!e.voidReason,'TIMER_NOT_RUNNING','This effort timer is no longer running.');const elapsed=(Date.now()-Date.parse(e.startedAt))/60000;ensure(elapsed>=0&&elapsed<=1080,'TIMER_REVIEW_REQUIRED','This timer is outside the 18-hour bound. Void it with a reason and record the corrected effort.');e.minutes=Math.max(0.1,Math.round(elapsed*10)/10);e.stoppedAt=timestamp();e.evidence=text(c.evidence,'what the elapsed time covers, including any idle time');}
  else{ensure(!e.voidReason,'EFFORT_ALREADY_VOID','This record is already excluded from comparisons.');e.voidReason=text(c.reason,'the reason this time should not be counted');if(!e.stoppedAt)e.stoppedAt=timestamp();}
  e.version++;e.updatedAt=timestamp();return {entryId:e.id,matterId:e.matterId};
 }
 const m=readRecord(s,a,s.matters,c.matterId);
 if(c.type==='baseline.record'){
  requireRole(s,a,'business_owner',m);ensure(['observed_comparable_work','estimate'].includes(c.method),'INVALID_BASELINE','Choose observed comparable work or an explicit estimate.');const prior=baselines.find(b=>b.matterId===m.id&&b.current);if(prior){prior.current=false;prior.version++;prior.updatedAt=timestamp();}const b:EffortBaseline={...base(s,a,m),matterId:m.id,minutes:minutes(c.minutes),method:c.method,comparisonScope:text(c.comparisonScope,'the equivalent work, scope and quality being compared'),evidence:text(c.evidence,'the baseline evidence or explicit estimating assumptions'),current:true,supersedesId:prior?.id||null};baselines.push(b);return {baselineId:b.id,matterId:m.id};
 }
 ensure(stages.includes(c.stage),'INVALID_STAGE','Choose the kind of human work being measured.');ensure(!entries.some(e=>e.actorId===a.actorId&&!e.stoppedAt&&!e.voidReason),'TIMER_ALREADY_RUNNING','Stop the running timer before starting or separately logging time.');
 const e:EffortEntry={...base(s,a,m),matterId:m.id,actorId:a.actorId,stage:c.stage,method:c.type==='effort.start'?'elapsed_timer':'human_report',minutes:c.type==='effort.log'?minutes(c.minutes):null,startedAt:timestamp(),stoppedAt:c.type==='effort.log'?timestamp():null,evidence:c.type==='effort.log'?text(c.evidence,'the actual work and source of this time report'):'Elapsed timer; no active-attention inference.',voidReason:null};entries.push(e);return {entryId:e.id,matterId:m.id};
}
