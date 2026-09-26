import {transaction,readState} from '../data/store';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {provisions} from '../data/fixtures';
import {AppError,type Json,type State,type Workflow,type Revision,type Provision,type Evaluation} from '../server/contracts';
import {hash,id,now} from '../server/hash';
import {revisionDigest} from '../validation/proposal';
import {runtimeConfig} from '../runtime/config';
import {LIMITS as RUNTIME_LIMITS} from '../runtime/budget';
import {BASE_STRATEGY,resolveHarnessStrategy,saveHarnessStrategy,validateStrategy,type HarnessStrategy,type StrategyModule} from './strategy';
import {generateStrategyProposal,type StrategyProposalResult} from './proposer';
export {resolveHarnessStrategy,strategyInstructions} from './strategy';

// These limits and evaluator criteria are code-owned, never included in mutable proposals.
export const AUTOMATIC_LIMITS=Object.freeze({depth:3,candidates_per_day:3,concurrency:1,cases:3,trials:6,proposal_cost_usd:.25,trial_cost_usd:3,campaign_cost_usd:18.25,trial_attempts:RUNTIME_LIMITS.requests,lease_ms:360000,deadline_ms:3600000,cost_regression_ratio:1.25,latency_regression_ratio:1.25});
const KERNEL_VERSION='automatic-harness-evaluator-v2';
export const EVALUATION_IMPLEMENTATION_FILES=Object.freeze(['src/runtime/index.ts','src/runtime/config.ts','src/runtime/budget.ts','src/runtime/backoff.ts','src/runtime/evidence.ts','src/runtime/semantic.ts','src/validation/proposal.ts','src/workflow/engine.ts','src/workflow/legal.ts','src/workflow/documents.ts','src/adaptation/automatic.ts','src/adaptation/strategy.ts','src/adaptation/proposer.ts']);
/** Local acceptance is bound to actual working-tree code, not merely a possibly stale git HEAD. */
export function evaluationImplementationIdentity(root=process.cwd()):{kind:'deployment_commit'|'local_sources';identity:string}{
  const deployment=process.env.VERCEL_GIT_COMMIT_SHA||process.env.KIARA_BUILD_ID;
  if(process.env.VERCEL){if(!deployment)throw new AppError('EVALUATOR_BUILD_ID_REQUIRED','Hosted evaluation requires an immutable deployment identity.');return {kind:'deployment_commit',identity:deployment};}
  return {kind:'local_sources',identity:hash(EVALUATION_IMPLEMENTATION_FILES.map(path=>[path,hash(readFileSync(join(/* turbopackIgnore: true */ root,path),'utf8'))]))};
}
export interface ImprovementTrigger {workflow_id:string;trigger_id:string;origin:'validation'|'founder_feedback'|'lawyer_feedback';codes:string[];feedback_type?:string;depth?:number}
export interface FrozenCase {case_id:string;split:'diagnosis'|'unseen';label:string;workflow:Workflow;base:Revision;input_hash:string}
export interface AutomaticTrialResult {passed:boolean;validation_codes:string[];provider_response_ids:string[];model_attempts:number;input_tokens:number;output_tokens:number;cost_usd:number;duration_ms:number;unknown_charge:boolean;output_hash:string|null;repair_count:number;error?:string|null;audit?:unknown}
interface Trial {trial_id:string;case_id:string;arm:'baseline'|'candidate';status:'pending'|'dispatched'|'completed'|'inconclusive';lease_owner:string|null;lease_until:string|null;charge_id:string;result:AutomaticTrialResult|null;input_hash:string}
export interface AutomaticImprovement {
  kind:'automatic_improvement';proposal_id:string;workflow_id:string;tenant_id:string;reset_epoch:number;created_at:string;deadline_at:string;
  trigger:ImprovementTrigger;depth:number;status:'queued'|'blocked'|'evaluating'|'promoted'|'rejected'|'inconclusive';reason:string;
  baseline_version:number;candidate_version:number;expected_generation:number;baseline_strategy:HarnessStrategy;candidate_strategy:HarnessStrategy;
  context_epoch:number;source_hash:string;model_config_hash:string;kernel_hash:string;dataset_hash:string;frozen_cases:FrozenCase[];frozen_sources:Provision[];
  trials:Trial[];actual_cost_usd:number;unknown_charge:boolean;evaluation_id:string|null;execution_mode:'provider'|'injected_test';
  proposal?:{status:'pending'|'dispatched'|'completed'|'inconclusive';charge_id:string;lease_owner:string|null;lease_until:string|null;result:StrategyProposalResult|null};
  implementation_identity?:{kind:'deployment_commit'|'local_sources';identity:string};
}
type EvaluationRunner=(input:{state:State;workflow_id:string;max_cost_usd:number;max_attempts:number;provisions:Provision[];authorization_charge_id?:string})=>Promise<AutomaticTrialResult>;
const keyOf=(proposal:string)=>`adaptation:automatic:${proposal}`;
const readRecords=(s:State)=>Object.values(s.receipts).filter(receipt=>{
  const value=receipt.result as unknown as AutomaticImprovement;
  if(value?.kind!=='automatic_improvement')return false;
  if(receipt.hash!==hash(value))throw new AppError('EVALUATION_INTEGRITY','An evaluation receipt failed its integrity check.');
  return true;
}).map(r=>r.result as unknown as AutomaticImprovement);
const save=(s:State,r:AutomaticImprovement)=>{s.receipts[keyOf(r.proposal_id)]={hash:hash(r),result:r as unknown as Json};};
const sourceHash=()=>hash(provisions().map(p=>[p.provision_key,p.source_version_id,p.content_hash,p.source_hash]));
const configHash=()=>runtimeConfig().config_version;
const kernelHash=()=>hash({version:KERNEL_VERSION,implementation:evaluationImplementationIdentity(),limits:AUTOMATIC_LIMITS,base:BASE_STRATEGY});
function emit(s:State,wid:string,type:string,title:string,detail:string){s.events.push({event_id:id(),tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,aggregate_seq:s.events.length+1,workflow_id:wid,type,title,detail,created_at:now()});}

