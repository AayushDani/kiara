import {demoScope} from './demo-context';
import {readState,transaction} from '../data/store';
import {scanAutomaticTriggers} from '../adaptation';
import {hasPendingWorkerWork} from './worker-step';

export async function scheduleWorker(){
  if(process.env.KIARA_WORKER_MODE!=='vercel_workflow')return;
  await transaction(s=>{scanAutomaticTriggers(s);});
  const {start}=await import('workflow/api');
  const {processJobs}=await import('../workflows/process-jobs');
  const state=await readState();
  if(!hasPendingWorkerWork(state))return;
  await start(processJobs,[state.reset_epoch,demoScope()]);
}
