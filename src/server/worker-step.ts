import {readState,transaction} from '../data/store';
import {nextRunnable,tick} from '../workflow/engine';
import {dispatchNotification,recoverNotifications} from './notifications';
import {recoverEvaluationCampaigns} from '../adaptation/campaign';
import * as runtime from '../runtime';
import {scanAutomaticTriggers,processAutomaticImprovementStep,hasAutomaticWork} from '../adaptation';
import type {State} from './contracts';

/** Keep a durable watchdog alive while another step owns a model lease.
 * A retried/crashed step must reach lease expiry and recovery, not silently close its workflow. */
export function hasPendingWorkerWork(state:State){
  return !!(nextRunnable(state)||hasAutomaticWork(state)||state.notifications.some(n=>n.status==='pending')||state.workflows.some(w=>w.model_status==='running'));
}

export async function processWorkerStep(resetEpoch:number){
  if((await readState()).reset_epoch!==resetEpoch)return false;
  await runtime.recoverModelRuns();
  await recoverNotifications();
  await recoverEvaluationCampaigns();
  const pending=await tick(resetEpoch);
  if(pending){
    if('intent' in pending&&pending.intent==='validate')await runtime.validateRevisionModel(pending.workflow_id,pending.reset_epoch);
    else if('intent' in pending&&pending.intent==='repair')await runtime.repairModel(pending.workflow_id,pending.reset_epoch);
    else await runtime.runModel(pending.workflow_id,pending.reset_epoch);
  }
  await dispatchNotification();
  await transaction(s=>{if(s.reset_epoch===resetEpoch)scanAutomaticTriggers(s);});
  let state=await readState();
  if(!pending&&state.reset_epoch===resetEpoch&&!nextRunnable(state)&&hasAutomaticWork(state)){await processAutomaticImprovementStep();await transaction(s=>{if(s.reset_epoch===resetEpoch)scanAutomaticTriggers(s);});}
  state=await readState();
  return state.reset_epoch===resetEpoch&&hasPendingWorkerWork(state);
}
