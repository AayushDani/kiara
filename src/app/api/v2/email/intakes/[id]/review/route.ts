import {authenticateV2,csrfV2} from '@/v2/auth';
import {V2Error} from '@/v2/contracts';
import {emailIntakeView,reviewEmailIntake} from '@/v2/integrations/email';
import {snapshot} from '@/v2/service';
import {body,failure,response} from '@/app/api/v2/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){try{const {session}=await authenticateV2(request),{id}=await context.params;return response({intake:await emailIntakeView(session.actor,id)});}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{
 const {session}=await authenticateV2(request);csrfV2(request,session);const {id}=await context.params,input=await body(request);
 if(!Object.keys(input).every(k=>['expectedSourceVersion','expectedSourceHash','expectedReceiptHash','decision'].includes(k))||!Number.isSafeInteger(input.expectedSourceVersion)||Number(input.expectedSourceVersion)<1||typeof input.expectedSourceHash!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedSourceHash)||typeof input.expectedReceiptHash!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedReceiptHash)||!['accept','reject'].includes(String(input.decision)))throw new V2Error('EMAIL_REVIEW_INVALID','Review the exact received source before choosing accept or reject.',400);
 const intake=await reviewEmailIntake(session.actor,id,{expectedSourceVersion:Number(input.expectedSourceVersion),expectedSourceHash:input.expectedSourceHash,expectedReceiptHash:input.expectedReceiptHash,decision:input.decision as 'accept'|'reject'});
 return response({intake,snapshot:await snapshot(session.actor)});
}catch(error){return failure(error);}}
