import {readState,transaction} from '../data/store';
import {nextRunnable,tick} from '../workflow/engine';
import {dispatchNotification,recoverNotifications} from './notifications';
import {recoverEvaluationCampaigns} from '../adaptation/campaign';
import * as runtime from '../runtime';
import {scanAutomaticTriggers,processAutomaticImprovementStep,hasAutomaticWork} from '../adaptation';
import type {State} from './contracts';
import {claimWorkerStep,ownsWorker,releaseWorkerStep,workerDeployment,type WorkerTicket} from './worker-ownership';

/** Keep a durable watchdog alive while another step owns a model lease.
 * A retried/crashed step must reach lease expiry and recovery, not silently close its workflow. */
export function hasPendingWorkerWork(state:State){
  return !!(nextRunnable(state)||hasAutomaticWork(state)||state.notifications.some(n=>n.status==='pending')||state.workflows.some(w=>w.model_status==='running'));
}

export async function processWorkerStep(resetEpoch:number,ticket?:WorkerTicket){
  if(ticket&&ticket.deployment!==workerDeployment())return false;
  if(!ticket&&process.env.KIARA_WORKER_MODE==='vercel_workflow')return false;
  const claim=ticket?await transaction(s=>s.reset_epoch===resetEpoch?claimWorkerStep(s,ticket):{kind:'stale' as const}):undefined;
  if(claim?.kind==='stale')return false;
  if(claim?.kind==='busy')return true;
  let more=false;
  const current=async()=>{const state=await readState();return state.reset_epoch===resetEpoch&&(!ticket||ownsWorker(state,ticket));};
  try{
  if((await readState()).reset_epoch!==resetEpoch)return false;
  await runtime.recoverModelRuns();
  await recoverNotifications();
  await recoverEvaluationCampaigns();
  if(!await current())return false;
  const pending=await tick(resetEpoch);
  if(!await current())return false;
  if(pending){
    if('intent' in pending&&pending.intent==='validate')await runtime.validateRevisionModel(pending.workflow_id,pending.reset_epoch);
    else if('intent' in pending&&pending.intent==='repair')await runtime.repairModel(pending.workflow_id,pending.reset_epoch);
    else await runtime.runModel(pending.workflow_id,pending.reset_epoch);
  }
  // A deployment change may happen while a paid call runs. Settle it, then stop.
  if(!await current())return false;
  await dispatchNotification();
  if(!await current())return false;
  await transaction(s=>{if(s.reset_epoch===resetEpoch)scanAutomaticTriggers(s);});
  let state=await readState();
  if(!pending&&state.reset_epoch===resetEpoch&&!nextRunnable(state)&&hasAutomaticWork(state)){await processAutomaticImprovementStep();await transaction(s=>{if(s.reset_epoch===resetEpoch)scanAutomaticTriggers(s);});}
  state=await readState();
  more=state.reset_epoch===resetEpoch&&(!ticket||ownsWorker(state,ticket))&&hasPendingWorkerWork(state);
  return more;
  }finally{if(ticket&&claim?.kind==='claimed')await transaction(s=>{if(s.reset_epoch===resetEpoch)releaseWorkerStep(s,ticket,claim.step_id,more);});}
}
