import {withDemoScope,type DemoScope} from '../server/demo-context';
import {sleep} from 'workflow';
import {processWorkerStep} from '../server/worker-step';

// Workflow state contains only a demo identifier, expiry, reset generation and a boolean. Application
// documents, receipts and review decisions remain in Atlas.
export async function processJobs(resetEpoch:number,scope?:DemoScope){
  'use workflow';
  while(await advance(resetEpoch,scope))await sleep('1s');
}
async function advance(resetEpoch:number,scope?:DemoScope){
  'use step';
  if(scope&&scope.expires_at<=Date.now())return false;
  return scope?withDemoScope(scope,()=>processWorkerStep(resetEpoch)):processWorkerStep(resetEpoch);
}
