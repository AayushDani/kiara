'use client';
import {useEffect,useState} from 'react';
import type {GovInfoCandidate} from '@/v2/legal-reference-govinfo';
import type {WorkspaceSnapshot} from '@/v2/contracts';
import {Modal} from './ReviewDialog';
import s from './workspace.module.css';

type Preview={candidate:GovInfoCandidate;text:string;rawHash:string;bytes:number;previewHash:string};
type Selection={packageId:string;granuleId:string;domain:string};
type Props={actorId:string;tenantId:string;legalReviewer:boolean;csrf:string;busy:boolean;pending:boolean;refresh:()=>Promise<WorkspaceSnapshot>};
const empty:Selection={packageId:'',granuleId:'',domain:''};

/** Official-source intake remains unverified until a separate named source and coverage review. */
export function GovInfoReviewPanel({actorId,tenantId,legalReviewer,csrf,busy,pending,refresh}:Props){
 const [open,setOpen]=useState(false),[selection,setSelection]=useState<Selection>(empty),[preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{setOpen(false);setPreview(null);setConfirmed(false);setSelection(empty);setError('');setNotice('')},[actorId,tenantId]);
 const close=()=>{if(working)return;setOpen(false);setPreview(null);setConfirmed(false);setError('')};
 const change=(key:keyof Selection,value:string)=>{setSelection(previous=>({...previous,[key]:value}));setPreview(null);setConfirmed(false);setError('');setNotice('')};
 async function request(operation:'preview'|'stage'){
  if(working||busy||pending||!legalReviewer||!csrf||!selection.packageId.trim()||!selection.granuleId.trim()||!selection.domain.trim()||operation==='stage'&&(!preview||!confirmed))return;
  setWorking(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/v2/legal/govinfo',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({operation,...selection,...(operation==='stage'?{expectedPreviewHash:preview!.previewHash}:{})})});
   const payload=await response.json();
   if(!response.ok)throw new Error(payload.error?.message??'The selected GovInfo source could not be read.');
   if(operation==='preview'){setPreview(payload.preview as Preview);setConfirmed(false);return;}
   setPreview(null);setConfirmed(false);setOpen(false);setNotice('Source staged for named verification. No legal coverage or conclusion was approved.');
   await refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:'The source request did not complete. Inspect the registry before retrying a stage request.');if(operation==='stage'){setPreview(null);setConfirmed(false);try{await refresh()}catch{/* Keep the intake error visible. */}}}
  finally{setWorking(false)}
 }
 return <div className={s.card}>
  <h2>Official federal source intake</h2><p>Select one exact U.S. Code or annual CFR granule. A tenant source policy and private GovInfo key are required. Staging preserves an unverified source for later legal review.</p>
  <button className={s.button} disabled={!legalReviewer||busy||pending||working} onClick={()=>{setOpen(true);setError('');setNotice('')}}>Inspect GovInfo granule</button>
  {!legalReviewer&&<p className={s.small}>A provisioned legal reviewer must inspect and stage official source bytes.</p>}
  {notice&&<p role="status" className={s.small}>{notice}</p>}
  {!open&&error&&<p role="alert" className={s.error}>{error}</p>}
  {open&&<Modal title="Inspect exact GovInfo source" close={close} error={error} footer={<button className={s.primary} disabled={working||busy||pending||!legalReviewer||!csrf||!selection.packageId.trim()||!selection.granuleId.trim()||!selection.domain.trim()||!!preview&&!confirmed} onClick={()=>void request(preview?'stage':'preview')}>{working?'Reading selected source…':preview?'Stage this exact unverified source':'Preview selected source'}</button>}>
   <p className={s.small}>Enter IDs chosen by the content owner under the configured exact URL policy. Preview makes no workspace change; stage re-reads and rejects changed bytes or metadata.</p>
   <label className={s.field}>Package ID<input value={selection.packageId} onChange={event=>change('packageId',event.target.value)} maxLength={120} placeholder="USCODE-2024-title17 or CFR-2025-title17-vol1"/></label>
   <label className={s.field}>Granule ID<input value={selection.granuleId} onChange={event=>change('granuleId',event.target.value)} maxLength={120} placeholder="Exact granule ID from GovInfo"/></label>
   <label className={s.field}>Bounded legal domain<input value={selection.domain} onChange={event=>change('domain',event.target.value)} maxLength={100} placeholder="e.g. federal copyright"/></label>
   {preview&&<div className={s.previewBox}>
    <h3>{preview.candidate.title}</h3><p>{preview.candidate.jurisdiction} · {preview.candidate.domain} · {preview.candidate.authorityType}</p>
    <p className={s.small}>Issued {preview.candidate.dateIssued??'Unknown'} · Metadata last modified {preview.candidate.lastModified??'Unknown'} · {preview.bytes} retained bytes</p>
    <p><a href={preview.candidate.sourceUrl} target="_blank" rel="noreferrer">Open selected HTML/XML rendition</a> · <a href={preview.candidate.officialPdfUrl} target="_blank" rel="noreferrer">Open official PDF for comparison</a> · <a href={preview.candidate.detailsUrl} target="_blank" rel="noreferrer">Open GovInfo details</a></p>
    <p className={s.documentMeta}>Raw SHA-256: {preview.rawHash}<br/>Metadata fingerprint: {preview.candidate.metadataHash}<br/>Exact preview fingerprint: {preview.previewHash}</p>
    <details open><summary>Full extracted rendition for inspection</summary><div className={s.longText}>{preview.text}</div></details>
    <p className={s.small}>Compare the official PDF, later amendments, effective dates, applicability and content rights. Staging alone grants no coverage, legal conclusion or counsel engagement.</p>
    <label className={s.field}><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I inspected this exact preview and the linked official PDF; I understand a separate qualified source and coverage review is required.</label>
   </div>}
  </Modal>}
 </div>;
}
