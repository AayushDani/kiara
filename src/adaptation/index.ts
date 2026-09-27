import {transaction,readState} from '../data/store';
import {AppError,type Evaluation,type Json} from '../server/contracts';
import {hash,id,now} from '../server/hash';
import {contextCheck} from '../validation/proposal';
import {getLedger} from '../runtime/budget';
import {scanAutomaticTriggers,automaticImprovementStatus,enqueueAutomaticImprovementInState,type AutomaticImprovement} from './automatic';
import {validateStrategy} from './strategy';
export {BASE_CONFIG,PREFETCH_PATCH,validateHarnessPatch} from './patch';
export type {HarnessConfig,PatchOperation} from './patch';
export * from './automatic';
export {BASE_STRATEGY,saveHarnessStrategy,validateStrategy} from './strategy';

/** Queue only the exact selected strategy, preserving suggestion/campaign identity through retries. */
export async function evaluateModelSuggestion(proposal_id:string,options:{expected_reset_epoch:number;expected_champion_generation:number}){
  return transaction(s=>{
    if(options.expected_reset_epoch!==s.reset_epoch)throw new AppError('RESET_EPOCH_MISMATCH','Refresh before evaluating.');
    const proposal=s.receipts[`${s.reset_epoch}:model_harness_proposal:${proposal_id}`]?.result as any;
    if(!proposal||proposal.kind!=='model_harness_proposal'||proposal.tenant_id!==s.tenant_id||proposal.reset_epoch!==s.reset_epoch)throw new AppError('PROPOSAL_REQUIRED','A current attributed harness suggestion is required.',400);
    const strategy=validateStrategy(proposal.strategy);
    if(proposal.strategy_hash!==hash(strategy))throw new AppError('PROPOSAL_INTEGRITY','The suggestion strategy changed.');
    let campaign=Object.values(s.receipts).map(r=>r.result as unknown as AutomaticImprovement).find(r=>r?.kind==='automatic_improvement'&&r.requested_suggestion?.proposal_id===proposal_id);
    if(!campaign){
      if(options.expected_champion_generation!==s.champion_generation||proposal.champion_generation!==s.champion_generation||proposal.champion_version!==s.champion_version||proposal.context_epoch!==s.context_epoch)throw new AppError('PROPOSAL_STALE','The suggestion was made for an older context or strategy. Request a new suggestion.');
      const w=s.workflows.find(w=>w.workflow_id===proposal.workflow_id&&w.reset_epoch===s.reset_epoch&&w.tenant_id===s.tenant_id);
      if(!w)throw new AppError('NOT_FOUND','The originating workflow is unavailable.',404);
      const failures=w.validations.filter(v=>!v.passed).flatMap(v=>v.codes);
      const correction=s.feedback.find(f=>f.workflow_id===w.workflow_id&&f.type!=='harness_improvement'&&(f.type!=='fact_correction'||f.status==='applied'));
      if(!failures.length&&!correction)throw new AppError('DIAGNOSIS_REQUIRED','This suggestion requires an actual failure or attributed correction on its originating workflow.');
      campaign=enqueueAutomaticImprovementInState(s,{workflow_id:w.workflow_id,trigger_id:`suggestion:${proposal_id}`,origin:failures.length?'validation':correction!.role==='founder'?'founder_feedback':'lawyer_feedback',codes:failures,feedback_type:correction?.type,feedback_id:correction?.feedback_id},{proposal_id,strategy})||undefined;
      if(!campaign)throw new AppError('EVALUATION_NOT_ADMITTED','The selected suggestion cannot start another evaluation while admission limits apply.');
      const resolution={kind:'model_proposal_resolution',proposal_id,campaign_id:campaign.proposal_id,status:'queued',strategy_hash:hash(strategy),created_at:now()};
      s.receipts[`${s.reset_epoch}:model_proposal_resolution:${proposal_id}`]={hash:hash(resolution),result:resolution as Json};
    }
    return {proposal_id,campaign_id:campaign.proposal_id,status:campaign.status,evaluation_id:campaign.evaluation_id,strategy_hash:hash(strategy)};
  });
}