/** Uses failure categories, never reviewer free text, as executable prompt instructions. */
export function proposeStrategy(base:HarnessStrategy,trigger:ImprovementTrigger):HarnessStrategy|null {
  const next=validateStrategy(base),modules=new Set<StrategyModule>(next.prompt_modules),codes=trigger.codes.join(' ');
  if(trigger.feedback_type==='fact_correction'||/FACT|COMPANY|EMAIL|CONTACT|CLAIM|SEMANTIC/.test(codes)){modules.add('fact_consistency');next.retrieval_order='facts_first';}
  if(trigger.feedback_type==='document_edit'||/BASE_CLAUSE|UNRELATED|DOCUMENT|SCOPE|PRESERV/.test(codes))modules.add('minimal_edits');
  if(trigger.feedback_type==='legal_interpretation_note'||/CITATION|EVIDENCE|SOURCE|GROUND|LEGAL|BUNDLE/.test(codes)){modules.add('legal_grounding');next.retrieval_order='evidence_first';}
  if(trigger.origin!=='validation')modules.add('feedback_scope');
  next.prompt_modules=[...modules].sort();
  return hash(next)===hash(base)?null:next;
}

function freezeCases(s:State,w:Workflow):FrozenCase[]{
  const base=s.revisions.find(r=>r.revision_id===w.base_revision_id);
  if(!base)throw new AppError('BASE_NOT_FOUND','Evaluation requires the actual pinned prior document.');
  const cases:FrozenCase[]=[];
  for(let i=0;i<AUTOMATIC_LIMITS.cases;i++){
    const workflow=structuredClone(w),revision=structuredClone(base);
    if(i>0){
      // Independently generated synthetic held-out inputs, not alternative expected prose.
      const nonce=id().replaceAll('-','').slice(0,12),newEmail=`privacy-${nonce}@unseen-${i}.example`;
      const contact=workflow.facts.find(f=>f.fact_key==='consumer_request_email');
      if(contact&&typeof contact.value==='string'){
        const old=contact.value;contact.value=newEmail;contact.fact_id=id();contact.knowledge='known';contact.provenance=`Synthetic held-out evaluation case ${i}; not a company fact.`;
        revision.clauses=revision.clauses.map(c=>({...c,body:c.body.split(old).join(newEmail)}));
      }
      revision.clauses.push({clause_id:`heldout_unrelated_${nonce}`,heading:`Unrelated preservation case ${i}`,body:`This synthetic evaluation-only clause records reference ${nonce}. Preserve this paragraph verbatim.`});
      revision.content_hash=revisionDigest(revision);
    }
    const case_id=id();cases.push({case_id,split:i===0?'diagnosis':'unseen',label:i===0?'Frozen triggering company and document':`Synthetic unseen contact and unrelated document clause ${i}`,workflow,base:revision,input_hash:hash({facts:workflow.facts,base:revision,residence:workflow.residence,context_epoch:workflow.context_epoch})});
  }
  return cases;
}

