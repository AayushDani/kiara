import {createHash} from 'node:crypto';
import {BSON, type Document} from 'mongodb';
import type {State} from '../server/contracts';
import {fixture, followups, legalChunks, TENANT} from './fixtures';
import {hash} from '../server/hash';

/** Runtime schema v2 reconciles the build's State contract with the architecture catalog. */
export const collectionNames = {facts:'company_facts',revisions:'document_revisions',workflows:'workflows',events:'events',feedback:'feedback',notifications:'notification_outbox',harnesses:'harness_versions',evaluations:'evaluation_runs'} as const;
export const arrayFields = Object.keys(collectionNames) as (keyof typeof collectionNames)[];
const keys = {facts:'fact_id',revisions:'revision_id',workflows:'workflow_id',events:'event_id',feedback:'feedback_id',notifications:'notification_id',harnesses:'harness_id',evaluations:'evaluation_id'} as const;
export const catalog = ['tenants','actors','company_facts','company_context_versions','customers','events','documents','document_revisions','legal_source_versions','legal_chunks','assessments','evidence_bundles','change_proposals','validation_runs','review_bundles','workflows','jobs','agent_runs','tool_receipts','review_actions','feedback','harness_versions','harness_candidates','evaluation_runs','operational_followups','seed_manifests','notification_outbox','telemetry_spans','source_recheck_attestations'] as const;
export type Collections = Record<string, Document[]>;
export function stableId(value:string) { const h=createHash('sha256').update(value).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; }
function row(s:State,key:string,body:Document,order=0):Document {return {...body,_id:`${s.tenant_id}:${s.reset_epoch}:${key}`,tenant_id:s.tenant_id,reset_epoch:s.reset_epoch,_record_key:key,_order:order,storage_schema:2};}
export function coreRows(s:State,field:keyof typeof collectionNames):Document[]{return s[field].map((value,i)=>row(s,String((value as any)[keys[field]]),value,i));}
export function decodeRows(field:keyof typeof collectionNames,rows:Document[]):any[]{return rows.map(doc=>{const result={...doc};for(const k of ['_id','_record_key','_order','storage_schema'])delete result[k];if(field!=='workflows'&&field!=='events')delete result.tenant_id;if(!['workflows','events','notifications'].includes(field))delete result.reset_epoch;return result;});}
export function head(s:State):Document {const result:Document={...s,_id:TENANT,fictional_demo:true,storage_schema:2,maintenance_state:'ready'};for(const key of arrayFields)delete result[key];delete result.receipts;return result;}
function sourceDocuments(){return fixture<Document[]>('legal_source_versions.ejson.json').map(source=>BSON.EJSON.deserialize(source));}
export function foundation(s:State):Collections {
 const out:Collections={};
 for(const name of catalog)out[name]=[];
 out.actors=fixture<Document[]>('actors.ejson.json').map((doc,i)=>row(s,doc._id,BSON.EJSON.deserialize(doc),i));
 const ny=fixture<Document[]>('customers.ejson.json').find(doc=>doc.external_key==='customer-ny')!;
 // The baseline retains NY customers only; the after-event design trace is never seeded as live history.
 const customer=BSON.EJSON.deserialize(ny);customer.residency_evidence=customer.residency_evidence.map((e:Document)=>({...e,source_event_id:null}));
 out.customers=[row(s,ny._id,customer)];
 out.legal_source_versions=sourceDocuments().map((doc,i)=>row(s,doc._id,doc,i));
 out.legal_chunks=legalChunks().map((doc,i)=>row(s,doc._id,BSON.EJSON.deserialize(doc),i));
 out.seed_manifests=[row(s,stableId('runtime-baseline-manifest'),{fixture_set:'kiara.runtime.baseline',fixture_version:'2',mode:'baseline',fictional_demo:true,sandbox_eligibility:'unverified',state:'ready',content_manifest_hash:hash({baseline:fixture('documents/baseline.json'),facts:fixture('company_context_versions.ejson.json'),source_hashes:out.legal_source_versions.map(d=>d.original_sha256)}),created_at:'2026-09-26T18:00:00.000Z'})];
 return out;
}
export function contextRow(s:State):Document {return row(s,stableId(`context:${s.context_epoch}`),{context_version_id:stableId(`context:${s.context_epoch}`),context_epoch:s.context_epoch,facts:s.facts,content_hash:hash(s.facts),provenance:'Company facts snapshot; synthetic fixture or founder-verified update'});}
export function projections(s:State):Collections {
 const out:Collections={};for(const name of catalog)out[name]=[];
 out.tenants=[head(s)];for(const field of arrayFields)out[collectionNames[field]]=coreRows(s,field);
 out.company_context_versions=[contextRow(s)];
 out.documents=[row(s,s.revisions[0].document_id,{document_id:s.revisions[0].document_id,kind:'privacy_policy',current_revision_id:s.current_revision_id,state_version:s.state_version})];
 out.tool_receipts=Object.entries(s.receipts).map(([key,value],i)=>row(s,stableId(`receipt:${key}`),{receipt_key:key,...value},i));
 for(const [key,receipt] of Object.entries(s.receipts)){
   if(!key.startsWith(`${s.reset_epoch}:source_recheck:`))continue;
   const attestation=receipt.result;
   if(attestation&&typeof attestation==='object'&&!Array.isArray(attestation)&&typeof attestation.attestation_id==='string')out.source_recheck_attestations.push(row(s,attestation.attestation_id,{...attestation,created_at:attestation.verified_at}));
 }
 const previousEvent=new Map<string|null,string>();
 for(const e of s.events){
   const prior=previousEvent.get(e.workflow_id),elapsed=prior?Date.parse(e.created_at)-Date.parse(prior):null;
   out.telemetry_spans.push(row(s,stableId(`span:${e.event_id}`),{span_id:stableId(`span:${e.event_id}`),workflow_id:e.workflow_id,event_id:e.event_id,operation:e.type,observed_at:e.created_at,elapsed_since_previous_event_ms:elapsed===null?null:Math.max(0,elapsed),measurement:'persisted_event_timestamps',content_policy:'metadata_only'},out.telemetry_spans.length));
   previousEvent.set(e.workflow_id,e.created_at);
 }

 for(const w of s.workflows){
   const add=(name:string,key:string,body:Document)=>out[name].push(row(s,key,{workflow_id:w.workflow_id,...body},out[name].length));
   add('customers',stableId(`customer:${w.workflow_id}`),{customer_id:stableId(`customer:${w.workflow_id}`),display_name:w.customer_name,...(w.postal_address?{postal_address:w.postal_address}:{}),synthetic:true,residency_evidence:[{evidence_type:'declared_legal_residence',country:'US',region:w.residence,verification_status:'self_declared',source_event_id:w.event_id}],created_at:w.created_at});
   add('company_context_versions',stableId(`workflow-context:${w.workflow_id}:${w.context_epoch}`),{context_version_id:stableId(`workflow-context:${w.workflow_id}:${w.context_epoch}`),context_epoch:w.context_epoch,facts:w.facts,content_hash:hash(w.facts),created_at:w.created_at,event_id:w.event_id});
   add('jobs',stableId(`job:${w.workflow_id}`),{job_id:stableId(`job:${w.workflow_id}`),state:w.state,lease_owner:w.lease_owner,lease_epoch:w.lease_epoch,lease_until:w.lease_until,created_at:w.created_at,updated_at:w.updated_at});
   if(w.model_attempts)add('agent_runs',stableId(`run:${w.workflow_id}`),{run_id:stableId(`run:${w.workflow_id}`),mode:w.model_mode,status:w.model_status,attempts:w.model_attempts,input_tokens:w.input_tokens,output_tokens:w.output_tokens,cost_usd:w.cost_usd,reserved_cost:w.reserved_cost,unknown_charge:w.unknown_charge,harness_version:w.harness_version});
   if(w.assessment)add('assessments',stableId(`assessment:${w.workflow_id}:${hash(w.assessment)}`),{assessment_id:stableId(`assessment:${w.workflow_id}:${hash(w.assessment)}`),...w.assessment,context_epoch:w.context_epoch});
   if(w.evidence_keys.length)add('evidence_bundles',stableId(`evidence:${w.workflow_id}:${hash(w.evidence_keys)}`),{evidence_bundle_id:stableId(`evidence:${w.workflow_id}:${hash(w.evidence_keys)}`),provision_keys:w.evidence_keys,context_epoch:w.context_epoch});
   if(w.candidate_revision_id)add('change_proposals',stableId(`proposal:${w.candidate_revision_id}`),{change_proposal_id:stableId(`proposal:${w.candidate_revision_id}`),base_revision_id:w.base_revision_id,candidate_revision_id:w.candidate_revision_id});
   for(const v of w.validations)add('validation_runs',v.validation_id,v);
   for(const a of w.approvals)add('review_actions',a.approval_id,a);
   if(w.bundle_hash)add('review_bundles',stableId(`review:${w.bundle_hash}`),{review_bundle_id:stableId(`review:${w.bundle_hash}`),bundle_hash:w.bundle_hash,review_input_hash:w.review_input_hash,candidate_revision_id:w.candidate_revision_id,freshness_valid_until:w.freshness_valid_until});
   if(w.assessment?.outcome==='covered')for(const f of followups())add('operational_followups',stableId(`followup:${w.workflow_id}:${f.followup_id}`),{...f,may_close_by_policy_approval:false});
 }
 for(const e of s.evaluations)out.harness_candidates.push(row(s,stableId(`candidate:${e.evaluation_id}`),{evaluation_id:e.evaluation_id,candidate_version:e.candidate_version,status:e.promoted?'promoted':'evaluated',passed:e.passed}));
 return out;
}
export const preservedCollections = new Set(['company_context_versions','assessments','evidence_bundles','change_proposals','review_bundles','review_actions','source_recheck_attestations']);
export function materialize(s:State,history:Collections={}):Collections {const out=foundation(s),live=projections(s);for(const name of catalog){if(name==='tenants'){out[name]=live[name];continue;}const rows=new Map(out[name].map(d=>[d._id,d]));if(preservedCollections.has(name))for(const d of history[name]||[])if(d.tenant_id===s.tenant_id&&d.reset_epoch===s.reset_epoch)rows.set(d._id,d);for(const d of live[name])rows.set(d._id,d);out[name]=[...rows.values()];}return out;}
export function sourceChecks():string[]{const failures:string[]=[];for(const s of sourceDocuments()){const bytes=s.original_bytes.value(true);if(bytes.length>4*1024*1024)failures.push(`Source exceeds 4 MiB: ${s.source_key}`);if(createHash('sha256').update(bytes).digest('hex')!==s.original_sha256)failures.push(`Original source hash mismatch: ${s.source_key}`);if(BSON.calculateObjectSize(s)>8*1024*1024)failures.push(`Source BSON exceeds 8 MiB: ${s.source_key}`);}for(const c of legalChunks())if(createHash('sha256').update(c.text).digest('hex')!==c.content_hash)failures.push(`Chunk hash mismatch: ${c.provision_key}`);return failures;}
