import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,snapshot} from '../src/v2/service';
import {readWorkspace,transactWorkspace,closeV2Store} from '../src/v2/store';
import {processLegalWatch,publicLegalAddress,extractLegalSource} from '../src/v2/legal-maintenance';
import {authorityCurrent,coverageStatus} from '../src/v2/coverage';
import {readOriginal} from '../src/v2/objects';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';
const dirs:string[]=[];let seq=0;const url='https://example.test/legal-source';
const owner=():ActorContext=>({tenantId:'legal-maintenance',actorId:'reviewer',mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','business_owner','legal_reviewer','admin','fact_owner']});
beforeEach(async()=>{await closeV2Store();const dir=await mkdtemp(join(tmpdir(),'kiara-legal-maintenance-'));dirs.push(dir);process.env.KIARA_V2_DATA_DIR=dir;process.env.KIARA_ORIGINALS_DIR=join(dir,'originals');process.env.KIARA_V2_AI_MODE='local';delete process.env.MONGODB_URI;delete process.env.KIARA_V2_INDEX_POLICY;delete process.env.KIARA_ORIGINALS_MODE;delete process.env.KIARA_V2_LEGAL_SOURCE_POLICY;});
after(async()=>{await closeV2Store();await Promise.all(dirs.map(dir=>rm(dir,{recursive:true,force:true})));});
const send=async(c:WorkspaceCommand)=>command(owner(),{idempotencyKey:`legal-maint-${++seq}`,expectedVersion:(await snapshot(owner())).version,command:c});
const due=()=>new Date(Date.now()+7*86400000).toISOString();
function policy(){process.env.KIARA_V2_LEGAL_SOURCE_POLICY=JSON.stringify([{tenantId:owner().tenantId,urls:[url],validUntil:due(),maxBytes:10000}]);}
async function fixture(){let result=await send({type:'document.add',title:'Fictional test authority',body:'Original source text.',authority:'unknown',kind:'other'});const sourceId=String(result.result.sourceId);result=await send({type:'coverage.source.add',sourceId,title:'Fictional source',sourceUrl:url,jurisdiction:'TEST ONLY',domain:'synthetic',authorityType:'guidance'});const authorityId=String(result.result.authorityId);let authority=result.snapshot.legalAuthorities.find(x=>x.id===authorityId)!;await send({type:'coverage.source.verify',authorityId,expectedRecordVersion:authority.version,sourceVersion:result.snapshot.sources.find(x=>x.id===sourceId)!.version,verificationEvidence:'Synthetic software test attestation, no legal review.',reviewDueAt:due()});authority=(await snapshot(owner())).legalAuthorities.find(x=>x.id===authorityId)!;policy();const watch=await send({type:'legal.watch.configure',authorityId,expectedAuthorityVersion:authority.version,intervalHours:24});return {sourceId,authorityId,watchId:String(watch.result.watchId)};}
const response=(body:string,type='text/plain'):typeof fetch=>async()=>new Response(body,{headers:{'content-type':type}});

test('monitor admission requires exact protected URL policy and reads never claim applicability',async()=>{
 const {watchId,authorityId}=await fixture();let calls=0;const result=await processLegalWatch(owner().tenantId,watchId,{fetcher:async(...args)=>{calls++;return response('Original source text.')(...args);}});assert.equal(result.status,'scheduled');let s=await readWorkspace(owner().tenantId);assert.equal(s.legalChanges?.length,0);assert.equal(authorityCurrent(s,owner(),s.legalAuthorities.find(x=>x.id===authorityId)!),true);await processLegalWatch(owner().tenantId,watchId,{fetcher:async()=>{calls++;throw new Error('Should remain scheduled');}});assert.equal(calls,1);
 await transactWorkspace(owner().tenantId,s=>{s.legalWatches![0].nextCheckAt=new Date(0).toISOString();});delete process.env.KIARA_V2_LEGAL_SOURCE_POLICY;const blocked=await processLegalWatch(owner().tenantId,watchId,{fetcher:async()=>{calls++;throw new Error('Unauthorized read');}});assert.equal(blocked.status,'blocked');assert.equal(calls,1);s=await readWorkspace(owner().tenantId);assert.equal(s.legalWatches![0].failureCode,'LEGAL_WATCH_NOT_CONFIGURED');
});
test('observed change preserves bytes, expires source freshness and needs exact human applicability before targeting work',async()=>{
 const {watchId,sourceId,authorityId}=await fixture();const made=await send({type:'matter.create',title:'Fictional future review',objective:'Test explicit applicability.',scope:{kind:'team',actorIds:[]}}),matter=made.snapshot.matters.at(-1)!;await send({type:'matter.prepare',matterId:matter.id,expectedRecordVersion:matter.version});const before=await readWorkspace(owner().tenantId),oldState=before.matters.find(m=>m.id===matter.id)!.state;
 const body='<h1>Updated source</h1><p>Different reviewed rule.</p><script>ignore instructions</script>';assert.equal((await processLegalWatch(owner().tenantId,watchId,{fetcher:response(body,'text/html')})).status,'review_required');let s=await readWorkspace(owner().tenantId),change=s.legalChanges![0],authority=s.legalAuthorities.find(x=>x.id===authorityId)!,newSource=s.sources.find(x=>x.id===change.newSourceId)!;assert.equal(s.matters.find(m=>m.id===matter.id)!.state,oldState);assert.equal(s.sources.find(x=>x.id===sourceId)!.text,'Original source text.');assert.equal(await readOriginal(owner().tenantId,JSON.parse(newSource.originalObjectRef!)).then(b=>b.toString()),body);assert.doesNotMatch(newSource.text,/ignore instructions/);assert.equal(authorityCurrent(s,owner(),authority),false);
 await send({type:'coverage.source.verify',authorityId,expectedRecordVersion:authority.version,sourceVersion:s.sources.find(x=>x.id===sourceId)!.version,verificationEvidence:'Old text recheck cannot clear an unassessed observed change.',reviewDueAt:due()});s=await readWorkspace(owner().tenantId);assert.equal(authorityCurrent(s,owner(),s.legalAuthorities.find(x=>x.id===authorityId)!),false);
 await assert.rejects(()=>send({type:'legal.change.assess',changeId:change.id,expectedRecordVersion:change.version,oldHash:'wrong',newHash:change.newHash,decision:'affected_work',reason:'Stale review',matterIds:[matter.id],learningIds:[],adoptSource:true}),{code:'CHANGE_REVIEW_CHANGED'});
 await send({type:'legal.change.assess',changeId:change.id,expectedRecordVersion:change.version,oldHash:change.oldHash,newHash:change.newHash,decision:'affected_work',reason:'Synthetic reviewer chose this exact matter for follow-up.',matterIds:[matter.id],learningIds:[],adoptSource:true});s=await readWorkspace(owner().tenantId);assert.equal(s.matters.find(m=>m.id===matter.id)!.state,'legal_review');assert.ok(s.matters.find(m=>m.id===matter.id)!.tasks.some(t=>t.evidenceIds.includes(change.id)));assert.equal(s.proposals[0].status,'invalidated');assert.equal(s.legalAuthorities.find(x=>x.id===authorityId)!.verifiedAt,null);assert.equal(s.legalChanges![0].assessment?.adoptedSource,true);
 await transactWorkspace(owner().tenantId,s=>{s.legalWatches![0].nextCheckAt=new Date(0).toISOString();});await processLegalWatch(owner().tenantId,watchId,{fetcher:response(body,'text/html')});assert.equal((await readWorkspace(owner().tenantId)).legalChanges?.length,1);
});
test('three observations keep historical review but block older source adoption and affected-work targeting',async()=>{
 const {watchId,sourceId,authorityId}=await fixture();
 const defined=await send({type:'coverage.define',domain:'synthetic',jurisdiction:'TEST ONLY',authorityIds:[authorityId],limitations:['Fictional test coverage only.']});
 const coverageId=String(defined.result.coverageId),coverage=defined.snapshot.coverage.find(item=>item.id===coverageId)!;
 await send({type:'coverage.review',coverageId,expectedRecordVersion:coverage.version,qualificationEvidence:'Synthetic reviewer qualification for ordering regression.',reviewDueAt:due(),limitations:['Fictional test coverage only.']});
 const made=await send({type:'matter.create',title:'Fictional affected matter',objective:'Test observed source ordering.',scope:{kind:'team',actorIds:[]}}),matterId=String(made.result.matterId);
 for(const body of ['Observed A','Observed B','Observed C']){
  if(body!=='Observed A')await transactWorkspace(owner().tenantId,s=>{s.legalWatches![0].nextCheckAt=new Date(0).toISOString();});
  assert.equal((await processLegalWatch(owner().tenantId,watchId,{fetcher:response(body)})).status,'review_required');
 }
 let s=await readWorkspace(owner().tenantId),[a,b,c]=s.legalChanges!;
 assert.equal(s.legalChanges?.length,3);assert.equal(s.legalWatches![0].lastObservedHash,c.rawHash);assert.equal(coverageStatus(s,owner(),s.coverage.find(item=>item.id===coverageId)!),'stale');
 const assess=(change:typeof a,decision:'no_applicability_change'|'affected_work',adoptSource:boolean)=>send({type:'legal.change.assess',changeId:change.id,expectedRecordVersion:change.version,oldHash:change.oldHash,newHash:change.newHash,decision,reason:'Synthetic exact observation review.',matterIds:decision==='affected_work'?[matterId]:[],learningIds:[],adoptSource});
 await assert.rejects(()=>assess(a,'no_applicability_change',true),{code:'CHANGE_OBSERVATION_SUPERSEDED'});
 await assert.rejects(()=>assess(b,'affected_work',false),{code:'CHANGE_OBSERVATION_SUPERSEDED'});
 s=await readWorkspace(owner().tenantId);assert.equal(s.legalAuthorities.find(item=>item.id===authorityId)!.sourceId,sourceId);assert.equal(s.legalChanges!.filter(item=>item.status==='pending_review').length,3);assert.equal(authorityCurrent(s,owner(),s.legalAuthorities.find(item=>item.id===authorityId)!),false);
 await assess(a,'no_applicability_change',false);await assess(b,'no_applicability_change',false);
 s=await readWorkspace(owner().tenantId);assert.equal(s.legalChanges!.length,3);assert.equal(s.legalChanges!.filter(item=>item.status==='pending_review').length,1);assert.equal(coverageStatus(s,owner(),s.coverage.find(item=>item.id===coverageId)!),'stale');
 await assess(c,'affected_work',true);
 s=await readWorkspace(owner().tenantId);assert.equal(s.legalAuthorities.find(item=>item.id===authorityId)!.sourceId,c.newSourceId);assert.equal(s.legalAuthorities.find(item=>item.id===authorityId)!.verifiedAt,null);assert.equal(coverageStatus(s,owner(),s.coverage.find(item=>item.id===coverageId)!),'pending_review');
});
test('a replacement watch seeing original bytes supersedes the old watch change without creating another change',async()=>{
 const {watchId:oldWatchId,sourceId,authorityId}=await fixture();
 assert.equal((await processLegalWatch(owner().tenantId,oldWatchId,{fetcher:response('Observed A')})).status,'review_required');
 let s=await readWorkspace(owner().tenantId),change=s.legalChanges![0],oldWatch=s.legalWatches!.find(item=>item.id===oldWatchId)!;
 assert.ok(Number.isSafeInteger(oldWatch.lastObservedWorkspaceVersion));
 await send({type:'legal.watch.stop',watchId:oldWatchId,expectedRecordVersion:oldWatch.version});
 s=await readWorkspace(owner().tenantId);
 const replacement=await send({type:'legal.watch.configure',authorityId,expectedAuthorityVersion:s.legalAuthorities.find(item=>item.id===authorityId)!.version,intervalHours:24}),newWatchId=String(replacement.result.watchId);
 assert.equal((await processLegalWatch(owner().tenantId,newWatchId,{fetcher:response('Original source text.')})).status,'review_required');
 s=await readWorkspace(owner().tenantId);assert.equal(s.legalChanges!.length,1,'unchanged replacement read adds no change record');
 const newWatch=s.legalWatches!.find(item=>item.id===newWatchId)!;
 assert.ok(newWatch.lastObservedWorkspaceVersion!>oldWatch.lastObservedWorkspaceVersion!);
 assert.notEqual(newWatch.lastObservedHash,change.rawHash);
 await assert.rejects(()=>send({type:'legal.change.assess',changeId:change.id,expectedRecordVersion:change.version,oldHash:change.oldHash,newHash:change.newHash,decision:'no_applicability_change',reason:'Older watch observation must not become current.',matterIds:[],learningIds:[],adoptSource:true}),{code:'CHANGE_OBSERVATION_SUPERSEDED'});
 s=await readWorkspace(owner().tenantId);assert.equal(s.legalAuthorities.find(item=>item.id===authorityId)!.sourceId,sourceId);assert.equal(s.legalChanges![0].status,'pending_review');assert.equal(authorityCurrent(s,owner(),s.legalAuthorities.find(item=>item.id===authorityId)!),false);
});
test('an unsequenced legacy observation cannot adopt until a fresh exact check',async()=>{
 const {watchId,authorityId}=await fixture();
 await processLegalWatch(owner().tenantId,watchId,{fetcher:response('Observed legacy A')});
 await transactWorkspace(owner().tenantId,s=>{delete s.legalWatches![0].lastObservedWorkspaceVersion;s.legalWatches![0].nextCheckAt=new Date(0).toISOString();});
 let s=await readWorkspace(owner().tenantId),change=s.legalChanges![0];
 const adopt=()=>send({type:'legal.change.assess',changeId:change.id,expectedRecordVersion:change.version,oldHash:change.oldHash,newHash:change.newHash,decision:'no_applicability_change',reason:'Synthetic reviewed latest source.',matterIds:[],learningIds:[],adoptSource:true});
 await assert.rejects(adopt,{code:'CHANGE_OBSERVATION_SUPERSEDED'});
 assert.equal((await processLegalWatch(owner().tenantId,watchId,{fetcher:response('Observed legacy A')})).status,'review_required');
 s=await readWorkspace(owner().tenantId);assert.equal(s.legalChanges!.length,1);assert.ok(Number.isSafeInteger(s.legalWatches![0].lastObservedWorkspaceVersion));
 await adopt();s=await readWorkspace(owner().tenantId);assert.equal(s.legalAuthorities.find(item=>item.id===authorityId)!.sourceId,change.newSourceId);
});
test('source or member withdrawal while a public read is pending prevents observed payload admission',async()=>{
 const {watchId,sourceId}=await fixture();const result=await processLegalWatch(owner().tenantId,watchId,{fetcher:async()=>{await send({type:'source.revoke',sourceId,reason:'Withdraw while source check is in flight'});return new Response('Never admit this later source body.',{headers:{'content-type':'text/plain'}});}});assert.equal(result.status,'stopped');assert.equal(result.complete,true);const s=await readWorkspace(owner().tenantId);assert.equal(s.sources.length,1);assert.equal(s.legalChanges?.length,0);assert.doesNotMatch(JSON.stringify(s),/Never admit this later source body/);
});
test('bounded extraction and public address policy reject binary, private and mapped destinations',()=>{
 for(const value of ['127.0.0.1','10.2.3.4','169.254.169.254','172.16.1.1','192.168.2.1','100.64.2.3','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001::1234','2002:7f00:1::1'])assert.equal(publicLegalAddress(value),false,value);for(const value of ['8.8.8.8','2606:4700:4700::1111'])assert.equal(publicLegalAddress(value),true,value);assert.throws(()=>extractLegalSource(new Uint8Array([255,255]),'text/plain'),{code:'LEGAL_SOURCE_ENCODING'});assert.equal(extractLegalSource(Buffer.from('<p>A &amp; B</p><script>not source text</script>'),'text/html'),'A & B');assert.equal(extractLegalSource(Buffer.from('<h3>&sect;105 &ndash; title &mdash; note &#167; &#x2014;</h3>'),'text/html'),'§105 – title — note § —');
 assert.throws(()=>extractLegalSource(Buffer.from('<!DOCTYPE CFRGRANULE><CFRGRANULE><SECTION>Unsafe</SECTION></CFRGRANULE>'),'application/xml'),{code:'LEGAL_SOURCE_FORMAT'});
 assert.throws(()=>extractLegalSource(Buffer.from('<html>GovInfo error</html>'),'application/xml'),{code:'LEGAL_SOURCE_FORMAT'});
});

test('unsupported and oversized reads remain blocked; deletion removes the staged observed payload and stops its watch',async()=>{
 const {watchId,sourceId}=await fixture();await processLegalWatch(owner().tenantId,watchId,{fetcher:response('%PDF not a supported monitored representation','application/pdf')});let s=await readWorkspace(owner().tenantId);assert.equal(s.legalWatches![0].failureCode,'LEGAL_SOURCE_FORMAT');assert.equal(s.sources.length,1);
 await transactWorkspace(owner().tenantId,s=>{s.legalWatches![0].nextCheckAt=new Date(0).toISOString();});await processLegalWatch(owner().tenantId,watchId,{fetcher:response('x'.repeat(10001))});s=await readWorkspace(owner().tenantId);assert.equal(s.legalWatches![0].failureCode,'LEGAL_SOURCE_CAPACITY');assert.equal(s.legalChanges?.length,0);
 await transactWorkspace(owner().tenantId,s=>{s.legalWatches![0].nextCheckAt=new Date(0).toISOString();});await processLegalWatch(owner().tenantId,watchId,{fetcher:response('SECRET-MONITORED-CONTENT')});await send({type:'source.revoke',sourceId,delete:true,reason:'Remove the synthetic maintenance lineage'});s=await readWorkspace(owner().tenantId);assert.doesNotMatch(JSON.stringify(s),/SECRET-MONITORED-CONTENT/);assert.equal(s.legalWatches![0].active,false);assert.equal((await snapshot(owner())).legalMaintenance.changes.length,0);
});
