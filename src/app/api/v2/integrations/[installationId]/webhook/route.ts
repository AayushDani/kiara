import {acceptWebhook} from '@/v2/integrations/intake';
import {V2Error} from '@/v2/contracts';
import {response,failure} from '../../../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{installationId:string}>}){try{
 const {installationId}=await context.params,reader=request.body?.getReader();if(!reader)throw new V2Error('PAYLOAD_REQUIRED','An event payload is required.',400);
 const chunks:Uint8Array[]=[];let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1_000_000){await reader.cancel();throw new V2Error('PAYLOAD_TOO_LARGE','Event payload exceeds 1 MB.',413);}chunks.push(value);}
 return response(await acceptWebhook(installationId,request.headers,Buffer.concat(chunks)));
}catch(error){return failure(error);}}
