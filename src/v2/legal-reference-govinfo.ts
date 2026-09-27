import {randomUUID} from 'node:crypto';
import {requireRole} from './authority';
import {retainIntakeOriginal} from './artifact-intake';
import {V2Error,type ActorContext,type LegalAuthority,type RecordBase,type Source} from './contracts';
import {assertLegalSourceReadPolicy,readSelectedLegalSource} from './legal-maintenance';
import {assertOriginalNotDeleted} from './retention';
import {digest,readWorkspace,timestamp,transactWorkspace} from './store';

/** A selected granule is a discovery aid. It is never coverage or legal clearance. */
export interface GovInfoSelection {packageId:string;granuleId:string;domain:string}
export interface GovInfoCandidate {packageId:string;granuleId:string;title:string;authorityType:'statute'|'regulation';jurisdiction:'US-federal';domain:string;dateIssued:string|null;lastModified:string|null;metadataHash:string;sourceUrl:string;officialPdfUrl:string;detailsUrl:string;status:'unreviewed_candidate'}
const idPattern=/^[A-Za-z0-9][A-Za-z0-9-]{0,119}$/;
function selected(value:GovInfoSelection){
 if(!idPattern.test(value.packageId)||!idPattern.test(value.granuleId)||!value.granuleId.startsWith(`${value.packageId}-`)||!/^USCODE-\d{4}-title\d+[a-z]?$/i.test(value.packageId)&&!/^CFR-\d{4}-title\d+-vol\d+$/i.test(value.packageId))throw new V2Error('GOVINFO_SELECTION_INVALID','Select one exact U.S. Code or annual CFR granule.',400);
 if(typeof value.domain!=='string'||!value.domain.trim()||value.domain.length>100)throw new V2Error('GOVINFO_SELECTION_INVALID','Declare a bounded legal domain for review.',400);
 return value;
}
function optionalDate(value:unknown){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return null;return new Date(value).toISOString();}
function exactApiLink(value:unknown,selection:GovInfoSelection,format:'htm'|'pdf'){
 if(typeof value!=='string')return false;
 try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='api.govinfo.gov'&&!url.username&&!url.password&&!url.hash&&url.pathname===`/packages/${selection.packageId}/granules/${selection.granuleId}/${format}`&&!url.search;}catch{return false;}
}
async function boundedJson(response:Response){
 if(!response.ok)throw new V2Error(response.status===429?'GOVINFO_RATE_LIMIT':'GOVINFO_UNAVAILABLE','GovInfo metadata is unavailable; source coverage remains unchanged.',503);
 if(!/^application\/json\b/i.test(response.headers.get('content-type')||''))throw new V2Error('GOVINFO_FORMAT','GovInfo returned an unsupported metadata format.',502);
 const size=Number(response.headers.get('content-length')||0);if(size>65536)throw new V2Error('GOVINFO_CAPACITY','GovInfo metadata exceeds the selected bound.',413);
 if(!response.body)throw new V2Error('GOVINFO_FORMAT','GovInfo returned no metadata.',502);
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let count=0;
 while(true){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;if(count>65536){await reader.cancel();throw new V2Error('GOVINFO_CAPACITY','GovInfo metadata exceeds the selected bound.',413);}parts.push(part.value);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string,unknown>;}catch{throw new V2Error('GOVINFO_FORMAT','GovInfo metadata is invalid JSON.',502);}
}
export async function inspectGovInfoGranule(selection:GovInfoSelection,options:{apiKey?:string;fetcher?:typeof fetch}={}):Promise<GovInfoCandidate>{
 selected(selection);const apiKey=options.apiKey||process.env.KIARA_GOVINFO_API_KEY;
 if(!apiKey||apiKey==='DEMO_KEY'||apiKey.length>256||/[\r\n]/.test(apiKey))throw new V2Error('GOVINFO_KEY_REQUIRED','Configure a private GovInfo API key before inspecting a source.',503);
 const endpoint=`https://api.govinfo.gov/packages/${selection.packageId}/granules/${selection.granuleId}/summary`;
 let response:Response;try{response=await (options.fetcher||fetch)(endpoint,{method:'GET',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000),headers:{'X-Api-Key':apiKey,Accept:'application/json'}});}catch{throw new V2Error('GOVINFO_UNAVAILABLE','GovInfo metadata could not be read; source coverage remains unchanged.',503);}
 const raw=await boundedJson(response),downloads=raw.download as Record<string,unknown>|undefined;
 if(raw.packageId!==selection.packageId||raw.granuleId!==selection.granuleId||typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>300||!downloads||!exactApiLink(downloads.txtLink,selection,'htm')||!exactApiLink(downloads.pdfLink,selection,'pdf'))throw new V2Error('GOVINFO_METADATA_MISMATCH','GovInfo metadata did not identify the selected granule and both review formats.',502);
 const stem=`https://www.govinfo.gov/content/pkg/${selection.packageId}`;
 return {packageId:selection.packageId,granuleId:selection.granuleId,title:raw.title.trim(),authorityType:selection.packageId.startsWith('USCODE-')?'statute':'regulation',jurisdiction:'US-federal',domain:selection.domain.trim(),dateIssued:optionalDate(raw.dateIssued),lastModified:optionalDate(raw.lastModified),metadataHash:digest(raw),sourceUrl:`${stem}/html/${selection.granuleId}.htm`,officialPdfUrl:`${stem}/pdf/${selection.granuleId}.pdf`,detailsUrl:`https://www.govinfo.gov/app/details/${selection.packageId}/${selection.granuleId}`,status:'unreviewed_candidate'};
}

