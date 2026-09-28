import type {CompanyMemoryView} from './company-memory';

export interface VoiceName {id:string;name:string}
export interface FrozenVoiceInterpretation {transcript:string;subjectId:string;subjectHash:string;names:VoiceName[];dates:string[];amounts:string[]}
export interface VoiceInterpretationReview extends Omit<FrozenVoiceInterpretation,'transcript'> {transcriptHash:string;ambiguityResolved:true}
const unique=(values:string[])=>[...new Set(values)];
const months:Record<string,number>={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
const weekdays:Record<string,number>={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
function namedCalendarDate(value:string):Date|null {
 const parts=/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value),month=parts?months[parts[1].slice(0,3).toLowerCase()]:undefined;
 if(!parts||month===undefined)return null;
 const day=Number(parts[2]),year=Number(parts[3]),date=new Date(Date.UTC(year,month,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month&&date.getUTCDate()===day?date:null;
}

/** Shared deterministic interpretation aid. The transcript and an attributed human review remain authoritative. */
export function interpretVoice(transcript:string,subjectId:string,companyMemory?:CompanyMemoryView){
 const numeric=unique(transcript.match(/(?<![\d-])\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g)??[]);
 const iso=unique(transcript.match(/\b\d{4}-\d{2}-\d{2}\b/g)??[]);
 const named=unique(transcript.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b/gi)??[]);
 const relativeText=transcript.replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi,phrase=>{
  const parts=/^([a-z]+),?\s+(.+)$/i.exec(phrase),date=parts?namedCalendarDate(parts[2]):null;
  return date&&date.getUTCDay()===weekdays[parts![1].slice(0,3).toLowerCase()]?' '.repeat(phrase.length):phrase;
 });
 const relative=unique(relativeText.match(/\b(?:today(?!['’]s)|tomorrow|yesterday|tonight|(?:this|next|last)\s+(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day(?!\.[a-z]{2,})|week|month|quarter|year)|(?:(?:on|by|before|after)\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day(?!\.[a-z]{2,})|(?:in|within|after|before)\s+(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:(?:business|calendar)\s+)?(?:days?|weeks?|months?|quarters?|years?)|(?:(?:by|before|after)\s+)?(?:the\s+)?(?:start|end)\s+of\s+(?:the\s+)?(?:(?:this|next)\s+)?(?:week|month|quarter|year))\b/gi)??[]);
 const ambiguous=unique([...numeric,...named.filter(value=>!namedCalendarDate(value)),...iso.filter(value=>{const date=new Date(`${value}T00:00:00.000Z`);return Number.isNaN(date.valueOf())||date.toISOString().slice(0,10)!==value}),...relative]);
 const amounts=unique(transcript.match(/(?:[$€£]\s?\d[\d,.]*(?:\s?(?:million|billion|thousand|k|m))?|\b\d[\d,.]*\s?(?:dollars?|euros?|pounds?|percent|%)\b)/gi)??[]);
 const names=(companyMemory?.entities??[]).filter(e=>[e.name,...e.aliases].some(name=>name&&transcript.toLocaleLowerCase().includes(name.toLocaleLowerCase()))).map(e=>({id:e.id,name:e.name}));
 const subject=companyMemory?.entities.find(e=>e.id===subjectId);
 return {transcript,subjectId,subjectHash:subject?.entityHash??'',names,dates:unique([...iso,...named,...numeric]),amounts,ambiguous};
}

export function voiceInterpretationCurrent(frozen:FrozenVoiceInterpretation|null,transcript:string,subjectId:string,companyMemory?:CompanyMemoryView){
 if(!frozen)return false;const now=interpretVoice(transcript,subjectId,companyMemory);
 return !now.ambiguous.length&&frozen.transcript===now.transcript&&frozen.subjectId===now.subjectId&&frozen.subjectHash===now.subjectHash&&JSON.stringify(frozen.names)===JSON.stringify(now.names)&&JSON.stringify(frozen.dates)===JSON.stringify(now.dates)&&JSON.stringify(frozen.amounts)===JSON.stringify(now.amounts);
}
