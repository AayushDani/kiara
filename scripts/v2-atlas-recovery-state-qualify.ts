/** Connected synthetic verifier drill. This does not create or restore an Atlas backup. */
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {ConnectionString} from 'mongodb-connection-string-url';
import {closeMongoOriginalStore,purgeMongoOriginal,retainMongoOriginal} from '../src/v2/mongo-originals';
import {closeNormalizedStore,readNormalized,transactNormalized} from '../src/v2/normalized-store';
import {closeOidcIdentityStore,provisionOidcIdentity,revokeOidcIdentity} from '../src/v2/oidc-identities';
import {digest,timestamp} from '../src/v2/store';
import {validateRestoreTarget,verifyRestoredOriginals} from './v2-original-restore-verify';
import {verifyRestoredState,type StateRestoreManifest} from './v2-state-restore-verify';

const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const suffix=randomUUID().replaceAll('-','');
const databaseName=`kiara_recovery_${suffix}`,tenantId=`synthetic-recovery-${suffix}`,marker=randomUUID();
async function main(){
 if(process.argv.slice(2).join(' ')!=='--synthetic-atlas')throw new Error('Explicit --synthetic-atlas flag is required.');
 const configured=process.env.MONGODB_URI;
 if(!configured)throw new Error('Configure the existing Atlas URI privately.');
 const uri=new ConnectionString(configured);
 if(!uri.hosts.length||uri.hosts.some(host=>!host.split(':')[0].endsWith('.mongodb.net')))throw new Error('Only Atlas hosts are permitted.');
 uri.pathname=`/${databaseName}`;
 const key=randomBytes(32).toString('hex');
 Object.assign(process.env,{MONGODB_URI:uri.toString(),MONGODB_DB:databaseName,KIARA_ORIGINALS_KEY:key,KIARA_ORIGINALS_MODE:'mongo_encrypted',KIARA_V2_STORE_MODE:'normalized',KIARA_V2_AI_MODE:'local'});
 const target={database:databaseName,sourceDatabase:'kiara_v2',manifestPath:'generated-in-memory'};
 validateRestoreTarget(target,process.env);
 const client=new MongoClient(process.env.MONGODB_URI!,{serverSelectionTimeoutMS:10000,maxPoolSize:4});
 let marked=false,dropped=false,cleanupVerified=false;
 try{
  await client.connect();
  const db=client.db(databaseName);
  assert.deepEqual(await db.listCollections().toArray(),[]);
  await db.collection<{_id:string;tenantId:string}>('qualification_identity').insertOne({_id:marker,tenantId});
  marked=true;
  const issuer='https://identity.example.test',activeActor='active-operator',revokedActor='revoked-operator',activeSubject=`active-${suffix}`,revokedSubject=`revoked-${suffix}`;
  const now=timestamp(),sourceId=`synthetic-source-${suffix}`;
  await transactNormalized(tenantId,state=>{
   state.memberships.push({actorId:activeActor,roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
   state.memberships.push({actorId:revokedActor,roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
   state.sources.push({id:sourceId,tenantId,version:1,createdAt:now,updatedAt:now,scope:{kind:'team',actorIds:[]},provenance:{actorId:activeActor,sourceIds:[],description:'Synthetic recovery probe.'},title:'Synthetic source',kind:'manual',externalId:null,externalRevision:null,text:'Synthetic source',contentHash:digest('Synthetic source'),url:null,status:'active',aclVersion:1,observedAt:now,effectiveAt:null,authority:'draft',originalObjectRef:null});
   state.receipts['recovery-probe']={hash:sha('synthetic-recovery-receipt'),result:{accepted:true}};
  });
  await provisionOidcIdentity({issuer,subject:activeSubject,tenantId,actorId:activeActor,expectedVersion:0,dryRun:false});
  await provisionOidcIdentity({issuer,subject:revokedSubject,tenantId,actorId:revokedActor,expectedVersion:0,dryRun:false});
  await revokeOidcIdentity({issuer,subject:revokedSubject,expectedVersion:1,dryRun:false});
  await transactNormalized(tenantId,state=>{
   const member=state.memberships.find(item=>item.actorId===revokedActor)!;member.revokedAt=timestamp();member.version++;
   const source=state.sources.find(item=>item.id===sourceId)!;source.status='deleted';source.text='';source.title='Removed evidence';source.url=null;source.externalId=null;source.externalRevision=null;source.aclVersion++;source.version++;source.updatedAt=timestamp();
   state.tombstones.push({sourceId,deletedAt:timestamp(),reason:'synthetic recovery deletion',backupExpiresAt:null});
  });
  const retained=await retainMongoOriginal(tenantId,Buffer.from(`synthetic retained ${suffix}`));
  const deleted=await retainMongoOriginal(tenantId,Buffer.from(`synthetic deleted ${suffix}`));
  await purgeMongoOriginal(tenantId,deleted);
  const state=await readNormalized(tenantId);
  const manifest:StateRestoreManifest={tenantId,checks:[{reference:retained,expected:'readable'},{reference:deleted,expected:'deleted'}],expectedStateHash:digest(state),expectedVersion:state.version,activeActorIds:[activeActor],revokedActorIds:[revokedActor],deletedSourceIds:[sourceId],receipts:[{key:'recovery-probe',hash:sha('synthetic-recovery-receipt')}],identities:[{issuer,subject:activeSubject,actorId:activeActor,version:1,expected:'active'},{issuer,subject:revokedSubject,actorId:revokedActor,version:2,expected:'revoked'}]};
  await closeNormalizedStore();await closeOidcIdentityStore();await closeMongoOriginalStore();
  const originals=await verifyRestoredOriginals(target,manifest);
  const restored=await verifyRestoredState(manifest);
  assert.equal(originals.verified,true);assert.equal(restored.verified,true);
  console.log('ATLAS_RECOVERY_STATE_EVIDENCE '+JSON.stringify({database:databaseName,tenantHash:sha(tenantId),stateHash:restored.stateHash,version:restored.version,originals:originals.checks.map(item=>({expected:item.expected,verified:item.verified})),activeMemberships:restored.activeMemberships,revokedMemberships:restored.revokedMemberships,deletedSources:restored.deletedSources,receipts:restored.receipts,activeIdentities:restored.activeIdentities,revokedIdentities:restored.revokedIdentities,managedBackupRestored:false,remoteTenantDataRead:false}));
 }finally{
  try{
   await closeMongoOriginalStore().catch(()=>{});
   await closeNormalizedStore().catch(()=>{});
   await closeOidcIdentityStore().catch(()=>{});
   if(marked){const db=client.db(databaseName),exact=await db.collection<{_id:string;tenantId:string}>('qualification_identity').findOne({_id:marker});if(exact?.tenantId!==tenantId)throw new Error('Generated database marker changed; refusing cleanup.');await db.dropDatabase();dropped=true;cleanupVerified=(await db.listCollections().toArray()).length===0;}
  }finally{await client.close().catch(()=>{});console.log('ATLAS_RECOVERY_STATE_CLEANUP '+JSON.stringify({database:databaseName,dropped,cleanupVerified}));}
 }
}
main().catch(error=>{console.error('ATLAS_RECOVERY_STATE_FAILURE '+JSON.stringify({code:(error as {code?:string}).code||'QUALIFICATION_FAILED',message:error instanceof Error?error.message:'Unknown failure'}));process.exitCode=1;});
