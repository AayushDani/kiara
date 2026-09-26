import {existsSync} from 'node:fs';
for(const file of ['.env.local','.env'])if(existsSync(file))process.loadEnvFile(file);
const {processWorkerStep}=await import('../server/worker-step');
const {readState}=await import('../data/store');
let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
console.log('Kiara durable worker started. Provider modes follow local configuration.');
while(!stopped){try{await processWorkerStep((await readState()).reset_epoch);}catch(e){console.error('Worker step failed:',e instanceof Error?e.message:'Unknown error');}await new Promise(resolve=>setTimeout(resolve,700));}
const {closeStore}=await import('../data/store');await closeStore();
