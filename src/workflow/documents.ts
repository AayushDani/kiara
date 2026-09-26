import type {Revision, State, Workflow, Json, Binding} from '../server/contracts';
import {AppError} from '../server/contracts';
import {bindings, candidate, provisions} from '../data/fixtures';
import {publicDemo} from '../server/demo-context';
import {hash, now} from '../server/hash';
import {revisionDigest} from '../validation/proposal';

export const contextSnapshotKey = (w:Workflow) => `${w.reset_epoch}:context_snapshot:${w.workflow_id}:${w.context_epoch}`;

/** The source pack is retained evidence, never a claim that the law was fetched today. */
export function pinContext(s:State,w:Workflow) {
  const base=s.revisions.find(r=>r.revision_id===w.base_revision_id);
  if(!base||base.content_hash!==revisionDigest(base))throw new AppError('BASE_HASH_MISMATCH','The prior document is missing or its content hash changed.');
  const snapshot={kind:'context_snapshot',workflow_id:w.workflow_id,event_id:w.event_id,tenant_id:s.tenant_id,context_epoch:w.context_epoch,base_revision_id:base.revision_id,base_content_hash:base.content_hash,facts:structuredClone(w.facts),facts_hash:hash(w.facts),source_basis:publicDemo()?'retained_demo_evidence_not_current_law_verification':'retained_evidence_requires_lawyer_recheck',sources:structuredClone(provisions()),source_pack_hash:hash(provisions()),harness_version:w.harness_version,created_at:now()};
  const key=contextSnapshotKey(w),prior=s.receipts[key];
  if(prior){
    const old=prior.result as unknown as typeof snapshot;
    if(old.facts_hash!==snapshot.facts_hash||old.base_content_hash!==snapshot.base_content_hash||old.harness_version!==snapshot.harness_version)throw new AppError('PINNED_CONTEXT_CHANGED','The pinned inputs changed without a new context version.');
    return prior.hash;
  }
  s.receipts[key]={hash:hash(snapshot),result:snapshot as unknown as Json};
  return s.receipts[key].hash;
}

export function verifyPinnedContext(s:State,w:Workflow) {
  const receipt=s.receipts[contextSnapshotKey(w)];
  if(!receipt)throw new AppError('CONTEXT_SNAPSHOT_REQUIRED','A versioned context snapshot is required.');
  const snapshot=receipt.result as any;
  const base=s.revisions.find(r=>r.revision_id===w.base_revision_id);
  if(receipt.hash!==hash(snapshot)||snapshot.facts_hash!==hash(w.facts)||snapshot.base_revision_id!==w.base_revision_id||snapshot.base_content_hash!==base?.content_hash||snapshot.harness_version!==w.harness_version||snapshot.source_pack_hash!==hash(provisions()))throw new AppError('PINNED_CONTEXT_CHANGED','Pinned facts, document, sources or harness changed. Revalidation is required.');
  return receipt.hash;
}

export type TextChange={kind:'equal'|'remove'|'add';text:string};
/** Exact lossless text redline. The middle replacement is intentionally not claimed to be minimal. */
export function textChanges(before:string,after:string):TextChange[] {
  if(before===after)return [{kind:'equal',text:before}];
  const a=before.match(/\s+|\S+/g)||[],b=after.match(/\s+|\S+/g)||[];
  let prefix=0,suffix=0;
  while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
  while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  const result:TextChange[]=[];
  const push=(kind:TextChange['kind'],text:string)=>{if(text)result.push({kind,text});};
  push('equal',a.slice(0,prefix).join(''));
  push('remove',a.slice(prefix,a.length-suffix).join(''));
  push('add',b.slice(prefix,b.length-suffix).join(''));
  push('equal',suffix?a.slice(a.length-suffix).join(''):'');
  return result;
}

