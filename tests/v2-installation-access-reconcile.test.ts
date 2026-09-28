import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canRead} from '../src/v2/authority';
import {checkInstallationAccess,reconcileInstallationAccess,retryInstallationAccessOwner} from '../src/v2/integrations/access-reconcile';
import type {EmailInstallation} from '../src/v2/integrations/email-config';
import type {Installation} from '../src/v2/integrations/config';
import {snapshot,snapshotFromState} from '../src/v2/service';
import {closeV2Store,digest,readWorkspace,timestamp,transactWorkspace} from '../src/v2/store';
import type {Action,ActorContext,Approval,Matter,Proposal,RecordBase,Scope,Source,WorkspaceState} from '../src/v2/contracts';

const owner=(tenantId:string):ActorContext=>({tenantId,actorId:'owner',mode:'authenticated',expiresAt:Date.now()+60_000});
const team={kind:'team' as const,actorIds:[] as string[]};
const base=(s:WorkspaceState,id:string,scope:Scope=team,actorId='owner'):RecordBase=>({id,tenantId:s.tenantId,version:1,createdAt:timestamp(),updatedAt:timestamp(),scope:structuredClone(scope),provenance:{actorId,sourceIds:[],description:'Synthetic installation access test'}});
function provider(id:string,kind:Installation['provider'],tenantId:string):Installation{return {id,provider:kind,tenantId,actorId:`integration-${id}`,enabled:true,tokenEnv:'TEST_PROVIDER_TOKEN',webhookSecretEnv:'TEST_PROVIDER_SECRET',resources:['selected-resource'],scope:team};}
function installSource(s:WorkspaceState,i:Installation){
 const id=`source-${i.id}`,source:Source={...base(s,id,i.scope,i.actorId),title:`Private canary ${i.id}`,kind:i.provider,externalId:`${i.id}:selected-resource`,externalRevision:'1',text:`SECRET_${i.id}`,contentHash:digest(`SECRET_${i.id}`),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'unknown',originalObjectRef:null,installationGrant:{installationId:i.id,configurationHash:digest(i)}};
 s.sources.push(source);const matter:Matter={...base(s,`matter-${i.id}`),provenance:{actorId:'owner',sourceIds:[id],description:'Exact retained provider evidence linked to this work'},title:'Review selected provider evidence',objective:'Review an observed change',entityId:s.entityId,state:'business_review',ownerId:'owner',conversationIds:[],scenarioId:null,eventIds:[],sourceIds:[id],factIds:[],documentIds:[],proposalId:null,tasks:[],blockers:[],outcome:null,closedAt:null,ruleVersion:s.ruleVersion};s.matters.push(matter);
 return {source,matter};
}
function addDecisions(s:WorkspaceState,source:Source,matter:Matter){
 const dependencies={sourceVersions:{[source.id]:source.version},factVersions:{},documentHashes:{},policyVersion:s.ruleVersion,scopeHash:digest(team)};
 const proposal:Proposal={...base(s,'proposal',team),provenance:{actorId:'owner',sourceIds:[source.id],description:'Synthetic source-backed proposal'},matterId:matter.id,title:'Reviewed output',body:'Synthetic proposal',contentHash:digest('Synthetic proposal'),baselineRevisionIds:[],dependencies,status:'current',route:'legal_review',noticeMatrix:[],inventoryComplete:false,unknowns:[],supersedesId:null};s.proposals.push(proposal);matter.proposalId=proposal.id;
 const approval:Approval={...base(s,'approval'),matterId:matter.id,proposalId:proposal.id,proposalHash:proposal.contentHash,actionId:null,actionHash:null,capacity:'business',actorId:'owner',membershipVersion:1,dependencies,conditions:[],recipients:[],destination:null,validUntil:new Date(Date.now()+60_000).toISOString(),status:'active',note:'Synthetic'};s.approvals.push(approval);
 const action=(id:string,status:Action['status']):Action=>({...base(s,id),matterId:matter.id,proposalId:proposal.id,kind:'internal_document',title:'Synthetic action',content:'Exact output',contentHash:digest('Exact output'),recipients:[],destination:null,status,authorizationId:status==='authorized'?'approval':null,providerIdempotencyKey:id,providerReceipt:status==='verified'?'prior-receipt':null,completion:status==='verified'?{kind:'readback',artifact:'prior-receipt',verifierId:'owner',verifiedAt:timestamp()}:null,executionOwner:'v2',leaseUntil:null});
 s.actions.push(action('future-action','authorized'),action('historical-action','verified'));
}
async function isolated(run:(tenantId:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'kiara-installation-access-')),tenantId=`access-${randomUUID()}`;
 const prior={root:process.env.KIARA_V2_DATA_DIR,mode:process.env.KIARA_V2_STORE_MODE,mongo:process.env.MONGODB_URI,providers:process.env.KIARA_V2_INSTALLATIONS,providerFile:process.env.KIARA_V2_INSTALLATIONS_FILE,email:process.env.KIARA_V2_EMAIL_INSTALLATIONS,emailFile:process.env.KIARA_V2_EMAIL_INSTALLATIONS_FILE};
 process.env.KIARA_V2_DATA_DIR=root;delete process.env.KIARA_V2_STORE_MODE;delete process.env.MONGODB_URI;delete process.env.KIARA_V2_INSTALLATIONS_FILE;delete process.env.KIARA_V2_EMAIL_INSTALLATIONS_FILE;
 try{await run(tenantId);}finally{await closeV2Store();for(const [key,value] of Object.entries({KIARA_V2_DATA_DIR:prior.root,KIARA_V2_STORE_MODE:prior.mode,MONGODB_URI:prior.mongo,KIARA_V2_INSTALLATIONS:prior.providers,KIARA_V2_INSTALLATIONS_FILE:prior.providerFile,KIARA_V2_EMAIL_INSTALLATIONS:prior.email,KIARA_V2_EMAIL_INSTALLATIONS_FILE:prior.emailFile})){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(root,{recursive:true,force:true});}
}

