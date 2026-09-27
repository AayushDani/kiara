import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectGovInfoGranule,previewGovInfoGranule,stageGovInfoGranule} from '../src/v2/legal-reference-govinfo';
import {command,snapshot} from '../src/v2/service';
import {readWorkspace,closeV2Store,transactWorkspace,digest} from '../src/v2/store';
import {readOriginal} from '../src/v2/objects';
import {processLegalWatch} from '../src/v2/legal-maintenance';
import {authorityCurrent} from '../src/v2/coverage';
import {retrieveConversationEvidence,recheckEvidence} from '../src/v2/retrieval';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';

const selected={packageId:'USCODE-2024-title17',granuleId:'USCODE-2024-title17-chap1-sec105',domain:'copyright scope'};
const htmlUrl=`https://www.govinfo.gov/content/pkg/${selected.packageId}/html/${selected.granuleId}.htm`;
const metadata={packageId:selected.packageId,granuleId:selected.granuleId,title:'17 USC 105',dateIssued:'2024-01-01',lastModified:'2026-09-01T00:00:00Z',download:{txtLink:`https://api.govinfo.gov/packages/${selected.packageId}/granules/${selected.granuleId}/htm`,pdfLink:`https://api.govinfo.gov/packages/${selected.packageId}/granules/${selected.granuleId}/pdf`}};
const metadataFetcher=(body:unknown):typeof fetch=>async()=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
const sourceFetcher:typeof fetch=async()=>new Response('<h1>Fictional section text</h1><p>Testing only.</p>',{headers:{'content-type':'text/html'}});
const dirs:string[]=[];
const actor:ActorContext={tenantId:'govinfo-test',actorId:'reviewer',mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','legal_reviewer','business_owner']};
let seq=0;const send=async(c:WorkspaceCommand)=>command(actor,{idempotencyKey:`govinfo-test-${++seq}`,expectedVersion:(await snapshot(actor)).version,command:c});
after(async()=>{await closeV2Store();await Promise.all(dirs.map(dir=>rm(dir,{recursive:true,force:true})));});

test('selected GovInfo source is durably staged with raw original and no implied coverage',async()=>{
 await closeV2Store();const dir=await mkdtemp(join(tmpdir(),'kiara-govinfo-'));dirs.push(dir);process.env.KIARA_V2_DATA_DIR=dir;process.env.KIARA_ORIGINALS_DIR=join(dir,'originals');delete process.env.MONGODB_URI;delete process.env.KIARA_ORIGINALS_MODE;delete process.env.KIARA_V2_INDEX_POLICY;process.env.KIARA_V2_LEGAL_SOURCE_POLICY=JSON.stringify([{tenantId:actor.tenantId,urls:[htmlUrl],validUntil:new Date(Date.now()+86400000).toISOString(),maxBytes:10000}]);
 process.env.KIARA_V2_AI_MODE='local';await snapshot(actor);
 const preview=await previewGovInfoGranule(actor,selected,{apiKey:'test-private-key',metadataFetcher:metadataFetcher(metadata),sourceFetcher});
 await assert.rejects(()=>stageGovInfoGranule(actor,selected,{apiKey:'test-private-key',metadataFetcher:metadataFetcher(metadata),sourceFetcher,expectedPreviewHash:'a'.repeat(64)}),{code:'GOVINFO_PREVIEW_CHANGED'});
 assert.equal((await readWorkspace(actor.tenantId)).sources.length,0,'changed preview cannot stage source bytes');
 const staged=await stageGovInfoGranule(actor,selected,{apiKey:'test-private-key',metadataFetcher:metadataFetcher(metadata),sourceFetcher,expectedPreviewHash:preview.previewHash});
 const state=await readWorkspace(actor.tenantId),source=state.sources.find(x=>x.id===staged.sourceId)!,authority=state.legalAuthorities.find(x=>x.id===staged.authorityId)!;
 assert.equal(source.kind,'legal');assert.equal(source.authority,'unknown');assert.equal(authority.verifiedAt,null);assert.equal(authority.effectiveFrom,null);assert.equal(authorityCurrent(state,actor,authority),false);assert.equal(state.coverage.length,0);
 assert.equal(source.url,htmlUrl);assert.equal(staged.officialPdfUrl,`https://www.govinfo.gov/content/pkg/${selected.packageId}/pdf/${selected.granuleId}.pdf`);
 assert.equal((await readOriginal(actor.tenantId,JSON.parse(source.originalObjectRef!))).toString(),'<h1>Fictional section text</h1><p>Testing only.</p>');
 // A derived document cannot bypass the legal source's review gate in local answers.
 await transactWorkspace(actor.tenantId,s=>{const at=new Date().toISOString();s.documents.push({id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:at,updatedAt:at,scope:structuredClone(source.scope),provenance:{actorId:actor.actorId,sourceIds:[source.id],description:'Fictional derived text to test review gates'},documentId:randomUUID(),title:'GovInfo derived text',body:source.text,contentHash:digest(source.text),authority:'unknown',sourceId:source.id,revision:1,parentRevisionId:null,amendsDocumentId:null,status:'current',kind:'other'});});
 const message=await send({type:'message.send',text:'Explain Fictional section text'}),conversationId=String(message.result.conversationId);
 let current=await readWorkspace(actor.tenantId),conversation=current.conversations.find(x=>x.id===conversationId)!,messageId=current.messages.find(x=>x.conversationId===conversationId&&x.role==='user')!.id;
 assert.equal(current.messages.find(x=>x.id===message.result.messageId)!.citations.length,0);
 assert.equal(retrieveConversationEvidence(current,actor,conversation,messageId).evidence.length,0);
 await send({type:'coverage.source.verify',authorityId:authority.id,expectedRecordVersion:authority.version,sourceVersion:source.version,verificationEvidence:'Fictional reviewer checked exact source and linked official PDF for software test only.',reviewDueAt:new Date(Date.now()+86400000).toISOString()});
 const defined=await send({type:'coverage.define',domain:selected.domain,jurisdiction:'US-federal',authorityIds:[authority.id],limitations:['Fictional local test only; no real legal coverage.']});
 const coverageId=String(defined.result.coverageId),coverage=defined.snapshot.coverage.find(x=>x.id===coverageId)!;
 await send({type:'coverage.review',coverageId,expectedRecordVersion:coverage.version,qualificationEvidence:'Fictional local qualification for test only.',reviewDueAt:new Date(Date.now()+86400000).toISOString(),limitations:['Fictional local test only; no real legal coverage.']});
 const reviewedAuthority=(await readWorkspace(actor.tenantId)).legalAuthorities.find(x=>x.id===authority.id)!;
 const configuredWatch=await send({type:'legal.watch.configure',authorityId:authority.id,expectedAuthorityVersion:reviewedAuthority.version,intervalHours:24});
 assert.equal((await processLegalWatch(actor.tenantId,String(configuredWatch.result.watchId),{fetcher:sourceFetcher})).status,'scheduled');
 const unchanged=await readWorkspace(actor.tenantId);assert.equal(unchanged.legalChanges?.length,0);assert.equal(authorityCurrent(unchanged,actor,unchanged.legalAuthorities.find(x=>x.id===authority.id)!),true);
 current=await readWorkspace(actor.tenantId);conversation=current.conversations.find(x=>x.id===conversationId)!;
 const packet=retrieveConversationEvidence(current,actor,conversation,messageId);assert.ok(packet.evidence.some(x=>x.sourceId===source.id));
 await transactWorkspace(actor.tenantId,s=>{s.coverage.find(x=>x.id===coverageId)!.reviewDueAt=new Date(0).toISOString();});
 const stale=await readWorkspace(actor.tenantId);assert.throws(()=>recheckEvidence(stale,actor,conversationId,packet),{code:'EVIDENCE_CHANGED'});
 await assert.rejects(()=>stageGovInfoGranule(actor,selected,{apiKey:'test-private-key',metadataFetcher:metadataFetcher(metadata),sourceFetcher,expectedPreviewHash:preview.previewHash}),{code:'GOVINFO_ALREADY_REGISTERED'});
});

test('metadata substitution and missing operator selection reject before source read',async()=>{
 let sourceReads=0,metadataReads=0;const reader:typeof fetch=async()=>{sourceReads++;return sourceFetcher(htmlUrl);};const metadataReader:typeof fetch=async()=>{metadataReads++;return metadataFetcher(metadata)('https://api.govinfo.gov');};
 await assert.rejects(()=>inspectGovInfoGranule(selected,{apiKey:'test-private-key',fetcher:metadataFetcher({...metadata,granuleId:'OTHER'})}),{code:'GOVINFO_METADATA_MISMATCH'});
 await assert.rejects(()=>inspectGovInfoGranule(selected,{apiKey:'test-private-key',fetcher:metadataFetcher({...metadata,download:{...metadata.download,pdfLink:'https://example.com/other.pdf'}})}),{code:'GOVINFO_METADATA_MISMATCH'});
 delete process.env.KIARA_V2_LEGAL_SOURCE_POLICY;
 await assert.rejects(()=>stageGovInfoGranule(actor,selected,{apiKey:'test-private-key',metadataFetcher:metadataReader,sourceFetcher:reader,expectedPreviewHash:'a'.repeat(64)}),{code:'LEGAL_WATCH_NOT_CONFIGURED'});
 assert.equal(sourceReads,0);assert.equal(metadataReads,0);
});
