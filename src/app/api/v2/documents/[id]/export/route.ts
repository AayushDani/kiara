import {authenticateV2} from '@/v2/auth';
import {snapshot} from '@/v2/service';
import {V2Error} from '@/v2/contracts';
import {exportReviewDocx} from '@/v2/document-files';
import {failure} from '../../../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{
 const {session}=await authenticateV2(request),{id}=await context.params,current=await snapshot(session.actor);
 const document=current.documents.find(d=>d.id===id),proposal=current.proposals.find(p=>p.id===id);
 if(!document&&!proposal)throw new V2Error('NOT_FOUND','This document is unavailable in your current scope.',404);
 const record=(document||proposal)!,approvals=proposal?current.approvals.filter(a=>a.proposalId===proposal.id):[];
 const bytes=await exportReviewDocx({title:record.title,body:record.body,manifest:[`Record: ${record.id} · version ${record.version}`,`Content hash: ${record.contentHash}`,`Authority: ${document?.authority||'unapproved proposal; decisions below are individually scoped'}`,`Exported by: ${session.actor.actorId}`,`Exported: ${new Date().toISOString()}`,...approvals.map(a=>`${a.capacity}: ${a.status} · actor ${a.actorId} · hash ${a.proposalHash} · expires ${a.validUntil}`),'Export does not publish, share, sign, execute or grant legal clearance. Re-import as a new reviewed version.']});
 const latest=await snapshot(session.actor);if(!latest.documents.some(d=>d.id===id)&&!latest.proposals.some(p=>p.id===id))throw new V2Error('ACCESS_REVOKED','Access changed while generating the export.',403);
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':'attachment; filename="kiara-review.docx"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}catch(error){return failure(error);}}
