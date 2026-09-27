import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,emptyWorkspace,timestamp} from '../src/v2/store';
import {applyCompanyMemoryCommand,companyMemoryView,memoryRecordCurrent,resolveCompanyContext,resolveMemorySubject,type CompanyMemoryCommand,type MemoryState} from '../src/v2/company-memory';
import {canRead} from '../src/v2/authority';
import {factCurrentlyConfirmed} from '../src/v2/fact-validity';
import {snapshotFromState} from '../src/v2/service';
import type {ActorContext,DocumentRecord,FactAssertion,RecordBase,Source} from '../src/v2/contracts';
const scope={kind:'team' as const,actorIds:[]};
function fixture(){
 const s:MemoryState=emptyWorkspace('memory-test'),a:ActorContext={tenantId:s.tenantId,actorId:'owner',mode:'local_demo',expiresAt:Date.now()+3600000};
 s.memberships=[{actorId:'owner',roles:['member','fact_owner','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null},{actorId:'member',roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null}];
 const run=(c:CompanyMemoryCommand)=>applyCompanyMemoryCommand(s,a,c),declare=(kind:'company'|'product'|'vendor',name:string)=>String(run({type:'memory.entity.declare',kind,name,aliases:[],ownerId:a.actorId,scope}).entityId);
 const fromId=declare('product','Support assistant'),toId=declare('vendor','RelayAI');
 const base:RecordBase={id:'evidence',tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope,provenance:{actorId:a.actorId,sourceIds:[],description:'Synthetic record'}};
 const source:Source={...base,title:'Deployment observation',kind:'manual',externalId:null,externalRevision:null,text:'Planned sandbox use only. No production deployment is attested.',contentHash:digest('Planned sandbox use only. No production deployment is attested.'),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'unknown',originalObjectRef:null};s.sources.push(source);
 const propose=(extra:Partial<Extract<CompanyMemoryCommand,{type:'memory.relationship.propose'}>>={})=>String(run({type:'memory.relationship.propose',fromId,toId,kind:'uses_vendor',description:'Support assistant may use RelayAI for the sandbox pilot.',practice:'planned',sourceIds:[source.id],factIds:[],documentIds:[],inspectedVersion:s.version,...extra}).relationshipId);
 const confirm=(id:string)=>{const r=companyMemoryView(s,a).relationships.find(r=>r.id===id)!;return run({type:'memory.relationship.confirm',relationshipId:id,expectedRecordVersion:r.version,basisHash:r.basisHash});};
 return {s,a,run,declare,fromId,toId,source,propose,confirm};
}
test('declarations and candidates do not become facts; exact confirmation preserves planned status and stable subject identity',()=>{
 const {s,a,run,fromId,toId,propose,confirm}=fixture();assert.equal(s.facts.length,0);assert.equal(s.memoryEntities!.length,2);assert.ok(s.memoryEntities!.every(e=>e.entityId===s.entityId&&e.declaration==='user_declared'));
 assert.throws(()=>resolveMemorySubject(s,a,'RelayAI'),/unavailable/);const id=propose();assert.equal(s.facts.length,0);assert.equal(resolveCompanyContext(s,a,fromId,scope).relationships.length,0);
 const {factId}=confirm(id),fact=s.facts.find(f=>f.id===factId)! as FactAssertion&{subjectEntityId:string};assert.equal(fact.status,'confirmed');assert.equal(fact.practice,'planned');assert.equal(fact.subjectEntityId,fromId);assert.equal(fact.entityId,s.entityId);assert.equal(fact.confirmedBy,a.actorId);assert.equal(memoryRecordCurrent(s,fact),true);assert.equal((fact.value as {toId:string}).toId,toId);
 const context=resolveCompanyContext(s,a,fromId,scope);assert.equal(context.relationships.length,1);assert.equal(context.relatedEntities[0].id,toId);assert.deepEqual(context.factIds,[fact.id]);assert.ok(context.sourceIds.includes(s.memoryEntities![0].declarationSourceId));
 run({type:'memory.relationship.withdraw',relationshipId:id,expectedRecordVersion:s.memoryRelationships![0].version,reason:'Pilot canceled; retained as history.'});assert.equal(resolveCompanyContext(s,a,fromId,scope).relationships.length,0);assert.equal(fact.status,'superseded');assert.equal(memoryRecordCurrent(s,fact),false);
});
test('ordinary members cannot confirm identities or relationships; cross-tenant and stale intent remain blocked',()=>{
 const {s,a,fromId,propose,confirm}=fixture(),member={...a,actorId:'member'},id=propose(),r=companyMemoryView(s,a).relationships[0];
 assert.throws(()=>applyCompanyMemoryCommand(s,member,{type:'memory.entity.declare',kind:'vendor',name:'Unauthorized',aliases:[],ownerId:'member',scope}),/fact owner/);
 assert.throws(()=>applyCompanyMemoryCommand(s,member,{type:'memory.relationship.confirm',relationshipId:id,expectedRecordVersion:r.version,basisHash:r.basisHash}),/fact owner/);
 assert.throws(()=>resolveMemorySubject(s,{...a,tenantId:'foreign'},fromId),/Sign in/);
 assert.throws(()=>applyCompanyMemoryCommand(s,a,{type:'memory.relationship.confirm',relationshipId:id,expectedRecordVersion:r.version,basisHash:'stale'}),/current candidate/);assert.equal(s.facts.length,0);confirm(id);
 assert.throws(()=>applyCompanyMemoryCommand(s,a,{type:'memory.relationship.confirm',relationshipId:id,expectedRecordVersion:r.version,basisHash:r.basisHash}),/current relationship/);
});
test('relationship proposal rejects a refreshed workspace version that was not inspected with its evidence',()=>{
 const {s,a,fromId,toId,source,run}=fixture();const inspectedVersion=s.version;s.version++;
 assert.throws(()=>run({type:'memory.relationship.propose',fromId,toId,kind:'uses_vendor',description:'Previously inspected source',practice:'planned',sourceIds:[source.id],factIds:[],documentIds:[],inspectedVersion}),/changed since the relationship evidence was inspected/);
 assert.equal(s.memoryRelationships?.length,0);
});
test('nested private evidence cannot be laundered into a team relationship',()=>{
 const {s,a,source,propose}=fixture();const privateSource={...structuredClone(source),id:'private',scope:{kind:'private' as const,actorIds:[a.actorId]},text:'PRIVATE dependency',contentHash:digest('PRIVATE dependency')};s.sources.push(privateSource);
 const fact:FactAssertion={...structuredClone(source),id:'derived-fact',provenance:{actorId:a.actorId,sourceIds:['private'],description:'Derived fixture'},entityId:s.entityId,predicate:'scope',value:'PRIVATE dependency',status:'confirmed',practice:'planned',ownerId:a.actorId,observedAt:timestamp(),validFrom:null,validUntil:null,confirmedBy:a.actorId,confirmedAt:timestamp(),supersedesId:null,originVersion:0,reuse:'company',conversationId:null};s.facts.push(fact);
 assert.throws(()=>propose({sourceIds:[],factIds:[fact.id]}),/exact relationship audience/);assert.equal(s.memoryRelationships?.length||0,0);
});
test('changed proof or declared identity prevents stale confirmation and relationship fact reuse',()=>{
 const {s,a,run,fromId,toId,source,propose,confirm}=fixture();const id=propose();source.version++;assert.throws(()=>confirm(id),/current candidate/);const fresh=propose();confirm(fresh);const fact=s.facts.at(-1)!;assert.equal(memoryRecordCurrent(s,fact),true);
 const target=s.memoryEntities!.find(e=>e.id===toId)!;run({type:'memory.entity.archive',entityId:target.id,expectedRecordVersion:target.version,entityHash:digest(target),reason:'Stop reuse of this declared vendor identity.'});assert.equal(canRead(s,a,fact),false);assert.equal(memoryRecordCurrent(s,fact),false);assert.equal(companyMemoryView(s,a).relationships.length,0);assert.equal(resolveCompanyContext(s,a,fromId,scope).relationships.length,0);assert.equal(target.archiveReason,'Stop reuse of this declared vendor identity.');
});
test('relationship evidence binds current document revision, not a similarly named replacement',()=>{
 const {s,source,propose,confirm}=fixture();const doc:DocumentRecord={id:'doc-v1',tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope,provenance:{actorId:'owner',sourceIds:[source.id],description:'Synthetic contract'},documentId:'agreement',title:'RelayAI terms',body:source.text,contentHash:digest(source.text),authority:'executed',sourceId:source.id,revision:1,parentRevisionId:null,amendsDocumentId:null,status:'current',kind:'agreement'};s.documents.push(doc);const id=propose({documentIds:[doc.id]});confirm(id);const fact=s.facts.at(-1)!;assert.equal(memoryRecordCurrent(s,fact),true);
 s.documents.push({...structuredClone(doc),id:'doc-v2',revision:2,parentRevisionId:doc.id,body:'Changed terms',contentHash:digest('Changed terms')});assert.equal(memoryRecordCurrent(s,fact),false);
});
test('effective periods, conflict replacement and exact graph audiences remain explicit',()=>{
 const {s,a,fromId,propose,confirm}=fixture();assert.throws(()=>propose({validFrom:'2026-01-02',validUntil:'2026-01-01'}),/effective period/);const id=propose();confirm(id);const conflicting=propose({practice:'live'});assert.throws(()=>confirm(conflicting),/Withdraw the current assertion/);assert.throws(()=>resolveCompanyContext(s,a,fromId,{kind:'private',actorIds:[a.actorId]}),/exact conversation audience/);
 const other=fixture(),expired=other.propose({validUntil:'2001-01-01'});other.confirm(expired);assert.equal(factCurrentlyConfirmed(other.s.facts.at(-1)!),false);assert.equal(resolveCompanyContext(other.s,other.a,other.fromId,scope).relationships.length,0);
});
test('a named owner must be able to read the declared entity under current membership restrictions',()=>{
 const {s,a}=fixture();s.memberships.find(m=>m.actorId==='member')!.matterIds=['unrelated-matter'];
 assert.throws(()=>applyCompanyMemoryCommand(s,a,{type:'memory.entity.declare',kind:'vendor',name:'Unreachable owner',aliases:[],ownerId:'member',scope}),/named owner must have current access/);
});
test('revoking a named subject owner removes confirmed graph context and derived fact reuse',()=>{
 const {s,a,run,source,confirm}=fixture();
 const bob={...a,actorId:'member'};
 const company=String(run({type:'memory.entity.declare',kind:'company',name:'Owner-bound company',aliases:[],ownerId:bob.actorId,scope}).entityId);
 const vendor=String(run({type:'memory.entity.declare',kind:'vendor',name:'Owner-bound vendor',aliases:[],ownerId:bob.actorId,scope}).entityId);
 const relationship=String(run({type:'memory.relationship.propose',fromId:company,toId:vendor,kind:'uses_vendor',description:'Observed vendor use',practice:'live',sourceIds:[source.id],factIds:[],documentIds:[],inspectedVersion:s.version}).relationshipId);
 const factId=String(confirm(relationship).factId);
 assert.equal(resolveCompanyContext(s,a,company,scope).relationships.length,1);
 const before=snapshotFromState(s,a).facts.find(f=>f.id===factId) as FactAssertion&{current?:boolean};
 assert.equal(before.current,true);
 s.memberships.find(m=>m.actorId===bob.actorId)!.revokedAt=timestamp();
 assert.throws(()=>resolveCompanyContext(s,a,company,scope),/currently available/);
 assert.equal(companyMemoryView(s,a).relationships.length,0);
 assert.equal(memoryRecordCurrent(s,s.facts.find(f=>f.id===factId)!),false);
 const after=snapshotFromState(s,a).facts.find(f=>f.id===factId) as FactAssertion&{current?:boolean};
 assert.equal(after.status,'confirmed');
 assert.equal(after.current,false);
 assert.throws(()=>resolveMemorySubject(s,a,company),/currently available/);
});
test('effective dates reject impossible calendar normalization and root declarations do not leave denormalized name copies',()=>{
 const {s,run,propose}=fixture();assert.throws(()=>propose({validFrom:'2026-02-31'}),/does not exist/);assert.throws(()=>propose({validFrom:'2026-02-31T00:00:00.000Z'}),/does not exist/);assert.throws(()=>propose({validFrom:'February 1, 2026'}),/exact ISO/);propose({validFrom:'2028-02-29'});
 const name=s.companyName;run({type:'memory.entity.declare',kind:'company',name:'Retain only in source-scoped registry',aliases:[],ownerId:'owner',scope,workspaceCompany:true});assert.equal(s.companyName,name);
});
