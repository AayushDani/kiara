import {authenticateV2} from '@/v2/auth';
import {snapshot} from '@/v2/service';
import {response,failure} from '../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {session,cookie}=await authenticateV2(request,true);return response({snapshot:await snapshot(session.actor),csrf:session.csrf,profile:session.profile},200,cookie);}catch(error){return failure(error);}}
