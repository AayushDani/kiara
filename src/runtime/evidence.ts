import {AppError,type Provision} from '../server/contracts';
import {hash} from '../server/hash';

export const CITATION_QUOTE_LIMIT=400;
export interface EvidenceSelection {provision:Provision;start_utf16:number;length:number}
interface Chunk {start_utf16:number;end_utf16:number;quote_text:string;citation_id?:string}
export interface RetrievedCitation {citation_id:string;provision_key:string;source_version_id:string;start_utf16:number;end_utf16:number}
export function citationIdentity(p:Provision,start_utf16:number,end_utf16:number){return 'cite_'+hash({provision_key:p.provision_key,source_version_id:p.source_version_id,content_hash:p.content_hash,start_utf16,end_utf16,quote:p.text.slice(start_utf16,end_utf16)}).slice(0,24);}
export function resolveCitationReference(reference:unknown,retrieved:RetrievedCitation[],evidence:Provision[]){
  if(!reference||typeof reference!=='object'||Object.keys(reference).join()!=='citation_id'||typeof (reference as any).citation_id!=='string')throw new AppError('CITATION_REFERENCE_REQUIRED','Select a citation_id returned by a scoped evidence tool.');
  const admitted=retrieved.find(c=>c.citation_id===(reference as any).citation_id);
  if(!admitted)throw new AppError('CITATION_REFERENCE_NOT_RETRIEVED','This citation_id was not returned by a scoped evidence tool in this run. Copy a returned ID exactly.');
  const p=evidence.find(p=>p.provision_key===admitted.provision_key&&p.source_version_id===admitted.source_version_id);
  if(!p||citationIdentity(p,admitted.start_utf16,admitted.end_utf16)!==admitted.citation_id)throw new AppError('CITATION_SPAN_MISMATCH','The selected citation no longer matches its pinned source.');
  return {provision_key:p.provision_key,source_version_id:p.source_version_id,start_utf16:admitted.start_utf16,end_utf16:admitted.end_utf16,quote_text:p.text.slice(admitted.start_utf16,admitted.end_utf16)};
}

/** Contiguous literal chunks; offsets are computed from pinned bytes, never model guesses. */
export function citationChunks(text:string,start:number,end:number):Chunk[]{
  const chunks:Chunk[]=[];
  while(start<end){
    let next=Math.min(start+CITATION_QUOTE_LIMIT,end);
    if(next<end){
      const prefix=text.slice(start,next),boundary=Math.max(prefix.lastIndexOf('\n')+1,prefix.lastIndexOf('. ')+2,prefix.lastIndexOf('; ')+2);
      if(boundary>=100)next=start+boundary;
      if(next>start&&/[\uD800-\uDBFF]/.test(text[next-1])&&/[\uDC00-\uDFFF]/.test(text[next]))next--;
    }
    chunks.push({start_utf16:start,end_utf16:next,quote_text:text.slice(start,next)});start=next;
  }
  return chunks;
}

/** Explicit bounded prefixes retain only returned-span authority and expose exact continuation. */
export function evidencePacket(selections:EvidenceSelection[],capacity=12000){
  const sources=[...new Map(selections.map(({provision:p})=>[p.source_version_id,{source_version_id:p.source_version_id,source_hash:p.source_hash}])).values()];
  const pending=selections.map(({provision:p,start_utf16,length})=>citationChunks(p.text,start_utf16,Math.min(p.text.length,start_utf16+length)).map(chunk=>({...chunk,citation_id:citationIdentity(p,chunk.start_utf16,chunk.end_utf16)})));
  const spans=selections.map(({provision:p,start_utf16,length})=>({provision_key:p.provision_key,source_version_id:p.source_version_id,content_hash:p.content_hash,start_utf16,end_utf16:start_utf16,requested_end_utf16:Math.min(p.text.length,start_utf16+length),total_utf16:p.text.length,next_start_utf16:start_utf16,has_more:true,capacity_limited:true,citation_chunks:[] as Chunk[]}));
  const packet={sources,spans};
  if(JSON.stringify(packet).length>capacity)throw new AppError('TOOL_RESULT_CAPACITY','Source identifiers alone exceed result capacity. Request fewer spans.');
  let progress=true;
  while(progress){
    progress=false;
    for(let i=0;i<spans.length;i++){
      const row=spans[i],chunk=pending[i][row.citation_chunks.length];if(!chunk)continue;
      const old={end:row.end_utf16,next:row.next_start_utf16,more:row.has_more,limited:row.capacity_limited};
      row.citation_chunks.push(chunk);row.end_utf16=chunk.end_utf16;row.next_start_utf16=chunk.end_utf16;row.has_more=chunk.end_utf16<row.total_utf16;row.capacity_limited=chunk.end_utf16<row.requested_end_utf16;
      if(JSON.stringify(packet).length<=capacity)progress=true;
      else{row.citation_chunks.pop();row.end_utf16=old.end;row.next_start_utf16=old.next;row.has_more=old.more;row.capacity_limited=old.limited;}
    }
  }
  if(!spans.some(row=>row.citation_chunks.length))throw new AppError('TOOL_RESULT_CAPACITY','No evidence text fits this batch. Request fewer spans.');
  return packet;
}
