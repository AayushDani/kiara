import {demoScope} from './demo-context';
import {transaction} from '../data/store';
import {scanAutomaticTriggers} from '../adaptation';
import {hasPendingWorkerWork} from './worker-step';
import {recordWorkerStart,reserveWorker} from './worker-ownership';

export async function scheduleWorker(){
  if(process.env.KIARA_WORKER_MODE!=='vercel_workflow')return;
  const launch=await transaction(s=>{scanAutomaticTriggers(s);if(!hasPendingWorkerWork(s))return;const ticket=reserveWorker(s);return ticket?{epoch:s.reset_epoch,ticket}:undefined;});
  if(!launch)return;
  try{
    const {start}=await import('workflow/api');
    const {processJobs}=await import('../workflows/process-jobs');
    // Runs are bound to the invoking deployment. The durable ticket fences older runs.
    const run=await start(processJobs,[launch.epoch,demoScope(),launch.ticket]);
    await transaction(s=>{if(s.reset_epoch===launch.epoch)recordWorkerStart(s,launch.ticket,run.runId);});
  }catch(error){
    await transaction(s=>{if(s.reset_epoch===launch.epoch)recordWorkerStart(s,launch.ticket,undefined);});
    throw error;
  }
}