/** Must be called in the same durable transaction that observes a failure or human feedback. */
export function enqueueAutomaticImprovementInState(s:State,trigger:ImprovementTrigger):AutomaticImprovement|null {
  const triggerKey=`adaptation:trigger:${trigger.origin}:${trigger.trigger_id}`;
  const prior=s.receipts[triggerKey]?.result as {reason?:string}|undefined;
  if(prior&&!['AUTOMATIC_CONCURRENCY_LIMIT','AUTOMATIC_DAILY_RATE_LIMIT'].includes(prior.reason||''))return null;
  const w=s.workflows.find(w=>w.workflow_id===trigger.workflow_id&&w.tenant_id===s.tenant_id&&w.reset_epoch===s.reset_epoch);
  if(!w)throw new AppError('NOT_FOUND','Improvement trigger workflow not found.');
  const base=resolveHarnessStrategy(s,s.champion_version),candidate=proposeStrategy(base,trigger)||structuredClone(base);
  const parent=readRecords(s).find(r=>r.candidate_version===s.champion_version&&r.status==='promoted');
  const depth=(parent?.depth||0)+1;
  let reason:string|null=null;
  if(depth>AUTOMATIC_LIMITS.depth)reason='AUTOMATIC_DEPTH_LIMIT';
  else if(w.model_mode!=='openai')reason='SCRIPTED_RUN_NO_AI_IMPROVEMENT';
  else if(Buffer.byteLength(JSON.stringify(s))>8_000_000)reason='WORKSPACE_AUDIT_CAPACITY_LIMIT';
  else if(readRecords(s).filter(r=>r.created_at.slice(0,10)===now().slice(0,10)).length>=AUTOMATIC_LIMITS.candidates_per_day)reason='AUTOMATIC_DAILY_RATE_LIMIT';
  else if(readRecords(s).some(r=>['queued','blocked','evaluating'].includes(r.status)))reason='AUTOMATIC_CONCURRENCY_LIMIT';
  s.receipts[triggerKey]={hash:hash(trigger),result:{kind:'adaptation_trigger',...trigger,depth,status:reason?'not_admitted':'admitted',reason,created_at:now()} as unknown as Json};
  if(reason){if(prior?.reason!==reason)emit(s,w.workflow_id,'harness.improvement_not_admitted','Harness trigger recorded',reason);return null;}
  const version=Math.max(...s.harnesses.map(h=>h.version))+1,proposal_id=id(),frozen_cases=freezeCases(s,w),frozen_sources=structuredClone(provisions());
  const record:AutomaticImprovement={kind:'automatic_improvement',proposal_id,workflow_id:w.workflow_id,tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,created_at:now(),deadline_at:new Date(Date.now()+AUTOMATIC_LIMITS.deadline_ms).toISOString(),trigger:structuredClone(trigger),depth,status:'queued',reason:'Observed failure or attributed review feedback; awaiting real paired provider evaluation.',baseline_version:s.champion_version,candidate_version:version,expected_generation:s.champion_generation,baseline_strategy:base,candidate_strategy:candidate!,context_epoch:s.context_epoch,source_hash:sourceHash(),model_config_hash:configHash(),kernel_hash:kernelHash(),dataset_hash:hash({cases:frozen_cases,sources:frozen_sources}),frozen_cases,frozen_sources,trials:frozen_cases.flatMap(c=>(['baseline','candidate'] as const).map(arm=>({trial_id:id(),case_id:c.case_id,arm,status:'pending' as const,lease_owner:null,lease_until:null,charge_id:id(),result:null,input_hash:c.input_hash}))),actual_cost_usd:0,unknown_charge:false,evaluation_id:null,execution_mode:'provider',proposal:{status:'pending',charge_id:id(),lease_owner:null,lease_until:null,result:null},implementation_identity:evaluationImplementationIdentity()};
  save(s,record);
  s.harnesses.push({version,harness_id:proposal_id,prefetch:true,created_at:now(),status:'candidate',reason:record.reason});
  emit(s,w.workflow_id,'harness.improvement_proposed','Improvement diagnosis queued',`${trigger.origin}; a provider proposal is required before selecting the candidate strategy. Frozen diagnosis plus two independent synthetic cases, six provider trials, maximum $18.25 including the proposal inside the shared authorization.`);
  return record;
}

