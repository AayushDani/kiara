import type {State,Json} from './contracts';
import {hash,id} from './hash';

export interface WorkerTicket {token:string;generation:number;deployment:string}
export interface WorkerOwner extends WorkerTicket {status:'starting'|'active'|'idle'|'failed';run_id?:string;updated_at:number;step?:{token:string;id:string;expires_at:number};previous_run_ids:string[]}
const START_TIMEOUT=120_000,STALE_TIMEOUT=360_000,STEP_LEASE=300_000;
export function workerDeployment(){return process.env.VERCEL_DEPLOYMENT_ID||process.env.VERCEL_GIT_COMMIT_SHA||process.env.KIARA_BUILD_ID||'local';}
export function workerOwner(s:State){return s.receipts[`${s.reset_epoch}:hosted_worker`]?.result as unknown as WorkerOwner|undefined;}
function save(s:State,o:WorkerOwner){s.receipts[`${s.reset_epoch}:hosted_worker`]={hash:hash(o),result:o as unknown as Json};}
export function reserveWorker(s:State,deployment=workerDeployment(),at=Date.now()):WorkerTicket|undefined{
  const old=workerOwner(s);
  if(old?.deployment===deployment&&((old.status==='starting'&&at-old.updated_at<START_TIMEOUT)||(old.status==='active'&&at-old.updated_at<STALE_TIMEOUT)))return;
  const ticket={token:id(),generation:(old?.generation||0)+1,deployment};
  save(s,{...ticket,status:'starting',updated_at:at,step:old?.step,previous_run_ids:[...(old?.previous_run_ids||[]),...(old?.run_id?[old.run_id]:[])].slice(-20)});
  return ticket;
}
export function ownsWorker(s:State,ticket:WorkerTicket){const owner=workerOwner(s);return !!owner&&owner.token===ticket.token&&owner.generation===ticket.generation&&owner.deployment===ticket.deployment;}
export function recordWorkerStart(s:State,ticket:WorkerTicket,runId:string|undefined,at=Date.now()){
  if(!ownsWorker(s,ticket))return false;
  const owner=workerOwner(s)!;save(s,{...owner,status:runId?'active':'failed',run_id:runId,updated_at:at});return true;
}
export function claimWorkerStep(s:State,ticket:WorkerTicket,at=Date.now()):{kind:'stale'|'busy'}|{kind:'claimed';step_id:string}{
  if(!ownsWorker(s,ticket))return {kind:'stale'};
  const owner=workerOwner(s)!;
  if(owner.step&&owner.step.expires_at>at)return {kind:'busy'};
  const step_id=id();save(s,{...owner,status:'active',updated_at:at,step:{token:ticket.token,id:step_id,expires_at:at+STEP_LEASE}});return {kind:'claimed',step_id};
}
export function releaseWorkerStep(s:State,ticket:WorkerTicket,stepId:string,pending:boolean,at=Date.now()){
  const owner=workerOwner(s);if(!owner||owner.step?.id!==stepId||owner.step.token!==ticket.token)return;
  const current=ownsWorker(s,ticket);save(s,{...owner,step:undefined,...(current?{status:pending?'active' as const:'idle' as const,updated_at:at}:{})});
}
