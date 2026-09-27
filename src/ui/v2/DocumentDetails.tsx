'use client';

import {useEffect,useState} from 'react';
import type {CommandResult,DocumentRecord,WorkspaceCommand,WorkspaceSnapshot} from '@/v2/contracts';
import type {TextChange} from '@/v2/document-lifecycle';
import {Badge,Icon,human} from './Primitives';
import {Modal} from './ReviewDialog';
import s from './workspace.module.css';

export function DocumentDetails({document:doc,data,close,onRevision,onCompare,onAmend,onReimport,onTemplate,onExplain}:{document:DocumentRecord;data:WorkspaceSnapshot;close:()=>void;onRevision:(doc:DocumentRecord)=>void;onCompare:(before:DocumentRecord,after:DocumentRecord)=>void;onAmend:()=>void;onReimport:()=>void;onTemplate:()=>void;onExplain:()=>void}){
 const original=data.sources.find(source=>source.id===doc.sourceId)?.originalObjectRef;
 const revisions=data.documents.filter(record=>record.documentId===doc.documentId).sort((a,b)=>b.revision-a.revision);
 const parent=data.documents.find(record=>record.id===doc.parentRevisionId);
 const executed=['executed','effective'].includes(doc.authority),head=(data.documentHeadIds??[]).includes(doc.id);
 return <Modal title={doc.title} close={close} footer={<><a className={s.button} href={`/api/v2/documents/${encodeURIComponent(doc.id)}/export`}><Icon name="download" size={13}/>Export Word</a><button className={s.primary} onClick={onExplain}>Explain this document</button></>}>
 <div className={s.row}><Badge>{doc.authority==='executed'?'Marked executed':human(doc.authority)}</Badge><Badge>Revision {doc.revision}</Badge><Badge>{head?'Current revision':'Historical revision'}</Badge></div>
 {executed&&<p className={s.boundary} style={{marginTop:15}}>This record is marked {doc.authority} by its contributor. Changed terms require a separate amendment or replacement; this retained text does not verify a signature.</p>}
 {doc.amendsDocumentId&&<p className={s.small} style={{marginTop:15}}>Amends retained agreement: {data.documents.find(record=>record.documentId===doc.amendsDocumentId)?.title??'Original outside current access'}. This separate draft does not modify the executed record.</p>}
 <div className={s.row} style={{marginTop:18}}>{executed?<button className={s.button} onClick={onAmend}>Create proposed amendment</button>:<button className={s.button} disabled={!head} onClick={onReimport}>Import a returned draft</button>}{(doc.authority==='template'||doc.kind==='template')&&<button className={s.button} disabled={!head} onClick={onTemplate}>Create a draft from template</button>}{parent&&<button className={s.button} onClick={()=>onCompare(parent,doc)}>Compare with revision {parent.revision}</button>}{original&&<a className={s.button} href={`/api/v2/documents/${encodeURIComponent(doc.id)}/original`}>Download retained original</a>}</div>
 <p className={s.small} style={{marginTop:12}}>Word export contains the retained text. Inspect the original for formatting, comments, tracked changes and signatures.</p>
 {revisions.length>1&&<label className={s.field}>Retained revision history<select value={doc.id} onChange={event=>{const revision=revisions.find(record=>record.id===event.target.value);if(revision)onRevision(revision)}}>{revisions.map(record=><option value={record.id} key={record.id}>Revision {record.revision} · {human(record.authority)}</option>)}</select></label>}
 <div className={s.documentBody}>{doc.body}</div><div className={s.documentMeta}>Content fingerprint: {doc.contentHash}</div>
 </Modal>;
}

