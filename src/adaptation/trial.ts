import {readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {hash} from '../server/hash';
import type {TrialInput,TrialResult} from './campaign';
import {readState,closeStore} from '../data/store';
import {provisions} from '../data/fixtures';
import {tick} from '../workflow/engine';
import {runModel,validateRevisionModel,repairModel,recoverModelRuns} from '../runtime';

if(process.env.KIARA_EVALUATION_CHILD!=='true'||!process.argv[2])throw new Error('Evaluation trial must be started by the bounded campaign service.');
const input=JSON.parse(await readFile(process.argv[2],'utf8')) as TrialInput;
if(process.env.MONGODB_URI||process.env.KIARA_ALLOW_LIVE_EMAIL!=='false')throw new Error('Evaluation child must use isolated local persistence and disabled email.');
const start=performance.now();let error:string|null=null;
try{
  for(let step=0;step<40;step++){
    if(Date.now()>=Date.parse(input.deadline_at)){error='CAMPAIGN_DEADLINE';break;}
    await recoverModelRuns();const s=await readState();const w=s.workflows[0];
    if(['awaiting_founder','needs_human_review','needs_information','closed_no_change','failed'].includes(w.state))break;
    const task=await tick();if(task){if('intent' in task&&task.intent==='validate')await validateRevisionModel(task.workflow_id,task.reset_epoch);else if('intent' in task&&task.intent==='repair')await repairModel(task.workflow_id,task.reset_epoch);else await runModel(task.workflow_id,task.reset_epoch);}
  }
}catch{error='TRIAL_EXECUTION_FAILED';}
const s=await readState();const w=s.workflows[0];const liveAttempts=w.model_attempts;
const result:TrialResult={trial_id:input.trial_id,arm:input.arm,status:error||w.unknown_charge||w.reserved_cost>0?'inconclusive':'completed',provider_mode:'openai',state:w.state,passed:w.state==='awaiting_founder'&&w.validations.at(-1)?.passed===true&&liveAttempts>0,missing_bundle_repairs:w.missing_bundle_repairs,repair_count:w.repair_count,model_attempts:liveAttempts,input_tokens:w.input_tokens,output_tokens:w.output_tokens,cost_usd:w.cost_usd,reserved_cost:w.reserved_cost,unknown_charge:w.unknown_charge,duration_ms:Math.round(performance.now()-start),source_snapshot:hash(provisions().map(p=>[p.provision_key,p.source_version_id,p.content_hash,p.source_hash])),input_hash:input.input_hash,candidate_hash:s.revisions.find(r=>r.revision_id===w.candidate_revision_id)?.content_hash||null,validation_codes:w.validations.filter(v=>!v.passed&&!v.repaired).flatMap(v=>v.codes),error:error||w.failure};
const path=join(dirname(process.argv[2]),'result.json');await writeFile(path+'.tmp',JSON.stringify(result),{mode:0o600});await rename(path+'.tmp',path);await closeStore();