/** Safe to call repeatedly after worker/review transitions; trigger identities are permanent. */
export function scanAutomaticTriggers(s:State):number {
  let count=0;
  for(const w of s.workflows.filter(w=>w.reset_epoch===s.reset_epoch))for(const v of w.validations.filter(v=>!v.passed))if(enqueueAutomaticImprovementInState(s,{workflow_id:w.workflow_id,trigger_id:v.validation_id,origin:'validation',codes:v.codes}))count++;
  for(const f of s.feedback){
    if(!s.workflows.some(w=>w.workflow_id===f.workflow_id&&w.reset_epoch===s.reset_epoch))continue;
    if(f.type==='harness_improvement')continue; // Free-text suggestions require a diagnosable failure category.
    if(f.type==='fact_correction'&&f.status!=='applied')continue;
    if(enqueueAutomaticImprovementInState(s,{workflow_id:f.workflow_id,trigger_id:f.feedback_id,origin:f.role==='founder'?'founder_feedback':'lawyer_feedback',codes:[],feedback_type:f.type}))count++;
  }
  return count;
}

export function hasAutomaticWork(s:State):boolean{return readRecords(s).some(r=>['queued','evaluating'].includes(r.status));}
function isolate(s:State,r:AutomaticImprovement,t:Trial):State {
  const c=r.frozen_cases.find(c=>c.case_id===t.case_id)!,out=structuredClone(s),w=structuredClone(c.workflow);
  out.events=[];out.feedback=[];out.notifications=[];out.evaluations=[];out.receipts={};
  if(s.receipts['runtime:spend_authorization'])out.receipts['runtime:spend_authorization']=structuredClone(s.receipts['runtime:spend_authorization']);
  out.facts=structuredClone(w.facts);out.context_epoch=w.context_epoch;out.current_revision_id=c.base.revision_id;out.revisions=[structuredClone(c.base)];out.champion_version=t.arm==='baseline'?r.baseline_version:r.candidate_version;
  saveHarnessStrategy(out,out.champion_version,t.arm==='baseline'?r.baseline_strategy:r.candidate_strategy);
  out.harnesses=[{version:out.champion_version,harness_id:id(),prefetch:true,created_at:now(),status:'active',reason:'Frozen evaluation: no approvals, publication, notifications or child adaptation.'}];
  Object.assign(w,{state:'drafting',state_version:1,harness_version:out.champion_version,candidate_revision_id:null,validations:[],repair_count:0,missing_bundle_repairs:0,approvals:[],bundle_hash:null,review_input_hash:null,model_mode:'openai',model_status:'pending',model_attempts:0,input_tokens:0,output_tokens:0,reserved_cost:0,cost_usd:0,unknown_charge:false,lease_owner:null,lease_epoch:0,lease_until:null,failure:null,evidence_keys:r.frozen_sources.map(p=>p.provision_key),citation_offset:null});out.workflows=[w];return out;
}

