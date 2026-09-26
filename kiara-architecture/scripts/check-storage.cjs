/* Offline artifact verification only. Does not connect to MongoDB. */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const Ajv=require(process.env.KIARA_AJV_PATH || '../research/T13/feasibility/node_modules/ajv');
const ajv=new Ajv({strict:false,allErrors:true,validateFormats:false});const root=path.resolve(__dirname,'..');
const read=(f)=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
function convert(x){
 if(Array.isArray(x))return x.map(convert);if(!x||typeof x!=='object')return x;
 let o={};for(const[k,v]of Object.entries(x)){
  if(k==='bsonType'){
   const ts=Array.isArray(v)?v:[v];if(ts.includes('date')){return {type:'object',required:['$date'],additionalProperties:false,properties:{$date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T.+Z$'}}};}
   if(ts.includes('binData')){return {type:'object',required:['$binary'],additionalProperties:false,properties:{$binary:{type:'object',required:['base64','subType'],additionalProperties:false,properties:{base64:{type:'string'},subType:{const:'00'}}}}};}
   o.type=[...new Set(ts.map(t=>({int:'integer',long:'integer',double:'number',decimal:'number',bool:'boolean'}[t]||t)))];if(o.type.length===1)o.type=o.type[0];
  }else o[k]=convert(v);
 }return o;
}
const checks=[];const check=(name,cond,details)=>{checks.push({name,passed:!!cond,...(details?{details}: {})});};
const cat=read('schema/collection-catalog.json'), fixtures={},schemaErrors=[];
for(const c of cat){
 const s=convert(read('schema/'+c.validator).validator.$jsonSchema);const validate=ajv.compile(s);fixtures[c.collection]=read('fixtures/'+c.collection+'.ejson.json');
 for(const row of fixtures[c.collection])if(!validate(row))schemaErrors.push({collection:c.collection,id:row._id,errors:validate.errors});
 check('collection_has_example:'+c.collection,fixtures[c.collection].length>0);
}
check('all_examples_match_translated_bson_validators',schemaErrors.length===0,schemaErrors);
const idmap=new Map();let dupe=[];for(const[c,rows]of Object.entries(fixtures))for(const row of rows){if(idmap.has(row._id))dupe.push(row._id);idmap.set(row._id,{collection:c,row});}
check('global_uuid_identity_unique',dupe.length===0,dupe);
const tenant=fixtures.tenants[0]._id;check('all_root_records_tenant_scoped',Object.values(fixtures).flat().every(x=>x.tenant_id===tenant));
const canonicalize=require('../research/T08/proof/node_modules/canonicalize');const canon=x=>canonicalize(x);function sort(x){if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])]));return x;}
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canon(wire(x))).digest('hex');
function wire(x){if(Array.isArray(x))return x.map(wire);if(x&&typeof x==='object'){if(Object.keys(x).join()==='$date')return x.$date;return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,wire(v)]));}return x;}
const missing=[];
const direct={context_head_id:'company_context_versions',harness_head_id:'harness_versions',parent_version_id:null,document_id:'documents',base_revision_id:'document_revisions',candidate_revision_id:'document_revisions',current_revision_id:'document_revisions',parent_revision_id:'document_revisions',context_version_id:'company_context_versions',context_snapshot_id:'company_context_versions',assessment_id:'assessments',event_id:'events',trigger_event_id:'events',evidence_bundle_id:'evidence_bundles',workflow_id:'workflows',active_proposal_id:'change_proposals',proposal_id:'change_proposals',review_bundle_id:'review_bundles',run_id:'agent_runs',created_by_run_id:'agent_runs',source_run_id:'agent_runs',harness_version_id:'harness_versions',validation_run_id:'validation_runs',source_version_id:'legal_source_versions',actor_id:'actors',author_id:'actors',created_by:'actors',recipient_actor_id:'actors',owner_actor_id:'actors',founder_approval_id:'review_actions',lawyer_approval_id:'review_actions',candidate_id:'harness_candidates',base_harness_version_id:'harness_versions',candidate_harness_version_id:'harness_versions',proposed_harness_version_id:'harness_versions',source_feedback_id:'feedback',feedback_id:'feedback',trigger_feedback_id:'feedback',trigger_validation_run_id:'validation_runs',result_harness_candidate_id:'harness_candidates'};
function walk(x,loc){if(Array.isArray(x)){x.forEach((v,i)=>walk(v,loc+'['+i+']'));return;}if(x&&typeof x==='object'){for(const[k,v]of Object.entries(x)){if(v!==null&&direct[k]){const found=idmap.get(v);if(!found||found.collection!==direct[k])missing.push({loc:loc+'.'+k,value:v,expected:direct[k]});}walk(v,loc+'.'+k);}}}
for(const[c,rows]of Object.entries(fixtures))rows.forEach((x,i)=>walk(x,c+'['+i+']'));
check('typed_record_references_resolve_same_tenant',missing.length===0,missing);
// Conservative BSON byte upper bound for the fixture subset; all integers charged 8 bytes.
function bsonBound(x){let n=5;for(const[k,v]of Object.entries(x)){n+=1+Buffer.byteLength(k)+1;if(v===null)continue;if(typeof v==='string')n+=5+Buffer.byteLength(v);else if(typeof v==='boolean')n+=1;else if(typeof v==='number')n+=8;else if(v.$date)n+=8;else if(v.$binary)n+=5+Buffer.from(v.$binary.base64,'base64').length;else if(Array.isArray(v))n+=bsonBound(Object.fromEntries(v.map((z,i)=>[String(i),z])));else n+=bsonBound(v);}return n;}
const sizes=Object.values(fixtures).flat().map(x=>({id:x._id,upper_bound:bsonBound(x)}));check('all_fixture_documents_conservative_bson_under_8mib',sizes.every(x=>x.upper_bound<=8*1024*1024),{largest:Math.max(...sizes.map(x=>x.upper_bound)),not_driver_serialization:true});
const facts=new Set(fixtures.company_context_versions.flatMap(x=>x.facts.map(f=>f.fact_id))), chunks=new Set(fixtures.legal_chunks.map(x=>x._id));
const proposals=fixtures.change_proposals;check('clause_edit_fact_and_citation_refs_resolve',proposals.every(p=>p.edits.every(e=>e.fact_ids.every(x=>facts.has(x))&&e.citation_chunk_ids.every(x=>chunks.has(x)))));
check('exact_redline_hash_matches_embedded_artifact',proposals.every(p=>p.diff_hash===p.redline.diff_hash&&hash(Object.fromEntries(Object.entries(p.redline).filter(([k])=>k!=='diff_hash')))===p.diff_hash));
check('unknown_facts_remain_null',fixtures.company_context_versions.every(c=>c.facts.every(f=>f.knowledge==='known'?f.value!==null:f.value===null)));
check('reset_generation_consistent',Object.values(fixtures).flat().every(x=>x.reset_epoch===fixtures.tenants[0].reset_epoch));

