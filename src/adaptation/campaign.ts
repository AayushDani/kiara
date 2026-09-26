import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {transaction} from '../data/store';
import {hash,id,now} from '../server/hash';
import {AppError,type Json,type State,type Workflow} from '../server/contracts';
import {seed} from '../data/fixtures';

export interface TrialResult {
  trial_id:string;arm:'baseline'|'candidate';status:'completed'|'inconclusive';provider_mode:'openai';state:string;passed:boolean;
  missing_bundle_repairs:number;repair_count:number;model_attempts:number;input_tokens:number;output_tokens:number;
  cost_usd:number;reserved_cost:number;unknown_charge:boolean;duration_ms:number;source_snapshot:string;input_hash:string;
  candidate_hash:string|null;validation_codes:string[];error:string|null;
}
export interface CampaignRecord {
  kind:'evaluation_campaign';campaign_id:string;tenant_id:string;reset_epoch:number;created_at:string;deadline_at:string;
  status:'running'|'completed'|'inconclusive';reserved_cost_usd:number;actual_cost_usd:number;unknown_charge:boolean;
  model_attempts:number;max_attempts:72;max_cost_usd:18;input_hash:string;frozen_hash:string;
  trial_plan:{trial_id:string;arm:'baseline'|'candidate'}[];results:TrialResult[];error:string|null;
}
export interface CampaignInput {reset_epoch:number;workflow:Workflow;revisions:State['revisions'];baseline_version:number;candidate_version:number;source_snapshot:string;frozen_hash:string}
export interface TrialInput {trial_id:string;arm:'baseline'|'candidate';state:State;source_snapshot:string;input_hash:string;deadline_at:string}
export type TrialRunner=(input:TrialInput,directory:string,deadline:number)=>Promise<TrialResult>;
const scopedKey=(epoch:number,id:string)=>`${epoch}:adaptation:campaign:${id}`;
function save(s:State,key:string,value:CampaignRecord){s.receipts[key]={hash:hash(value),result:value as unknown as Json};}
function isolatedState(input:CampaignInput,arm:'baseline'|'candidate'):State {
  const s=seed(input.reset_epoch),w=structuredClone(input.workflow);s.facts=structuredClone(w.facts);s.context_epoch=w.context_epoch;s.revisions=structuredClone(input.revisions);s.current_revision_id=w.base_revision_id;s.champion_version=arm==='candidate'?input.candidate_version:input.baseline_version;s.harnesses=[{version:s.champion_version,harness_id:id(),prefetch:arm==='candidate',created_at:now(),status:'active',reason:'Isolated evaluation trial; cannot approve, notify or promote.'}];
  Object.assign(w,{state:'queued',state_version:1,created_at:now(),updated_at:now(),harness_version:s.champion_version,candidate_revision_id:null,assessment:null,validations:[],repair_count:0,missing_bundle_repairs:0,approvals:[],bundle_hash:null,review_input_hash:null,model_mode:'openai',model_status:'not_started',model_attempts:0,input_tokens:0,output_tokens:0,reserved_cost:0,cost_usd:0,unknown_charge:false,lease_owner:null,lease_epoch:0,lease_until:null,failure:null,evidence_keys:[],citation_offset:null});s.workflows=[w];return s;
}
export async function spawnTrial(input:TrialInput,directory:string,deadline:number):Promise<TrialResult>{
  await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,'input.json'),JSON.stringify(input),{mode:0o600});await writeFile(join(directory,'state.json'),JSON.stringify(input.state),{mode:0o600});
  const env={...process.env,KIARA_DATA_DIR:directory,KIARA_MODEL_MODE:'openai',KIARA_EMAIL_MODE:'preview',KIARA_ALLOW_LIVE_EMAIL:'false',KIARA_EVALUATION_CHILD:'true'};
  for(const key of Object.keys(env))if(key==='MONGODB_URI'||key.startsWith('RESEND_')||key==='KIARA_SESSION_SECRET')delete (env as Record<string,string|undefined>)[key];
  const child=spawn(process.execPath,['--import','tsx',resolve(process.cwd(),'src/adaptation/trial.ts'),join(directory,'input.json')],{cwd:process.cwd(),env,stdio:['ignore','ignore','pipe']});
  // Never persist raw provider stderr: SDK failures can include request details.
  child.stderr.resume();
  let force:ReturnType<typeof setTimeout>|undefined;const timer=setTimeout(()=>{child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),2000);},Math.max(1,deadline-Date.now()));
  try{await new Promise<void>((res,rej)=>{child.once('error',rej);child.once('exit',(code,signal)=>code===0?res():rej(new AppError('TRIAL_PROCESS_INTERRUPTED',`Isolated trial ended without a completion receipt (${signal||code}).`)));});}
  finally{clearTimeout(timer);if(force)clearTimeout(force);}
  const result=JSON.parse(await readFile(join(directory,'result.json'),'utf8')) as TrialResult;
  if(result.trial_id!==input.trial_id||result.arm!==input.arm||result.input_hash!==input.input_hash||result.provider_mode!=='openai')throw new AppError('TRIAL_BINDING_MISMATCH','Trial result does not match its frozen input identity.');return result;
}
/** Runs only foreground review code inside six separate child stores. No child can email, approve, publish, or mutate the parent champion. */
export async function runLiveCampaign(input:CampaignInput,runner:TrialRunner=spawnTrial):Promise<CampaignRecord>{
  if(runner===spawnTrial&&!process.env.OPENAI_API_KEY)throw new AppError('LIVE_EVALUATION_CREDENTIALS_REQUIRED','OpenAI credentials are required for the six-run live semantic comparison.');
  const campaignId=id(),key=scopedKey(input.reset_epoch,campaignId);
  const inputHash=hash({facts:input.workflow.facts,context_epoch:input.workflow.context_epoch,base_revision:input.revisions.find(r=>r.revision_id===input.workflow.base_revision_id),residence:input.workflow.residence,source_snapshot:input.source_snapshot});
  const initial:CampaignRecord={kind:'evaluation_campaign',campaign_id:campaignId,tenant_id:input.workflow.tenant_id,reset_epoch:input.reset_epoch,created_at:now(),deadline_at:new Date(Date.now()+900000).toISOString(),status:'running',reserved_cost_usd:18,actual_cost_usd:0,unknown_charge:false,model_attempts:0,max_attempts:72,max_cost_usd:18,input_hash:inputHash,frozen_hash:input.frozen_hash,trial_plan:Array.from({length:6},(_,i)=>({trial_id:id(),arm:i%2===0?'baseline':'candidate'})),results:[],error:null};
  await transaction(s=>{if(s.reset_epoch!==input.reset_epoch)throw new AppError('RESET_EPOCH_MISMATCH','Campaign belongs to an old epoch.');if(Object.values(s.receipts).some(r=>(r.result as any)?.kind==='evaluation_campaign'&&(r.result as any)?.status==='running'))throw new AppError('CAMPAIGN_ACTIVE','An evaluation campaign is already running.');save(s,key,initial);});
  const root=join(process.env.KIARA_DATA_DIR||join(process.cwd(),'.kiara'),'evals',campaignId);let results:TrialResult[]=[];let error:string|null=null;
  for(const trial of initial.trial_plan){
    if(Date.now()>=Date.parse(initial.deadline_at)){error='CAMPAIGN_DEADLINE';break;}
    const trialInput:TrialInput={...trial,state:isolatedState(input,trial.arm),source_snapshot:input.source_snapshot,input_hash:inputHash,deadline_at:initial.deadline_at};
    // Persist the dispatch identity and full reservation before any child can call a provider.
    await transaction(s=>{if(s.reset_epoch!==input.reset_epoch)throw new AppError('RESET_EPOCH_MISMATCH','Campaign was reset.');const record=s.receipts[key]?.result as unknown as CampaignRecord;if(!record||record.status!=='running')throw new AppError('CAMPAIGN_FENCED','Campaign is no longer dispatchable.');s.receipts[`${key}:dispatch:${trial.trial_id}`]={hash:hash({trial,input_hash:inputHash}),result:{kind:'evaluation_trial_dispatch',campaign_id:campaignId,trial_id:trial.trial_id,arm:trial.arm,reset_epoch:input.reset_epoch,status:'dispatched',reserved_cost_usd:3,created_at:now()}};});
    let result:TrialResult;
    try{result=await runner(trialInput,join(root,trial.trial_id),Math.min(Date.parse(initial.deadline_at),Date.now()+305000));}
    catch{result={...trial,status:'inconclusive',provider_mode:'openai',state:'needs_human_review',passed:false,missing_bundle_repairs:0,repair_count:0,model_attempts:0,input_tokens:0,output_tokens:0,cost_usd:0,reserved_cost:3,unknown_charge:true,duration_ms:0,source_snapshot:input.source_snapshot,input_hash:inputHash,candidate_hash:null,validation_codes:[],error:'TRIAL_PROCESS_OR_RECEIPT_UNKNOWN'};}
    if(result.input_hash!==inputHash||result.source_snapshot!==input.source_snapshot){result.passed=false;result.status='inconclusive';result.error='TRIAL_BINDING_MISMATCH';}
    results=[...results,result];
    await transaction(s=>{if(s.reset_epoch!==input.reset_epoch)throw new AppError('RESET_EPOCH_MISMATCH','Old trial results cannot attach.');const record=s.receipts[key]!.result as unknown as CampaignRecord;record.results=results;record.actual_cost_usd=results.reduce((n,r)=>n+r.cost_usd,0);record.model_attempts=results.reduce((n,r)=>n+r.model_attempts,0);record.unknown_charge=results.some(r=>r.unknown_charge);record.reserved_cost_usd=(6-results.length)*3+results.reduce((n,r)=>n+r.reserved_cost,0);save(s,key,record);s.receipts[`${key}:result:${trial.trial_id}`]={hash:hash(result),result:result as unknown as Json};});
    if(result.unknown_charge||result.reserved_cost>0){error='TRIAL_CHARGE_RECONCILIATION_REQUIRED';break;}
    if(results.reduce((n,r)=>n+r.cost_usd,0)>18||results.reduce((n,r)=>n+r.model_attempts,0)>72){error='CAMPAIGN_BUDGET_EXCEEDED';break;}
  }
  return transaction(s=>{if(s.reset_epoch!==input.reset_epoch)throw new AppError('RESET_EPOCH_MISMATCH','Old campaign cannot finish after reset.');const record=s.receipts[key]!.result as unknown as CampaignRecord;record.results=results;record.actual_cost_usd=results.reduce((n,r)=>n+r.cost_usd,0);record.model_attempts=results.reduce((n,r)=>n+r.model_attempts,0);record.unknown_charge=results.some(r=>r.unknown_charge);record.reserved_cost_usd=results.reduce((n,r)=>n+r.reserved_cost,0);record.status=error||results.length!==6||results.some(r=>r.status==='inconclusive')?'inconclusive':'completed';record.error=error;save(s,key,record);return structuredClone(record);});
}
/** A parent crash cannot authorize replay. Retain dispatched trial reservations until results are reconciled. */
export async function recoverEvaluationCampaigns():Promise<number>{return transaction(s=>{let count=0;for(const [key,receipt] of Object.entries(s.receipts)){const r=receipt.result as unknown as CampaignRecord;if(r?.kind!=='evaluation_campaign'||r.status!=='running'||Date.parse(r.deadline_at)>Date.now())continue;r.status='inconclusive';r.unknown_charge=true;r.error='PARENT_CAMPAIGN_INTERRUPTED';save(s,key,r);count++;}return count;});}
