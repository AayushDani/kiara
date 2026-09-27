import {authenticateV2,csrfV2} from '@/v2/auth';
import {V2Error,type CommandEnvelope} from '@/v2/contracts';
import {command} from '@/v2/service';
import {response,failure,body} from '../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  try{
    const {session}=await authenticateV2(request);csrfV2(request,session);
    const input=await body(request);
    if(Object.keys(input).some(k=>!['idempotencyKey','expectedVersion','command'].includes(k))||typeof input.idempotencyKey!=='string'||input.idempotencyKey!==request.headers.get('idempotency-key')||!Number.isSafeInteger(input.expectedVersion)||!input.command||typeof input.command!=='object'||Array.isArray(input.command))throw new V2Error('INVALID_COMMAND','A stable command key, inspected version and typed command are required.',400);
    return response(await command(session.actor,input as unknown as CommandEnvelope));
  }catch(error){return failure(error);}
}
