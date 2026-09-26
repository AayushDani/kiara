import type {State} from './contracts';

export interface OperationalEvidence {
  shared_budget?:{budget_usd:number;spent_usd:number;reserved_usd:number;unknown_charges:number;inflight:number;request_count:number;scope:string};
  inference_evidence:{completed_requests:number;provider_response_ids:string[];input_tokens:number;output_tokens:number;cost_usd:number;reserved_usd:number;unknown_charge:boolean};
  runs:{workflow_id:string;run_id:string;model:string;config_hash:string|null;attempts:{attempt_id:string;phase:string;status:string;response_id:string|null;input_tokens:number;output_tokens:number;cost_usd:number;error_code:string|null}[];tools:{name:string;call_id:string|null;arguments_hash:string|null;result_hash:string}[]}[];
  improvements:Record<string,unknown>[];
  receipts:{key:string;kind:string;hash:string;workflow_id:string|null;created_at:string|null}[];
  scope:{context_epoch:number;source:'founder_supplied'|'synthetic_fixture';supported_jurisdictions:string[];source_policy:string};
}

/** Explicit projection: model text, credentials, prompts and raw company facts are not telemetry. */
export function operationalEvidence(s:State):OperationalEvidence {
  const receipts=Object.entries(s.receipts);
  const runs:OperationalEvidence['runs']=[];
  for(const [key,receipt] of receipts){
    const value=receipt.result as any;
    const ledger=value?.kind==='runtime_history'?value.ledger:key.includes(':runtime:')?value:null;
    if(!ledger?.run_id||!Array.isArray(ledger.attempts))continue;
    if(runs.some(r=>r.run_id===ledger.run_id))continue;
    runs.push({workflow_id:ledger.workflow_id,run_id:ledger.run_id,model:ledger.model,config_hash:ledger.config?.config_version??null,
      attempts:ledger.attempts.map((a:any)=>({attempt_id:a.attempt_id,phase:a.phase,status:a.status,response_id:a.response_id??null,input_tokens:a.input_tokens||0,output_tokens:a.output_tokens||0,cost_usd:a.cost_usd||0,error_code:a.provider_error_code??a.error_code??null})),
      tools:(ledger.tools||[]).map((t:any)=>({name:t.name,call_id:t.call_id??null,arguments_hash:t.arguments_hash??null,result_hash:t.result_hash}))});
  }
  for(const [,receipt] of receipts){
    const campaign=receipt.result as any;if(campaign?.kind!=='automatic_improvement')continue;
    for(const trial of campaign.trials||[]){const audit=trial.result?.audit;if(!audit?.attempts)continue;runs.push({workflow_id:campaign.workflow_id,run_id:trial.trial_id,model:audit.config?.model||'unknown',config_hash:audit.config_version??null,attempts:audit.attempts.map((a:any)=>({attempt_id:a.attempt_id,phase:`evaluation_${trial.arm}:${a.phase}`,status:a.status,response_id:a.response_id??null,input_tokens:a.input_tokens||0,output_tokens:a.output_tokens||0,cost_usd:a.cost_usd||0,error_code:a.provider_error_code??a.error_code??null})),tools:(audit.tools||[]).map((t:any)=>({name:t.name,call_id:t.call_id??null,arguments_hash:t.arguments_hash??null,result_hash:t.result_hash}))});}
    const proposal=campaign.proposal?.result;
    if(proposal?.response_id)runs.push({workflow_id:campaign.workflow_id,run_id:`proposal:${campaign.proposal_id}`,model:proposal.model||'strategy_proposer',config_hash:proposal.config_version??null,attempts:[{attempt_id:campaign.proposal.charge_id,phase:'strategy_proposal',status:proposal.unknown_charge?'unknown':'complete',response_id:proposal.response_id,input_tokens:proposal.input_tokens||0,output_tokens:proposal.output_tokens||0,cost_usd:proposal.cost_usd||0,error_code:proposal.error||null}],tools:[]});
  }
  const attempts=runs.flatMap(r=>r.attempts),completed=attempts.filter(a=>a.status==='complete'&&!!a.response_id);
  const metadataKeys=['kind','proposal_id','job_id','origin','trigger_id','trigger','workflow_id','status','reason','codes','depth','baseline_version','candidate_version','dataset_hash','created_at','updated_at','promoted','failure','actual_cost_usd','cost_usd','reserved_cost_usd','duration_ms','summary','candidate_strategy','evaluation_id','metrics','blocked_reason'];
  const improvements=receipts.flatMap(([,receipt])=>{const r=receipt.result as any;if(!r||typeof r!=='object'||!/(automatic|improvement|evaluation_campaign)/.test(r.kind||''))return [];return [Object.fromEntries(metadataKeys.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]))];});
  const imported=!!s.receipts[`${s.reset_epoch}:company_context:${s.context_epoch}`];
  return {inference_evidence:{completed_requests:completed.length,provider_response_ids:completed.map(a=>a.response_id!),input_tokens:attempts.reduce((n,a)=>n+a.input_tokens,0),output_tokens:attempts.reduce((n,a)=>n+a.output_tokens,0),cost_usd:attempts.reduce((n,a)=>n+a.cost_usd,0),reserved_usd:s.workflows.reduce((n,w)=>n+w.reserved_cost,0),unknown_charge:s.workflows.some(w=>w.unknown_charge)},runs,improvements,
    receipts:receipts.filter(([key,r])=>!!(r.result as any)?.kind||key.includes(':runtime:')).map(([key,r])=>({key,kind:(r.result as any)?.kind||'runtime_ledger',hash:r.hash,workflow_id:(r.result as any)?.workflow_id??null,created_at:(r.result as any)?.created_at??null})),
    scope:{context_epoch:s.context_epoch,source:imported?'founder_supplied':'synthetic_fixture',supported_jurisdictions:['US-CA'],source_policy:process.env.KIARA_AUTH_MODE==='public_demo'?'Retained demonstration sources, not a claim of current law. Human review roles are simulated; AI execution is independently recorded.':'Retained California provisions; live private approval requires a lawyer source attestation. Unsupported scope escalates.'}};
}