export function compareAutomaticTrials(r:AutomaticImprovement):Evaluation['cases'] {
  const baseline=r.trials.filter(t=>t.arm==='baseline'),candidate=r.trials.filter(t=>t.arm==='candidate');
  const complete=r.trials.length===6&&r.trials.every(t=>t.status==='completed'&&t.result&&!t.result.unknown_charge&&t.result.model_attempts>0&&t.result.provider_response_ids.length>0&&(t.result.output_hash||(!t.result.passed&&t.result.validation_codes.length>0)));
  const paired=r.frozen_cases.every(c=>{const b=baseline.find(t=>t.case_id===c.case_id)?.result,a=candidate.find(t=>t.case_id===c.case_id)?.result;return !!a&&!!b&&(!b.passed||a.passed)&&a.passed;});
  const total=(xs:Trial[],k:'cost_usd'|'duration_ms'|'repair_count')=>xs.reduce((sum,t)=>sum+(t.result?.[k]||0),0);
  const passCount=(xs:Trial[])=>xs.filter(t=>t.result?.passed).length;
  const improvement=passCount(candidate)>passCount(baseline)||(passCount(candidate)===3&&total(candidate,'repair_count')<total(baseline,'repair_count'));
  const cost=total(candidate,'cost_usd')<=total(baseline,'cost_usd')*AUTOMATIC_LIMITS.cost_regression_ratio;
  const latency=total(candidate,'duration_ms')<=total(baseline,'duration_ms')*AUTOMATIC_LIMITS.latency_regression_ratio;
  const gate=(name:string,passed:boolean,actual:string)=>({name,expected:'passed',actual,passed});
  return [gate('six completed provider trials with attributable usage',complete,complete?'passed':'missing or inconclusive evidence'),gate('candidate passes diagnosis and both independent unseen cases with no regression',paired,paired?'passed':'candidate failure'),gate('measured success or repair improvement',improvement,`passes ${passCount(baseline)} → ${passCount(candidate)}, repairs ${total(baseline,'repair_count')} → ${total(candidate,'repair_count')}`),gate('cost regression ceiling 25%',cost,`${total(baseline,'cost_usd')} → ${total(candidate,'cost_usd')}`),gate('latency regression ceiling 25%',latency,`${total(baseline,'duration_ms')} → ${total(candidate,'duration_ms')}`),gate('protected campaign budget',r.actual_cost_usd<=AUTOMATIC_LIMITS.campaign_cost_usd&&r.trials.every(t=>(t.result?.model_attempts||0)<=AUTOMATIC_LIMITS.trial_attempts),String(r.actual_cost_usd)),gate('real provider execution required for promotion',r.execution_mode==='provider',r.execution_mode)];
}

function finish(s:State,r:AutomaticImprovement){
  const cases=compareAutomaticTrials(r),unchanged=r.source_hash===sourceHash()&&r.model_config_hash===configHash()&&r.kernel_hash===kernelHash()&&r.dataset_hash===hash({cases:r.frozen_cases,sources:r.frozen_sources});
  const cas=s.champion_version===r.baseline_version&&s.champion_generation===r.expected_generation;
  cases.push({name:'frozen source, model, dataset and protected evaluator bindings',expected:'unchanged',actual:unchanged?'unchanged':'changed',passed:unchanged},{name:'champion version and generation compare-and-swap',expected:'matched',actual:cas?'matched':'changed',passed:cas});
  cases.push({name:'model-proposed strategy has attributable provider evidence',expected:'completed provider proposal',actual:r.proposal?.result?.response_id||r.proposal?.status||'missing',passed:r.execution_mode==='provider'&&r.proposal?.status==='completed'&&r.proposal.result?.execution_mode==='provider'&&!!r.proposal.result.response_id&&!r.proposal.result.unknown_charge});
  const passed=cases.every(c=>c.passed),evaluation_id=id();
  const evaluation:Evaluation={evaluation_id,created_at:now(),baseline_version:r.baseline_version,candidate_version:r.candidate_version,mode:r.execution_mode==='provider'&&r.trials.every(t=>t.status==='completed')?'live_executed':'inconclusive',cases,baseline_repairs:r.trials.filter(t=>t.arm==='baseline').reduce((n,t)=>n+(t.result?.repair_count||0),0),candidate_repairs:r.trials.filter(t=>t.arm==='candidate').reduce((n,t)=>n+(t.result?.repair_count||0),0),passed,promoted:passed,dataset_hash:r.dataset_hash,duration_ms:r.trials.reduce((n,t)=>n+(t.result?.duration_ms||0),0)};
  const harness=s.harnesses.find(h=>h.version===r.candidate_version);
  if(passed){for(const h of s.harnesses)if(h.status==='active')h.status='retired';if(harness)harness.status='active';s.champion_version=r.candidate_version;s.champion_generation++;r.status='promoted';r.reason='All frozen provider and safety gates passed with a measured improvement; new events use this version.';}
  else{r.status=r.status==='inconclusive'||r.trials.some(t=>t.status==='inconclusive')?'inconclusive':'rejected';r.reason=cases.filter(c=>!c.passed).map(c=>c.name).join('; ');if(harness)harness.status='retired';}
  if(harness)harness.reason=r.reason;r.evaluation_id=evaluation_id;s.evaluations.push(evaluation);save(s,r);
  emit(s,r.workflow_id,'harness.evaluation_completed','Harness comparison completed',`${r.status}; ${cases.filter(c=>c.passed).length}/${cases.length} gates; ${r.actual_cost_usd.toFixed(4)} USD; ${r.execution_mode}.`);
  if(passed)emit(s,r.workflow_id,'harness.promoted',`Harness v${r.candidate_version} promoted`,'New events use the evaluated strategy. Existing workflows retain their pinned version; human approvals and evaluator rules are unchanged.');
}

