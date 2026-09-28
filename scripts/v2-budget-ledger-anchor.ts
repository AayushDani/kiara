/** Read-only anchor for the existing shared Mongo spend ledger. */
import {previewSpendLedgerAnchor} from '../src/server/global-spend';
import {closeStore} from '../src/data/store';

try{
  if(process.argv.length!==2)throw new Error('Run without arguments after selecting the exact Mongo cluster and KIARA_BUDGET_DB.');
  const preview=await previewSpendLedgerAnchor();
  process.stdout.write(`${JSON.stringify({...preview,readOnly:true},null,2)}\n`);
}catch{
  process.stderr.write('The selected shared Mongo spend ledger could not be anchored.\n');
  process.exitCode=1;
}finally{await closeStore();}
