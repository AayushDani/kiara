import {existsSync} from 'node:fs';
for(const file of ['.env.local','.env'])if(existsSync(file))process.loadEnvFile(file);
const {readState,closeStore}=await import('../src/data/store');
const {readiness}=await import('../src/server/readiness');
try{const state=await readState();console.log(JSON.stringify({node:process.version,requested_node:'24.19.0',runtime_match:process.version==='v24.19.0',...readiness(state),records:{facts:state.facts.length,revisions:state.revisions.length,workflows:state.workflows.length},note:'Configured credentials are not printed. Configuration presence does not prove provider access.'},null,2));}catch(e){console.error('Readiness failed:',e instanceof Error?e.message:'Unknown error');process.exitCode=1;}finally{await closeStore();}
