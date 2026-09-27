'use client';

import {useEffect,useRef,useState} from 'react';
import {Icon} from './Primitives';
import s from './workspace.module.css';

interface RecognitionResult {isFinal:boolean;[index:number]:{transcript:string}}
interface RecognitionEvent {resultIndex:number;results:{length:number;[index:number]:RecognitionResult}}
interface Recognition {continuous:boolean;interimResults:boolean;lang:string;onresult:((event:RecognitionEvent)=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void}
type RecognitionConstructor=new()=>Recognition;
type SpeechWindow=Window&{SpeechRecognition?:RecognitionConstructor;webkitSpeechRecognition?:RecognitionConstructor};

/** Browser speech is opt-in; only an edited, explicitly confirmed transcript enters the workspace. */
export function VoiceCapture({value,onChange,onListeningChange}:{value:string;onChange:(text:string)=>void;onListeningChange:(listening:boolean)=>void}){
  const [available,setAvailable]=useState<boolean|null>(null),[listening,setListening]=useState(false),[consent,setConsent]=useState(false),[error,setError]=useState(''),[interim,setInterim]=useState('');
  const recognition=useRef<Recognition|null>(null),transcript=useRef(value),change=useRef(onChange),listeningChange=useRef(onListeningChange),mounted=useRef(false);
  useEffect(()=>{transcript.current=value;change.current=onChange;listeningChange.current=onListeningChange},[value,onChange,onListeningChange]);
  useEffect(()=>{mounted.current=true;const scope=window as SpeechWindow;setAvailable(!!(scope.SpeechRecognition||scope.webkitSpeechRecognition));return()=>{mounted.current=false;recognition.current?.abort();recognition.current=null;listeningChange.current(false)}},[]);
  function start(){
    const Constructor=(window as SpeechWindow).SpeechRecognition||(window as SpeechWindow).webkitSpeechRecognition;if(!Constructor||!consent||listening)return;
    setError('');setInterim('');const session=new Constructor();recognition.current=session;session.continuous=false;session.interimResults=true;session.lang=document.documentElement.lang||'en-US';
    session.onresult=event=>{if(!mounted.current)return;let final='',draft='';for(let i=event.resultIndex;i<event.results.length;i++){const result=event.results[i];if(result.isFinal)final+=`${result[0].transcript} `;else draft+=result[0].transcript}if(final){transcript.current=`${transcript.current.trim()} ${final.trim()}`.trim();change.current(transcript.current)}setInterim(draft)};
    session.onerror=event=>{if(mounted.current)setError(event.error==='not-allowed'?'Microphone or speech permission was denied. You can paste and review a transcript below.':event.error==='no-speech'?'No speech was recognized. Try again or type the transcript.':`Speech recognition stopped (${event.error}). Review any captured text before submitting.`)};
    session.onend=()=>{if(mounted.current){setListening(false);setInterim('');listeningChange.current(false)}recognition.current=null};
    try{session.start();setListening(true);listeningChange.current(true)}catch{setError('Speech recognition could not start. Paste a transcript or use your device’s dictation.');recognition.current=null;setListening(false);listeningChange.current(false)}
  }
  return <div className={s.previewBox} style={{maxHeight:'none'}}>
    <h3 style={{fontSize:13}}>Speak, then review.</h3>
    {available===null?<p className={s.small}>Checking browser speech support…</p>:available?<>
      <p className={s.small} style={{marginTop:9}}>Your browser may process audio using its speech service. Kiara retains only the transcript you explicitly confirm and send. No recording starts automatically.</p>
      <label className={s.field}><input type="checkbox" checked={consent} disabled={listening} onChange={event=>setConsent(event.target.checked)}/>I choose to use this browser’s microphone and speech service.</label>
      <div className={s.row}><button type="button" className={s.button} disabled={!consent||listening} onClick={start}><Icon name="mic" size={14}/>Start microphone</button>{listening&&<button type="button" className={s.button} onClick={()=>recognition.current?.stop()}>Stop listening</button>}</div>
      <p className={s.small} role="status" style={{marginTop:9}}>{listening?'Listening — stop before confirming the transcript.':'Microphone idle. You can edit every word below.'}</p>
      {interim&&<p className={s.longText} aria-live="polite">{interim}</p>}
    </>:<p className={s.small} style={{marginTop:9}}>Speech recognition is unavailable in this browser. Paste a transcript or use your device’s dictation, then review it below.</p>}
    {error&&<p className={s.error} role="alert" style={{marginTop:10}}>{error}</p>}
  </div>;
}