/** One trial per durable worker step; no subprocesses or local disk required on Vercel. */
export async function processAutomaticImprovementStep(injected?:EvaluationRunner):Promise<{worked:boolean;proposal_id?:string;status?:string}> {
  const budget=await import('../runtime/budget');
  const owner=id();
  const claim=await transaction(s=>{
    for(const r of readRecords(s).filter(r=>['queued','blocked','evaluating'].includes(r.status))){
      if(r.reset_epoch!==s.reset_epoch){r.status='inconclusive';r.reason='RESET_EPOCH_CHANGED';save(s,r);continue;}
      if(r.proposal?.status==='dispatched'){
        if(Date.parse(r.proposal.lease_until||'')>Date.now())continue;
        r.proposal.status='inconclusive';r.unknown_charge=true;r.status='inconclusive';r.reason='PROPOSAL_LEASE_EXPIRED_CHARGE_RECONCILIATION_REQUIRED';budget.settleAuthorizedSpend(s,r.proposal.charge_id,0,true);save(s,r);finish(s,r);continue;
      }
      const dispatched=r.trials.find(t=>t.status==='dispatched');
      if(dispatched){if(Date.parse(dispatched.lease_until||'')>Date.now())continue;dispatched.status='inconclusive';r.unknown_charge=true;r.status='inconclusive';r.reason='EVALUATION_LEASE_EXPIRED_CHARGE_RECONCILIATION_REQUIRED';if(r.execution_mode==='provider')budget.settleAuthorizedSpend(s,dispatched.charge_id,0,true);save(s,r);finish(s,r);continue;}
      if(Date.now()>=Date.parse(r.deadline_at)){r.status='inconclusive';r.reason='EVALUATION_DEADLINE';save(s,r);finish(s,r);continue;}
      if(r.source_hash!==sourceHash()||r.model_config_hash!==configHash()||r.kernel_hash!==kernelHash()||r.dataset_hash!==hash({cases:r.frozen_cases,sources:r.frozen_sources})||s.champion_version!==r.baseline_version||s.champion_generation!==r.expected_generation){r.status='inconclusive';r.reason='EVALUATION_FROZEN_INPUT_CHANGED';save(s,r);finish(s,r);continue;}
      if(!injected&&!process.env.OPENAI_API_KEY){if(r.status!=='blocked'){r.status='blocked';r.reason='OPENAI_API_KEY_MISSING';save(s,r);emit(s,r.workflow_id,'harness.evaluation_blocked','Harness evaluation needs provider configuration',r.reason);}continue;}
      if(r.proposal?.status==='pending'){
        if(injected){r.execution_mode='injected_test';r.proposal.status='completed';saveHarnessStrategy(s,r.candidate_version,r.candidate_strategy);save(s,r);}
        else{
          try{budget.reserveAuthorizedSpend(s,r.proposal.charge_id,AUTOMATIC_LIMITS.proposal_cost_usd);}
          catch(e){r.status='blocked';r.reason=e instanceof AppError?e.code:'PROPOSAL_BUDGET_BLOCKED';save(s,r);continue;}
          r.status='evaluating';r.proposal.status='dispatched';r.proposal.lease_owner=owner;r.proposal.lease_until=new Date(Date.now()+120000).toISOString();save(s,r);
          emit(s,r.workflow_id,'harness.proposal_agent_started','Improvement proposal agent dispatched','One bounded model call selects a permitted strategy from observed failure evidence. Frozen unseen evaluation cases remain hidden from the proposal agent.');
          return {kind:'proposal' as const,proposal_id:r.proposal_id,charge_id:r.proposal.charge_id,state:structuredClone(s),baseline_strategy:r.baseline_strategy,failure_codes:r.trigger.codes,origin:r.trigger.origin,feedback_type:r.trigger.feedback_type,attributed_feedback:s.feedback.filter(f=>f.feedback_id===r.trigger.trigger_id).map(f=>({role:f.role,type:f.type,text:f.text.slice(0,2000),status:f.status}))};
        }
      }
      const trial=r.trials.find(t=>t.status==='pending');if(!trial){finish(s,r);continue;}
      try{if(!injected)budget.reserveAuthorizedSpend(s,trial.charge_id,AUTOMATIC_LIMITS.trial_cost_usd);}
      catch(e){r.status='blocked';r.reason=e instanceof AppError?e.code:'EVALUATION_BUDGET_BLOCKED';save(s,r);continue;}
      r.status='evaluating';if(injected)r.execution_mode='injected_test';trial.status='dispatched';trial.lease_owner=owner;trial.lease_until=new Date(Date.now()+AUTOMATIC_LIMITS.lease_ms).toISOString();save(s,r);
      emit(s,r.workflow_id,'harness.evaluation_trial_started','Frozen provider trial dispatched',`${trial.arm}; ${r.frozen_cases.find(c=>c.case_id===trial.case_id)!.split}; reserved up to $3 inside the shared authorization.`);
      return {kind:'trial' as const,proposal_id:r.proposal_id,trial:structuredClone(trial),state:isolate(s,r,trial),sources:structuredClone(r.frozen_sources)};
    }
    return null;
  });
  if(!claim)return {worked:false};
  if(claim.kind==='proposal'){
    let result:StrategyProposalResult;
    try{result=await generateStrategyProposal(claim);}
    catch{result={strategy:null,reason:'',response_id:null,model_attempts:0,input_tokens:0,output_tokens:0,cost_usd:0,unknown_charge:true,duration_ms:0,model:'unknown',config_version:'unknown',request_hash:'unknown',output_hash:null,error:'PROPOSAL_EXECUTION_INTERRUPTED',execution_mode:'provider'};}
    return transaction(s=>{
      const r=s.receipts[keyOf(claim.proposal_id)]?.result as unknown as AutomaticImprovement;
      if(!r?.proposal||r.proposal.lease_owner!==owner||r.proposal.status!=='dispatched')throw new AppError('EVALUATION_FENCED','A stale proposal cannot attach.');
      budget.settleAuthorizedSpend(s,r.proposal.charge_id,result.cost_usd,result.unknown_charge);
      r.proposal.result=result;r.proposal.lease_until=null;r.proposal.status=result.unknown_charge?'inconclusive':'completed';r.actual_cost_usd=result.cost_usd;r.unknown_charge=result.unknown_charge;
      if(result.strategy&&!result.unknown_charge&&hash(result.strategy)!==hash(r.baseline_strategy)){
        r.candidate_strategy=validateStrategy(result.strategy);saveHarnessStrategy(s,r.candidate_version,r.candidate_strategy);r.status='queued';r.reason='Provider-generated constrained strategy awaits six frozen independent trials.';save(s,r);
      }else{r.status=result.unknown_charge?'inconclusive':'rejected';r.reason=result.error||'MODEL_PROPOSED_NO_JUSTIFIED_CHANGE';save(s,r);finish(s,r);}
      emit(s,r.workflow_id,'harness.proposal_agent_completed','Improvement proposal agent completed',`${result.response_id||'no provider response'}; ${result.cost_usd} USD; ${r.status}; strategy remains unpromoted.`);
      return {worked:true,proposal_id:r.proposal_id,status:r.status};
    });
  }
  let result:AutomaticTrialResult;
  try{
    const runner=injected||(await import('../runtime')).evaluateFrozenCase;
    result=await runner({state:claim.state,workflow_id:claim.state.workflows[0].workflow_id,max_cost_usd:AUTOMATIC_LIMITS.trial_cost_usd,max_attempts:AUTOMATIC_LIMITS.trial_attempts,provisions:claim.sources,authorization_charge_id:claim.trial.charge_id});
  }catch{result={passed:false,validation_codes:['EVALUATION_EXECUTION_INTERRUPTED'],provider_response_ids:[],model_attempts:0,input_tokens:0,output_tokens:0,cost_usd:0,duration_ms:0,unknown_charge:true,output_hash:null,repair_count:0,error:'EVALUATION_EXECUTION_INTERRUPTED'};}
  return transaction(s=>{
    const r=s.receipts[keyOf(claim.proposal_id)]?.result as unknown as AutomaticImprovement;
    if(!r)throw new AppError('EVALUATION_FENCED','Evaluation record is missing.');
    const t=r.trials.find(t=>t.trial_id===claim.trial.trial_id)!;
    if(t.lease_owner!==owner||t.status!=='dispatched')throw new AppError('EVALUATION_FENCED','A stale evaluator cannot attach results.');
    // Malformed usage is a charge uncertainty, never zero-cost success.
    if(typeof result.passed!=='boolean'||!Number.isFinite(result.cost_usd)||result.cost_usd<0||result.cost_usd>3||!Number.isInteger(result.model_attempts)||result.model_attempts<0||result.model_attempts>AUTOMATIC_LIMITS.trial_attempts||!Number.isFinite(result.duration_ms)||result.duration_ms<0||![result.input_tokens,result.output_tokens,result.repair_count].every(n=>Number.isInteger(n)&&n>=0)||!Array.isArray(result.provider_response_ids)||result.provider_response_ids.some(x=>typeof x!=='string'||!x)||!Array.isArray(result.validation_codes)||result.validation_codes.some(x=>typeof x!=='string')){result.unknown_charge=true;result.passed=false;result.error='EVALUATION_USAGE_INVALID';}
    if(!injected)budget.settleAuthorizedSpend(s,t.charge_id,Number.isFinite(result.cost_usd)&&result.cost_usd>=0?result.cost_usd:0,result.unknown_charge);
    t.result=structuredClone(result);t.status=result.unknown_charge?'inconclusive':'completed';t.lease_until=null;r.actual_cost_usd=(r.proposal?.result?.cost_usd||0)+r.trials.reduce((n,t)=>n+(Number.isFinite(t.result?.cost_usd)?t.result!.cost_usd:0),0);r.unknown_charge=!!r.proposal?.result?.unknown_charge||r.trials.some(t=>t.result?.unknown_charge);
    emit(s,r.workflow_id,'harness.evaluation_trial_completed','Frozen provider trial completed',`${t.arm}; passed=${result.passed}; ${result.model_attempts} model calls; ${result.cost_usd} USD; ${r.execution_mode}.`);
    if(r.unknown_charge||r.trials.every(t=>t.status==='completed'))finish(s,r);else save(s,r);
    return {worked:true,proposal_id:r.proposal_id,status:r.status};
  });
}

export async function automaticImprovementStatus(){const s=await readState();return readRecords(s).map(r=>({proposal_id:r.proposal_id,workflow_id:r.workflow_id,origin:r.trigger.origin,status:r.status,reason:r.reason,baseline_version:r.baseline_version,candidate_version:r.candidate_version,dataset_hash:r.dataset_hash,depth:r.depth,completed_trials:r.trials.filter(t=>t.result).length,total_trials:r.trials.length,cost_usd:r.actual_cost_usd,unknown_charge:r.unknown_charge,execution_mode:r.execution_mode,evaluation_id:r.evaluation_id}));}
