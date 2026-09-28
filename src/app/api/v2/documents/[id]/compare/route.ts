import {authenticateV2} from '@/v2/auth';
import {snapshot} from '@/v2/service';
import {V2Error} from '@/v2/contracts';
import {compareDocumentText} from '@/v2/document-lifecycle';
import {response,failure} from '../../../http';
import {assertOidcBindingCurrent} from '@/v2/oidc-identities';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{
 const {session}=await authenticateV2(request),{id}=await context.params,baseId=new URL(request.url).searchParams.get('base'),current=await snapshot(session.actor),right=current.documents.find(d=>d.id===id),left=current.documents.find(d=>d.id===(baseId||right?.parentRevisionId));
 if(!left||!right)throw new V2Error('NOT_FOUND','Both compared revisions must be available in your current scope.',404);
 const comparison=compareDocumentText(left.body,right.body),latest=await snapshot(session.actor);
 if(![left,right].every(r=>latest.documents.some(d=>d.id===r.id&&d.contentHash===r.contentHash)))throw new V2Error('ACCESS_REVOKED','Document access changed during comparison.',403);
 await assertOidcBindingCurrent(session.actor);
 return response({before:{id:left.id,title:left.title,hash:left.contentHash,revision:left.revision},after:{id:right.id,title:right.title,hash:right.contentHash,revision:right.revision},...comparison,limitation:'Exact extracted-text comparison. Formatting, annotations, signatures and Word tracked-change semantics require inspection of the retained originals.'});
}catch(error){return failure(error);}}
