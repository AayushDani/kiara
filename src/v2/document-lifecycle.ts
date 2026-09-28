import {randomUUID} from 'node:crypto';
import {readRecord,requireRole} from './authority';
import {V2Error,type ActorContext,type DocumentRecord,type RecordBase,type Source,type WorkspaceState} from './contracts';
import {digest,timestamp} from './store';
import {resetReviewTasks} from './tasks';

export type DocumentCommand=
 | {type:'document.from_template';templateRevisionId:string;expectedContentHash:string;title:string;values:Record<string,string>}
 | {type:'document.reimport';baseRevisionId:string;expectedContentHash:string;body:string;note:string};
export const documentCommandFields:Record<DocumentCommand['type'],string[]>={
 'document.from_template':['templateRevisionId','expectedContentHash','title','values'],
 'document.reimport':['baseRevisionId','expectedContentHash','body','note'],
};
function ensure(v:unknown,code:string,message:string):asserts v {if(!v)throw new V2Error(code,message);}
function text(v:unknown,label:string,max:number){ensure(typeof v==='string'&&v.trim()&&v.length<=max,'INVALID_INPUT',`Provide ${label} (up to ${max} characters).`);return v.trim();}
function touch(r:RecordBase){r.version++;r.updatedAt=timestamp();}
/** Revision history is immutable. Current heads are derived from the full authorized lineage. */
export function documentHeads(records:DocumentRecord[]):DocumentRecord[]{const parents=new Set(records.map(d=>d.parentRevisionId).filter(Boolean));return records.filter(d=>!parents.has(d.id)&&d.status!=='superseded');}
export function templateFields(body:string){return [...new Set([...body.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g)].map(x=>x[1]))];}
export function applyDocumentCommand(s:WorkspaceState,a:ActorContext,c:DocumentCommand,trusted?:{originalObjectRef?:string}):Record<string,unknown>{
 requireRole(s,a,'member');const baseline=readRecord(s,a,s.documents,c.type==='document.from_template'?c.templateRevisionId:c.baseRevisionId);
 ensure(baseline.contentHash===c.expectedContentHash&&documentHeads(s.documents).some(d=>d.id===baseline.id),'DOCUMENT_BASE_CHANGED','Inspect the current source revision before creating a successor.');
 const base=(sources:string[]):RecordBase=>({id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:structuredClone(baseline.scope),provenance:{actorId:a.actorId,sourceIds:sources,description:'Controlled draft; no signature, effectiveness or approval inferred'}});
 let body:string,title:string,documentId:string,revision:number,parentRevisionId:string|null,kind:DocumentRecord['kind'],amendsDocumentId:string|null;
 if(c.type==='document.from_template'){
  ensure(baseline.authority==='template'||baseline.kind==='template','TEMPLATE_REQUIRED','Select a designated template.');
  ensure(c.values&&typeof c.values==='object'&&!Array.isArray(c.values),'INVALID_TEMPLATE_VALUES','Provide named template values.');const fields=templateFields(baseline.body);
  ensure(Object.keys(c.values).length===fields.length&&Object.keys(c.values).every(k=>fields.includes(k)),'TEMPLATE_FIELDS_CHANGED','Supply exactly the fields shown in this template.');
  const values=Object.fromEntries(fields.map(k=>[k,text(c.values[k],`a value for ${k}`,10000)]));body=baseline.body.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g,(_,k:string)=>values[k]);
  body=text(body,'bounded draft text',100000);title=text(c.title,'a draft title',300);documentId=randomUUID();revision=1;parentRevisionId=null;kind='draft';amendsDocumentId=null;
 }else{
  ensure(!['executed','effective'].includes(baseline.authority),'AMENDMENT_REQUIRED','Preserve the signed or effective original. Start a separate amendment or replacement process.');
  body=text(c.body,'the returned draft text',100000);ensure(body!==baseline.body,'NO_DOCUMENT_CHANGE','The returned text is unchanged.');text(c.note,'the revision reason and review context',3000);
  title=baseline.title;documentId=baseline.documentId;revision=baseline.revision+1;parentRevisionId=baseline.id;kind=baseline.kind==='template'?'draft':baseline.kind;amendsDocumentId=baseline.amendsDocumentId;
 }
 const source:Source={...base([baseline.sourceId]),title,kind:'manual',externalId:null,externalRevision:null,text:body,contentHash:digest(body),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'draft',originalObjectRef:trusted?.originalObjectRef||null};s.sources.push(source);
 const document:DocumentRecord={...base([source.id]),documentId,title,body,contentHash:digest(body),authority:'draft',sourceId:source.id,revision,parentRevisionId,amendsDocumentId,status:'current',kind};s.documents.push(document);
 // A successor never inherits permission to execute a proposal based on its predecessor.
 if(c.type==='document.reimport')for(const p of s.proposals.filter(p=>p.status==='current'&&(p.baselineRevisionIds.includes(baseline.id)||Object.hasOwn(p.dependencies.documentHashes,baseline.id)))){
  p.status='invalidated';touch(p);for(const approval of s.approvals.filter(x=>x.proposalId===p.id&&x.status==='active')){approval.status='invalidated';touch(approval);}
  for(const action of s.actions.filter(x=>x.proposalId===p.id&&!['verified','dispatching','uncertain','verifying'].includes(x.status))){action.status='planned';action.authorizationId=null;touch(action);}
  const m=s.matters.find(x=>x.id===p.matterId);if(m&&m.state!=='canceled'){m.state='needs_facts';m.closedAt=null;m.outcome=null;m.blockers=['A controlled document revision changed. Prepare and review the successor before further action.'];resetReviewTasks(s,m,p);touch(m);}
 }
 s.events.push({...base([source.id]),type:c.type,title:c.type==='document.reimport'?'Draft successor retained':'Draft created from template',detail:c.type==='document.reimport'?c.note.trim():'Named substitutions retained as a proposed draft; company truth and execution authority are unchanged.',matterId:null,recordId:document.id,measurement:s.rehearsal?'fictional_rehearsal':'observed'});
 return {documentId:document.id,sourceId:source.id,parentRevisionId};
}

export interface TextChange {kind:'unchanged'|'removed'|'added';text:string}
/** Exact paragraph comparison, independent of model interpretation and Word markup. */
export function compareDocumentText(before:string,after:string):{changes:TextChange[];granularity:'paragraph'|'whole_document'}{
 const left=before.split('\n'),right=after.split('\n');
 if(left.length*right.length>1_000_000)return {changes:[{kind:'removed',text:before},{kind:'added',text:after}],granularity:'whole_document'};
 const rows=Array.from({length:left.length+1},()=>new Uint32Array(right.length+1));
 for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)rows[i][j]=left[i]===right[j]?1+rows[i+1][j+1]:Math.max(rows[i+1][j],rows[i][j+1]);
 const changes:TextChange[]=[];let i=0,j=0;
 while(i<left.length||j<right.length){if(i<left.length&&j<right.length&&left[i]===right[j]){changes.push({kind:'unchanged',text:left[i++]});j++;}else if(i<left.length&&(j===right.length||rows[i+1][j]>=rows[i][j+1]))changes.push({kind:'removed',text:left[i++]});else changes.push({kind:'added',text:right[j++]});}
 return {changes,granularity:'paragraph'};
}
