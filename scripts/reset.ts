import {existsSync} from 'node:fs';
for(const file of ['.env.local','.env'])if(existsSync(file))process.loadEnvFile(file);
import {readState,resetStore,verifyStore,assertResetSafe,closeStore} from '../src/data/store';
const args=process.argv.slice(2),dry=args.includes('--dry-run');
const position=args.indexOf('--expected-reset-epoch');
try {
 const state=await readState();
 if(dry){assertResetSafe(state);console.log(JSON.stringify({dry_run:true,tenant_id:state.tenant_id,reset_epoch:state.reset_epoch,next_epoch:state.reset_epoch+1,workflows:state.workflows.length,notifications:state.notifications.length},null,2));}
 else {const epoch=Number(position>=0?args[position+1]:NaN);if(!Number.isSafeInteger(epoch)||epoch<1||!args.includes('--synthetic-only'))throw new Error('Usage: node --import tsx scripts/reset.ts --expected-reset-epoch N --synthetic-only');await resetStore(epoch);console.log(JSON.stringify(await verifyStore(),null,2));}
} catch(e) {console.error(e instanceof Error&&e.message.startsWith('Usage:')?e.message:'Reset blocked or failed. Check expected epoch and reconcile in-flight model or live email records.');process.exitCode=1;}
finally {await closeStore();}
