import type {CompanyMemoryView} from './company-memory';

export interface VoiceName {id:string;name:string}
export interface FrozenVoiceInterpretation {transcript:string;subjectId:string;subjectHash:string;names:VoiceName[];dates:string[];amounts:string[]}
export interface VoiceInterpretationReview extends Omit<FrozenVoiceInterpretation,'transcript'> {transcriptHash:string;ambiguityResolved:true}
const unique=(values:string[])=>[...new Set(values)];

/** Shared deterministic interpretation aid. The transcript and an attributed human review remain authoritative. */
export function interpretVoice(transcript:string,subjectId:string,companyMemory?:CompanyMemoryView){
 const numeric=unique(transcript.match(/(?<![\d-])\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g)??[]);
 const iso=unique(transcript.match(/\b\d{4}-\d{2}-\d{2}\b/g)??[]);
 const named=unique(transcript.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b/gi)??[]);
 const ambiguous=unique([...numeric,...named.filter(value=>!/(?:^|\s)\d{4}$/.test(value.replace(',',''))),...iso.filter(value=>{const date=new Date(`${value}T00:00:00.000Z`);return Number.isNaN(date.valueOf())||date.toISOString().slice(0,10)!==value})]);
 const amounts=unique(transcript.match(/(?:[$€£]\s?\d[\d,.]*(?:\s?(?:million|billion|thousand|k|m))?|\b\d[\d,.]*\s?(?:dollars?|euros?|pounds?|percent|%)\b)/gi)??[]);
 const names=(companyMemory?.entities??[]).filter(e=>[e.name,...e.aliases].some(name=>name&&transcript.toLocaleLowerCase().includes(name.toLocaleLowerCase()))).map(e=>({id:e.id,name:e.name}));
 const subject=companyMemory?.entities.find(e=>e.id===subjectId);
 return {transcript,subjectId,subjectHash:subject?.entityHash??'',names,dates:unique([...iso,...named,...numeric]),amounts,ambiguous};
}

export function voiceInterpretationCurrent(frozen:FrozenVoiceInterpretation|null,transcript:string,subjectId:string,companyMemory?:CompanyMemoryView){
 if(!frozen)return false;const now=interpretVoice(transcript,subjectId,companyMemory);
 return !now.ambiguous.length&&frozen.transcript===now.transcript&&frozen.subjectId===now.subjectId&&frozen.subjectHash===now.subjectHash&&JSON.stringify(frozen.names)===JSON.stringify(now.names)&&JSON.stringify(frozen.dates)===JSON.stringify(now.dates)&&JSON.stringify(frozen.amounts)===JSON.stringify(now.amounts);
}
