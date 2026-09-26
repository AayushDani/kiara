import type {Json, State, Workflow} from '../server/contracts';
import {AppError} from '../server/contracts';
import {hash, id, now} from '../server/hash';
export const LIMITS=Object.freeze({attempts:12,requests:9,tools:16,repairs:2,input:120000,output:24000,request_input:24000,request_output:4000,cost:3,deadline_ms:300000,timeout_ms:90000});
export interface Attempt {attempt_id:string;phase:string;status:'reserved'|'dispatched'|'complete'|'rejected'|'unknown';reserved_input:number;reserved_output:number;reserved_usd:number;input_tokens:number;output_tokens:number;cost_usd:number;created_at:string;response_id:string|null;error_code:string|null}
export interface UsageTotals {model_attempts:number;input_tokens:number;output_tokens:number;cost_usd:number}
export interface Ledger {run_id:string;budget_scope_id:string;parent_run_id:string|null;parent_budget_scope_id:string|null;cumulative_before:UsageTotals;applied_resolution_ids:string[];human_resolution_id:string|null;workflow_id:string;tenant_id:string;reset_epoch:number;started_at:string;deadline_at:string;input_hash:string;attempts:Attempt[];tools:{key:string;name:string;result_hash:string}[];retrieved_spans:{provision_key:string;start_utf16:number;end_utf16:number}[];model:string;reasoning_effort:'medium';validation_revision_id?:string;input_history?:{input_hash:string;changed_at:string}[]}
export function ledgerKey(w:Pick<Workflow,'reset_epoch'|'workflow_id'>){return `${w.reset_epoch}:runtime:${w.workflow_id}`;}
export function getLedger(s:State,w:Workflow):Ledger|undefined{return s.receipts[ledgerKey(w)]?.result as unknown as Ledger|undefined;}
export function saveLedger(s:State,w:Workflow,l:Ledger){s.receipts[ledgerKey(w)]={hash:hash({tenant_id:l.tenant_id,reset_epoch:l.reset_epoch,workflow_id:l.workflow_id,input_hash:l.input_hash}),result:l as unknown as Json};}
export function freshLedger(s:State,w:Workflow):Ledger {
  return {run_id:id(),budget_scope_id:id(),parent_run_id:null,parent_budget_scope_id:null,cumulative_before:{model_attempts:0,input_tokens:0,output_tokens:0,cost_usd:0},applied_resolution_ids:[],human_resolution_id:null,workflow_id:w.workflow_id,tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,started_at:now(),deadline_at:new Date(Date.now()+LIMITS.deadline_ms).toISOString(),input_hash:hash({facts:w.facts,base_revision_id:w.base_revision_id,context_epoch:w.context_epoch,harness_version:w.harness_version}),attempts:[],tools:[],retrieved_spans:[],model:process.env.KIARA_MODEL||'gpt-6-astra',reasoning_effort:'medium'};
}
export function initializeLedger(s:State,w:Workflow):Ledger {return getLedger(s,w)||freshLedger(s,w);}
export function runUsage(l:Ledger):UsageTotals{return {model_attempts:l.attempts.length,input_tokens:l.attempts.reduce((n,a)=>n+a.input_tokens,0),output_tokens:l.attempts.reduce((n,a)=>n+a.output_tokens,0),cost_usd:l.attempts.reduce((n,a)=>n+a.cost_usd,0)};}
export function totalUsage(l:Ledger):UsageTotals{const current=runUsage(l),prior=l.cumulative_before;return {model_attempts:current.model_attempts+(prior?.model_attempts||0),input_tokens:current.input_tokens+(prior?.input_tokens||0),output_tokens:current.output_tokens+(prior?.output_tokens||0),cost_usd:current.cost_usd+(prior?.cost_usd||0)};}
export function unsettled(l:Ledger){return l.attempts.some(a=>['reserved','dispatched','unknown'].includes(a.status));}
export function linkedHumanLedger(s:State,w:Workflow,parent:Ledger,resolutionId:string):Ledger {
  if(unsettled(parent)||w.unknown_charge||w.reserved_cost>0)throw new AppError('CHARGE_RECONCILIATION_REQUIRED','Prior model charges must settle before a human resolution can start a child run.');
  const parentId=parent.run_id||hash({workflow_id:parent.workflow_id,started_at:parent.started_at,input_hash:parent.input_hash});
  const scopeId=parent.budget_scope_id||parentId;
  const key=`${w.reset_epoch}:runtime_history:${w.workflow_id}:${parentId}`;
  const history={kind:'runtime_history',tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,workflow_id:w.workflow_id,run_id:parentId,budget_scope_id:scopeId,ledger:structuredClone(parent),repair_count:w.repair_count,settled:true};
  if(s.receipts[key]&&s.receipts[key].hash!==hash(history))throw new AppError('RUNTIME_HISTORY_IMMUTABLE','An archived runtime ledger cannot be replaced.');
  s.receipts[key]={hash:hash(history),result:history as unknown as Json};
  const child=freshLedger(s,w);child.parent_run_id=parentId;child.parent_budget_scope_id=scopeId;child.cumulative_before=totalUsage(parent);child.applied_resolution_ids=[...(parent.applied_resolution_ids||[]),resolutionId];child.human_resolution_id=resolutionId;return child;
}
export function reserveAttempt(l:Ledger,phase:string,input:number,output:number,at=Date.now()):Attempt {
  if(at>=Date.parse(l.deadline_at))throw new AppError('MODEL_DEADLINE','The persisted model run deadline expired.');
  if(!Number.isInteger(input)||input<0||input>LIMITS.request_input||output>LIMITS.request_output)throw new AppError('CONTEXT_CAPACITY_EXCEEDED','Mandatory model context exceeds the request capacity.');
  if(l.attempts.some(a=>['dispatched','unknown','reserved'].includes(a.status)))throw new AppError('CHARGE_RECONCILIATION_REQUIRED','An earlier request has an unresolved cost reservation.');
  if(l.attempts.length>=LIMITS.requests)throw new AppError('MODEL_REQUEST_LIMIT','The model request budget is exhausted.');
  const usedIn=l.attempts.reduce((n,a)=>n+(a.status==='complete'?a.input_tokens:a.status==='rejected'?0:a.reserved_input),0);
  const usedOut=l.attempts.reduce((n,a)=>n+(a.status==='complete'?a.output_tokens:a.status==='rejected'?0:a.reserved_output),0);
  const usedCost=l.attempts.reduce((n,a)=>n+(a.status==='complete'?a.cost_usd:a.status==='rejected'?0:a.reserved_usd),0);
  const cost=input*0.000010+output*0.000050;
  // Preserve one semantic review and one targeted repair until the final check.
  const headroom=phase==='draft'?{input:16000,output:6000,cost:0.46}:{input:0,output:0,cost:0};
  if(usedIn+input+headroom.input>LIMITS.input||usedOut+output+headroom.output>LIMITS.output||usedCost+cost+headroom.cost>LIMITS.cost)throw new AppError('MODEL_BUDGET_EXHAUSTED','The protected request and repair reserve cannot be satisfied.');
  const a:Attempt={attempt_id:id(),phase,status:'reserved',reserved_input:input,reserved_output:output,reserved_usd:cost,input_tokens:0,output_tokens:0,cost_usd:0,created_at:now(),response_id:null,error_code:null};l.attempts.push(a);return a;
}
export function syncCounters(w:Workflow,l:Ledger){const totals=totalUsage(l);w.model_attempts=totals.model_attempts;w.input_tokens=totals.input_tokens;w.output_tokens=totals.output_tokens;w.cost_usd=totals.cost_usd;w.reserved_cost=l.attempts.filter(a=>['reserved','dispatched','unknown'].includes(a.status)).reduce((n,a)=>n+a.reserved_usd,0);w.unknown_charge=l.attempts.some(a=>a.status==='unknown');}
