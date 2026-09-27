import {authenticateV2,csrfV2,sameV2Origin} from '@/v2/auth';
import {V2Error} from '@/v2/contracts';
import {previewGovInfoGranule,stageGovInfoGranule} from '@/v2/legal-reference-govinfo';
import {body,failure,response} from '../../http';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

/** A signed-in legal reviewer inspects exact public authority text before intake. */
export async function POST(request:Request){try{
 sameV2Origin(request);const {session}=await authenticateV2(request);csrfV2(request,session);if(session.actor.mode!=='authenticated')throw new V2Error('AUTHENTICATED_REVIEWER_REQUIRED','Sign in with a provisioned legal-reviewer identity before selecting a live source.',403);const input=await body(request);
 if(!Object.keys(input).every(key=>['operation','packageId','granuleId','domain','expectedPreviewHash'].includes(key))||!['preview','stage'].includes(String(input.operation))||typeof input.packageId!=='string'||typeof input.granuleId!=='string'||typeof input.domain!=='string')throw new V2Error('GOVINFO_SELECTION_INVALID','Select an exact GovInfo granule and review operation.',400);
 if(input.operation==='preview'&&input.expectedPreviewHash!==undefined||input.operation==='stage'&&(typeof input.expectedPreviewHash!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedPreviewHash)))throw new V2Error('GOVINFO_PREVIEW_REQUIRED','Inspect the exact source before staging.',400);
 const selection={packageId:input.packageId,granuleId:input.granuleId,domain:input.domain};
 if(input.operation==='preview')return response({preview:await previewGovInfoGranule(session.actor,selection)});
 return response({staged:await stageGovInfoGranule(session.actor,selection,{expectedPreviewHash:input.expectedPreviewHash as string})},201);
}catch(error){return failure(error);}}
