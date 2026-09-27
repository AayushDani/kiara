'use client';

import type {CompanyMemoryView} from '@/v2/company-memory';
import {Badge} from './Primitives';
import s from './workspace.module.css';

import {blankVoiceChecks,interpretVoice,voiceInterpretationCurrent,type VoiceChecks,type FrozenVoiceInterpretation} from './voice-interpretation';
export {blankVoiceChecks,voiceInterpretationCurrent} from './voice-interpretation';
export type {FrozenVoiceInterpretation} from './voice-interpretation';

export function VoiceInterpretation({transcript,companyMemory,subjectId,subjectLocked=false,onSubjectChange,checks,onChecksChange,frozen,onFreeze}:{transcript:string;companyMemory?:CompanyMemoryView;subjectId:string;subjectLocked?:boolean;onSubjectChange:(id:string)=>void;checks:VoiceChecks;onChecksChange:(checks:VoiceChecks)=>void;frozen:FrozenVoiceInterpretation|null;onFreeze:(value:FrozenVoiceInterpretation)=>void}){
 const value=interpretVoice(transcript,subjectId,companyMemory),current=voiceInterpretationCurrent(frozen,transcript,subjectId,companyMemory);
 const identity=companyMemory?.entities.find(e=>e.id===subjectId);
 return <section className={s.previewBox} aria-label="Voice interpretation review" style={{maxHeight:'none'}}>
  <h3 style={{fontSize:13}}>Resolve what the transcript means</h3><p className={s.small}>Edit the transcript above. Numeric dates need an ISO date such as 2026-09-10, or a month name and year. Speech recognition can miss names and values that you must inspect.</p>
  <label className={s.field}>Company subject mentioned<select value={subjectId} disabled={subjectLocked} onChange={e=>onSubjectChange(e.target.value)}><option value="">Workspace company / no narrower subject</option>{(companyMemory?.entities??[]).map(e=><option key={e.id} value={e.id}>{e.name} · {e.kind.replaceAll('_',' ')} · {e.id.slice(-8)}</option>)}</select><small>{subjectLocked?'This conversation’s subject is fixed. Start a new conversation for another subject.':identity?`Exact declared ID: ${identity.id}. This does not prove legal existence or live practice.`:'If a named subject is absent or unclear, correct the transcript and leave this at the workspace company.'}</small></label>
  <div className={s.row}><Badge>Names</Badge><span className={s.small}>{value.names.length?value.names.map(e=>`${e.name} (${e.id.slice(-8)})`).join(' · '):'No exact declared name matched. Inspect spoken names yourself.'}</span></div>
  <div className={s.row}><Badge>Dates</Badge><span className={s.small}>{value.dates.length?value.dates.join(' · '):'No date pattern recognized. Inspect spoken dates yourself.'}</span></div>
  <div className={s.row}><Badge>Amounts</Badge><span className={s.small}>{value.amounts.length?value.amounts.join(' · '):'No amount pattern recognized. Inspect spoken amounts yourself.'}</span></div>
  {value.ambiguous.length>0&&<p className={s.error} role="alert">Correct ambiguous dates in the transcript before continuing: {value.ambiguous.join(', ')}.</p>}
  <button type="button" className={s.button} disabled={!transcript.trim()||!!value.ambiguous.length} onClick={()=>{onChecksChange(blankVoiceChecks());onFreeze({transcript,subjectId,subjectHash:value.subjectHash,names:value.names,dates:value.dates,amounts:value.amounts})}}>Freeze interpreted request</button>
  {frozen&&<p className={current?s.notice:s.error} role="status" style={{marginTop:10}}>{current?'This exact transcript, subject and recognized values are frozen for review.':'The transcript, subject or declared identity changed. Freeze and review again.'}</p>}
  {current&&<><label className={s.field}><input type="checkbox" checked={checks.names} onChange={e=>onChecksChange({...checks,names:e.target.checked})}/>I resolved every spoken name against the edited transcript and exact subject.</label><label className={s.field}><input type="checkbox" checked={checks.dates} onChange={e=>onChecksChange({...checks,dates:e.target.checked})}/>I checked displayed dates and any dates the pattern missed.</label><label className={s.field}><input type="checkbox" checked={checks.amounts} onChange={e=>onChecksChange({...checks,amounts:e.target.checked})}/>I checked displayed amounts and any amounts the pattern missed.</label></>}
  <p className={s.small}>This is a retained conversation message. Factual confirmation and external actions keep separate exact review gates.</p>
 </section>;
}