const hashes=[];for(const s of fixtures.legal_source_versions){if(hash(s.extracted_text)!==s.content_hash)hashes.push(s._id);const raw=Buffer.from(s.original_bytes.$binary.base64,'base64');check('raw_source_hash:'+s.source_key,crypto.createHash('sha256').update(raw).digest('hex')===s.original_sha256);check('raw_source_under_4mib:'+s.source_key,raw.length<=4*1024*1024);}
for(const c of fixtures.legal_chunks)if(hash(c.text)!==c.content_hash)hashes.push(c._id);
for(const c of fixtures.company_context_versions)if(hash(c.facts)!==c.content_hash)hashes.push(c._id);
for(const r of fixtures.document_revisions){const o={};for(const k of ['schema_version','document_id','language','title','policy_updated_on','clauses'])o[k]=r[k];if(hash(o)!==r.content_hash)hashes.push(r._id);}
for(const e of fixtures.events)if(hash(wire(e.payload))!==e.payload_hash)hashes.push(e._id);
for(const h of fixtures.harness_versions)if(hash(h.config)!==h.config_hash)hashes.push(h._id);
check('source_chunk_context_revision_event_harness_hashes_match',hashes.length===0,hashes);
const rb=fixtures.review_bundles[0],ri=rb.review_input;check('review_input_hash_matches',hash(wire(ri))===rb.review_input_hash);
check('review_approval_hashes_bind_same_bundle',fixtures.review_actions.filter(x=>x.action==='approved').every(x=>x.review_bundle_hash===rb.review_bundle_hash));
check('review_bundle_candidate_hash_matches',ri.candidate_content_hash===idmap.get(ri.candidate_revision_id).row.content_hash);
check('review_bundle_context_hash_matches',ri.context_snapshot_hash===idmap.get(ri.context_snapshot_id).row.content_hash);
check('review_bundle_harness_hash_matches',ri.harness_hash===idmap.get(ri.harness_version_id).row.config_hash);
check('approval_actor_roles_match',fixtures.review_actions.every(x=>idmap.get(x.actor_id).row.roles.includes(x.role)));
check('founder_precedes_lawyer_by_workflow_version',fixtures.review_actions[0].expected_state_version<fixtures.review_actions[1].expected_state_version);
check('review_bundle_minimal_seal_matches',hash(Object.fromEntries(['review_input_hash','validation_run_id','validation_hash','validator_version_id'].map(k=>[k,rb[k]])))===rb.review_bundle_hash);
check('legal_map_hash_binds_rationale_and_citations',proposals.every(p=>hash(p.legal_map)===p.legal_map_hash)&&ri.legal_map_hash===idmap.get(ri.proposal_id).row.legal_map_hash);
const correctProposal=idmap.get(ri.proposal_id).row;const badProposal=proposals.find(p=>p._id===correctProposal.supersedes_proposal_id);
function validAnchor(p){return p.source_anchor_evidence.every(e=>e.segments.every(a=>hash(e.raw_page_text)===a.raw_page_text_sha256&&e.raw_page_text.slice(a.start_utf16,a.end_utf16)===a.quote_text&&hash(a.quote_text)===a.quote_sha256));}
check('corrected_source_span_matches_exact_text',validAnchor(correctProposal));check('intentionally_faulty_source_span_is_rejected',!validAnchor(badProposal));

