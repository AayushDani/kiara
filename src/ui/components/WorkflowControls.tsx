'use client';
import {useState} from 'react';
import type {State, Workflow, Role} from '../../server/contracts';
import type {OperationalEvidence} from '../../server/operations';

type Post=(path:string,body:unknown)=>Promise<any>;
export function ContextIntake({state,post,disabled}:{state:State;post:Post;disabled:boolean}){
  const [input,setInput]=useState(''),[error,setError]=useState('');
  const current=state.revisions.find(r=>r.revision_id===state.current_revision_id)!;
  const template={company_name:state.company_name,facts:state.facts.map(({fact_key,knowledge,value,provenance})=>({fact_key,knowledge,value,provenance})),document:{title:current.title,policy_updated_on:current.policy_updated_on,clauses:current.clauses}};
  async function save(){try{setError('');const value=JSON.parse(input);const result=await post('/api/context',{...value,expected_reset_epoch:state.reset_epoch,expected_context_epoch:state.context_epoch});if(result)setInput('');}catch{setError('Enter valid company context JSON.');}}
  return <details className="demo-details"><summary>Import company facts and prior policy</summary><p>Attest the facts you supply and include their provenance. Missing facts stay unknown. The prior document becomes an immutable version; active reviews must finish first.</p><button className="demo-secondary" disabled={disabled} onClick={()=>setInput(JSON.stringify(template,null,2))}>Load current context as an editable template</button><label className="demo-field">Company context JSON<textarea rows={10} value={input} onChange={e=>setInput(e.target.value)} maxLength={60000}/></label>{error&&<p role="alert">{error}</p>}<button className="demo-primary" disabled={disabled||!input} onClick={()=>void save()}>Attest and save context v{state.context_epoch+1}</button></details>;
}

export function ReviewFeedback({state,workflow,role,post,disabled}:{state:State;workflow:Workflow;role:Role;post:Post;disabled:boolean}){
  const [type,setType]=useState('document_edit'),[text,setText]=useState(''),[target,setTarget]=useState(''),[newKey,setNewKey]=useState(''),[value,setValue]=useState(''),[error,setError]=useState('');
  const draft=state.revisions.find(r=>r.revision_id===workflow.candidate_revision_id);
  const feedback=state.feedback.filter(f=>f.workflow_id===workflow.workflow_id);
  async function submit(){let proposed_value;setError('');if(type==='fact_correction'){try{proposed_value=JSON.parse(value);}catch{setError('The proposed fact must be a JSON value: a quoted string, number, true/false, array or object.');return;}}
    const result=await post(`/api/workflows/${workflow.workflow_id}/feedback`,{type,text,expected_reset_epoch:state.reset_epoch,...(type==='fact_correction'?{fact_key:target==='__new__'?newKey.trim():target,proposed_value}:{}),...(type==='document_edit'?{clause_id:target,expected_candidate_revision_id:workflow.candidate_revision_id,expected_state_version:workflow.state_version}:{})});if(result)setText('');}
  return <details className="demo-details"><summary>Give feedback or request a correction</summary><p>Edits and legal interpretation feedback invalidate the review packet. Fact suggestions require a separate founder verification; notes never become facts automatically.</p>
    <label className="demo-field">Feedback category<select value={type} onChange={e=>{setType(e.target.value);setTarget('');}}><option value="document_edit">Replace clause text</option><option value="fact_correction">Propose a factual correction</option><option value="legal_interpretation_note">Legal interpretation</option><option value="harness_improvement">Harness improvement</option></select></label>
    {['document_edit','fact_correction'].includes(type)&&<label className="demo-field">{type==='document_edit'?'Clause':'Fact'}<select value={target} onChange={e=>{setTarget(e.target.value);if(type==='document_edit')setText(draft?.clauses.find(c=>c.clause_id===e.target.value)?.body||'');}}><option value="">Select…</option>{type==='document_edit'?draft?.clauses.map(c=><option key={c.clause_id} value={c.clause_id}>{c.heading}</option>):<>{state.facts.map(f=><option key={f.fact_id} value={f.fact_key}>{f.fact_key}</option>)}<option value="__new__">Add a missing company fact…</option></>}</select></label>}
    {type==='fact_correction'&&target==='__new__'&&<label className="demo-field">New fact name<input value={newKey} onChange={e=>setNewKey(e.target.value)} maxLength={100} placeholder="disclosure_history"/><small>Use letters, numbers and underscores. This remains a proposal until the founder verifies it.</small></label>}
    {type==='fact_correction'&&<label className="demo-field">Proposed value (JSON)<input value={value} onChange={e=>setValue(e.target.value)}/></label>}
    <label className="demo-field">{type==='document_edit'?'Replacement text':'Feedback and supporting source'}<textarea value={text} onChange={e=>setText(e.target.value)} rows={4} maxLength={5000}/></label>{error&&<p role="alert">{error}</p>}
    <button className="demo-secondary" disabled={disabled||!text.trim()||(['fact_correction','document_edit'].includes(type)&&!target)} onClick={()=>void submit()}>Record {role} feedback</button>
    {feedback.map(f=><article className="demo-fact" key={f.feedback_id}><strong>{f.role} · {f.type.replaceAll('_',' ')} · {f.status}</strong><p>{f.text}</p>{f.proposed_value !== undefined && <pre>{JSON.stringify(f.proposed_value,null,2)}</pre>}{f.type==='fact_correction'&&f.status==='recorded'&&role==='founder'&&<button className="demo-secondary" disabled={disabled} onClick={()=>void post(`/api/facts/${f.feedback_id}/verify`,{expected_reset_epoch:state.reset_epoch})}>Verify and apply this fact</button>}</article>)}
  </details>;
}

