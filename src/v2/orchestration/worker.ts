import {fileURLToPath} from 'node:url';
import {NativeConnection,Worker} from '@temporalio/worker';
import {ApplicationFailure} from '@temporalio/common';
import {V2Error} from '../contracts';
import type {OutboxReference} from './contracts';
import {reconcileReference} from './activities';
import {processConversationReference} from './conversations';
import {processEffectReference} from './effects';
import {processRetentionReference} from './retention';
import {processArtifactReference} from './artifacts';
import {processIndexReference} from './indexing';
import {processSlackReference} from './slack';
import {processLegalReference} from './legal';
import {connectTemporal,dispatchOutbox,temporalConfig} from './temporal';
async function safeActivity<T>(run:()=>Promise<T>):Promise<T>{try{return await run();}catch(error){const code=error instanceof V2Error?error.code:'ACTIVITY_UNAVAILABLE';throw ApplicationFailure.create({message:'The referenced operation is unavailable; authoritative state remains retained.',type:code,nonRetryable:['INVALID_WORKFLOW_REFERENCE','OUTBOX_NOT_FOUND','RUN_IDENTITY_MISMATCH','RETENTION_IDENTITY_MISMATCH','INDEX_IDENTITY_MISMATCH','SLACK_REPLY_IDENTITY_MISMATCH'].includes(code)});}}
/** Run separately from HTTP. Operator explicitly selects tenants; no aggregate enumeration bypass. */
export async function runManagedWorker(tenantIds:string[],signal?:AbortSignal){
 if(process.env.KIARA_V2_ORCHESTRATION_MODE!=='temporal')throw new Error('Set KIARA_V2_ORCHESTRATION_MODE=temporal for managed ownership.');if(!tenantIds.length)throw new Error('Configure explicit KIARA_V2_WORKER_TENANTS before starting the worker.');const config=temporalConfig();const connection=await NativeConnection.connect({address:config.address,tls:true,apiKey:config.apiKey});let client:Awaited<ReturnType<typeof connectTemporal>>|undefined;
 try{client=await connectTemporal();const worker=await Worker.create({connection,namespace:config.namespace,taskQueue:config.taskQueue,workflowsPath:fileURLToPath(new URL('./workflows.ts',import.meta.url)),activities:{reconcileReference:(ref:OutboxReference)=>safeActivity(()=>reconcileReference(ref)),processConversationReference:(ref:OutboxReference)=>safeActivity(()=>processConversationReference(ref)),processEffectReference:(ref:OutboxReference)=>safeActivity(()=>processEffectReference(ref)),processRetentionReference:(ref:OutboxReference)=>safeActivity(()=>processRetentionReference(ref)),processArtifactReference:(ref:OutboxReference)=>safeActivity(()=>processArtifactReference(ref)),processIndexReference:(ref:OutboxReference)=>safeActivity(()=>processIndexReference(ref)),processSlackReference:(ref:OutboxReference)=>safeActivity(()=>processSlackReference(ref)),processLegalReference:(ref:OutboxReference)=>safeActivity(()=>processLegalReference(ref))},maxConcurrentActivityTaskExecutions:10});let stopping=false;const stop=()=>{stopping=true;worker.shutdown();};signal?.addEventListener('abort',stop,{once:true});
  const pump=(async()=>{while(!stopping){for(const tenant of tenantIds){if(stopping)break;try{await dispatchOutbox(tenant,client!.dispatcher);}catch{console.error('Kiara outbox dispatch pending; retrying with durable identity.');}}await new Promise(resolve=>setTimeout(resolve,2000));}})();
  try{if(signal?.aborted)stop();await worker.run();}finally{stopping=true;await pump;signal?.removeEventListener('abort',stop);}
 }finally{await client?.close();await connection.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());const tenants=(process.env.KIARA_V2_WORKER_TENANTS||'').split(',').map(t=>t.trim()).filter(Boolean);runManagedWorker(tenants,abort.signal).catch(()=>{console.error('Kiara managed worker unavailable; verify configuration and connectivity.');process.exitCode=1;});}
