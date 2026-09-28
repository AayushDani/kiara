import type {RetrievedCitation} from './evidence';
import type {Json, State, Workflow} from '../server/contracts';
import {AppError} from '../server/contracts';
import {hash, id, now} from '../server/hash';
import {authorizedBudget,runtimeConfig,tokenCost,type RuntimeConfig,type ReasoningEffort} from './config';
// Real acceptance measured ~58k review-input tokens across three complete-authority
// checks. The finite run window must cover generation and two reviewed repairs.
// Monetary ceilings remain $3/run and the separately authorized $50 global total.
export const LIMITS=Object.freeze({attempts:24,requests:24,tools:16,repairs:2,input:384000,output:48000,request_input:32000,request_output:10000,cost:3,deadline_ms:240000,timeout_ms:180000});
export interface Attempt {attempt_id:string;phase:string;status:'reserved'|'dispatched'|'complete'|'rejected'|'unknown';reserved_input:number;reserved_output:number;reserved_usd:number;input_tokens:number;output_tokens:number;cost_usd:number;created_at:string;response_id:string|null;error_code:string|null;model?:string;provider_model?:string;provider_status?:string;provider_error_code?:string|null;provider_error_type?:string|null;provider_rate_diagnostics?:Record<string,number>;rate_limit_retry?:number;retry_of_attempt_id?:string|null;retry_after_ms?:number;execution_mode?:'provider'|'injected_test';provider_request_id?:string|null;request_hash?:string;output_hash?:string;duration_ms?:number;cached_input_tokens?:number;reasoning_tokens?:number;completed_at?:string;config_version?:string}
export interface UsageTotals {model_attempts:number;input_tokens:number;output_tokens:number;cost_usd:number}
export interface ReviewBudget {input_tokens:number;output_tokens:number;requests:number}
export interface Ledger {run_id:string;budget_scope_id:string;parent_run_id:string|null;parent_budget_scope_id:string|null;cumulative_before:UsageTotals;applied_resolution_ids:string[];human_resolution_id:string|null;workflow_id:string;tenant_id:string;reset_epoch:number;started_at:string;deadline_at:string;input_hash:string;attempts:Attempt[];tools:{key:string;name:string;result_hash:string;arguments_hash?:string;arguments?:Json;call_id?:string;response_id?:string;input_hash?:string;created_at?:string;result_bytes?:number;cached?:boolean}[];retrieved_spans:{provision_key:string;start_utf16:number;end_utf16:number}[];retrieved_citations?:RetrievedCitation[];model:string;reasoning_effort:ReasoningEffort;config?:RuntimeConfig;max_cost_usd?:number;max_attempts?:number;protected_review_budget?:ReviewBudget;validation_revision_id?:string;input_history?:{input_hash:string;changed_at:string}[]}
export function ledgerKey(w:Pick<Workflow,'reset_epoch'|'workflow_id'>){return `${w.reset_epoch}:runtime:${w.workflow_id}`;}
export function getLedger(s:State,w:Workflow):Ledger|undefined{return s.receipts[ledgerKey(w)]?.result as unknown as Ledger|undefined;}
export function saveLedger(s:State,w:Workflow,l:Ledger){s.receipts[ledgerKey(w)]={hash:hash({tenant_id:l.tenant_id,reset_epoch:l.reset_epoch,workflow_id:l.workflow_id,input_hash:l.input_hash}),result:l as unknown as Json};}
export function freshLedger(s:State,w:Workflow):Ledger {
  const config=runtimeConfig();
  const startedAt=Date.now();
  return {run_id:id(),budget_scope_id:id(),parent_run_id:null,parent_budget_scope_id:null,cumulative_before:{model_attempts:0,input_tokens:0,output_tokens:0,cost_usd:0},applied_resolution_ids:[],human_resolution_id:null,workflow_id:w.workflow_id,tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,started_at:new Date(startedAt).toISOString(),deadline_at:new Date(startedAt+LIMITS.deadline_ms).toISOString(),input_hash:hash({facts:w.facts,base_revision_id:w.base_revision_id,context_epoch:w.context_epoch,harness_version:w.harness_version}),attempts:[],tools:[],retrieved_spans:[],model:config.model,reasoning_effort:config.reasoning_effort,config};
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
/** Trusted exact token planning only; proposal output cannot write this reservation. */
export function pinReviewBudget(l:Ledger,plan:ReviewBudget){
  if(![plan.input_tokens,plan.output_tokens,plan.requests].every(n=>Number.isSafeInteger(n)&&n>0)||plan.requests>3||plan.input_tokens>plan.requests*LIMITS.request_input||plan.output_tokens>plan.requests*4000)throw new AppError('REVIEW_BUDGET_INVALID','The complete review plan must fit three protected requests.');
  l.protected_review_budget={...plan};
}
export function protectedReviewBudget(l:Ledger):ReviewBudget{
  const p=l.protected_review_budget;
  // Before the first exact plan, retain the full three-request checker capacity.
  // Thereafter reserve 25% context growth for the repaired document, capped by
  // the same per-request ceiling. The next complete plan is counted again.
  return p?{input_tokens:Math.min(3*LIMITS.request_input,Math.ceil(p.input_tokens*1.25)),output_tokens:p.output_tokens,requests:p.requests}:{input_tokens:3*LIMITS.request_input,output_tokens:12000,requests:3};
}
export function reserveAttempt(l:Ledger,phase:string,input:number,output:number,at=Date.now(),model=l.model):Attempt {
  if(at>=Date.parse(l.deadline_at))throw new AppError('MODEL_DEADLINE','The persisted model run deadline expired.');
  if(!Number.isInteger(input)||input<0||input>LIMITS.request_input||!Number.isInteger(output)||output<1||output>LIMITS.request_output)throw new AppError('CONTEXT_CAPACITY_EXCEEDED','Mandatory model context exceeds the request capacity.');
  if(l.attempts.some(a=>['dispatched','unknown','reserved'].includes(a.status)))throw new AppError('CHARGE_RECONCILIATION_REQUIRED','An earlier request has an unresolved cost reservation.');
  const review=phase==='semantic_validation'?{input_tokens:0,output_tokens:0,requests:0}:protectedReviewBudget(l);
  if(l.attempts.length+1+review.requests>Math.min(LIMITS.requests,l.max_attempts??LIMITS.requests))throw new AppError('MODEL_REQUEST_LIMIT','The request would consume protected independent-review slots.');
  const usedIn=l.attempts.reduce((n,a)=>n+(a.status==='complete'?a.input_tokens:a.status==='rejected'?0:a.reserved_input),0);
  const usedOut=l.attempts.reduce((n,a)=>n+(a.status==='complete'?a.output_tokens:a.status==='rejected'?0:a.reserved_output),0);
  const usedCost=l.attempts.reduce((n,a)=>n+(a.status==='complete'?a.cost_usd:a.status==='rejected'?0:a.reserved_usd),0);
  const cost=tokenCost(model,input,output);
  // Every draft/tool/repair turn preserves an entire independently checked output.
  const headroom={input:review.input_tokens,output:review.output_tokens,cost:tokenCost(l.config?.review_model||l.model,review.input_tokens,review.output_tokens)};
  if(usedIn+input+headroom.input>LIMITS.input||usedOut+output+headroom.output>LIMITS.output||usedCost+cost+headroom.cost>Math.min(LIMITS.cost,l.max_cost_usd??LIMITS.cost))throw new AppError('MODEL_BUDGET_EXHAUSTED','The protected request and repair reserve cannot be satisfied.');
  const a:Attempt={attempt_id:id(),phase,status:'reserved',reserved_input:input,reserved_output:output,reserved_usd:cost,input_tokens:0,output_tokens:0,cost_usd:0,created_at:now(),response_id:null,error_code:null,model,config_version:l.config?.config_version};l.attempts.push(a);return a;
}
export function syncCounters(w:Workflow,l:Ledger){const totals=totalUsage(l);w.model_attempts=totals.model_attempts;w.input_tokens=totals.input_tokens;w.output_tokens=totals.output_tokens;w.cost_usd=totals.cost_usd;w.reserved_cost=l.attempts.filter(a=>['reserved','dispatched','unknown'].includes(a.status)).reduce((n,a)=>n+a.reserved_usd,0);w.unknown_charge=l.attempts.some(a=>a.status==='unknown');}

export const AUTHORIZATION_RECEIPT_KEY='runtime:spend_authorization';
interface AuthorizedSpend {kind:'runtime_spend_authorization';budget_usd:number;charges:Record<string,{reserved_usd:number;cost_usd:number;status:'reserved'|'complete'|'unknown';created_at:string;settled_at?:string}>}
function authorization(s:State):AuthorizedSpend {
  const existing=s.receipts[AUTHORIZATION_RECEIPT_KEY]?.result as unknown as AuthorizedSpend|undefined;
  const configured=authorizedBudget();
  if(existing){if(existing.kind!=='runtime_spend_authorization')throw new AppError('SPEND_LEDGER_INVALID','The protected spend ledger is invalid.');return {...existing,budget_usd:Math.min(existing.budget_usd,configured)};}
  return {kind:'runtime_spend_authorization',budget_usd:configured,charges:{}};
}
function saveAuthorization(s:State,a:AuthorizedSpend){s.receipts[AUTHORIZATION_RECEIPT_KEY]={hash:hash(a),result:a as unknown as Json};}
/** Caller must run in the durable state transaction before dispatch; includes adaptation trials. */
export function reserveAuthorizedSpend(s:State,charge_id:string,reserved_usd:number){
  const a=authorization(s);
  if(!Number.isFinite(reserved_usd)||reserved_usd<=0||reserved_usd>LIMITS.cost)throw new AppError('SPEND_RESERVATION_INVALID','Invalid protected cost reservation.');
  if(a.charges[charge_id])throw new AppError('SPEND_RESERVATION_REPLAY','A charge identifier cannot be reused.');
  if(Object.values(a.charges).some(c=>c.status==='unknown'))throw new AppError('CHARGE_RECONCILIATION_REQUIRED','An earlier provider charge is unknown.');
  const committed=Object.values(a.charges).reduce((sum,c)=>sum+(c.status==='complete'?c.cost_usd:c.reserved_usd),0);
  if(committed+reserved_usd>a.budget_usd+1e-9)throw new AppError('AUTHORIZED_BUDGET_EXHAUSTED','The total authorized OpenAI spending cap would be exceeded.');
  a.charges[charge_id]={reserved_usd,cost_usd:0,status:'reserved',created_at:now()};saveAuthorization(s,a);
}
export function settleAuthorizedSpend(s:State,charge_id:string,cost_usd:number,unknown_charge=false){
  // Settlement must remain possible after an operator disables new spending.
  const a=s.receipts[AUTHORIZATION_RECEIPT_KEY]?.result as unknown as AuthorizedSpend|undefined,charge=a?.charges[charge_id];
  if(!a||!charge)throw new AppError('SPEND_RESERVATION_REQUIRED','A charge must be reserved before settlement.');
  if(!Number.isFinite(cost_usd)||cost_usd<0)throw new AppError('SPEND_USAGE_INVALID','Provider usage is invalid.');
  if(charge.status==='complete')throw new AppError('SPEND_SETTLEMENT_REPLAY','Settled charges are immutable.');
  if(charge.status==='unknown'&&!unknown_charge)throw new AppError('CHARGE_RECONCILIATION_REQUIRED','Unknown provider charges require explicit operator reconciliation.');
  charge.cost_usd=cost_usd;charge.status=unknown_charge||cost_usd>charge.reserved_usd+1e-9?'unknown':'complete';charge.settled_at=now();saveAuthorization(s,a);
}
