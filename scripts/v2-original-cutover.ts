/** Operator-only synthetic original migration. Never exposed through a web route. */
import {applyOriginalCutover,previewOriginalCutover} from '../src/v2/original-cutover';
import {closeMongoOriginalStore} from '../src/v2/mongo-originals';
import {closeV2Store} from '../src/v2/store';
import {V2Error} from '../src/v2/contracts';

const [operation,tenantId,previewHash]=process.argv.slice(2);
if(!['preview','apply'].includes(operation)||!tenantId||operation==='apply'&&!previewHash||operation==='preview'&&previewHash){
 console.error('Usage: node --import tsx scripts/v2-original-cutover.ts preview <synthetic-tenant> | apply <synthetic-tenant> <reviewed-preview-hash>');process.exitCode=2;
}else{
 try{const result=operation==='preview'?await previewOriginalCutover(tenantId):await applyOriginalCutover(tenantId,previewHash!);console.log(JSON.stringify(result,null,2));}
 catch(error){console.error(JSON.stringify({code:error instanceof V2Error?error.code:'ORIGINAL_CUTOVER_FAILED',message:error instanceof V2Error?error.message:'Cutover failed; inspect operator logs without printing credentials.'}));process.exitCode=1;}
 finally{await closeMongoOriginalStore();await closeV2Store();}
}