const supp=read('fixtures/documents/supplemental-facts.json').facts;check('all_seven_supplemental_policy_facts_present',supp.length===7&&supp.every(f=>facts.has(f.fact_id)));
check('supplemental_claims_bound_to_actual_clauses',supp.every(f=>correctProposal.legal_map.rows.some(r=>r.fact_refs.some(z=>z.fact_id===f.fact_id)&&f.clause_ids.every(c=>r.clause_ids.includes(c)))));

const idx=read('schema/indexes.json'),conflicts=[];const at=(x,k)=>k.split('.').reduce((v,t)=>v?.[t],x);
for(const[c,indexes]of Object.entries(idx))for(const ix of indexes.filter(x=>x.unique)){
 const seen=new Set();for(const d of fixtures[c]){
  if(ix.partialFilterExpression&&!Object.entries(ix.partialFilterExpression).every(([k,v])=>at(d,k)===v))continue;
  const key=canon(Object.keys(ix.key).map(k=>at(d,k)??null));if(seen.has(key))conflicts.push({collection:c,index:ix.name,key});seen.add(key);
 }
}
check('unique_index_keys_no_fixture_collisions',conflicts.length===0,conflicts);
check('no_domain_ttl',Object.entries(idx).every(([c,ix])=>c==='telemetry_spans'||ix.every(x=>x.expireAfterSeconds===undefined)));
// Mutation probes test schema rejection, not access control/database transaction behavior.
const validateEvent=ajv.compile(convert(read('schema/events.validator.json').validator.$jsonSchema));const bad=structuredClone(fixtures.events[0]);bad.payload.residence_evidence.kind='ip_geolocation';check('reject_signup_ip_as_declared_residence',!validateEvent(bad));
const validateRevision=ajv.compile(convert(read('schema/document_revisions.validator.json').validator.$jsonSchema));const badr=structuredClone(fixtures.document_revisions[0]);badr._id='ObjectId(123)';check('reject_mixed_id_representation',!validateRevision(badr));
const result={checked_at:new Date().toISOString(),scope:'Offline schema/fixture/reference/hash/index checks; BSON validators translated to JSON Schema and checked by Ajv. No Atlas, MongoDB server, transactions, model, email or workflow executed.',counts:{collections:cat.length,documents:Object.values(fixtures).flat().length,indexes:Object.values(idx).flat().length,checks:checks.length},passed:checks.every(x=>x.passed),checks};fs.writeFileSync(path.join(root,'validation/storage-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,counts:result.counts,failures:checks.filter(x=>!x.passed)},null,2));process.exitCode=result.passed?0:1;
