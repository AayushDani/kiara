import {AppError, type State} from './contracts';
import {hash} from './hash';

export const sourceHealthKey = (epoch:number) => `${epoch}:source_recheck_health`;
/** A failed or unfinished source check remains authoritative across workflow creation. */
export function sourceRecheckBlock(state:State):string|null {
  const receipt=state.receipts[sourceHealthKey(state.reset_epoch)];
  if(!receipt)return null;
  const health=receipt.result as {status?:string;failure?:string};
  if(receipt.hash!==hash(health))throw new AppError('SOURCE_HEALTH_INTEGRITY','Source review health failed its integrity check.');
  return health.status==='verified'?null:health.failure||'SOURCE_RECHECK_PENDING';
}
