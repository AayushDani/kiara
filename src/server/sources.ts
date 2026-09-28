import {createHash} from 'node:crypto';
import {fixture} from '../data/fixtures';
import {transaction} from '../data/store';
import {AppError,type Role,type Json} from './contracts';
import {event,terminal,scoped} from '../workflow/engine';
import {id,now,hash} from './hash';
import {sourceHealthKey} from './source-health';
const allowed=new Set(['cppa.ca.gov','leginfo.legislature.ca.gov']);
/** Fetch only a registered official source, with redirects, bytes and time bounded. */
export async function fetchRegisteredSource(url:string){let target=new URL(url);const signal=AbortSignal.timeout(10000);for(let hop=0;hop<4;hop++){if(target.protocol!=='https:'||!allowed.has(target.hostname)||target.port||target.username||target.password)throw new AppError('SOURCE_UNTRUSTED','The source is outside the registered official-origin allowlist.',400);const response=await fetch(target,{redirect:'manual',signal,headers:{Accept:'application/pdf,text/html,text/plain'}});if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw new AppError('SOURCE_FETCH_FAILED','Invalid source redirect.',502);target=new URL(location,target);continue;}if(!response.ok||!response.body)throw new AppError('SOURCE_FETCH_FAILED','The official source could not be retrieved.',502);const length=Number(response.headers.get('content-length')||0);if(length>4*1024*1024)throw new AppError('SOURCE_TOO_LARGE','The source exceeds the original-byte admission limit.',413);const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>4*1024*1024){await reader.cancel();throw new AppError('SOURCE_TOO_LARGE','The source exceeds the original-byte admission limit.',413);}chunks.push(item.value);}const bytes=Buffer.concat(chunks);return {sha256:createHash('sha256').update(bytes).digest('hex'),byte_count:size,url:target.href};}throw new AppError('SOURCE_REDIRECT_LIMIT','Too many source redirects.',502);}
export async function recheckSources(workflow_id:string,role:Role,epoch:number){
  if(role!=='lawyer')throw new AppError('FORBIDDEN','An assigned lawyer must recheck authoritative sources.',403);
  const sources=fixture<any[]>('legal_source_versions.ejson.json');
  const check_id=id();
  // Revoke eligibility before asynchronous fetch so concurrent approval cannot use the old window.
  const started=await transaction(s=>{
    const target=scoped(s,workflow_id,epoch);
    if(terminal.has(target.state))throw new AppError('TERMINAL_WORKFLOW','Completed review packets remain immutable.');
    if(!target.evidence_keys.length)throw new AppError('EVIDENCE_REQUIRED','Retrieve the review evidence first.');
    const prior=s.receipts[sourceHealthKey(epoch)]?.result as {status?:string;lease_until?:string}|undefined;
    if(prior?.status==='pending'&&Date.parse(prior.lease_until||'')>Date.now())throw new AppError('SOURCE_RECHECK_IN_PROGRESS','A source recheck is already in progress.');
    const health={kind:'source_recheck_health',check_id,status:'pending',failure:'SOURCE_RECHECK_PENDING',checked_at:now(),lease_until:new Date(Date.now()+45000).toISOString()};
    s.receipts[sourceHealthKey(epoch)]={hash:hash(health),result:health};
    for(const current of s.workflows.filter(w=>!terminal.has(w.state)&&w.evidence_keys.length>0)){
      const old=current.bundle_hash;
      current.freshness_valid_until=new Date(0).toISOString();current.bundle_hash=null;current.review_input_hash=null;
      current.state='needs_human_review';current.failure='SOURCE_RECHECK_PENDING';current.state_version++;current.updated_at=now();
      for(const n of s.notifications)if(n.workflow_id===current.workflow_id&&n.bundle_hash===old&&n.status==='pending'){n.status='canceled';n.failure='Source review invalidated the packet.';}
      event(s,current,'approval.invalidated','Source recheck started','Prior source eligibility is suspended until exact-byte verification succeeds. Prior decisions remain historical.');
    }
    return {state_version:target.state_version};
  });
  const verified:{source_version_id:string;source_hash:string;url:string;byte_count:number}[]=[];
  try{
    // The retained corpus is shared: verify every registered source before releasing its health gate.
    for(const source of sources){
      const result=await fetchRegisteredSource(source.url);
      if(result.sha256!==source.original_sha256)throw new AppError('SOURCE_CHANGED','The official source bytes have changed. Reingestion and legal review are required; pending packets are blocked.');
      verified.push({source_version_id:source._id,source_hash:result.sha256,url:result.url,byte_count:result.byte_count});
    }
    return await transaction(s=>{
      const current=scoped(s,workflow_id,epoch),health=s.receipts[sourceHealthKey(epoch)]?.result as {check_id?:string};
      if(health?.check_id!==check_id)throw new AppError('SOURCE_RECHECK_SUPERSEDED','A newer source recheck owns this result.');
      if(current.state_version!==started.state_version)throw new AppError('STATE_VERSION_MISMATCH','The workflow changed during source recheck.');
      const attestation_id=id(),valid_until=new Date(Date.now()+24*60*60*1000).toISOString();
      const result={attestation_id,workflow_id,actor_role:role,verified_at:now(),valid_until,method:'official_origin_exact_bytes',sources:verified};
      s.receipts[`${epoch}:source_recheck:${attestation_id}`]={hash:hash(result),result:result as Json};
      const passed={kind:'source_recheck_health',check_id,status:'verified',checked_at:now(),attestation_id};
      s.receipts[sourceHealthKey(epoch)]={hash:hash(passed),result:passed};
      current.freshness_valid_until=valid_until;current.failure=null;current.state=current.candidate_revision_id?'validating':'retrieving_context';current.state_version++;current.updated_at=now();
      event(s,current,'source.rechecked','Official sources rechecked','Exact registered bytes verified. A new review seal and both approvals are required.');
      return result;
    });
  }catch(error){
    const code=error instanceof AppError?error.code:'SOURCE_FETCH_FAILED';
    await transaction(s=>{
      if(s.reset_epoch!==epoch)return;
      const prior=s.receipts[sourceHealthKey(epoch)]?.result as {check_id?:string};
      if(prior?.check_id!==check_id)return;
      const failed={kind:'source_recheck_health',check_id,status:'failed',failure:code,checked_at:now()};
      s.receipts[sourceHealthKey(epoch)]={hash:hash(failed),result:failed};
      for(const w of s.workflows.filter(w=>!terminal.has(w.state)&&w.failure==='SOURCE_RECHECK_PENDING')){w.failure=code;w.state_version++;w.updated_at=now();event(s,w,'source.recheck_failed','Source verification requires attention',code);}
    });
    throw error instanceof AppError?error:new AppError(code,'Official source verification failed. Pending packets remain blocked.',502);
  }
}
