import assert from 'node:assert/strict';
import {readWorkspace} from '../../src/v2/store';
import {resumeSourceWithdrawal} from '../../src/v2/source-corrective';

/** Legacy scenario fixtures explicitly drive the durable local withdrawal stage. */
export async function completeQueuedWithdrawal(tenantId:string,sourceId:string){
 for(let turn=0;turn<100;turn++){
  const progress=(await readWorkspace(tenantId)).receipts[`source-withdrawal-progress:${sourceId}`]?.result;
  if(!progress||progress.status==='complete')return;
  const result=await resumeSourceWithdrawal(tenantId,sourceId);
  if(result.status==='complete')return;
 }
 assert.fail('Synthetic withdrawal did not complete within 100 bounded worker turns.');
}
