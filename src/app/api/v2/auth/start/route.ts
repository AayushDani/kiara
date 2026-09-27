import {startOidcSignIn} from '@/v2/auth';
import {failure} from '../../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const result=await startOidcSignIn(request);return new Response(null,{status:303,headers:{Location:result.location,'Set-Cookie':result.cookie,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}catch(error){return failure(error);}}
