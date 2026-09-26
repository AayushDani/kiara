import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {State, Fact, Revision, Provision, Binding} from '../server/contracts';
import {id, now, hash, textHash} from '../server/hash';
const root = join(process.cwd(), 'kiara-architecture/fixtures');
export const fixture = <T = any>(path: string): T => JSON.parse(readFileSync(join(root, path), 'utf8'));
export const TENANT = '23c3e609-b6fc-52b5-ad3b-5731feb09323';
export const ACTORS = {founder: '6c6939bf-2453-539f-8f86-6b1e6e61edbe', lawyer: '3a6ef3af-edf4-58c4-8123-03bbcbf09ad1'};
export function revision(input: any, number = 1, base: string | null = null): Revision { const r = {revision_id: id(), document_id: input.document_id, revision_number: number, base_revision_id: base, title: input.title, policy_updated_on: input.policy_updated_on, clauses: input.clauses, created_at: now(), content_hash: ''}; r.content_hash = hash({document_id:r.document_id, title:r.title, policy_updated_on:r.policy_updated_on, clauses:r.clauses}); return r; }
export function seed(epoch = 1): State { const input = fixture<any>('documents/baseline.json'); const base = revision(input); base.revision_id=input._id; base.created_at='2026-09-26T18:00:00.000Z'; return {schema_version:1,tenant_id:TENANT,reset_epoch:epoch,state_version:0,context_epoch:1,company_name:'DemoCo',facts:fixture<any[]>('company_context_versions.ejson.json')[0].facts.map((f:any): Fact=>({fact_id:f.fact_id,fact_key:f.fact_key,knowledge:f.fact_key==='ca_processing_initiated_on'?'unknown':f.knowledge,value:['declared_legal_residence','physical_state_at_collection'].includes(f.fact_key)?'US-NY':f.fact_key==='ca_consumers_commercial_processing_current_year'?0:f.fact_key==='ca_processing_initiated_on'?null:f.value,provenance:'Synthetic baseline fact · 26 Sep 2026'})),revisions:[base],current_revision_id:base.revision_id,workflows:[],events:[],feedback:[],notifications:[],harnesses:[{version:1,harness_id:'de7eeb80-697c-573a-8c76-9e837127a6c9',prefetch:false,created_at:'2026-09-26T18:00:00.000Z',status:'active',reason:'Baseline retrieval; applicability bundle requested after readiness check.'}],champion_version:1,champion_generation:1,evaluations:[],receipts:{},worker_heartbeat:null}; }
/** A missing CPI chunk in the design fixtures is derived from retained agency HTML. */
export function legalChunks(): any[] {
 const sources=fixture<any[]>('legal_source_versions.ejson.json');
 const chunks=fixture<any[]>('legal_chunks.ejson.json').map(c=>({...c,source_text_hash:c.source_hash,source_hash:sources.find(s=>s._id===c.source_version_id)!.original_sha256}));
 const source=fixture<any[]>('legal_source_versions.ejson.json').find(s=>s._id==='23513bed-4516-56ad-ab38-84fab4936de3')!;
 const amount=source.extracted_text.indexOf('$26,625,000');
 if(amount<0)throw new Error('Retained CPI source does not contain the expected threshold');
 const start=source.extracted_text.lastIndexOf('<tr>',amount),end=source.extracted_text.indexOf('</tr>',amount)+5;
 const text=source.extracted_text.slice(start,end).replace(/<[^>]+>/g,' ').replaceAll('&sect;','§').replace(/\s+/g,' ').trim();
 chunks.push({_id:'d05817a1-6ea5-50e2-a944-9679130e388c',tenant_id:TENANT,schema_version:1,source_version_id:source._id,source_hash:source.original_sha256,chunk_index:0,provision_key:'prov_ccpa_cpi',locator:{section:'CPPA inflation-adjusted business threshold (effective January 1, 2025)',pages:[],start_char:start,end_char:end,offset_basis:'retained_html',extraction:'HTML tags removed, section entity decoded, whitespace collapsed'},text,content_hash:textHash(text),effective_from:source.effective_from});
 return chunks;
}
let cached: Provision[] | undefined;
export function provisions(): Provision[] { if(cached) return cached; const sources = fixture<any[]>('legal_source_versions.ejson.json'); return cached = legalChunks().map(c=>{const s=sources.find(x=>x._id===c.source_version_id);return {provision_key:c.provision_key,source_version_id:c.source_version_id,title:c.locator.section,url:s.url+(c.locator.pages.length?'#page='+c.locator.pages[0]:''),text:c.text,content_hash:c.content_hash,source_hash:s.original_sha256,effective_from:c.effective_from?.$date||'2026-01-01T00:00:00Z',retrieved_at:s.retrieved_at.$date};}); }
export function bindings(): Binding[] { const current=provisions(); return fixture<any>('documents/canonical-legal-map.json').rows.map((r:any)=>({...r,legal_refs:r.legal_refs.map((ref:any)=>{const provision=current.find(p=>p.provision_key===ref.provision_key);return {...ref,...(provision?{source_hash:provision.source_hash,chunk_content_hash:provision.content_hash}:{})};}),rationale:r.interpretation||r.mapping_key.replaceAll('_',' ')})); }
export const followups = () => fixture<any[]>('documents/operational-followups.json');
export function candidate(base: Revision): Revision { return revision(fixture('documents/candidate.json'),base.revision_number+1,base.revision_id); }
