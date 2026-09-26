import {existsSync} from 'node:fs';
for(const file of ['.env.local','.env'])if(existsSync(file))process.loadEnvFile(file);
import {verifyStore,closeStore} from '../src/data/store';
try {const report=await verifyStore();console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
catch {console.error('Seed verification failed; no provider credentials are printed.');process.exitCode=1;}
finally {await closeStore();}
