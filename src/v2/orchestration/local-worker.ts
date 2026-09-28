import {fileURLToPath} from 'node:url';
import {processLocalOutboxOnce} from './conversations';
export async function runLocalWorker(tenantIds:string[],signal:AbortSignal){
 if(!tenantIds.length)throw new Error('Configure explicit KIARA_V2_WORKER_TENANTS.');if(process.env.KIARA_V2_ORCHESTRATION_MODE==='temporal')throw new Error('Local worker cannot own Temporal work.');const deferred=new Map<string,number>();
 while(!signal.aborted){for(const tenant of tenantIds){if(signal.aborted)break;try{await processLocalOutboxOnce(tenant,{deferred});}catch{console.error('Kiara local processing pending; durable records retained for retry.');}}await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,2000);signal.addEventListener('abort',finish,{once:true});if(signal.aborted)finish();});}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());runLocalWorker((process.env.KIARA_V2_WORKER_TENANTS||'').split(',').map(t=>t.trim()).filter(Boolean),abort.signal).catch(()=>{console.error('Kiara local worker unavailable; verify configuration.');process.exitCode=1;});}
