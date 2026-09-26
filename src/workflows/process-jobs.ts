import {withDemoScope,type DemoScope} from '../server/demo-context';
import {sleep} from 'workflow';
import {processWorkerStep} from '../server/worker-step';
import type {WorkerTicket} from '../server/worker-ownership';

// Only routing identifiers and an ownership ticket enter Workflow storage; documents stay in Atlas.
export async function processJobs(resetEpoch:number,scope?:DemoScope,ticket?:WorkerTicket){
  'use workflow';
  while(await advance(resetEpoch,scope,ticket))await sleep('1s');
}
async function advance(resetEpoch:number,scope?:DemoScope,ticket?:WorkerTicket){
  'use step';
  if(scope&&scope.expires_at<=Date.now())return false;
  // Legacy runs on this deployment cannot claim new work without a persisted ticket.
  if(!ticket)return false;
  return scope?withDemoScope(scope,()=>processWorkerStep(resetEpoch,ticket)):processWorkerStep(resetEpoch,ticket);
}
