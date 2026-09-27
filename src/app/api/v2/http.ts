import {V2Error} from '@/v2/contracts';
export const response=(value:unknown,status=200,cookie?:string)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
export function failure(error:unknown){
  if(error instanceof V2Error)return response({error:{code:error.code,message:error.message}},error.status);
  // Never serialize provider payloads, credentials, source text, or stack traces.
  return response({error:{code:'SERVICE_UNAVAILABLE',message:'This action could not complete. Your existing work is retained. Retry the same command or reconnect.'}},503);
}
export async function body(request:Request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new V2Error('CONTENT_TYPE','Use a JSON request.',415);
  const reader=request.body?.getReader();if(!reader)throw new V2Error('INVALID_BODY','A request body is required.',400);
  let bytes=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>100000){await reader.cancel();throw new V2Error('PAYLOAD_TOO_LARGE','This request exceeds 100 KB. Use a smaller document excerpt.',413);}chunks.push(value);}
  let parsed:unknown;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new V2Error('INVALID_JSON','Enter valid JSON.',400);}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new V2Error('INVALID_BODY','A JSON object is required.',400);
  return parsed as Record<string,unknown>;
}
