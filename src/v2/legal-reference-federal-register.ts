import {V2Error} from './contracts';

const endpoint='https://www.federalregister.gov/api/v1/documents.json';
const maxBytes=512_000;
const maxResults=10;

export interface FederalRegisterDiscovery {
 title:number;
 part:number;
 sourceUrl:string;
 totalCount:number;
 returnedCount:number;
 moreResults:boolean;
 status:'unreviewed_discovery';
 documents:Array<{
  documentNumber:string;
  title:string;
  type:string;
  publicationDate:string;
  federalRegisterUrl:string;
  officialPdfUrl:string;
 }>;
}

const validDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const officialPdf=(value:unknown):value is string=>{
 if(typeof value!=='string')return false;
 try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.govinfo.gov'&&!url.username&&!url.password&&!url.port&&/^\/content\/pkg\/FR-\d{4}-\d{2}-\d{2}\/pdf\/[\w-]+\.pdf$/.test(url.pathname)&&!url.search&&!url.hash;}
 catch{return false;}
};
const federalRegisterDocument=(value:unknown):value is string=>{
 if(typeof value!=='string')return false;
 try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.federalregister.gov'&&!url.username&&!url.password&&!url.port&&/^\/documents\/\d{4}\/\d{2}\/\d{2}\/[\w-]+\/[\w-]+$/.test(url.pathname)&&!url.search&&!url.hash;}
 catch{return false;}
};

/** A first-page research lead only. It does not establish current law or stage an authority. */
export async function discoverFederalRegisterCfrPart(title:number,part:number,fetcher:typeof fetch=fetch):Promise<FederalRegisterDiscovery>{
 if(!Number.isInteger(title)||title<1||title>50||!Number.isInteger(part)||part<1||part>9999)throw new V2Error('FR_CFR_SELECTION_REQUIRED','Select an exact CFR title from 1 through 50 and part from 1 through 9999.',400);
 const url=new URL(endpoint);
 url.searchParams.set('conditions[cfr][title]',String(title));
 url.searchParams.set('conditions[cfr][part]',String(part));
 url.searchParams.set('per_page',String(maxResults));
 url.searchParams.set('order','newest');
 let response:Response;
 try{response=await fetcher(url.toString(),{method:'GET',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});}
 catch{throw new V2Error('FR_UNAVAILABLE','Federal Register discovery could not be read.',503);}
 if(!response.ok)throw new V2Error(response.status===429?'FR_RATE_LIMIT':'FR_UNAVAILABLE','Federal Register discovery is unavailable.',503);
 if(!/^application\/json\b/i.test(response.headers.get('content-type')||'')||!response.body)throw new V2Error('FR_METADATA_FORMAT','Federal Register returned an unsupported response format.',502);
 const declared=Number(response.headers.get('content-length')||0);
 if(declared>maxBytes)throw new V2Error('FR_CAPACITY','Federal Register results exceed the selected bound.',413);
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes){await reader.cancel();throw new V2Error('FR_CAPACITY','Federal Register results exceed the selected bound.',413);}parts.push(chunk.value);}
 let raw:unknown;try{raw=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new V2Error('FR_METADATA_FORMAT','Federal Register results are invalid JSON.',502);}
 if(!object(raw)||!Number.isSafeInteger(raw.count)||Number(raw.count)<0||!Array.isArray(raw.results)||raw.results.length>maxResults||raw.results.length>Number(raw.count))throw new V2Error('FR_METADATA_FORMAT','Federal Register result metadata is incomplete.',502);
 const documents=raw.results.map((item:unknown)=>{
  if(!object(item)||typeof item.document_number!=='string'||!/^\d{4}-\d{5}$/.test(item.document_number)||typeof item.title!=='string'||!item.title.trim()||item.title.length>500||typeof item.type!=='string'||!['Rule','Proposed Rule','Notice','Presidential Document'].includes(item.type)||!validDate(item.publication_date)||!federalRegisterDocument(item.html_url)||!officialPdf(item.pdf_url))throw new V2Error('FR_METADATA_FORMAT','Federal Register document metadata is incomplete.',502);
  const officialPdfUrl=new URL(item.pdf_url);
  const federalRegisterUrl=new URL(item.html_url);
  const [year,month,day]=item.publication_date.split('-');
  if(officialPdfUrl.pathname!==`/content/pkg/FR-${item.publication_date}/pdf/${item.document_number}.pdf`||!federalRegisterUrl.pathname.startsWith(`/documents/${year}/${month}/${day}/${item.document_number}/`))throw new V2Error('FR_METADATA_FORMAT','Federal Register document links do not match their metadata.',502);
  return {documentNumber:item.document_number,title:item.title.trim(),type:item.type,publicationDate:item.publication_date,federalRegisterUrl:item.html_url,officialPdfUrl:item.pdf_url};
 });
 return {title,part,sourceUrl:url.toString(),totalCount:Number(raw.count),returnedCount:documents.length,moreResults:Number(raw.count)>documents.length,status:'unreviewed_discovery',documents};
}
