'use client';

import {useCallback,useEffect,useState} from 'react';
import type {Action,WorkspaceSnapshot} from '@/v2/contracts';
import type {EffectView,ExecutionPreview} from '@/v2/execution/contracts';
import {Badge,human} from './Primitives';
import {Modal} from './ReviewDialog';
import s from './workspace.module.css';

type Props={action:Action;data:WorkspaceSnapshot;csrf:string;busy:boolean;blocked:boolean;setBusy:(busy:boolean)=>void;acceptSnapshot:(snapshot:WorkspaceSnapshot)=>void;refresh:()=>Promise<WorkspaceSnapshot>};
const modeNames:Record<ExecutionPreview['mode'],string>={internal:'Create an internal document',email:'Send a live email',publication_readback:'Read back an existing publication',preview:'Prepare an email preview — no delivery'};
const timingStartPending=(action:Action)=>action.timing?.mode==='not_before'&&!!action.timing.notBefore&&Date.parse(action.timing.notBefore)>Date.now();
const timingDescription=(action:Action)=>action.timing?.mode==='not_before'&&action.timing.notBefore?`Not before ${action.timing.notBefore} (UTC). Reason: ${action.timing.reason}`:'Immediate only after exact authorization; this does not schedule or send automatically.';

export function ExecutionControls({action,data,csrf,busy,blocked,setBusy,acceptSnapshot,refresh}:Props){
  const [review,setReview]=useState<{actorId:string;action:Action;operation:'dispatch'|'reconcile'}|null>(null),[preview,setPreview]=useState<ExecutionPreview|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false),[receipt,setReceipt]=useState(''),[effect,setEffect]=useState<EffectView|null>(null),[uncertain,setUncertain]=useState(false);
  const close=useCallback(()=>setReview(null),[]);
  useEffect(()=>{if(review&&(review.actorId!==data.actor.id||!data.actions.some(a=>a.id===review.action.id)))close()},[data,review,close]);
  const allowed=data.capabilities.includes(action.kind==='signature_request'?'signatory':action.kind==='no_action'?'business_owner':'publisher');
  const current=review?data.actions.find(a=>a.id===review.action.id):undefined;
  const fresh=!!review&&!!current&&current.contentHash===review.action.contentHash&&(review.operation==='reconcile'||current.version===preview?.actionVersion&&current.contentHash===preview?.contentHash);
  const early=timingStartPending(current??action);
  async function open(operation:'dispatch'|'reconcile'){
    setReview({actorId:data.actor.id,action,operation});setError('');setConfirmed(false);setReceipt('');setEffect(null);setPreview(null);setUncertain(false);
    if(operation==='reconcile')return;setLoading(true);
    try{const response=await fetch(`/api/v2/actions/${encodeURIComponent(action.id)}/execution`,{cache:'no-store'});const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??'Execution preview is unavailable.');setPreview(payload.preview)}catch(e){setError(e instanceof Error?e.message:'Execution preview is unavailable.')}finally{setLoading(false)}
  }
  async function execute(operation:'dispatch'|'reconcile'){
    if(!review||!current||busy||blocked||!allowed||!fresh||(operation==='dispatch'&&(early||!confirmed)))return;
    setBusy(true);setError('');
    try{const response=await fetch(`/api/v2/actions/${encodeURIComponent(action.id)}/execution`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({operation,expectedVersion:operation==='dispatch'?preview!.actionVersion:current.version,contentHash:review.action.contentHash,...(operation==='dispatch'?{previewHash:preview!.previewHash}:receipt.trim()?{providerReceipt:receipt.trim()}:{})})});const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??'Execution could not be completed.');acceptSnapshot(payload.snapshot);setEffect(payload.effect);setConfirmed(false);setUncertain(false);setReview(old=>old?{...old,operation:'reconcile'}:null)}
    catch(e){setError(e instanceof Error?e.message:'Execution outcome is unknown.');if(e instanceof TypeError||e instanceof SyntaxError){setUncertain(true);setReview(old=>old?{...old,operation:'reconcile'}:null)}try{acceptSnapshot(await refresh())}catch{/* Keep the original failure and frozen intent. */}}
    finally{setBusy(false)}
  }
  const supported=['internal_document','send','publish'].includes(action.kind);
  if(!supported&&!review)return null;
  return <>
    {['authorized','pending_manual'].includes(action.status)&&!action.providerReceipt&&<button className={s.button} disabled={busy||blocked||!allowed} onClick={()=>void open('dispatch')}>Preview execution</button>}
    {(['uncertain','verifying','dispatching','failed'].includes(action.status)||!!action.providerReceipt)&&action.status!=='canceled'&&<button className={s.button} disabled={busy||blocked||!allowed} onClick={()=>void open('reconcile')}>Reconcile existing effect</button>}
    {review&&<Modal title={effect?.status==='verified'?'Completion evidence retained':review.operation==='dispatch'?'Inspect the exact execution':'Reconcile the existing effect'} error={error} close={close} footer={<><button className={s.button} onClick={close}>Close</button>{effect?.status!=='verified'&&<button className={s.primary} disabled={busy||blocked||loading||!allowed||!fresh||(review.operation==='dispatch'&&(!preview||!confirmed||early))} onClick={()=>void execute(review.operation)}>{review.operation==='reconcile'?'Read back existing effect':preview?.mode==='email'?'Send this exact email':preview?.mode==='publication_readback'?'Read back this exact publication':preview?.mode==='preview'?'Create preview without delivery':'Create this internal document'}</button>}</>}>
      <Badge tone="purple">Frozen action · version {review.action.version}</Badge><h3 style={{marginTop:16}}>{review.action.title}</h3><p className={s.boundary} style={{marginTop:15}}>{timingDescription(review.action)}{early&&review.operation==='dispatch'?' Dispatch remains unavailable until the exact UTC start. You may inspect this preview now.':''}</p>
      {loading&&<p className={s.muted}>Loading the current execution mode and exact sender…</p>}
      {preview&&<><div className={s.boundary} style={{marginTop:15}}>{modeNames[preview.mode]}{preview.mode==='email'?' — this sends to the exact recipients shown below.':preview.mode==='publication_readback'?' — this does not publish or change the destination.':preview.mode==='preview'?' — a preview receipt is not completion evidence.':' — verified output is retained as a draft in Documents.'}</div><dl className={s.definitionList}><dt>Sender</dt><dd>{preview.sender??'No email sender'}</dd><dt>Recipients</dt><dd>{preview.recipients.join(', ')||'None'}</dd><dt>Destination</dt><dd>{preview.destination??'No external destination'}</dd><dt>Title / subject</dt><dd>{preview.title}</dd><dt>Reviewed timing</dt><dd>{timingDescription(review.action)}</dd></dl><div className={s.previewBox}><div className={s.longText}>{preview.content}</div></div><div className={s.documentMeta}>Execution fingerprint: {preview.previewHash}</div></>}
      {review.operation==='dispatch'&&preview&&<label className={s.field}><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I reviewed this exact mode, sender, recipients, destination, content and timing.</label>}
      {review.operation==='reconcile'&&<><p className={s.muted} style={{marginTop:15}}>Read-back inspects the retained effect. It does not resend, republish or create a second execution.</p><dl className={s.definitionList} style={{marginTop:15}}><dt>Action status</dt><dd>{human(current?.status??'unavailable')}</dd><dt>Retained receipt</dt><dd>{current?.providerReceipt?(review.action.kind==='internal_document'?'Exact internal artifact receipt retained':current.providerReceipt):'No receipt retained yet'}</dd></dl>{review.action.kind==='send'&&!current?.providerReceipt&&<label className={s.field}>Candidate provider receipt (optional)<input value={receipt} maxLength={200} onChange={event=>setReceipt(event.target.value)}/><small>The server must verify the provider’s exact effect identity and payload before accepting it.</small></label>}</>}
      {uncertain&&<div className={s.boundary} style={{marginTop:15}}>The response was interrupted. The outcome remains unknown; reconcile the retained effect before further execution.</div>}
      {effect&&<div className={s.previewBox} role="status"><h3>{effect.status==='verified'?'Completion verified by read-back':`Effect ${human(effect.status).toLowerCase()}`}</h3><p className={s.small}>{effect.failure?human(effect.failure):effect.status==='verified'?'Action-specific completion evidence is retained. Matter closure still checks every required task and obligation.':'Completion has not been verified.'}</p>{effect.completionArtifact&&<p className={s.small}>{data.documents.find(d=>d.id===effect.completionArtifact)?.title??'Retained completion artifact'}</p>}{effect.completionArtifact&&data.documents.some(d=>d.id===effect.completionArtifact)&&<a className={s.button} style={{marginTop:12}} href={`/api/v2/documents/${encodeURIComponent(effect.completionArtifact)}/export`}>Export the retained draft</a>}</div>}
      {!loading&&review.operation==='dispatch'&&preview&&!fresh&&<div className={s.error}>The action changed. Close this preview and inspect the current version.</div>}
    </Modal>}
  </>;
}
