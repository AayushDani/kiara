/** Connected synthetic verifier drill. This does not create or restore an Atlas backup. */
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {ConnectionString} from 'mongodb-connection-string-url';
import {closeMongoOriginalStore,purgeMongoOriginal,retainMongoOriginal} from '../src/v2/mongo-originals';
import {closeNormalizedStore,NORMALIZED_COLLECTIONS,readNormalized,transactNormalized} from '../src/v2/normalized-store';
import {closeOidcIdentityStore,provisionOidcIdentity,revokeOidcIdentity} from '../src/v2/oidc-identities';
import {digest,timestamp} from '../src/v2/store';
import {validateRestoreTarget,verifyRestoredOriginals} from './v2-original-restore-verify';
import {verifyRestoredState,type StateRestoreManifest} from './v2-state-restore-verify';

const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const suffix=randomUUID().replaceAll('-','');
const databaseName=`kiara_recovery_${suffix}`,tenantId=`synthetic-recovery-${suffix}`,marker=randomUUID();
const ownedCollections=new Set(['qualification_identity','v2_workspaces','v2_normalized_heads','v2_oidc_identities','v2_original_manifests','v2_original_chunks','v2_original_fences',...NORMALIZED_COLLECTIONS.map(kind=>`v2_records_${kind}`)]);
/** A generated name and marker alone do not make unrelated rows safe to drop. */
export function assertRecoveryCleanupInventory(input:{collections:string[];markers:{_id:string;tenantId:string}[];foreignCounts:Record<string,number>;foreignChunks:number;foreignFences:number},expected:{marker:string;tenantId:string}){
 if(input.collections.some(name=>!ownedCollections.has(name))||input.markers.length!==1||input.markers[0]._id!==expected.marker||input.markers[0].tenantId!==expected.tenantId||Object.values(input.foreignCounts).some(count=>count!==0)||input.foreignChunks!==0||input.foreignFences!==0)throw new Error('Generated recovery database has an unexpected collection or owner; cleanup refused.');
}
async function assertRecoveryCleanupOwnership(db:ReturnType<MongoClient['db']>,expected:{marker:string;tenantId:string}){
 const tenantHash=sha(expected.tenantId),collections=(await db.listCollections().toArray()).map(row=>row.name);
 if(collections.some(name=>!ownedCollections.has(name)))throw new Error('Generated recovery database has an unexpected collection; cleanup refused.');
 const markers=await db.collection<{_id:string;tenantId:string}>('qualification_identity').find({}).toArray();
 const foreignCounts:Record<string,number>={
  v2_workspaces:await db.collection<{_id:string}>('v2_workspaces').countDocuments({_id:{$ne:expected.tenantId}}),
  v2_normalized_heads:await db.collection<{_id:string}>('v2_normalized_heads').countDocuments({_id:{$ne:expected.tenantId}}),
  v2_oidc_identities:await db.collection('v2_oidc_identities').countDocuments({tenantId:{$ne:expected.tenantId}}),
  v2_original_manifests:await db.collection('v2_original_manifests').countDocuments({tenantHash:{$ne:tenantHash}}),
 };
 for(const kind of NORMALIZED_COLLECTIONS)foreignCounts[`v2_records_${kind}`]=await db.collection(`v2_records_${kind}`).countDocuments({tenantId:{$ne:expected.tenantId}});
 const chunks=await db.collection<{manifestId:string}>('v2_original_chunks').find({},{projection:{manifestId:1}}).toArray();
 const fences=await db.collection<{_id:string}>('v2_original_fences').find({},{projection:{_id:1}}).toArray();
 assertRecoveryCleanupInventory({collections,markers,foreignCounts,foreignChunks:chunks.filter(row=>!row.manifestId?.startsWith(`${tenantHash}/`)).length,foreignFences:fences.filter(row=>!row._id.startsWith(`${tenantHash}/`)).length},expected);
}
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
   if(marked){const db=client.db(databaseName);await assertRecoveryCleanupOwnership(db,{marker,tenantId});await db.dropDatabase();dropped=true;cleanupVerified=(await db.listCollections().toArray()).length===0;}
  }finally{await client.close().catch(()=>{});console.log('ATLAS_RECOVERY_STATE_CLEANUP '+JSON.stringify({database:databaseName,dropped,cleanupVerified}));}
 }
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(error=>{console.error('ATLAS_RECOVERY_STATE_FAILURE '+JSON.stringify({code:(error as {code?:string}).code||'QUALIFICATION_FAILED',message:error instanceof Error?error.message:'Unknown failure'}));process.exitCode=1;});
