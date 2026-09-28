import {authenticateV2,csrfV2} from '@/v2/auth';
import {V2Error,type CommandEnvelope} from '@/v2/contracts';
import {command,snapshot} from '@/v2/service';
import {retainIntakeOriginal} from '@/v2/artifact-intake';
import {response,failure,body} from '../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  try{
    const {session}=await authenticateV2(request);csrfV2(request,session);
    const input=await body(request);
    if(Object.keys(input).some(k=>!['idempotencyKey','expectedVersion','command'].includes(k))||typeof input.idempotencyKey!=='string'||input.idempotencyKey!==request.headers.get('idempotency-key')||!Number.isSafeInteger(input.expectedVersion)||!input.command||typeof input.command!=='object'||Array.isArray(input.command))throw new V2Error('INVALID_COMMAND','A stable command key, inspected version and typed command are required.',400);
    const envelope=input as unknown as CommandEnvelope;let originalObjectRef:string|undefined;
    if(envelope.command.type==='document.add'||envelope.command.type==='document.reimport'){
      const current=await snapshot(session.actor);
      if(!current.capabilities.includes('member'))throw new V2Error('FORBIDDEN','Document intake requires workspace membership.',403);
      const baselineId=envelope.command.type==='document.reimport'?envelope.command.baseRevisionId:null;
      if(baselineId&&!current.documents.some(d=>d.id===baselineId))throw new V2Error('NOT_FOUND','The baseline document is unavailable.',404);
      if(typeof envelope.command.body!=='string'||!envelope.command.body.trim()||envelope.command.body.length>100000)throw new V2Error('INVALID_INPUT','Provide document text up to 100,000 characters.',400);
      const intake=await retainIntakeOriginal(session.actor,envelope.idempotencyKey,Buffer.from(envelope.command.body,'utf8'),envelope.expectedVersion);originalObjectRef=JSON.stringify(intake.reference);envelope.expectedVersion=intake.expectedVersion;
    }
    return response(await command(session.actor,envelope,originalObjectRef?{originalObjectRef}:undefined));
  }catch(error){return failure(error);}
}
