import {demoScope} from './demo-context';
import {nextRunnable} from '../workflow/engine';
import {readState} from '../data/store';

export async function scheduleWorker(){
  if(process.env.KIARA_WORKER_MODE!=='vercel_workflow')return;
  const {start}=await import('workflow/api');
  const {processJobs}=await import('../workflows/process-jobs');
  const state=await readState();
  if(!nextRunnable(state)&&!state.notifications.some(n=>n.status==='pending'))return;
  await start(processJobs,[state.reset_epoch,demoScope()]);
}
