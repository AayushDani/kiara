import type {Clause, Fact, Json, Session} from './contracts';
import {AppError} from './contracts';
import {transaction} from '../data/store';
import {revision} from '../data/fixtures';
import {event, once, terminal} from '../workflow/engine';
import {hash, id, now} from './hash';
import {publicDemo} from './demo-context';

export interface CompanyContextInput {
  company_name:string;
  facts: {fact_key:string; knowledge:Fact['knowledge']; value:Json; provenance:string}[];
  document:{title:string;policy_updated_on:string;clauses:Clause[]};
  expected_reset_epoch:number;
  expected_context_epoch:number;
}
function text(value:unknown,limit:number):value is string { return typeof value==='string' && !!value.trim() && value.length<=limit; }
export function validateContextInput(input:CompanyContextInput){
  if(!text(input.company_name,160)||!Number.isSafeInteger(input.expected_context_epoch)||input.expected_context_epoch<1)throw new AppError('INVALID_CONTEXT','A company name and exact context version are required.',400);
  if(!Array.isArray(input.facts)||!input.facts.length||input.facts.length>100)throw new AppError('INVALID_CONTEXT','Supply between one and 100 explicitly sourced company facts.',400);
  const keys=new Set<string>();
  for(const fact of input.facts){
    if(!fact||!text(fact.fact_key,100)||!/^[a-z][a-z0-9_]*$/.test(fact.fact_key)||keys.has(fact.fact_key)||!['known','unknown','conflicted'].includes(fact.knowledge)||fact.value===undefined||!text(fact.provenance,1000))throw new AppError('INVALID_FACT','Each fact needs a unique key, knowledge state, value and provenance.',400);
    if(fact.knowledge==='known'&&fact.value===null)throw new AppError('INVALID_FACT','A known fact requires a value; mark missing values unknown.',400);
    if(JSON.stringify(fact.value).length>8000)throw new AppError('INVALID_FACT','A fact exceeds the supported context size.',400);
    keys.add(fact.fact_key);
  }
  const doc=input.document;
  if(!doc||!text(doc.title,200)||!/^\d{4}-\d{2}-\d{2}$/.test(doc.policy_updated_on)||!Number.isFinite(Date.parse(doc.policy_updated_on))||!Array.isArray(doc.clauses)||!doc.clauses.length||doc.clauses.length>80)throw new AppError('INVALID_DOCUMENT','Supply a dated prior document with one to 80 stable clause identifiers.',400);
  const clauses=new Set<string>();
  for(const clause of doc.clauses){
    if(!clause||!text(clause.clause_id,100)||!text(clause.heading,300)||!text(clause.body,15000)||clauses.has(clause.clause_id))throw new AppError('INVALID_DOCUMENT','Clauses need unique identifiers, headings and text.',400);
    clauses.add(clause.clause_id);
  }
  if(JSON.stringify(input).length>60000)throw new AppError('CONTEXT_CAPACITY_EXCEEDED','This context exceeds the supported intake size.',413);
}

/** Explicit founder assertion; a model or a note can never call this tool. */
export async function importCompanyContext(input:CompanyContextInput,session:Session,key:string){
  if(publicDemo())throw new AppError('DEMO_ONLY','Public demos cannot import private company context.',403);
  if(session.role!=='founder')throw new AppError('FORBIDDEN','The founder must attest company context.',403);
  if(session.reset_epoch!==input.expected_reset_epoch)throw new AppError('RESET_EPOCH_MISMATCH','Refresh the workspace.');
  validateContextInput(input);
  return transaction(s=>once(s,key,{actor_id:session.actor_id,...input},()=>{
    if(s.reset_epoch!==input.expected_reset_epoch||s.context_epoch!==input.expected_context_epoch)throw new AppError('MATERIAL_INPUT_CHANGED','Company context changed. Reload before importing.');
    if(s.workflows.some(w=>!terminal.has(w.state)))throw new AppError('ACTIVE_REVIEW','Finish or reject active reviews before replacing the company context. Use attributed feedback to correct an active review.');
    const prior=s.revisions.find(r=>r.revision_id===s.current_revision_id)!;
    const next=revision({...input.document,document_id:prior.document_id},Math.max(...s.revisions.map(r=>r.revision_number))+1,prior.revision_id);
    next.generation='human_edit';
    s.revisions.push(next);s.current_revision_id=next.revision_id;s.company_name=input.company_name.trim();
    s.facts=input.facts.map(f=>({...structuredClone(f),fact_id:id()}));s.context_epoch++;
    const receipt={kind:'company_context_import',actor_id:session.actor_id,role:session.role,context_epoch:s.context_epoch,company_name:s.company_name,document_revision_id:next.revision_id,document_hash:next.content_hash,facts_hash:hash(s.facts),facts:structuredClone(s.facts),created_at:now(),source:'founder_supplied',synthetic:false};
    s.receipts[`${s.reset_epoch}:company_context:${s.context_epoch}`]={hash:hash(receipt),result:receipt as unknown as Json};
    event(s,null,'context.imported','Company context registered',`Founder supplied context v${s.context_epoch} and prior document v${next.revision_number}; source attribution retained.`);
    return {context_epoch:s.context_epoch,document_revision_id:next.revision_id,document_hash:next.content_hash,facts_hash:receipt.facts_hash};
  }));
}