/** Legacy manual entry point now queues the same genuine failure-driven evaluation as workers. */
export async function evaluateHarness(input:{patch?:unknown;expected_reset_epoch?:number;expected_champion_generation?:number}|number={}):Promise<Evaluation>{
  const options=typeof input==='number'?{expected_reset_epoch:input}:input;
  return transaction(s=>{
    if(options.expected_reset_epoch!==undefined&&options.expected_reset_epoch!==s.reset_epoch)throw new AppError('RESET_EPOCH_MISMATCH','Refresh before evaluating.');
    if(options.expected_champion_generation!==undefined&&options.expected_champion_generation!==s.champion_generation)throw new AppError('CHAMPION_CHANGED','Harness generation changed.');
    if(options.patch!==undefined)throw new AppError('LEGACY_PATCH_RETIRED','Fixed prefetch patches cannot establish a measured AI improvement. Failure-driven strategy evaluation is automatic.');
    scanAutomaticTriggers(s);
    const records=Object.values(s.receipts).map(r=>r.result as unknown as AutomaticImprovement).filter(r=>r?.kind==='automatic_improvement');
    const latest=records.at(-1);
    if(!latest)throw new AppError('DIAGNOSIS_REQUIRED','A real AI validation failure or attributed review correction is required before proposing an improvement. Scripted examples never promote a harness.');
    if(latest.evaluation_id){const report=s.evaluations.find(e=>e.evaluation_id===latest.evaluation_id);if(report)return report;}
    // This is a status response, not an executed evaluation record.
    return {evaluation_id:latest.proposal_id,created_at:latest.created_at,baseline_version:latest.baseline_version,candidate_version:latest.candidate_version,mode:'inconclusive',cases:[{name:'provider evaluation execution',expected:'completed and measured',actual:latest.status+': '+latest.reason,passed:false}],baseline_repairs:0,candidate_repairs:0,passed:false,promoted:false,duration_ms:0,dataset_hash:latest.dataset_hash};
  });
}
export async function rollback(input:{expected_reset_epoch?:number;expected_champion_generation?:number}|number={}){
  const options=typeof input==='number'?{expected_reset_epoch:input}:input;
  return transaction(s=>{
    if(options.expected_reset_epoch!==undefined&&options.expected_reset_epoch!==s.reset_epoch)throw new AppError('RESET_EPOCH_MISMATCH','Refresh before rolling back.');
    if(options.expected_champion_generation!==undefined&&options.expected_champion_generation!==s.champion_generation)throw new AppError('CHAMPION_CHANGED','Harness generation changed.');
    if(s.champion_version===1)throw new AppError('NO_ROLLBACK','The baseline is already active.');
    const previous=s.champion_version,proof=Object.values(s.receipts).map(r=>r.result as unknown as AutomaticImprovement).find(r=>r?.kind==='automatic_improvement'&&r.status==='promoted'&&r.candidate_version===previous);
    const target=proof?.baseline_version||1;
    s.champion_version=target;s.champion_generation++;for(const h of s.harnesses)h.status=h.version===target?'active':'retired';
    for(const receipt of Object.values(s.receipts)){const r=receipt.result as unknown as AutomaticImprovement;if(r?.kind==='automatic_improvement'&&['queued','blocked','evaluating'].includes(r.status)){r.status='inconclusive';r.reason='CHAMPION_ROLLED_BACK';receipt.hash=hash(r);}}
    s.events.push({event_id:id(),tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,aggregate_seq:s.events.length+1,workflow_id:null,type:'harness.rolled_back',title:`Harness returned to v${target}`,detail:`Version ${previous} retired for new events. Existing workflow version pins, approvals, costs and evaluation history remain retained.`,created_at:now()});
    return {champion_version:target,champion_generation:s.champion_generation};
  });
}
export async function laterEventProof(){
  const s=await readState(),evaluation=[...s.evaluations].reverse().find(e=>e.promoted);
  if(!evaluation)return {status:'awaiting_promotion',live_model_calls:0};
  const record=Object.values(s.receipts).map(r=>r.result as unknown as AutomaticImprovement).find(r=>r?.kind==='automatic_improvement'&&r.evaluation_id===evaluation.evaluation_id);
  const later=s.workflows.find(w=>w.harness_version===evaluation.candidate_version&&w.workflow_id!==record?.workflow_id&&Date.parse(w.created_at)>=Date.parse(evaluation.created_at)&&w.validations.some(v=>v.stage==='proposal'&&v.passed));
  if(!later)return {status:'awaiting_distinct_later_event',harness_version:evaluation.candidate_version,live_model_calls:0};
  const ledger=getLedger(s,later),ids=ledger?.attempts.filter(a=>a.status==='complete'&&a.response_id).map(a=>a.response_id)||[],candidate=s.revisions.find(r=>r.revision_id===later.candidate_revision_id);
  const real=later.model_mode==='openai'&&ids.length>0&&candidate?.generation==='openai';
  return {status:real&&contextCheck(later.evidence_keys)?'observed':'inconclusive',workflow_id:later.workflow_id,event_id:later.event_id,harness_version:later.harness_version,model_mode:later.model_mode,live_model_calls:ids.length,provider_response_ids:ids,candidate_hash:candidate?.content_hash||null,evaluation_id:evaluation.evaluation_id};
}
export {automaticImprovementStatus};
