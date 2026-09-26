import {transaction} from '../data/store';
import {hash} from '../server/hash';
import type {Json} from '../server/contracts';

/** Legacy subprocess campaigns are retired: isolated local budgets could bypass the shared authorization.
 * The automatic worker evaluates one frozen trial per durable step with the shared spend reservation.
 * Retain old receipts for audit and quarantine any interrupted legacy campaign; never replay it.
 */
export async function recoverEvaluationCampaigns():Promise<number>{
  return transaction(s=>{
    let count=0;
    for(const receipt of Object.values(s.receipts)){
      const r=receipt.result as {kind?:string;status?:string;unknown_charge?:boolean;error?:string}|null;
      if(r?.kind!=='evaluation_campaign'||r.status!=='running')continue;
      r.status='inconclusive';r.unknown_charge=true;r.error='LEGACY_CAMPAIGN_RETIRED_RECONCILIATION_REQUIRED';receipt.hash=hash(r);receipt.result=r as Json;count++;
    }
    return count;
  });
}
