import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {completeQueuedWithdrawal} from './support/withdrawal';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,snapshot} from '../src/v2/service';
import {closeV2Store,readWorkspace,transactWorkspace,validateWorkspace} from '../src/v2/store';
import {applySourceDeletion,redactHistoricalWorkspace} from '../src/v2/retention';
import {retainIntakeOriginal,purgeExpiredIntakes,reconcileIntakeOriginal} from '../src/v2/artifact-intake';
import {processDeletionJob,originalHeldElsewhere} from '../src/v2/retention-worker';
import {retainOriginal,purgeOriginal,readOriginal} from '../src/v2/objects';
import {purgeS3Original} from '../src/v2/s3-originals';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';
import {identityBindingKey} from '../src/v2/oidc-identities';
const dirs:string[]=[];let sequence=0;
beforeEach(async()=>{await closeV2Store();const dir=await mkdtemp(join(tmpdir(),'kiara-retention-'));dirs.push(dir);process.env.KIARA_V2_DATA_DIR=dir;process.env.KIARA_ORIGINALS_DIR=join(dir,'originals');delete process.env.MONGODB_URI;delete process.env.KIARA_ORIGINALS_MODE;process.env.KIARA_V2_AI_MODE='local';});
after(async()=>{await closeV2Store();delete process.env.KIARA_ORIGINALS_DIR;await Promise.all(dirs.map(d=>rm(d,{recursive:true,force:true})));});
const owner=():ActorContext=>({tenantId:'retention-test',actorId:'owner',mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','business_owner','fact_owner','admin']});
const send=async(a:ActorContext,c:WorkspaceCommand,trusted?:{originalObjectRef?:string})=>{const result=await command(a,{idempotencyKey:`retention-${++sequence}`,expectedVersion:(await snapshot(a)).version,command:c},trusted);if(c.type==='source.revoke'){await completeQueuedWithdrawal(a.tenantId,c.sourceId);return {...result,snapshot:await snapshot(a)};}return result;};
const code=(value:string)=>(e:unknown)=>(e as {code:string}).code===value;
test('revocation during original retention leaves a tracked cleanup receipt and cannot attach the bytes',async()=>{
 const issuer='https://issuer.example.test',subject='retention-subject',saved={source:process.env.KIARA_OIDC_IDENTITY_SOURCE,issuer:process.env.KIARA_OIDC_ISSUER,identities:process.env.KIARA_OIDC_IDENTITIES};
 const a=owner();await snapshot(a);process.env.KIARA_OIDC_IDENTITY_SOURCE='fixture_env';process.env.KIARA_OIDC_ISSUER=issuer;process.env.KIARA_OIDC_IDENTITIES=JSON.stringify([{subject,tenantId:a.tenantId,actorId:a.actorId}]);
 const signed:ActorContext={tenantId:a.tenantId,actorId:a.actorId,mode:'authenticated',expiresAt:Date.now()+3600000,oidcBinding:{key:identityBindingKey(issuer,subject),version:1}};
 try{const bytes=Buffer.from('Revoked during original write'),initial=await snapshot(signed);
  await assert.rejects(()=>retainIntakeOriginal(signed,'revoked-mid-write',bytes,initial.version,{retain:async(tenant,input)=>{const ref=await retainOriginal(tenant,input);process.env.KIARA_OIDC_IDENTITIES='[]';return ref;}}),code('IDENTITY_GRANT_CHANGED'));
  const state=await readWorkspace(a.tenantId),jobs=Object.entries(state.receipts).filter(([key])=>key.startsWith('artifact-intake:')).map(([,value])=>value.result.intake as {reference:string|null;status:string});
  assert.equal(state.sources.length,0);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'retained');assert.ok(jobs[0].reference);assert.ok(state.outbox.some(job=>job.kind==='artifact_cleanup'));
 }finally{for(const [name,value] of Object.entries({KIARA_OIDC_IDENTITY_SOURCE:saved.source,KIARA_OIDC_ISSUER:saved.issuer,KIARA_OIDC_IDENTITIES:saved.identities}))if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
async function setup(){const a=owner(),bytes=Buffer.from('SECRET-SOURCE obligation and confidential terms.'),ref=await retainOriginal(a.tenantId,bytes);let r=await send(a,{type:'document.add',title:'SECRET-SOURCE agreement',body:bytes.toString(),authority:'executed',kind:'agreement'},{originalObjectRef:JSON.stringify(ref)});const doc=r.snapshot.documents[0];r=await send(a,{type:'fact.propose',predicate:'SECRET-SOURCE retention',value:'SECRET-SOURCE practice',sourceIds:[doc.sourceId],practice:'planned'});const fact=r.snapshot.facts[0];await send(a,{type:'fact.confirm',factId:fact.id,expectedRecordVersion:fact.version,expectedOriginVersion:fact.originVersion});r=await send(a,{type:'matter.create',title:'SECRET-SOURCE review',objective:'SECRET-SOURCE change',scope:{kind:'team',actorIds:[]}});const m=r.snapshot.matters[0];const objective=await send(a,{type:'fact.propose',predicate:'business_objective',value:m.objective,practice:'planned',sourceIds:[doc.sourceId]}),objectiveFact=objective.snapshot.facts.at(-1)!;await send(a,{type:'fact.confirm',factId:objectiveFact.id,expectedRecordVersion:objectiveFact.version,expectedOriginVersion:objectiveFact.originVersion});r=await send(a,{type:'matter.prepare',matterId:m.id,expectedRecordVersion:m.version});const p=r.snapshot.proposals[0];await send(a,{type:'action.plan',matterId:m.id,proposalId:p.id,kind:'internal_document',title:'SECRET-SOURCE output',content:p.body});const reviewed=(await snapshot(a)).matters.find(item=>item.id===m.id)!;await send(a,{type:'learning.propose',matterId:m.id,expectedOriginVersion:reviewed.version,expectedOriginTitle:reviewed.title,expectedOriginScope:reviewed.scope,title:'SECRET-SOURCE lesson',rule:'SECRET-SOURCE rule',kind:'procedure',scopeDescription:'SECRET-SOURCE scope'});return {a,doc,ref,bytes,m};}

test('deletion propagates through records and audit payloads while exposing only safe pending-retention status',async()=>{
 const {a,doc,ref,bytes,m}=await setup(),before=await readWorkspace(a.tenantId);const deleted=await send(a,{type:'source.revoke',sourceId:doc.sourceId,reason:'Requested removal',delete:true});const s=await readWorkspace(a.tenantId);assert.doesNotMatch(JSON.stringify(s),/SECRET-SOURCE/);assert.ok(s.deletionJobs![0].records.some(r=>r.kind==='events'));assert.equal(deleted.snapshot.deletions[0].backupStatus,'operator_verification_required');assert.equal(deleted.snapshot.deletions[0].originalsPending,1);assert.equal(deleted.snapshot.documents.length,0);assert.equal(deleted.snapshot.matters.length,1,'only safe source-independent corrective work remains visible');assert.notEqual(deleted.snapshot.matters[0].id,m.id);assert.ok(deleted.snapshot.attention.items.some(item=>item.matterId===deleted.snapshot.matters[0].id));assert.equal('deletionJobs' in deleted.snapshot,false);assert.deepEqual(await readOriginal(a.tenantId,ref),bytes);validateWorkspace(s,before);
 const history=structuredClone(before);redactHistoricalWorkspace(history,s.deletionJobs![0]);assert.doesNotMatch(JSON.stringify(history),/SECRET-SOURCE/);assert.ok(history.tombstones.some(t=>t.sourceId===doc.sourceId));
 await assert.rejects(()=>send(a,{type:'document.add',title:'Race with purge',body:bytes.toString(),authority:'draft'},{originalObjectRef:JSON.stringify(ref)}),code('ORIGINAL_DELETION_FENCED'));
 const illegal=structuredClone(s);illegal.events[0].detail='Unrelated forged history';assert.throws(()=>validateWorkspace(illegal,s),code('IMMUTABLE_HISTORY'));
});
test('uncertain effects remain protected exceptions until settled, then repeated cleanup erases the payload',async()=>{
 const {a,doc}=await setup();await transactWorkspace(a.tenantId,s=>{s.actions[0].status='uncertain';});await send(a,{type:'source.revoke',sourceId:doc.sourceId,reason:'Requested removal',delete:true});let s=await readWorkspace(a.tenantId);assert.equal(s.deletionJobs![0].operationalExceptionActionIds.length,1);assert.match(s.actions[0].content,/SECRET-SOURCE/);assert.equal((await snapshot(a)).actions.length,0);
 await transactWorkspace(a.tenantId,s=>{s.actions[0].status='failed';});await transactWorkspace(a.tenantId,s=>applySourceDeletion(s,a,doc.sourceId));s=await readWorkspace(a.tenantId);assert.equal(s.deletionJobs![0].operationalExceptionActionIds.length,0);assert.equal(s.actions[0].content,'');assert.doesNotMatch(JSON.stringify(s),/SECRET-SOURCE/);
});
test('local original deletion is tenant scoped, exact, verified and replayable',async()=>{
 const a=owner(),reference=await retainOriginal(a.tenantId,Buffer.from('Source to erase'));await assert.rejects(()=>purgeOriginal('different-tenant',reference),code('ORIGINAL_SCOPE'));await purgeOriginal(a.tenantId,reference);await purgeOriginal(a.tenantId,reference);await assert.rejects(()=>readOriginal(a.tenantId,reference),(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT');
});
test('S3 purge targets the retained version, verifies absence and never treats forbidden/readback as success',async()=>{
 const saved={...process.env};Object.assign(process.env,{KIARA_ORIGINALS_S3_BUCKET:'test',AWS_REGION:'us-east-1',KIARA_ORIGINALS_KMS_KEY_ID:'arn:aws:kms:us-east-1:123456789012:key/test'});
 try{const {createHash}=await import('node:crypto');const tenant='retention-test',sha256='a'.repeat(64),reference={storage:'s3_kms' as const,encryption:'aws-kms' as const,key:`${createHash('sha256').update(tenant).digest('hex')}/${sha256}`,sha256,bytes:10,keyId:process.env.KIARA_ORIGINALS_KMS_KEY_ID!,versionId:'exact-version'};const seen:any[]=[];
 await purgeS3Original(tenant,reference,{send:async(c:any)=>{seen.push(c);if(c.constructor.name==='HeadObjectCommand')throw Object.assign(new Error('Absent'),{$metadata:{httpStatusCode:404}});return {};}});assert.equal(seen.length,2);assert.ok(seen.every(c=>c.input.VersionId==='exact-version'));assert.equal(seen[0].input.BypassGovernanceRetention,undefined);
 await assert.rejects(()=>purgeS3Original(tenant,reference,{send:async()=>({})}),code('ORIGINAL_PURGE_UNVERIFIED'));await assert.rejects(()=>purgeS3Original(tenant,reference,{send:async()=>{throw Object.assign(new Error('Held'),{$metadata:{httpStatusCode:403}});}}),/Held/);
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});


test('original intake hands off only its own storage revisions and abandoned bytes are fenced before cleanup',async()=>{
 const a=owner(),initial=await snapshot(a),bytes=Buffer.from('Abandoned input');const intake=await retainIntakeOriginal(a,'abandoned-key',bytes,initial.version);assert.ok(intake.expectedVersion>initial.version);
 await assert.rejects(()=>retainIntakeOriginal(a,'stale-other-key',bytes,initial.version),code('VERSION_CONFLICT'));
 await transactWorkspace(a.tenantId,s=>{for(const receipt of Object.values(s.receipts)){const job=receipt.result.intake as {expiresAt:string}|undefined;if(job)job.expiresAt=new Date(0).toISOString();}});const cleanup=await purgeExpiredIntakes(a.tenantId);assert.equal(cleanup.purged,1);await assert.rejects(()=>readOriginal(a.tenantId,intake.reference));await assert.rejects(()=>send(a,{type:'document.add',title:'Late attachment',body:bytes.toString(),authority:'draft'},{originalObjectRef:JSON.stringify(intake.reference)}),code('ORIGINAL_DELETION_FENCED'));
 const current=await snapshot(a),attached=await retainIntakeOriginal(a,'attached-key',Buffer.from('Retained input'),current.version);const envelope={idempotencyKey:'attached-key',expectedVersion:attached.expectedVersion,command:{type:'document.add',title:'Attached original',body:'Retained input',authority:'draft'} as const};await command(a,envelope,{originalObjectRef:JSON.stringify(attached.reference)});const replay=await retainIntakeOriginal(a,'attached-key',Buffer.from('Retained input'),current.version);assert.equal((await command(a,{...envelope,expectedVersion:replay.expectedVersion},{originalObjectRef:JSON.stringify(replay.reference)})).replayed,true);
});
test('retention worker honors original delay, shared pending intake and hold, then verifies exact purge',async()=>{
 const {a,doc,ref}=await setup();await send(a,{type:'source.revoke',sourceId:doc.sourceId,reason:'Requested removal',delete:true});let s=await readWorkspace(a.tenantId),job=s.deletionJobs![0];let r=await processDeletionJob(a.tenantId,job.id);assert.equal(r.originalsPending,1);assert.equal(r.externalBackupErasureVerified,false);
 const state=structuredClone(s);state.receipts['artifact-intake:other']={hash:'fixture',result:{intake:{reference:JSON.stringify(ref),status:'retained',expiresAt:new Date(Date.now()+3600000).toISOString()}}};assert.equal(originalHeldElsewhere(state,job,JSON.stringify(ref)),true);
 delete state.receipts['artifact-intake:other'];state.receipts['migration-archive:fixture']={hash:'fixture',result:{archive:{status:'staging',contentHash:ref.sha256,reference:null}}};assert.equal(originalHeldElsewhere(state,job,JSON.stringify(ref)),true);
 (state.receipts['migration-archive:fixture'].result.archive as {status:string;reference:string|null}).reference=JSON.stringify(ref);assert.equal(originalHeldElsewhere(state,job,JSON.stringify(ref)),true);
 delete state.receipts['migration-archive:fixture'];state.migration={sourceHash:'fixture',legacyArchive:{original:ref},importedAt:new Date().toISOString(),effectOwner:'legacy',status:'imported_read_only'} as typeof state.migration;assert.equal(originalHeldElsewhere(state,job,JSON.stringify(ref)),true);
 await transactWorkspace(a.tenantId,s=>{s.deletionJobs![0].originals[0].notBefore=new Date(0).toISOString();});process.env.KIARA_RETENTION_HOLD='true';try{r=await processDeletionJob(a.tenantId,job.id);assert.equal(r.originalsPending,1);assert.equal((await readWorkspace(a.tenantId)).deletionJobs![0].originals[0].status,'hold');}finally{delete process.env.KIARA_RETENTION_HOLD;}
 r=await processDeletionJob(a.tenantId,job.id);assert.equal(r.applicationCleanupComplete,true);assert.equal(r.externalBackupErasureVerified,false);await assert.rejects(()=>readOriginal(a.tenantId,ref));assert.equal((await processDeletionJob(a.tenantId,job.id)).applicationCleanupComplete,true);
});
test('a later deletion job keeps shared original bytes until its own retention deadline',async()=>{
 const a=owner(),bytes=Buffer.from('Two sources share the same retained original'),ref=await retainOriginal(a.tenantId,bytes);
 const firstAdd=await send(a,{type:'document.add',title:'First shared source',body:bytes.toString(),authority:'draft'},{originalObjectRef:JSON.stringify(ref)});
 const secondAdd=await send(a,{type:'document.add',title:'Second shared source',body:bytes.toString(),authority:'draft'},{originalObjectRef:JSON.stringify(ref)});
 const firstSourceId=firstAdd.snapshot.documents[0].sourceId,secondSourceId=secondAdd.snapshot.documents.at(-1)!.sourceId;
 assert.notEqual(firstSourceId,secondSourceId);
 await send(a,{type:'source.revoke',sourceId:firstSourceId,reason:'First deletion',delete:true});
 const first=(await readWorkspace(a.tenantId)).deletionJobs![0];
 assert.equal(originalHeldElsewhere(await readWorkspace(a.tenantId),first,JSON.stringify(ref)),true);
 await send(a,{type:'source.revoke',sourceId:secondSourceId,reason:'Later deletion',delete:true});
 const current=await readWorkspace(a.tenantId);
 assert.equal(current.deletionJobs?.length,2);
 await transactWorkspace(a.tenantId,s=>{s.deletionJobs![0].originals[0].notBefore=new Date(0).toISOString();s.deletionJobs![1].originals[0].notBefore=new Date(Date.now()+86400000).toISOString();});
 assert.equal(originalHeldElsewhere(await readWorkspace(a.tenantId),first,JSON.stringify(ref)),true);
 const result=await processDeletionJob(a.tenantId,first.id);
 assert.equal(result.originalsPending,1);
 assert.deepEqual(await readOriginal(a.tenantId,ref),bytes);
 await transactWorkspace(a.tenantId,s=>{s.deletionJobs![1].originals[0].notBefore=new Date(0).toISOString();});
 const completed=await processDeletionJob(a.tenantId,first.id);
 assert.equal(completed.applicationCleanupComplete,true);
 await assert.rejects(()=>readOriginal(a.tenantId,ref));
});
test('retention worker records its purge claim before calling the physical adapter',async()=>{
 const {a,doc,ref}=await setup();
 await send(a,{type:'source.revoke',sourceId:doc.sourceId,reason:'Claim test',delete:true});
 const job=(await readWorkspace(a.tenantId)).deletionJobs![0];
 await transactWorkspace(a.tenantId,s=>{s.deletionJobs![0].originals[0].notBefore=new Date(0).toISOString();});
 let observed=false;
 const result=await processDeletionJob(a.tenantId,job.id,{original:async(tenant,reference)=>{
  const current=await readWorkspace(tenant);
  assert.equal(current.deletionJobs![0].originals[0].status,'purging');
  observed=true;
  await purgeOriginal(tenant,reference);
 }});
 assert.equal(observed,true);
 assert.equal(result.applicationCleanupComplete,true);
 await assert.rejects(()=>readOriginal(a.tenantId,ref));
});
test('a second worker cannot dispatch physical purge while the first claim is active',async()=>{
 const {a,doc,ref,bytes}=await setup();
 await send(a,{type:'source.revoke',sourceId:doc.sourceId,reason:'Concurrent purge claim',delete:true});
 const job=(await readWorkspace(a.tenantId)).deletionJobs![0];
 await transactWorkspace(a.tenantId,s=>{s.deletionJobs![0].originals[0].notBefore=new Date(0).toISOString();});
 let entered!:()=>void,released!:()=>void,physicalCalls=0;
 const firstEntered=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>released=resolve);
 const first=processDeletionJob(a.tenantId,job.id,{original:async(tenant,reference)=>{physicalCalls++;entered();await gate;await purgeOriginal(tenant,reference);}});
 await firstEntered;
 try{
  const second=await processDeletionJob(a.tenantId,job.id,{original:async(tenant,reference)=>{physicalCalls++;await purgeOriginal(tenant,reference);}});
  assert.equal(physicalCalls,1);
  assert.equal(second.originalsPending,1);
  assert.deepEqual(await readOriginal(a.tenantId,ref),bytes);
 }finally{released();await first;}
 assert.equal((await readWorkspace(a.tenantId)).deletionJobs![0].originals[0].status,'purged');
});
test('an expired purge claim recovers without letting the old worker overwrite completion',async()=>{
 const {a,doc,ref}=await setup();
 await send(a,{type:'source.revoke',sourceId:doc.sourceId,reason:'Crash recovery claim',delete:true});
 const job=(await readWorkspace(a.tenantId)).deletionJobs![0];
 await transactWorkspace(a.tenantId,s=>{s.deletionJobs![0].originals[0].notBefore=new Date(0).toISOString();});
 let entered!:()=>void,released!:()=>void;
 const firstEntered=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>released=resolve);
 const stale=processDeletionJob(a.tenantId,job.id,{original:async()=>{entered();await gate;throw new Error('Old worker lost its result');}});
 await firstEntered;
 await transactWorkspace(a.tenantId,s=>{s.deletionJobs![0].originals[0].claimExpiresAt=new Date(0).toISOString();});
 const recovered=await processDeletionJob(a.tenantId,job.id,{original:purgeOriginal});
 assert.equal(recovered.applicationCleanupComplete,true);
 released();
 const old=await stale;
 assert.equal(old.failures.length,0);
 assert.equal((await readWorkspace(a.tenantId)).deletionJobs![0].originals[0].status,'purged');
 await assert.rejects(()=>readOriginal(a.tenantId,ref));
});
test('one due deletion claim holds a second due owner of the same original',async()=>{
 const a=owner(),bytes=Buffer.from('Two due owners, one physical original'),ref=await retainOriginal(a.tenantId,bytes);
 const first=await send(a,{type:'document.add',title:'Owner one',body:bytes.toString(),authority:'draft'},{originalObjectRef:JSON.stringify(ref)});
 const second=await send(a,{type:'document.add',title:'Owner two',body:bytes.toString(),authority:'draft'},{originalObjectRef:JSON.stringify(ref)});
 await send(a,{type:'source.revoke',sourceId:first.snapshot.documents[0].sourceId,reason:'First owner delete',delete:true});
 await send(a,{type:'source.revoke',sourceId:second.snapshot.documents.at(-1)!.sourceId,reason:'Second owner delete',delete:true});
 const jobs=(await readWorkspace(a.tenantId)).deletionJobs!;
 await transactWorkspace(a.tenantId,s=>{for(const job of s.deletionJobs!)for(const original of job.originals)original.notBefore=new Date(0).toISOString();});
 let entered!:()=>void,released!:()=>void,physicalCalls=0;
 const firstEntered=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>released=resolve);
 const firstRun=processDeletionJob(a.tenantId,jobs[0].id,{original:async(tenant,reference)=>{physicalCalls++;entered();await gate;await purgeOriginal(tenant,reference);}});
 await firstEntered;
 try{
  const other=await processDeletionJob(a.tenantId,jobs[1].id,{original:async(tenant,reference)=>{physicalCalls++;await purgeOriginal(tenant,reference);}});
  assert.equal(physicalCalls,1);
  assert.equal(other.originalsPending,1);
  assert.equal((await readWorkspace(a.tenantId)).deletionJobs![1].originals[0].status,'shared_reference');
  assert.deepEqual(await readOriginal(a.tenantId,ref),bytes);
 }finally{released();await firstRun;}
 assert.equal((await processDeletionJob(a.tenantId,jobs[1].id)).applicationCleanupComplete,true);
});
test('an expired attached intake cannot purge bytes owned by a pending deletion job',async()=>{
 const a=owner(),bytes=Buffer.from('Shared attached intake under retention'),initial=await snapshot(a);
 const intake=await retainIntakeOriginal(a,'retained-shared-intake',bytes,initial.version);
 const added=await send(a,{type:'document.add',title:'Shared intake',body:bytes.toString(),authority:'draft'},{originalObjectRef:JSON.stringify(intake.reference)});
 const sourceId=added.snapshot.documents[0].sourceId;
 await send(a,{type:'source.revoke',sourceId,reason:'Retain before purge',delete:true});
 await transactWorkspace(a.tenantId,s=>{for(const [key,receipt] of Object.entries(s.receipts))if(key.startsWith('artifact-intake:'))(receipt.result.intake as {expiresAt:string}).expiresAt=new Date(0).toISOString();});
 const swept=await purgeExpiredIntakes(a.tenantId);
 assert.equal(swept.purged,0);
 assert.deepEqual(await readOriginal(a.tenantId,intake.reference),bytes);
});
test('revoked-source owner controls allow a later scoped deletion without recovering content',async()=>{
 const {a,doc}=await setup();await send(a,{type:'source.revoke',sourceId:doc.sourceId,reason:'Withdraw access first'});const removed=await snapshot(a);assert.equal(removed.sources.length,0);assert.ok(removed.recovery.sources.some(s=>s.id===doc.sourceId));const deleted=await send(a,{type:'source.revoke',sourceId:doc.sourceId,delete:true,reason:'Then apply deletion policy'});assert.equal(deleted.snapshot.sources.length,0);assert.equal(deleted.snapshot.deletions.length,1);
});

test('pending intake blocks physical purge by content identity and deleted bytes cannot be re-created by later intake',async()=>{
 const {a,doc,ref,bytes}=await setup();let released!:()=>void,started!:()=>void;const waiting=new Promise<void>(resolve=>released=resolve),entered=new Promise<void>(resolve=>started=resolve);const initial=await snapshot(a);const held=retainIntakeOriginal(a,'inflight-other-upload',bytes,initial.version,{retain:async()=>{started();await waiting;return ref;}});await entered;
 await send(a,{type:'source.revoke',sourceId:doc.sourceId,reason:'Delete while a admitted original writer is paused',delete:true});let s=await readWorkspace(a.tenantId);assert.equal(originalHeldElsewhere(s,s.deletionJobs![0],JSON.stringify(ref)),true);released();await assert.rejects(()=>held,code('VERSION_CONFLICT'));
 const current=await snapshot(a);await assert.rejects(()=>retainIntakeOriginal(a,'late-recreation',bytes,current.version),code('ORIGINAL_DELETION_FENCED'));
});

test('interrupted original writes require exact verified manifest recovery before orphan cleanup',async()=>{
 const a=owner(),bytes=Buffer.from('Object accepted but intake receipt lost.'),reference=await retainOriginal(a.tenantId,bytes),current=await snapshot(a);
 await assert.rejects(()=>retainIntakeOriginal(a,'interrupted-write',bytes,current.version,{retain:async()=>{throw new Error('Process lost receipt after provider acceptance');}}),/Process lost receipt/);
 let intakeId='';await transactWorkspace(a.tenantId,s=>{for(const receipt of Object.values(s.receipts)){const intake=receipt.result.intake as {id:string;expiresAt:string}|undefined;if(intake){intakeId=intake.id;intake.expiresAt=new Date(0).toISOString();}}});
 assert.equal((await purgeExpiredIntakes(a.tenantId)).unresolved,1);assert.deepEqual(await readOriginal(a.tenantId,reference),bytes);
 await assert.rejects(()=>reconcileIntakeOriginal(a.tenantId,intakeId,{...reference,bytes:reference.bytes+1}),code('ORIGINAL_INTEGRITY'));
 const other=await retainOriginal('other-tenant',bytes);await assert.rejects(()=>reconcileIntakeOriginal(a.tenantId,intakeId,other),code('ORIGINAL_SCOPE'));
 const recovery=await reconcileIntakeOriginal(a.tenantId,intakeId,reference);assert.equal(recovery.verified,true);assert.equal((await purgeExpiredIntakes(a.tenantId)).purged,1);await assert.rejects(()=>readOriginal(a.tenantId,reference));
 await assert.rejects(()=>reconcileIntakeOriginal(a.tenantId,intakeId,reference),code('INTAKE_EXPIRED'));
});

test('an orphan purge claim fences all same-byte intakes until its exact deletion finishes',async()=>{
 const a=owner(),bytes=Buffer.from('Orphan purge interleave.'),initial=await snapshot(a),first=await retainIntakeOriginal(a,'old-orphan',bytes,initial.version);let intakeKey='';
 await transactWorkspace(a.tenantId,s=>{intakeKey=Object.keys(s.receipts).find(key=>key.startsWith('artifact-intake:'))!;const i=s.receipts[intakeKey].result.intake as {status:string};i.status='purging';});
 let reads=0;await assert.rejects(()=>retainIntakeOriginal(a,'racing-intake',bytes,(0),{retain:async()=>{reads++;return first.reference;}}),code('ORIGINAL_PURGE_IN_PROGRESS'));assert.equal(reads,0);
 await purgeOriginal(a.tenantId,first.reference);await transactWorkspace(a.tenantId,s=>{(s.receipts[intakeKey].result.intake as {status:string}).status='purged';});const current=await snapshot(a),fresh=await retainIntakeOriginal(a,'fresh-after-purge',bytes,current.version);assert.deepEqual(await readOriginal(a.tenantId,fresh.reference),bytes);
 const applied=await command(a,{idempotencyKey:'fresh-after-purge',expectedVersion:fresh.expectedVersion,command:{type:'document.add',title:'Fresh reviewed intake',body:bytes.toString(),authority:'draft'}},{originalObjectRef:JSON.stringify(fresh.reference)});assert.equal(applied.snapshot.documents.length,1);
});
