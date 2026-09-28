import {completeOidcSignIn,clearOidcFlow} from '@/v2/auth';
import {failure} from '../../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const result=await completeOidcSignIn(request);const response=new Response(null,{status:303,headers:{Location:result.location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});response.headers.append('Set-Cookie',result.cookie);response.headers.append('Set-Cookie',clearOidcFlow());return response;}catch(error){const response=failure(error);response.headers.append('Set-Cookie',clearOidcFlow());response.headers.set('Referrer-Policy','no-referrer');return response;}}