type ReadOptions={apiKey?:string;metadataFetcher?:typeof fetch;sourceFetcher?:typeof fetch};
async function selectedRead(actor:ActorContext,selection:GovInfoSelection,options:ReadOptions){
 requireRole(await readWorkspace(actor.tenantId),actor,'legal_reviewer');
 selected(selection);assertLegalSourceReadPolicy(actor.tenantId,`https://www.govinfo.gov/content/pkg/${selection.packageId}/html/${selection.granuleId}.htm`);
 const candidate=await inspectGovInfoGranule(selection,{apiKey:options.apiKey,fetcher:options.metadataFetcher});
 const read=await readSelectedLegalSource(actor.tenantId,candidate.sourceUrl,options.sourceFetcher);
 requireRole(await readWorkspace(actor.tenantId),actor,'legal_reviewer');
 return {candidate,read,previewHash:digest({candidate,rawHash:read.rawHash})};
}
/** Exact preview is read-only and contains the full extracted rendition for a qualified reviewer to inspect. */
export async function previewGovInfoGranule(actor:ActorContext,selection:GovInfoSelection,options:ReadOptions={}){
 const {candidate,read,previewHash}=await selectedRead(actor,selection,options);
 return {candidate,text:read.text,rawHash:read.rawHash,bytes:read.bytes.byteLength,previewHash};
}
/** Stage only the exact reviewed selection; never promote it to coverage or legal clearance. */
export async function stageGovInfoGranule(actor:ActorContext,selection:GovInfoSelection,options:ReadOptions&{expectedPreviewHash:string}){
 if(!/^[a-f0-9]{64}$/.test(options.expectedPreviewHash))throw new V2Error('GOVINFO_PREVIEW_REQUIRED','Inspect the exact source and official PDF before staging.',400);
 const {candidate,read,previewHash}=await selectedRead(actor,selection,options);
 if(previewHash!==options.expectedPreviewHash)throw new V2Error('GOVINFO_PREVIEW_CHANGED','The selected source or metadata changed after preview. Inspect again before staging.',409);
 const before=await readWorkspace(actor.tenantId);requireRole(before,actor,'legal_reviewer');
 const intakeKey=`govinfo:${candidate.packageId}:${candidate.granuleId}:${read.rawHash}`;
 const original=await retainIntakeOriginal(actor,intakeKey,read.bytes,before.version);
 return (await transactWorkspace(actor.tenantId,s=>{
  requireRole(s,actor,'legal_reviewer');if(s.version!==original.expectedVersion)throw new V2Error('VERSION_CONFLICT','Workspace changed during source intake. Inspect and retry the same exact selection.');
  assertLegalSourceReadPolicy(s.tenantId,candidate.sourceUrl);
  const reference=JSON.stringify(original.reference);assertOriginalNotDeleted(s,reference,digest({actor:actor.actorId,key:intakeKey}));
  const existing=s.sources.find(x=>x.kind==='legal'&&x.externalId===`${candidate.packageId}/${candidate.granuleId}`&&x.status==='active');
  if(existing)throw new V2Error('GOVINFO_ALREADY_REGISTERED','This authority already has a selected version. Use its change and applicability review workflow.',409);
  const now=timestamp(),scope={kind:'team' as const,actorIds:[] as string[]};
  const base=():RecordBase=>({id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(scope),provenance:{actorId:actor.actorId,sourceIds:[],description:'GovInfo API metadata and selected official publication rendition; legal applicability unreviewed.'}});
  const source:Source={...base(),title:candidate.title,kind:'legal',externalId:`${candidate.packageId}/${candidate.granuleId}`,externalRevision:candidate.lastModified||candidate.metadataHash,text:read.text,contentHash:digest(read.text),url:candidate.sourceUrl,status:'active',aclVersion:1,observedAt:now,effectiveAt:null,authority:'unknown',originalObjectRef:reference};
  const authority:LegalAuthority={...base(),title:candidate.title,sourceUrl:candidate.sourceUrl,jurisdiction:candidate.jurisdiction,domain:candidate.domain,authorityType:candidate.authorityType,publishedAt:candidate.dateIssued,effectiveFrom:null,effectiveUntil:null,verifiedAt:null,reviewOwnerId:null,sourceId:source.id};authority.provenance.sourceIds=[source.id];
  s.sources.push(source);s.legalAuthorities.push(authority);
  s.events.push({...base(),type:'legal.source.staged',title:'Official source staged for review',detail:`${candidate.packageId}/${candidate.granuleId}; official PDF ${candidate.officialPdfUrl}; metadata ${candidate.metadataHash}. Publication and applicability are unverified.`,matterId:null,recordId:authority.id,measurement:s.rehearsal?'fictional_rehearsal':'observed'});
  return {sourceId:source.id,authorityId:authority.id,sourceHash:source.contentHash,rawHash:read.rawHash,metadataHash:candidate.metadataHash,officialPdfUrl:candidate.officialPdfUrl,status:'pending_reviewer_verification' as const};
 })).result;
}
