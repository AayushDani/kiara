/** Real provider acceptance in one isolated Atlas workspace. No email or human identity claims. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {withDemoScope} from '../src/server/demo-context';
import {transaction,readState,closeStore} from '../src/data/store';
import {signup,tick,review,feedback,verifyFact} from '../src/workflow/engine';
import {executeModel,runModel,validateRevisionModel,repairModel,retryBlockedModel} from '../src/runtime';
import {scanAutomaticTriggers,processAutomaticImprovementStep,automaticImprovementStatus} from '../src/adaptation';
import {revision} from '../src/data/fixtures';
import {operationalEvidence} from '../src/server/operations';
import {globalSpendStatus} from '../src/server/global-spend';
import {dispatchNotification} from '../src/server/notifications';

Object.assign(process.env,{KIARA_AUTH_MODE:'public_demo',KIARA_MODEL_MODE:'openai',KIARA_OPENAI_BUDGET_USD:'50',KIARA_PUBLIC_LIVE_ENABLED:'true',KIARA_EMAIL_MODE:'preview',KIARA_ALLOW_LIVE_EMAIL:'false',KIARA_ACCEPTANCE_TEST:'true',KIARA_MODEL:'gpt-6-sol',KIARA_REVIEW_MODEL:'gpt-6-sol',KIARA_REASONING_EFFORT:'low'});
if(!process.env.OPENAI_API_KEY||!process.env.MONGODB_URI)throw new Error('Secure project provider and Atlas configuration required.');
const step=process.argv[2]||'initial',label=process.env.KIARA_ACCEPTANCE_RUN||'';
if(!/^[a-z0-9-]{0,40}$/.test(label))throw new Error('Invalid acceptance run label');
const suffix=label?'-'+label:'',file='.kiara/live-acceptance-scope'+suffix+'.json',reportFile='docs/verification/provider-acceptance'+suffix+'.json';
await mkdir('.kiara',{recursive:true,mode:0o700});await mkdir('docs/verification',{recursive:true});
let saved:{scope:{id:string;expires_at:number};workflow_id?:string;created_at:string};
try{saved=JSON.parse(await readFile(file,'utf8'));}catch{saved={scope:{id:randomBytes(16).toString('hex'),expires_at:Date.now()+30*86400000},created_at:new Date().toISOString()};await writeFile(file,JSON.stringify(saved),{mode:0o600});}
let injected=false;
async function foreground(fault=false){
  for(let i=0;i<18;i++){
    const before=await readState(),w=before.workflows.find(w=>w.workflow_id===saved.workflow_id)!;
    if(['awaiting_founder','awaiting_lawyer','needs_human_review','needs_information','finalized','closed_no_change','failed'].includes(w.state))break;
    const pending=await tick(before.reset_epoch);
    if(pending){
      if('intent'in pending&&pending.intent==='validate')await validateRevisionModel(pending.workflow_id,pending.reset_epoch);
      else if('intent'in pending&&pending.intent==='repair')await repairModel(pending.workflow_id,pending.reset_epoch);
      else if(fault&&!injected)await executeModel(pending.workflow_id,pending.reset_epoch,undefined,'draft',{transaction,transformOutput:(text:string)=>{if(injected)return text;const value=JSON.parse(text);if(!value.changes?.length)return text;injected=true;value.changes[0].body+=' Send privacy requests to privacy@deliberate-test-fault.example.';return JSON.stringify(value);}});
      else await runModel(pending.workflow_id,pending.reset_epoch);
    }
    await transaction(s=>{scanAutomaticTriggers(s);});
    const current=(await readState()).workflows.find(w=>w.workflow_id===saved.workflow_id)!;
    console.log(JSON.stringify({checkpoint:current.state,workflow_id:current.workflow_id,attempts:current.model_attempts,repairs:current.repair_count,failure:current.failure,cost_usd:current.cost_usd}));
  }
}
async function record(){const s=await readState();const report={checked_at:new Date().toISOString(),kind:'real_provider_isolated_atlas_acceptance',test_scope_id:saved.scope.id,email_mode:'preview',human_roles:'synthetic acceptance assertions, not actual founder/lawyer approval',fault_injection:s.events.some(e=>e.type.includes('fault'))?'See local test-only fault receipt and original provider hash':'See test-only fault receipts, if any; never enabled on Vercel',step,workflows:s.workflows,events:s.events,feedback:s.feedback,documents:s.revisions,operations:operationalEvidence(s),improvements:await automaticImprovementStatus(),global_budget:await globalSpendStatus(),receipts:Object.entries(s.receipts).filter(([,r])=>['model_output_event','model_output_failure','acceptance_fault_injected','test_only_fault_injected','semantic_review','document_redline'].includes((r.result as any)?.kind)).map(([key,r])=>({key,...r}))};await writeFile(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({evidence:reportFile,global_budget:report.global_budget,improvements:report.improvements}));}
try{await withDemoScope(saved.scope,async()=>{
  if(step==='initial'||step==='initial-clean'){
    if(!saved.workflow_id){await transaction(s=>{const old=s.revisions.find(r=>r.revision_id===s.current_revision_id)!;const next=revision({...old,title:'Harbor Meridian privacy policy',clauses:[...old.clauses.map(c=>({...c,body:c.body.replaceAll('DemoCo','Harbor Meridian').replaceAll('privacy@democo.example','privacy@harbor-meridian.example').replaceAll('https://democo.example','https://harbor-meridian.example')})),{clause_id:'acceptance-unrelated',heading:'Contract continuity',body:'Existing signed customer contracts remain unchanged. Acceptance reference HM-726.'}]},old.revision_number+1,old.revision_id);s.revisions.push(next);s.current_revision_id=next.revision_id;s.company_name='Harbor Meridian (synthetic acceptance)';for(const f of s.facts){f.provenance='Synthetic unseen acceptance input';if(f.fact_key==='consumer_request_email')f.value='privacy@harbor-meridian.example';if(f.fact_key==='consumer_request_web_path'&&typeof f.value==='string')f.value=f.value.replaceAll('democo.example','harbor-meridian.example');}});
      const ack=await signup({customer_name:'Acceptance California event',residence:'US-CA',scenario:'covered',expected_reset_epoch:1},'provider-acceptance-event-1');saved.workflow_id=ack.workflow_id;await writeFile(file,JSON.stringify(saved),{mode:0o600});console.log(JSON.stringify({acknowledged_event:ack}));}
    await foreground(step==='initial');
  }else if(step==='retry'||step==='retry-clean'){await retryBlockedModel(saved.workflow_id!,1,'founder');await foreground(step==='retry');}
  else if(step==='resume')await foreground();
  else if(step==='evaluate'){for(let i=0;i<8;i++){await transaction(s=>{scanAutomaticTriggers(s);});const result=await processAutomaticImprovementStep();console.log(JSON.stringify(result));await record();if(!result.worked)break;}}
  else if(step==='founder-feedback'){
    const s=await readState(),w=s.workflows.find(w=>w.workflow_id===saved.workflow_id)!;
    const f=await feedback(w.workflow_id,'founder',{type:'fact_correction',text:'Synthetic founder correction: use the dedicated rights inbox from the acceptance company record.',fact_key:'consumer_request_email',proposed_value:'rights@harbor-meridian.example',expected_reset_epoch:s.reset_epoch},'acceptance-founder-correction');await verifyFact(f.feedback_id,'founder',s.reset_epoch);await foreground();
  }else if(step==='lawyer-correction'){
    const s=await readState(),w=s.workflows.find(w=>w.workflow_id===saved.workflow_id)!;
    await feedback(w.workflow_id,'lawyer',{type:'legal_interpretation_note',text:'Synthetic acceptance reviewer correction: this is an internal unapproved document proposal, not publication. Keep unverified request channels and implementation processes explicitly conditional as proposed methods awaiting operational confirmation; do not invite consumers to use them as currently active. Retain unresolved Notice at Collection and other operational duties for human followup according to their actual flags. Keep the policy metadata date consistent with the visible Policy updates clause, using the existing date unless both are explicitly revised. Preserve verified rights inbox facts and unrelated clauses.',expected_reset_epoch:s.reset_epoch},'acceptance-lawyer-correction-v3');await foreground();
  }else if(step==='lawyer-feedback'){
    let s=await readState(),w=s.workflows.find(w=>w.workflow_id===saved.workflow_id)!;
    await review(w.workflow_id,'founder',{action:'approved',expected_state_version:w.state_version,expected_reset_epoch:s.reset_epoch,bundle_hash:w.bundle_hash!,note:'Synthetic acceptance: founder approves this packet for lawyer review.'},'acceptance-founder-first');
    s=await readState();w=s.workflows.find(w=>w.workflow_id===saved.workflow_id)!;const stale={action:'approved' as const,expected_state_version:w.state_version,expected_reset_epoch:s.reset_epoch,bundle_hash:w.bundle_hash!,note:'Test stale approval must fail'};
    await feedback(w.workflow_id,'lawyer',{type:'legal_interpretation_note',text:'Clarify that this policy describes rights and required operational work; it must not claim every privacy intake mechanism is already implemented. Keep exact rights contact facts and unrelated clauses.',expected_reset_epoch:s.reset_epoch},'acceptance-lawyer-feedback');
    let rejected=false;try{await review(w.workflow_id,'lawyer',stale,'acceptance-stale-lawyer');}catch{rejected=true;}if(!rejected)throw new Error('Stale lawyer approval was accepted');console.log(JSON.stringify({stale_approval_rejected:true}));await foreground();
  }else if(step==='approve'){
    for(const role of ['founder','lawyer'] as const){const s=await readState(),w=s.workflows.find(w=>w.workflow_id===saved.workflow_id)!;await review(w.workflow_id,role,{action:'approved',expected_state_version:w.state_version,expected_reset_epoch:s.reset_epoch,bundle_hash:w.bundle_hash!,note:`Synthetic acceptance: ordered ${role} assertion only, not an actual professional approval.`},`acceptance-final-${role}`);}await dispatchNotification();
  }else if(step==='next'){
    const s=await readState();const ack=await signup({customer_name:'Independent California event',residence:'US-CA',scenario:'covered',expected_reset_epoch:s.reset_epoch},'provider-independent-event');saved.workflow_id=ack.workflow_id;await writeFile(file,JSON.stringify(saved),{mode:0o600});await foreground();
  }else throw new Error('Unknown acceptance step');
  await record();
});}catch(error:any){console.error(JSON.stringify({step,error_code:error.code||error.name,message:error instanceof Error?error.message:'Acceptance failed'}));await withDemoScope(saved.scope,record).catch(()=>{});process.exitCode=1;}finally{await closeStore();}
