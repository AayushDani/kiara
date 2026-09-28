import {authenticateV2,csrfV2,localSession,clearV2Session,sameV2Origin} from '@/v2/auth';
import {V2Error} from '@/v2/contracts';
import {response,failure,body} from '../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
  sameV2Origin(request);const input=await body(request);
  if(Object.keys(input).length!==1)throw new V2Error('INVALID_BODY','Choose one sign-in method.',400);
  if(typeof input.token==='string')throw new V2Error('OIDC_BROWSER_FLOW_REQUIRED','Use organization sign-in with the browser authorization-code flow.',403);
  const {session}=await authenticateV2(request);csrfV2(request,session);
  if(input.logout===true)return response({signedOut:true},200,clearV2Session());
  if(typeof input.role!=='string')throw new V2Error('INVALID_ROLE','Choose a local demonstration role.',400);
  const issued=await localSession(request,input.role);return response({signedIn:true,csrf:issued.session.csrf,profile:issued.session.profile},200,issued.cookie);
}catch(error){return failure(error);}}
