import {authenticateV2,csrfV2} from '@/v2/auth';
import {V2Error} from '@/v2/contracts';
import {dispatchAction,executionPreview,reconcileAction} from '@/v2/execution/broker';
import {snapshot} from '@/v2/service';
import {body,failure,response} from '../../../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){try{const {session}=await authenticateV2(request),{id}=await context.params;return response({preview:await executionPreview(session.actor,id)});}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{
 const {session}=await authenticateV2(request);csrfV2(request,session);const {id}=await context.params,input=await body(request);
 if(!Object.keys(input).every(k=>['operation','expectedVersion','contentHash','previewHash','providerReceipt'].includes(k))||!Number.isSafeInteger(input.expectedVersion)||typeof input.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(input.contentHash)||!['dispatch','reconcile'].includes(String(input.operation)))throw new V2Error('INVALID_EXECUTION','Review the current exact execution preview.',400);
 if(input.providerReceipt!==undefined&&(typeof input.providerReceipt!=='string'||input.providerReceipt.length>200))throw new V2Error('INVALID_RECEIPT','Provide a bounded provider receipt for read-back.',400);
 if(input.operation==='dispatch'&&(typeof input.previewHash!=='string'||!/^[a-f0-9]{64}$/.test(input.previewHash)||input.providerReceipt!==undefined))throw new V2Error('EXECUTION_PREVIEW_REQUIRED','Confirm the current sender, mode, recipients and exact content.',400);
 const expected={expectedVersion:input.expectedVersion as number,contentHash:input.contentHash};
 const effect=input.operation==='dispatch'?await dispatchAction(session.actor,id,{...expected,previewHash:input.previewHash as string}):await reconcileAction(session.actor,id,{...expected,providerReceipt:input.providerReceipt as string|undefined});
 return response({effect,snapshot:await snapshot(session.actor)});
 }catch(error){return failure(error);}}
