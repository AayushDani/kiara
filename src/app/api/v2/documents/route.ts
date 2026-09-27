import {authenticateV2,csrfV2} from '@/v2/auth';
import {command,snapshot} from '@/v2/service';
import {V2Error,type Source,type DocumentRecord,type WorkspaceCommand} from '@/v2/contracts';
import {parseDocument} from '@/v2/document-files';
import {retainIntakeOriginal} from '@/v2/artifact-intake';
import {response,failure} from '../http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 const {session}=await authenticateV2(request);csrfV2(request,session);
 const reader=request.body?.getReader();if(!reader)throw new V2Error('FILE_REQUIRED','Choose a document.',400);
 const chunks:Uint8Array[]=[];let count=0;while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>11_000_000){await reader.cancel();throw new V2Error('DOCUMENT_CAPACITY','Choose a document below 10 MB.',413);}chunks.push(value);}
 const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':request.headers.get('content-type')||''}}).formData();
 const file=form.get('file');if(!(file instanceof File))throw new V2Error('FILE_REQUIRED','Choose a document.',400);
 const expectedVersion=Number(form.get('expectedVersion')),idempotencyKey=String(form.get('idempotencyKey')||'');
 if(!Number.isSafeInteger(expectedVersion)||!idempotencyKey||idempotencyKey!==request.headers.get('idempotency-key'))throw new V2Error('INVALID_COMMAND','Provide the inspected workspace version and stable command identity.',400);
 const current=await snapshot(session.actor);if(!current.capabilities.includes('member'))throw new V2Error('FORBIDDEN','Document intake requires workspace membership.',403);
 const bytes=Buffer.from(await file.arrayBuffer()),parsed=await parseDocument(bytes,file.name),intake=await retainIntakeOriginal(session.actor,idempotencyKey,bytes,expectedVersion);
 const write:WorkspaceCommand=form.get('baseRevisionId')?{type:'document.reimport',baseRevisionId:String(form.get('baseRevisionId')),expectedContentHash:String(form.get('expectedContentHash')||''),body:parsed.text,note:String(form.get('note')||'')}:{type:'document.add',title:String(form.get('title')||file.name),body:parsed.text,authority:String(form.get('authority')||'unknown') as Source['authority'],kind:String(form.get('kind')||'other') as DocumentRecord['kind'],...(form.get('amendsDocumentId')?{amendsDocumentId:String(form.get('amendsDocumentId'))}:{})};
 const result=await command(session.actor,{idempotencyKey,expectedVersion:intake.expectedVersion,command:write},{originalObjectRef:JSON.stringify(intake.reference)});
 return response({...result,extractionWarnings:parsed.warnings},201);
}catch(error){return failure(error);}}