export function OperationRecords({evidence}:{evidence?:OperationalEvidence}){
  if(!evidence)return null;
  const usage=evidence.inference_evidence;
  return <details className="harness-events"><summary>Provider and improvement records <span>{usage.completed_requests} responses</span></summary>
    <p>{usage.completed_requests?`${usage.completed_requests} completed provider requests recorded`:'No completed provider request is recorded.'} · {usage.input_tokens} input / {usage.output_tokens} output tokens · ${usage.cost_usd.toFixed(4)} estimated usage · ${usage.reserved_usd.toFixed(4)} reserved{usage.unknown_charge?' · Unresolved charge: execution blocked':''}</p>
    {evidence.shared_budget && <p>Shared API budget across all visitors and evaluations: ${evidence.shared_budget.spent_usd.toFixed(4)} spent + ${evidence.shared_budget.reserved_usd.toFixed(4)} reserved / ${evidence.shared_budget.budget_usd.toFixed(2)} cap. {evidence.shared_budget.unknown_charges > 0 ? 'Unresolved charge blocks new calls.' : ''}</p>}
    {evidence.runs.map(run=><article key={run.run_id}><strong>{run.model} · run {run.run_id.slice(0,8)}</strong><ul>{run.attempts.map(a=><li key={a.attempt_id}>{a.phase} · {a.status}{a.response_id&&<code> {a.response_id}</code>}{a.error_code&&` · ${a.error_code}`}</li>)}{run.tools.map((t,i)=><li key={i}>Tool: {t.name} · result <code>{t.result_hash.slice(0,12)}</code></li>)}</ul></article>)}
    <p>{evidence.improvements.length} persisted improvement records. Promotion requires a measured evaluation; an empty history means no improvement has been proven.</p>
    {evidence.improvements.map((r,i)=><pre key={i} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:11}}>{JSON.stringify(r,null,2)}</pre>)}
    <p>{evidence.scope.source==='founder_supplied'?'Founder-supplied company context':'Synthetic fixture context'} · {evidence.scope.source_policy}</p>
    <a className="demo-link" href="/api/operations" target="_blank" rel="noreferrer">Open auditable metadata JSON</a>
  </details>;
}
