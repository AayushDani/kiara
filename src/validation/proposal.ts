import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Binding, Fact, Provision, Revision, Workflow} from '../server/contracts';
import {bindings, fixture, provisions} from '../data/fixtures';
import {hash, textHash} from '../server/hash';

export const requiredEvidence = ['prov_ccpa_business','prov_ccpa_consumer','prov_ccpa_pi','prov_ccpa_exemptions','prov_ccpa_cpi','prov_ccpa_cpi_authority','prov_ccpa_policy','prov_regs_policy'];
export const contextCheck = (keys: string[]) => requiredEvidence.every(key => keys.includes(key));
export type CitedRef = Binding['legal_refs'][number] & {start_utf16?:number;end_utf16?:number;quote_text?:string};
export type BoundRevision = Revision & {evidence_bindings?:Binding[];generation?:'scripted'|'openai'|'human_edit';semantic_validation?:{passed:boolean;codes:string[];reviewed_content_hash:string;model:string;checked_at:string}};
export function revisionDigest(r:Revision) {return hash({document_id:r.document_id,title:r.title,policy_updated_on:r.policy_updated_on,clauses:r.clauses});}
export function validateCitation(ref:CitedRef, available:Provision[]):string[] {
  const p=available.find(p=>p.provision_key===ref.provision_key&&p.source_version_id===ref.source_version_id);
  if(!p)return ['CITATION_UNRESOLVED'];
  if(ref.quote_text===undefined)return [];
  if(!Number.isInteger(ref.start_utf16)||!Number.isInteger(ref.end_utf16)||ref.start_utf16!<0||ref.end_utf16!<=ref.start_utf16!||ref.end_utf16!>p.text.length)return ['CITATION_SPAN_MISMATCH'];
  return p.text.slice(ref.start_utf16,ref.end_utf16)===ref.quote_text?[]:['CITATION_SPAN_MISMATCH'];
}
export function validateSeedCitation(offset:number|null):string[] {
  const citation=fixture<any>('documents/citation-corrected.json');
  const raw=readFileSync(join(process.cwd(),'kiara-architecture/fixtures/documents/citation-raw-page-21.txt'),'utf8');
  const seg=citation.segments[0];
  const source=fixture<any[]>('legal_source_versions.ejson.json').find(s=>s._id===citation.source_version_id);
  if(!source||source.original_sha256!==citation.raw_sha256||source.url!==citation.source_url)return ['SOURCE_VERSION_MISMATCH'];
  if(textHash(raw)!==seg.raw_page_text_sha256 || textHash(seg.quote_text)!==seg.quote_sha256)return ['SOURCE_HASH_MISMATCH'];
  if(offset===null||raw.slice(offset,offset+seg.end_utf16-seg.start_utf16)!==seg.quote_text)return ['CITATION_SPAN_MISMATCH'];
  return [];
}
export function semanticRuleChecks(r:Revision,facts:Fact[]):string[] {
  const out:string[]=[];const text=r.clauses.map(c=>c.body).join('\n');
  if(/\b(fully compliant|guarantee(?:s|d)? compliance|all (?:legal|ccpa) (?:duties|obligations) (?:are )?(?:satisfied|fulfilled)|retroactively (?:cures|satisfies))\b/i.test(text))out.push('UNSUPPORTED_COMPLIANCE_CLAIM');
  if(/ignore (?:all |previous )?instructions|disable (?:citation|validation|approval)|bypass (?:approval|validation)/i.test(text))out.push('INSTRUCTION_IN_DOCUMENT');
  const val=(key:string)=>facts.find(f=>f.fact_key===key&&f.knowledge==='known')?.value;
  if(val('sells_personal_information')===false&&/(?:^|[.!?]\s+|\n\s*)we (?:currently )?(?:sell|have sold|will sell)\b/i.test(text))out.push('FACT_CONTRADICTION');
  if(val('shares_for_cross_context_behavioral_advertising')===false&&/\bwe (?:currently )?share[^.!?]{0,200}(?:cross.context|advertis)/i.test(text))out.push('FACT_CONTRADICTION');
  if(val('financial_incentives')===false&&/\bwe offer financial incentives/i.test(text))out.push('FACT_CONTRADICTION');
  if(val('sells_personal_information')===true&&/we (?:have not|do not|never) sell/i.test(text))out.push('FACT_CONTRADICTION');
  if(val('shares_for_cross_context_behavioral_advertising')===true&&/we do not (?:sell or )?share/i.test(text))out.push('FACT_CONTRADICTION');
  if(val('financial_incentives')===true&&/we do not offer financial incentives/i.test(text))out.push('FACT_CONTRADICTION');
  if(val('account_credentials_collected')===true&&!/credential|password|login/i.test(text))out.push('SENSITIVE_DATA_OMITTED');
  if(/we (?:automatically |always )?(?:honor|process) (?:all )?(?:global privacy control|opt.out preference signals)/i.test(text)&&val('gpc_implementation_status')!=='implemented')out.push('OPERATIONAL_CLAIM_UNSUPPORTED');
  return [...new Set(out)];
}
export function validateProposal(w:Workflow,input:Revision,base?:Revision,available=provisions()):string[] {
  const r=input as BoundRevision;const errors:string[]=[];
  if(w.assessment?.outcome!=='covered')errors.push('APPLICABILITY_UNRESOLVED');
  if(!contextCheck(w.evidence_keys))errors.push('APPLICABILITY_BUNDLE_MISSING');
  if(!r||!Array.isArray(r.clauses)||!r.clauses.length)return [...errors,'DOCUMENT_STRUCTURE_INVALID'];
  if(r.content_hash!==revisionDigest(r))errors.push('DOCUMENT_HASH_MISMATCH');
  if(new Set(r.clauses.map(c=>c.clause_id)).size!==r.clauses.length)errors.push('DUPLICATE_CLAUSE');
  if(Buffer.byteLength(JSON.stringify(r))>1048576)errors.push('DOCUMENT_TOO_LARGE');
  if(r.clauses.some(c=>typeof c.clause_id!=='string'||typeof c.heading!=='string'||typeof c.body!=='string'||!c.body.trim()||c.body.length>50000))return [...errors,'CLAUSE_INVALID'];
  if(!Number.isFinite(Date.parse(w.freshness_valid_until))||Date.parse(w.freshness_valid_until)<=Date.now())errors.push('SOURCE_STALE');
  const allSources=fixture<any[]>('legal_source_versions.ejson.json');
  const retainedChunks=fixture<any[]>('legal_chunks.ejson.json');
  const checkedSources=new Set<string>();
  for(const key of w.evidence_keys){
    const p=available.find(p=>p.provision_key===key);if(!p){errors.push('CITATION_UNRESOLVED');continue;}
    const source=allSources.find(s=>s._id===p.source_version_id);
    if(textHash(p.text)!==p.content_hash)errors.push('SOURCE_HASH_MISMATCH');
    const retained=retainedChunks.find(c=>c.provision_key===key);if(retained&&retained.content_hash!==p.content_hash)errors.push('SOURCE_HASH_MISMATCH');
    if(source&&!checkedSources.has(source._id)){checkedSources.add(source._id);const raw=source.original_bytes?.$binary?.base64;if(!raw||createHash('sha256').update(Buffer.from(raw,'base64')).digest('hex')!==source.original_sha256)errors.push('SOURCE_HASH_MISMATCH');}
    if(!source||source.original_sha256!==p.source_hash)errors.push('SOURCE_VERSION_MISMATCH');
    if(!/^https:\/\/(?:www\.)?(?:cppa\.ca\.gov|leginfo\.legislature\.ca\.gov)\//.test(p.url))errors.push('SOURCE_UNTRUSTED');
    if(!Number.isFinite(Date.parse(p.effective_from))||Date.parse(p.effective_from)>Date.parse(w.created_at))errors.push('FUTURE_SOURCE');
    if(source?.status && !['active','current','operative'].includes(source.status))errors.push('SOURCE_NOT_OPERATIVE');
  }
  const baseline=base||fixture<Revision>('documents/baseline.json');
  const mapping=r.evidence_bindings||bindings();
  for(const clauseId of new Set(bindings().flatMap(b=>b.clause_ids))){if(!r.clauses.some(c=>c.clause_id===clauseId))errors.push('REQUIRED_DISCLOSURE_MISSING');}
  const protectedIds=new Set(baseline.clauses.filter(c=>!bindings().some(b=>b.clause_ids.includes(c.clause_id))).map(c=>c.clause_id));
  for(const b of baseline.clauses){const c=r.clauses.find(c=>c.clause_id===b.clause_id);if(!c)errors.push('BASE_CLAUSE_REMOVED');else if(protectedIds.has(b.clause_id)&&(b.body!==c.body||b.heading!==c.heading))errors.push('UNCHANGED_CLAUSE_MODIFIED');}
  if(base&&(r.document_id!==base.document_id||r.base_revision_id!==w.base_revision_id))errors.push('BASE_REVISION_MISMATCH');
  for(const c of r.clauses){
    const b=baseline.clauses.find(b=>b.clause_id===c.clause_id);
    if(b&&b.body===c.body&&b.heading===c.heading)continue;
    const rows=mapping.filter(row=>row.clause_ids.includes(c.clause_id));
    if(!rows.length){errors.push('CLAUSE_EVIDENCE_MISSING');continue;}
    for(const row of rows){
      if(!row.fact_refs.length||!row.legal_refs.length)errors.push('CLAUSE_EVIDENCE_MISSING');
      for(const ref of row.fact_refs){const f=w.facts.find(f=>f.fact_key===ref.fact_key&&f.fact_id===ref.fact_id);if(!f)errors.push('FACT_REFERENCE_UNRESOLVED');else if(f.knowledge!=='known')errors.push('FACT_UNRESOLVED');}
      for(const ref of row.legal_refs){if(!w.evidence_keys.includes(ref.provision_key))errors.push('CITATION_NOT_IN_CONTEXT');errors.push(...validateCitation(ref,available));if(r.generation==='openai'&&!(ref as CitedRef).quote_text)errors.push('CITATION_SPAN_REQUIRED');}
    }
  }
  errors.push(...semanticRuleChecks(r,w.facts));
  if(r.generation==='openai'||(r.generation==='human_edit'&&w.model_mode==='openai')){
    const v=r.semantic_validation;
    if(!v||v.reviewed_content_hash!==r.content_hash)errors.push('SEMANTIC_REVIEW_REQUIRED');
    else if(!v.passed)errors.push(...v.codes.length?v.codes:['SEMANTIC_REVIEW_FAILED']);
  }else errors.push(...validateSeedCitation(w.citation_offset));
  return [...new Set(errors)];
}