export function documentRedline(base:Revision,candidate:Revision,workflow_id:string|null=null) {
  if(base.document_id!==candidate.document_id||candidate.base_revision_id!==base.revision_id)throw new AppError('BASE_REVISION_MISMATCH','The redline must compare the candidate with its actual prior document.');
  const ids=[...base.clauses.map(c=>c.clause_id),...candidate.clauses.filter(c=>!base.clauses.some(b=>b.clause_id===c.clause_id)).map(c=>c.clause_id)];
  return {kind:'document_redline',workflow_id,created_at:candidate.created_at,schema_version:'kiara.redline.v1',base_revision_id:base.revision_id,base_content_hash:base.content_hash,candidate_revision_id:candidate.revision_id,candidate_content_hash:candidate.content_hash,title:textChanges(base.title,candidate.title),policy_updated_on:textChanges(base.policy_updated_on,candidate.policy_updated_on),prior_order:base.clauses.map(c=>c.clause_id),candidate_order:candidate.clauses.map(c=>c.clause_id),clauses:ids.map(clause_id=>{
    const before=base.clauses.find(c=>c.clause_id===clause_id),after=candidate.clauses.find(c=>c.clause_id===clause_id);
    return {clause_id,change:!before?'added':!after?'removed':hash(before)===hash(after)?'unchanged':'modified',before:before??null,after:after??null,heading:textChanges(before?.heading||'',after?.heading||''),body:textChanges(before?.body||'',after?.body||''),evidence_bindings:(candidate.evidence_bindings||[]).filter(b=>b.clause_ids.includes(clause_id))};
  })};
}

export function persistRedline(s:State,w:Workflow) {
  const base=s.revisions.find(r=>r.revision_id===w.base_revision_id),revision=s.revisions.find(r=>r.revision_id===w.candidate_revision_id);
  if(!base||!revision)throw new AppError('DOCUMENT_REQUIRED','Both prior and candidate documents are required.');
  const redline=documentRedline(base,revision,w.workflow_id),key=`${s.reset_epoch}:redline:${revision.revision_id}`,digest=hash(redline);
  const prior=s.receipts[key];
  if(prior&&prior.hash!==digest)throw new AppError('IMMUTABLE_REVISION_CHANGED','A previously saved candidate or redline was modified.');
  s.receipts[key]={hash:digest,result:redline as unknown as Json};
  return digest;
}

/** Explicit demo template adapter. Production OpenAI generation never calls this function. */
export function scriptedCandidate(base:Revision,w:Workflow):Revision {
  const revision=candidate(base);
  revision.document_id=base.document_id;revision.title=base.title;revision.policy_updated_on=w.created_at.slice(0,10);revision.generation='scripted';
  const value=(key:string)=>w.facts.find(f=>f.fact_key===key&&f.knowledge==='known')?.value;
  const email=value('consumer_request_email'),url=value('consumer_request_web_path');
  revision.clauses=revision.clauses.map(c=>({...c,body:c.body.replaceAll('privacy@democo.example',typeof email==='string'?email:'[unverified contact]').replaceAll('https://democo.example/privacy/requests',typeof url==='string'?url:'[unverified request URL]')}));
  // Preserve existing protected and unfamiliar sections exactly, including customer wording.
  const mutableIds=new Set(bindings().flatMap(b=>b.clause_ids));
  for(const old of base.clauses){
    const index=revision.clauses.findIndex(c=>c.clause_id===old.clause_id);
    if(index<0)revision.clauses.push(structuredClone(old));
    else if(!mutableIds.has(old.clause_id))revision.clauses[index]=structuredClone(old);
  }
  const sources=provisions();
  revision.evidence_bindings=bindings().map(row=>({...row,fact_refs:row.fact_refs.map(ref=>({fact_key:ref.fact_key,fact_id:w.facts.find(f=>f.fact_key===ref.fact_key)?.fact_id||ref.fact_id})),legal_refs:row.legal_refs.map(ref=>{const source=sources.find(p=>p.provision_key===ref.provision_key)!;return {...ref,start_utf16:0,end_utf16:source.text.length,quote_text:source.text};})})) as Binding[];
  revision.content_hash=revisionDigest(revision);
  return revision;
}
