import {existsSync} from 'node:fs';
for(const file of ['.env.local','.env'])if(existsSync(file))process.loadEnvFile(file);
import {seedStore,closeStore} from '../src/data/store';
try { const result=await seedStore(); console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1; }
catch { console.error('Seed failed. Check configuration and database permissions; no provider credentials are printed.');process.exitCode=1; }
finally {await closeStore();}
