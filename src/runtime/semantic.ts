import type {ResponseCreateParamsNonStreaming} from 'openai/resources/responses/responses';
import type {Provision,Revision} from '../server/contracts';
import {AppError} from '../server/contracts';
import {hash} from '../server/hash';

/** Full prior text plus an exact candidate delta: no unchanged clause is sent twice. */
export function semanticDocumentPacket(base:Revision,candidate:Revision){
  const {clauses}=candidate;
  const document=(r:Revision)=>({document_id:r.document_id,title:r.title,policy_updated_on:r.policy_updated_on});
  return {baseline:{...document(base),clauses:base.clauses},candidate_delta:{metadata:document(candidate),clause_order:clauses.map(c=>c.clause_id),clause_patches:clauses.filter(c=>{const before=base.clauses.find(b=>b.clause_id===c.clause_id);return !before||hash(before)!==hash(c);}),removed_clause_ids:base.clauses.filter(b=>!clauses.some(c=>c.clause_id===b.clause_id)).map(c=>c.clause_id)},reconstruction:'Start with baseline clauses, replace/add every candidate_delta.clause_patches entry, remove removed_clause_ids, then order by clause_order. Metadata supplies document title and date. This reconstructs all document business/legal text exactly. Citation proof bindings and internal IDs remain in the separate deterministic validator and immutable audit, and are not repeated in this semantic text projection.'};
}
export interface SemanticBatch {authorities:Provision[];request:ResponseCreateParamsNonStreaming;input_tokens:number;request_hash:string}
/** Byte weights only choose batches. Exact provider counts are mandatory and reused for dispatch. */
export async function planSemanticBatches(authorities:Provision[],build:(law:Provision[])=>ResponseCreateParamsNonStreaming,count:(request:ResponseCreateParamsNonStreaming)=>Promise<number>,capacity=24000,maxBatches=3){
  if(!authorities.length||maxBatches<1)throw new AppError('SEMANTIC_CONTEXT_CAPACITY','Complete authoritative evidence is required for review.');
  const cache=new Map<string,number>();let count_requests=0;
  const exact=async(law:Provision[]):Promise<SemanticBatch>=>{
    const request=build(law),request_hash=hash(request);let input_tokens=cache.get(request_hash);
    if(input_tokens===undefined){input_tokens=await count(request);count_requests++;if(!Number.isInteger(input_tokens)||input_tokens<0)throw new AppError('TOKEN_COUNT_INVALID','The provider returned an invalid exact input count.');cache.set(request_hash,input_tokens);}
    return {authorities:law,request,input_tokens,request_hash};
  };
  const context=(await exact([])).input_tokens,limit=capacity-256;
  if(context>=limit)throw new AppError('SEMANTIC_CONTEXT_CAPACITY','The mandatory review context alone exceeds request capacity.');
  const bytes=new Map(authorities.map(p=>[p.provision_key,Buffer.byteLength(JSON.stringify(p))]));
  const weights=new Map(authorities.map(p=>[p.provision_key,Math.ceil(bytes.get(p.provision_key)!/3)]));
  const balance=(parts:number)=>{
    const bins=Array.from({length:parts},()=>({weight:0,laws:[] as Provision[]}));
    for(const law of [...authorities].sort((a,b)=>weights.get(b.provision_key)!-weights.get(a.provision_key)!||a.provision_key.localeCompare(b.provision_key))){const target=bins.reduce((a,b)=>a.weight<=b.weight?a:b);target.laws.push(law);target.weight+=weights.get(law.provision_key)!;}
    return bins.filter(bin=>bin.laws.length).map(bin=>authorities.filter(law=>bin.laws.includes(law)));
  };
  // The 15% planning margin is conservative; it is never substituted for exact counting.
  let parts=Math.min(maxBatches,authorities.length,Math.max(1,Math.ceil([...weights.values()].reduce((a,b)=>a+b,0)/((limit-context)*0.85))));
  let batches:SemanticBatch[]=[];
  for(let round=0;round<3;round++){
    batches=[];for(const law of balance(parts))batches.push(await exact(law));
    if(batches.every(batch=>batch.input_tokens<=limit))break;
    if(batches.some(batch=>batch.input_tokens>limit&&batch.authorities.length===1))throw new AppError('SEMANTIC_CONTEXT_CAPACITY','One complete authority plus review context exceeds request capacity.');
    // Rebalance whole provisions using measured density; never split or discard their text.
    for(const batch of batches){const totalBytes=batch.authorities.reduce((sum,p)=>sum+bytes.get(p.provision_key)!,0);const density=Math.max(1,batch.input_tokens-context)/totalBytes;for(const law of batch.authorities)weights.set(law.provision_key,Math.ceil(bytes.get(law.provision_key)!*density));}
    parts=Math.min(maxBatches,parts+1);
  }
  if(batches.some(batch=>batch.input_tokens>limit))throw new AppError('SEMANTIC_CONTEXT_CAPACITY','Complete authorities cannot fit the protected review batch capacity.');
  // If two measured batches fit together after removing duplicated context, verify and merge them.
  for(let pass=0;pass<2&&batches.length>1;pass++){
    const smallest=[...batches].sort((a,b)=>a.input_tokens-b.input_tokens),a=smallest[0],b=smallest[1];
    if(a.input_tokens+b.input_tokens-context+128>limit)break;
    const merged=await exact(authorities.filter(law=>a.authorities.includes(law)||b.authorities.includes(law)));
    if(merged.input_tokens>limit)break;
    batches=[...batches.filter(batch=>batch!==a&&batch!==b),merged];
  }
  if(batches.flatMap(batch=>batch.authorities).length!==authorities.length||new Set(batches.flatMap(batch=>batch.authorities.map(law=>law.provision_key))).size!==authorities.length)throw new AppError('SEMANTIC_CONTEXT_INTEGRITY','Every authoritative provision must appear exactly once in the review plan.');
  return {batches,count_requests,context_tokens:context,source_bytes:[...bytes.values()].reduce((a,b)=>a+b,0)};
}
