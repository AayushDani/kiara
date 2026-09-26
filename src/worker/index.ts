import {existsSync} from 'node:fs';
for(const file of ['.env.local','.env'])if(existsSync(file))process.loadEnvFile(file);
const {tick}=await import('../workflow/engine');
const {recoverEvaluationCampaigns}=await import('../adaptation/campaign');
const {dispatchNotification,recoverNotifications}=await import('../server/notifications');
let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
console.log('Kiara durable worker started. Provider modes follow local configuration.');
while(!stopped){try{const runtime=await import('../runtime/index');await runtime.recoverModelRuns();await recoverNotifications();await recoverEvaluationCampaigns();const pending=await tick();if(pending){if('intent' in pending&&pending.intent==='validate')await runtime.validateRevisionModel(pending.workflow_id,pending.reset_epoch);else if('intent' in pending&&pending.intent==='repair')await runtime.repairModel(pending.workflow_id,pending.reset_epoch);else await runtime.runModel(pending.workflow_id,pending.reset_epoch);}await dispatchNotification();}catch(e){console.error('Worker step failed:',e instanceof Error?e.message:'Unknown error');}await new Promise(resolve=>setTimeout(resolve,700));}
const {closeStore}=await import('../data/store');await closeStore();
