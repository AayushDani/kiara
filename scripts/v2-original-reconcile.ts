/** Operator-only cleanup of a holder-free synthetic cutover target. */
import {readFile} from 'node:fs/promises';
import {applyOriginalAliasTargetReconciliation,previewOriginalAliasTargetReconciliation} from '../src/v2/original-cutover';
import {closeMongoOriginalStore} from '../src/v2/mongo-originals';
import {closeV2Store} from '../src/v2/store';
import {V2Error} from '../src/v2/contracts';
import type {OriginalReference} from '../src/v2/objects';

const [operation,tenantId,referenceFile,previewHash]=process.argv.slice(2);
if(!['preview','apply'].includes(operation)||!tenantId||!referenceFile||operation==='apply'&&!previewHash||operation==='preview'&&previewHash){
 console.error('Usage: node --import tsx scripts/v2-original-reconcile.ts preview <synthetic-tenant> <reference.json> | apply <synthetic-tenant> <reference.json> <reviewed-preview-hash>');process.exitCode=2;
}else{
 try{
  const reference=JSON.parse(await readFile(referenceFile,'utf8')) as OriginalReference;
  const result=operation==='preview'?await previewOriginalAliasTargetReconciliation(tenantId,reference):await applyOriginalAliasTargetReconciliation(tenantId,reference,previewHash!);
  console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(JSON.stringify({code:error instanceof V2Error?error.code:'ORIGINAL_RECONCILIATION_FAILED',message:error instanceof V2Error?error.message:'Reconciliation failed; inspect operator logs without printing credentials.'}));process.exitCode=1;}
 finally{await closeMongoOriginalStore();await closeV2Store();}
}
