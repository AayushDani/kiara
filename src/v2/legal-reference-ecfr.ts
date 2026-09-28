import {V2Error} from './contracts';

export interface EcfrTitleCurrentness {
 title:number;name:string;latestAmendedOn:string|null;latestIssueDate:string|null;
 upToDateAsOf:string;catalogDate:string;importInProgress:boolean;
 sourceUrl:'https://www.ecfr.gov/api/versioner/v1/titles.json';
 status:'unreviewed_discovery';
}
const sourceUrl='https://www.ecfr.gov/api/versioner/v1/titles.json' as const;
const maxBytes=128_000;
const date=(value:unknown,nullable=false):string|null=>{
 if(nullable&&value===null)return null;
 if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new V2Error('ECFR_METADATA_FORMAT','eCFR title dates are unavailable or invalid.',502);
 return value;
};

/** Title-level change signal only; it never stages legal authority or certifies applicability. */
export async function inspectEcfrTitleCurrentness(title:number,fetcher:typeof fetch=fetch):Promise<EcfrTitleCurrentness>{
 if(!Number.isInteger(title)||title<1||title>50)throw new V2Error('ECFR_TITLE_REQUIRED','Select an exact CFR title from 1 through 50.',400);
 let response:Response;
 try{response=await fetcher(sourceUrl,{method:'GET',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});}
 catch{throw new V2Error('ECFR_UNAVAILABLE','The eCFR currentness catalog could not be read.',503);}
 if(!response.ok)throw new V2Error(response.status===429?'ECFR_RATE_LIMIT':'ECFR_UNAVAILABLE','The eCFR currentness catalog is unavailable.',503);
 if(!/^application\/json\b/i.test(response.headers.get('content-type')||'')||!response.body)throw new V2Error('ECFR_METADATA_FORMAT','eCFR returned an unsupported catalog format.',502);
 const declared=Number(response.headers.get('content-length')||0);
 if(declared>maxBytes)throw new V2Error('ECFR_CAPACITY','eCFR catalog exceeds the selected bound.',413);
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let count=0;
 while(true){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;if(count>maxBytes){await reader.cancel();throw new V2Error('ECFR_CAPACITY','eCFR catalog exceeds the selected bound.',413);}parts.push(part.value);}
 let raw:unknown;try{raw=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new V2Error('ECFR_METADATA_FORMAT','eCFR catalog is invalid JSON.',502);}
 if(!raw||typeof raw!=='object')throw new V2Error('ECFR_METADATA_FORMAT','eCFR catalog is invalid.',502);
 const catalog=raw as {titles?:unknown;meta?:unknown},meta=catalog.meta as {date?:unknown;import_in_progress?:unknown}|undefined;
 if(!Array.isArray(catalog.titles)||catalog.titles.length<1||catalog.titles.length>60||!meta||typeof meta.import_in_progress!=='boolean')throw new V2Error('ECFR_METADATA_FORMAT','eCFR catalog metadata is incomplete.',502);
 const matches=catalog.titles.filter(item=>item&&typeof item==='object'&&(item as {number?:unknown}).number===title);
 if(matches.length!==1)throw new V2Error('ECFR_TITLE_UNAVAILABLE','The selected CFR title is unavailable in the catalog.',404);
 const selected=matches[0] as {name?:unknown;reserved?:unknown;latest_amended_on?:unknown;latest_issue_date?:unknown;up_to_date_as_of?:unknown};
 if(selected.reserved!==false||typeof selected.name!=='string'||!selected.name.trim()||selected.name.length>200)throw new V2Error('ECFR_TITLE_UNAVAILABLE','The selected CFR title is reserved or unavailable.',404);
 return {title,name:selected.name.trim(),latestAmendedOn:date(selected.latest_amended_on,true),latestIssueDate:date(selected.latest_issue_date,true),upToDateAsOf:date(selected.up_to_date_as_of)!,catalogDate:date(meta.date)!,importInProgress:meta.import_in_progress,sourceUrl,status:'unreviewed_discovery'};
}
