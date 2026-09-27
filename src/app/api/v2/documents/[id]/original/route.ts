import {authenticateV2} from '@/v2/auth';
import {snapshot} from '@/v2/service';
import {V2Error} from '@/v2/contracts';
import {readOriginal,type OriginalReference} from '@/v2/objects';
import {failure} from '../../../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{
 const {session}=await authenticateV2(request),{id}=await context.params,current=await snapshot(session.actor),document=current.documents.find(d=>d.id===id),source=document&&current.sources.find(s=>s.id===document.sourceId);
 if(!document||!source?.originalObjectRef)throw new V2Error('NOT_FOUND','No retained original is available in your current scope.',404);
 let reference:OriginalReference;try{reference=JSON.parse(source.originalObjectRef);}catch{throw new V2Error('ORIGINAL_INTEGRITY','The original manifest is invalid.',503);}
 const bytes=await readOriginal(session.actor.tenantId,reference),latest=await snapshot(session.actor);
 if(!latest.documents.some(d=>d.id===id&&d.contentHash===document.contentHash)||!latest.sources.some(s=>s.id===source.id&&s.version===source.version&&s.originalObjectRef===source.originalObjectRef))throw new V2Error('ACCESS_REVOKED','Source authority changed during the download.',403);
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="kiara-original.bin"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox'}});
}catch(error){return failure(error);}}