export function TemplateDraftDialog({document:doc,data,busy,error,pending,submit,retryPending,close}:{document:DocumentRecord;data:WorkspaceSnapshot;busy:boolean;error:string;pending:boolean;submit:(command:WorkspaceCommand)=>Promise<CommandResult|null>;retryPending:()=>Promise<CommandResult|null>;close:()=>void}){
 const [title,setTitle]=useState(`Draft · ${doc.title}`),[values,setValues]=useState<Record<string,string>>({}),[confirmed,setConfirmed]=useState(false);
 const fields=[...new Set([...doc.body.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g)].map(match=>match[1]))];
 const valid=!!title.trim()&&fields.every(field=>!!values[field]?.trim());
 const current=data.documents.find(record=>record.id===doc.id),fresh=current?.contentHash===doc.contentHash&&(data.documentHeadIds??[]).includes(doc.id);
 const preview=doc.body.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g,(full,field:string)=>values[field]?.trim()||full);
 return <Modal title="Create a proposed draft from this template" close={close} error={error} footer={pending?<button className={s.primary} disabled={busy} onClick={async()=>{if(await retryPending())close()}}>Check saved draft</button>:<button className={s.primary} disabled={busy||!fresh||!valid||!confirmed} onClick={async()=>{if(await submit({type:'document.from_template',templateRevisionId:doc.id,expectedContentHash:doc.contentHash,title,values}))close()}}>Create this separate draft</button>}>
 <Badge tone="purple">Template revision {doc.revision}</Badge><p className={s.muted}>{doc.title}</p><p className={s.small}>Only the named fields below are substituted. The new document remains a draft, with the template’s access scope. It does not change company facts or carry permission to execute.</p>
 <label className={s.field}>Draft title<input maxLength={300} value={title} onChange={event=>{setTitle(event.target.value);setConfirmed(false)}}/></label>
 {fields.map(field=><label className={s.field} key={field}>{field}<textarea value={values[field]??''} maxLength={10000} onChange={event=>{setValues(old=>({...old,[field]:event.target.value}));setConfirmed(false)}}/></label>)}
 {!fields.length&&<p className={s.small}>This template has no named substitution fields. It will be copied as a separate proposed draft.</p>}
 <h3 style={{marginTop:20}}>Exact draft preview</h3><div className={s.previewBox}><div className={s.longText}>{preview}</div></div><label className={s.field}><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I reviewed these exact substitutions and the complete proposed draft.</label>{!fresh&&<p className={s.error}>The template changed. Close this view and inspect the current revision.</p>}
 </Modal>;
}

interface Comparison {before:{id:string;hash:string;revision:number};after:{id:string;hash:string;revision:number};changes:TextChange[];granularity:'paragraph'|'whole_document';limitation:string}
export function DocumentComparison({before,after,close}:{before:DocumentRecord;after:DocumentRecord;close:()=>void}){
 const [comparison,setComparison]=useState<Comparison|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setComparison(null);setError('');void(async()=>{try{const response=await fetch(`/api/v2/documents/${encodeURIComponent(after.id)}/compare?base=${encodeURIComponent(before.id)}`,{cache:'no-store',signal:controller.signal});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'These revisions are unavailable.');if(result.before.id!==before.id||result.after.id!==after.id||result.before.hash!==before.contentHash||result.after.hash!==after.contentHash)throw new Error('The compared records changed. Inspect their current revisions.');setComparison(result)}catch(failure){if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Comparison unavailable.')}})();return()=>controller.abort()},[before,after]);
 return <Modal title={`Compare revisions ${before.revision} and ${after.revision}`} close={close} error={error} footer={<button className={s.button} onClick={close}>Close comparison</button>}><p>{after.title}</p>{comparison?<><p className={s.boundary} style={{marginTop:15}}>{comparison.limitation}</p><div className={s.row} style={{marginTop:15}}><Badge tone="red">Removed</Badge><Badge tone="green">Added</Badge><Badge>{comparison.granularity==='paragraph'?'Paragraph comparison':'Whole-document comparison'}</Badge></div><div className={s.previewBox} style={{maxHeight:'none'}}>{comparison.changes.map((change,index)=><div key={index} className={s.longText} style={{padding:'6px 8px',margin:'3px 0',borderLeft:`3px solid ${change.kind==='added'?'#518168':change.kind==='removed'?'#ae5755':'transparent'}`,background:change.kind==='added'?'#eff7f0':change.kind==='removed'?'#fff0ed':undefined}}>{change.kind!=='unchanged'&&<strong className={s.small}>{human(change.kind)}: </strong>}{change.text||' '}</div>)}</div></>:!error&&<p role="status" className={s.muted}>Comparing the exact retained text…</p>}</Modal>;
}