test('one-shot GitHub, Slack and Drive disable creates owner-visible corrective work on refresh without another webhook',async()=>isolated(async tenantId=>{
 const installations=[provider('gh','github',tenantId),provider('sl','slack',tenantId),provider('dr','drive',tenantId)];process.env.KIARA_V2_INSTALLATIONS=JSON.stringify(installations);
 await transactWorkspace(tenantId,s=>{s.memberships.push({actorId:'owner',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});for(const i of installations){s.memberships.push({actorId:i.actorId,roles:['integration'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});const {source,matter}=installSource(s,i);if(i.provider==='github')addDecisions(s,source,matter);}});
 const before=await snapshot(owner(tenantId));assert.equal(before.matters.length,3);assert.equal(before.sources.length,3);
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify(installations.map(i=>({...i,enabled:false})));
 const denied=await readWorkspace(tenantId);assert.equal(canRead(denied,owner(tenantId),denied.sources[0]),false);assert.equal(canRead(denied,owner(tenantId),denied.matters[0]),false);
 const after=await snapshot(owner(tenantId)),state=await readWorkspace(tenantId);
 assert.equal(after.sources.length,0);assert.equal(after.matters.length,3);assert.ok(after.matters.every(m=>m.title.startsWith('Review work after evidence access changed · EW-')&&m.provenance.sourceIds.length===0&&m.sourceIds.length===0));
 assert.doesNotMatch(JSON.stringify(after),/SECRET_(?:gh|sl|dr)/,'withdrawn source bytes cannot reappear through corrective work');
 assert.equal(state.sources.filter(x=>x.status==='revoked').length,3);assert.equal(state.events.filter(e=>e.type==='source.withdrawal_correction').length,3);assert.equal(state.outbox.filter(o=>o.kind==='matter_changed'&&o.status==='pending').length,3);
 assert.equal(state.proposals[0].status,'invalidated');assert.equal(state.approvals[0].status,'invalidated');assert.equal(state.actions.find(a=>a.id==='future-action')!.status,'planned');assert.equal(state.actions.find(a=>a.id==='historical-action')!.status,'verified');
 await snapshot(owner(tenantId));assert.equal((await readWorkspace(tenantId)).matters.length,6,'refresh is idempotent');
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify(installations);assert.equal((await snapshot(owner(tenantId))).sources.length,0,'restored env does not reactivate revoked evidence');
}));

test('malformed or missing configuration blocks refresh without irreversible revocation; reviewed operator plan applies after repair',async()=>isolated(async tenantId=>{
 const i=provider('gh','github',tenantId);process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([i]);
 await transactWorkspace(tenantId,s=>{s.memberships.push({actorId:'owner',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null},{actorId:i.actorId,roles:['integration'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});installSource(s,i);});
 const before=digest(await readWorkspace(tenantId));process.env.KIARA_V2_INSTALLATIONS='not-json';
 await assert.rejects(snapshot(owner(tenantId)),{code:'INSTALLATION_CONFIG_UNAVAILABLE'});assert.equal(digest(await readWorkspace(tenantId)),before);await assert.rejects(checkInstallationAccess(tenantId),{code:'INSTALLATION_CONFIG_UNAVAILABLE'});
 delete process.env.KIARA_V2_INSTALLATIONS;await assert.rejects(snapshot(owner(tenantId)),{code:'INSTALLATION_CONFIG_UNAVAILABLE'});assert.equal(digest(await readWorkspace(tenantId)),before);
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([{...i,enabled:false}]);const checked=await checkInstallationAccess(tenantId);assert.deepEqual(checked.sourceIds,['source-gh']);
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([i]);await assert.rejects(reconcileInstallationAccess(tenantId,checked.planHash),{code:'INSTALLATION_PLAN_CHANGED'});assert.equal((await readWorkspace(tenantId)).sources[0].status,'active');
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([{...i,enabled:false}]);const current=await checkInstallationAccess(tenantId),result=await reconcileInstallationAccess(tenantId,current.planHash);assert.equal(result.revokedSources,1);assert.equal(result.correctiveMatters,1);const replay=await reconcileInstallationAccess(tenantId,current.planHash);assert.equal(replay.replayed,true);assert.equal((await readWorkspace(tenantId)).matters.length,2);
}));

test('integration membership loss and intentionally empty config have bounded explicit recovery',async()=>isolated(async tenantId=>{
 const i=provider('gh','github',tenantId);process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([i]);
 await transactWorkspace(tenantId,s=>{s.memberships.push({actorId:'owner',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null},{actorId:i.actorId,roles:['integration'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});installSource(s,i);});
 await transactWorkspace(tenantId,s=>{s.memberships.find(m=>m.actorId===i.actorId)!.revokedAt=timestamp();});
 assert.equal((await checkInstallationAccess(tenantId)).sourceIds.length,1);await snapshot(owner(tenantId));assert.equal((await readWorkspace(tenantId)).sources[0].status,'revoked');
 const second=provider('new','github',tenantId);await transactWorkspace(tenantId,s=>{s.memberships.push({actorId:second.actorId,roles:['integration'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});installSource(s,second);});process.env.KIARA_V2_INSTALLATIONS='[]';
 await assert.rejects(snapshot(owner(tenantId)),{code:'INSTALLATION_CONFIG_UNAVAILABLE'});const explicit=await checkInstallationAccess(tenantId,true);assert.deepEqual(explicit.sourceIds,['source-new']);
 await assert.rejects(reconcileInstallationAccess(tenantId,explicit.planHash),{code:'INSTALLATION_CONFIG_UNAVAILABLE'});assert.equal((await reconcileInstallationAccess(tenantId,explicit.planHash,true)).revokedSources,1);
}));

test('email expiry and owner membership drift revoke retained private evidence with no second delivery',async()=>isolated(async tenantId=>{
 const scope={kind:'private' as const,actorIds:['email-integration','owner']},i:EmailInstallation={id:'mail',tenantId,actorId:'email-integration',ownerId:'owner',accountId:'dedicated-account',accountScope:'exclusive_owner',enabled:true,validUntil:new Date(Date.now()+60_000).toISOString(),receivingAddress:'private@example.test',allowedSenders:['sender@example.test'],tokenEnv:'TEST_EMAIL_TOKEN',webhookSecretEnv:'TEST_EMAIL_SECRET',rawDownloadHosts:['example.test'],scope};
 process.env.KIARA_V2_EMAIL_INSTALLATIONS=JSON.stringify([i]);
 await transactWorkspace(tenantId,s=>{s.memberships.push({actorId:'owner',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null},{actorId:i.actorId,roles:['integration'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
  const source:Source={...base(s,'source-mail',scope,i.actorId),title:'Private email canary',kind:'email',externalId:'mail:received:message',externalRevision:'1',text:'EMAIL_SECRET',contentHash:digest('EMAIL_SECRET'),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'unknown',originalObjectRef:null,installationGrant:{installationId:i.id,configurationHash:digest(i)},emailIntake:{receiptId:'receipt',installationId:i.id,ownerId:i.ownerId,status:'accepted'}};s.sources.push(source);s.receipts['email-intake:receipt']={hash:'synthetic',result:{intake:{membershipVersion:1,integrationVersion:1,sourceId:source.id,configurationHash:digest(i)}}};
  const matter:Matter={...base(s,'matter-mail',scope),provenance:{actorId:'owner',sourceIds:[source.id],description:'Exact retained email evidence linked to this work'},title:'Review received email',objective:'Review selected email',entityId:s.entityId,state:'business_review',ownerId:'owner',conversationIds:[],scenarioId:null,eventIds:[],sourceIds:[source.id],factIds:[],documentIds:[],proposalId:null,tasks:[],blockers:[],outcome:null,closedAt:null,ruleVersion:s.ruleVersion};s.matters.push(matter);
 });
 assert.equal((await snapshot(owner(tenantId))).sources.length,1);
 process.env.KIARA_V2_EMAIL_INSTALLATIONS=JSON.stringify([{...i,validUntil:new Date(Date.now()-60_000).toISOString()}]);const after=await snapshot(owner(tenantId));assert.equal(after.sources.length,0);assert.equal(after.matters.length,1);assert.match(after.matters[0].title,/evidence access changed/);
 assert.doesNotMatch(JSON.stringify(after),/EMAIL_SECRET/);
 // A separate retained email revision with the original grant is denied on membership change too.
 process.env.KIARA_V2_EMAIL_INSTALLATIONS=JSON.stringify([i]);await transactWorkspace(tenantId,s=>{const source={...structuredClone(s.sources[0]),id:'source-mail-2',status:'active' as const,version:1,emailIntake:{receiptId:'receipt-2',installationId:i.id,ownerId:i.ownerId,status:'accepted' as const}};s.sources.push(source);s.receipts['email-intake:receipt-2']={hash:'synthetic',result:{intake:{membershipVersion:1,integrationVersion:1,sourceId:source.id,configurationHash:digest(i)}}};s.matters.push({...structuredClone(s.matters[0]),id:'matter-mail-2',sourceIds:[source.id],provenance:{actorId:'owner',sourceIds:[],description:'Synthetic second matter'}});s.memberships.find(m=>m.actorId==='owner')!.version++;});
 assert.equal((await checkInstallationAccess(tenantId)).sourceIds.includes('source-mail-2'),true);await snapshot(owner(tenantId));assert.equal((await readWorkspace(tenantId)).sources.find(x=>x.id==='source-mail-2')!.status,'revoked');
}));

test('revoked owner gets a durable exception; unrelated member sees no correction or private access-loss hint',async()=>isolated(async tenantId=>{
 const i=provider('gh','github',tenantId);i.scope={kind:'private',actorIds:['owner']};process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([i]);
 await transactWorkspace(tenantId,s=>{s.memberships.push({actorId:'owner',roles:['member','business_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null},{actorId:'bystander',roles:['member','admin'],version:1,expiresAt:null,revokedAt:null,matterIds:['unrelated-matter'],entityIds:null},{actorId:i.actorId,roles:['integration'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});const {matter}=installSource(s,i);matter.scope={kind:'private',actorIds:['owner']};s.memberships.find(m=>m.actorId==='owner')!.revokedAt=timestamp();});
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([{...i,enabled:false}]);
 const other:ActorContext={tenantId,actorId:'bystander',mode:'authenticated',expiresAt:Date.now()+60_000};assert.equal(snapshotFromState(await readWorkspace(tenantId),other).limitations.some(text=>text.includes('Access-loss reconciliation')),false,'matter-restricted admin must not learn of private lost evidence');
 await transactWorkspace(tenantId,s=>{s.memberships.find(member=>member.actorId==='bystander')!.roles=['member'];});
 const view=await snapshot(other),state=await readWorkspace(tenantId);
 assert.equal(view.matters.length,0);assert.equal(view.sources.length,0);assert.equal(view.limitations.some(text=>text.includes('Access-loss reconciliation')),false);
 assert.equal(state.sources[0].status,'revoked');assert.equal(state.receipts[`source-withdrawal:${digest({matterId:'matter-gh',sourceId:'source-gh'})}`].result.status,'owner_unavailable');
 await transactWorkspace(tenantId,s=>{s.memberships.push({actorId:'administrator',roles:['member','admin'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
 const retried=await retryInstallationAccessOwner(tenantId,'source-gh',state.sources[0].version);assert.equal(retried.correctiveMatters,1);assert.equal(retried.pendingOwnerExceptions,0);
 const admin:ActorContext={tenantId,actorId:'administrator',mode:'authenticated',expiresAt:Date.now()+60_000},adminView=await snapshot(admin);
 assert.equal(adminView.matters.length,1);assert.equal(adminView.matters[0].scope.kind,'private');assert.deepEqual(adminView.matters[0].sourceIds,[]);assert.equal((await retryInstallationAccessOwner(tenantId,'source-gh',state.sources[0].version)).correctiveMatters,0);
}));

test('operator reconciliation is capped at 100 source revisions and makes forward progress across batches',async()=>isolated(async tenantId=>{
 const i=provider('bulk','drive',tenantId);process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([i]);
 await transactWorkspace(tenantId,s=>{s.memberships.push({actorId:i.actorId,roles:['integration'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});for(let n=0;n<101;n++){const source:Source={...base(s,`bulk-${String(n).padStart(3,'0')}`,team,i.actorId),title:'Synthetic selected file',kind:'drive',externalId:`${i.id}:file:${n}`,externalRevision:'1',text:'Synthetic file',contentHash:digest('Synthetic file'),url:null,status:'active',aclVersion:1,observedAt:timestamp(),effectiveAt:null,authority:'unknown',originalObjectRef:null,installationGrant:{installationId:i.id,configurationHash:digest(i)}};s.sources.push(source);}});
 process.env.KIARA_V2_INSTALLATIONS=JSON.stringify([{...i,enabled:false}]);
 const first=await checkInstallationAccess(tenantId);assert.equal(first.sourceIds.length,100);assert.equal(first.remaining,1);assert.equal((await reconcileInstallationAccess(tenantId,first.planHash)).revokedSources,100);
 const second=await checkInstallationAccess(tenantId);assert.equal(second.sourceIds.length,1);assert.equal(second.remaining,0);assert.notEqual(second.planHash,first.planHash);assert.equal((await reconcileInstallationAccess(tenantId,second.planHash)).revokedSources,1);
 assert.equal((await readWorkspace(tenantId)).sources.filter(source=>source.status==='active').length,0);
}));
