import {authenticateV2,csrfV2} from '@/v2/auth';
import {V2Error} from '@/v2/contracts';
import {reconcileNotificationDelivery} from '@/v2/notifications';
import {snapshot} from '@/v2/service';
import {body,failure,response} from '@/app/api/v2/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
 const {session}=await authenticateV2(request);csrfV2(request,session);const {id}=await context.params,input=await body(request);
 if(!Object.keys(input).every(k=>['expectedVersion','providerReceipt'].includes(k))||!Number.isSafeInteger(input.expectedVersion)||Number(input.expectedVersion)<1||typeof input.providerReceipt!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(input.providerReceipt))throw new V2Error('INVALID_RECEIPT','Inspect the current delivery and exact provider receipt.',400);
 await reconcileNotificationDelivery(session.actor.tenantId,id,input.providerReceipt,{actor:session.actor,expectedVersion:Number(input.expectedVersion)});
 return response({snapshot:await snapshot(session.actor)});
}catch(error){return failure(error);}}
