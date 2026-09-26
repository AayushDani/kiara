import {readState} from '../data/store';
import {nextRunnable,tick} from '../workflow/engine';
import {dispatchNotification,recoverNotifications} from './notifications';
import {recoverEvaluationCampaigns} from '../adaptation/campaign';
import * as runtime from '../runtime';

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
  const state=await readState();
  return state.reset_epoch===resetEpoch&&!!(nextRunnable(state)||state.notifications.some(n=>n.status==='pending'));
}
