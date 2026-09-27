/** Seed, verify and clean a synthetic database for a real Atlas managed-backup restore. */
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {isAbsolute} from 'node:path';
import {readFile,rename,stat,writeFile} from 'node:fs/promises';
import {MongoClient} from 'mongodb';
import {ConnectionString} from 'mongodb-connection-string-url';
import {closeMongoOriginalStore,purgeMongoOriginal,retainMongoOriginal} from '../src/v2/mongo-originals';
import {closeNormalizedStore,NORMALIZED_COLLECTIONS,readNormalized,transactNormalized} from '../src/v2/normalized-store';
import {closeOidcIdentityStore,provisionOidcIdentity,revokeOidcIdentity} from '../src/v2/oidc-identities';
import {digest,timestamp} from '../src/v2/store';
import {validateRestoreTarget,verifyRestoredOriginals} from './v2-original-restore-verify';
import {verifyRestoredState,type StateRestoreManifest} from './v2-state-restore-verify';

const args=process.argv.slice(2),mode=args[0];
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const hostHash='8259e505073f806ae0ce25f34cd2784f7611b95d937441d0a09c9da3fd4d296d';
interface DrillFile {version:1;sourceDatabase:string;tenantId:string;marker:string;originalsKey:string;createdAt:string;stage:'preparing'|'seeded'|'verified';manifest?:StateRestoreManifest;candidateRestoredDatabase?:string;restoredDatabase?:string;verifiedAt?:string;cleanedDatabases?:string[]}
interface Marker {_id:string;purpose:'managed_backup_drill';sourceDatabase:string;tenantId:string;runHost:string;runPid:number}

function baseUri(){
 if(!process.env.MONGODB_URI||process.env.MONGODB_DB!=='kiara_v2'||process.env.VERCEL||process.env.NODE_ENV==='production'||process.env.KIARA_V2_AUTH_MODE==='oidc'||process.env.KIARA_V2_ORCHESTRATION_MODE==='temporal'||process.env.KIARA_V2_WORKER_HOST)throw new Error('Use the inspected local Atlas v2 operator environment.');
 const uri=new ConnectionString(process.env.MONGODB_URI);
 if(!uri.hosts.length||uri.hosts.some(host=>!host.split(':')[0].endsWith('.mongodb.net'))||sha(JSON.stringify(uri.hosts.map(host=>host.toLowerCase()).sort()))!==hostHash)throw new Error('The Atlas host set differs from the inspected managed-backup cluster.');
 return uri;
}
function targetUri(base:ConnectionString,database:string){
 const uri=new ConnectionString(base.toString());
 if(!uri.searchParams.has('authSource')&&uri.pathname!=='/')uri.searchParams.set('authSource',decodeURIComponent(uri.pathname.slice(1)));
 uri.pathname=`/${database}`;
 return uri.toString();
}
function targetName(value:string){if(!/^kiara_recovery_[A-Za-z0-9_-]{1,48}$/.test(value)||value.length>64)throw new Error('Select one isolated generated recovery database.');return value;}
async function load(path:string){
 if(!isAbsolute(path))throw new Error('Use an absolute private manifest path.');
 const file=await stat(path);if(!file.isFile()||file.size>65536||(file.mode&0o077)!==0)throw new Error('The drill manifest must be a private file of at most 64 KiB.');
 const value=JSON.parse(await readFile(path,'utf8')) as DrillFile;
 if(value.version!==1||!/^kiara_recovery_[a-f0-9]{16}$/.test(value.sourceDatabase)||value.tenantId!==`synthetic-managed-recovery-${value.sourceDatabase.slice('kiara_recovery_'.length)}`||!/^[a-f0-9-]{36}$/.test(value.marker)||!/^[a-f0-9]{64}$/.test(value.originalsKey))throw new Error('The exact generated drill identity is invalid.');
 return value;
}
async function save(path:string,value:DrillFile){const next=`${path}.${randomUUID()}.tmp`;await writeFile(next,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(next,path);}
async function close(){await closeMongoOriginalStore().catch(()=>{});await closeNormalizedStore().catch(()=>{});await closeOidcIdentityStore().catch(()=>{});}
function selectedEnvironment(base:ConnectionString,database:string,key:string){
 Object.assign(process.env,{MONGODB_URI:targetUri(base,database),MONGODB_DB:database,KIARA_ORIGINALS_KEY:key,KIARA_ORIGINALS_MODE:'mongo_encrypted',KIARA_OIDC_IDENTITY_SOURCE:'mongo',KIARA_V2_STORE_MODE:'normalized',KIARA_V2_AI_MODE:'local'});
}

async function seed(base:ConnectionString,path:string){
 if(!isAbsolute(path))throw new Error('Use an absolute private manifest path.');
 const suffix=randomBytes(8).toString('hex'),sourceDatabase=`kiara_recovery_${suffix}`,tenantId=`synthetic-managed-recovery-${suffix}`,marker=randomUUID(),originalsKey=randomBytes(32).toString('hex');
 const file:DrillFile={version:1,sourceDatabase,tenantId,marker,originalsKey,createdAt:new Date().toISOString(),stage:'preparing'};
 selectedEnvironment(base,sourceDatabase,originalsKey);
 validateRestoreTarget({database:sourceDatabase,sourceDatabase:'kiara_v2',manifestPath:path},process.env);
 const client=new MongoClient(process.env.MONGODB_URI!,{serverSelectionTimeoutMS:10000,maxPoolSize:4});
 try{
  await client.connect();const db=client.db(sourceDatabase);
  assert.equal((await db.listCollections().toArray()).length,0,'Generated recovery database must be empty.');
  await writeFile(path,JSON.stringify(file),{mode:0o600,flag:'wx'});
  console.log('MANAGED_BACKUP_SEED_STARTED '+JSON.stringify({sourceDatabase,tenantId,marker,privateManifestPath:path}));
  await db.collection<Marker>('qualification_identity').insertOne({_id:marker,purpose:'managed_backup_drill',sourceDatabase,tenantId,runHost:hostname(),runPid:process.pid});
  const issuer='https://identity.example.test',activeActor='active-operator',revokedActor='revoked-operator',activeSubject=`active-${suffix}`,revokedSubject=`revoked-${suffix}`,sourceId=`synthetic-source-${suffix}`,now=timestamp();
  await transactNormalized(tenantId,state=>{
   state.memberships.push({actorId:activeActor,roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
   state.memberships.push({actorId:revokedActor,roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
   state.sources.push({id:sourceId,tenantId,version:1,createdAt:now,updatedAt:now,scope:{kind:'team',actorIds:[]},provenance:{actorId:activeActor,sourceIds:[],description:'Synthetic managed backup probe.'},title:'Synthetic source',kind:'manual',externalId:null,externalRevision:null,text:'Synthetic source',contentHash:digest('Synthetic source'),url:null,status:'active',aclVersion:1,observedAt:now,effectiveAt:null,authority:'draft',originalObjectRef:null});
   state.receipts['recovery-probe']={hash:sha('synthetic-managed-recovery-receipt'),result:{accepted:true}};
  });
  await provisionOidcIdentity({issuer,subject:activeSubject,tenantId,actorId:activeActor,expectedVersion:0,dryRun:false});
  await provisionOidcIdentity({issuer,subject:revokedSubject,tenantId,actorId:revokedActor,expectedVersion:0,dryRun:false});
  await revokeOidcIdentity({issuer,subject:revokedSubject,expectedVersion:1,dryRun:false});
  await transactNormalized(tenantId,state=>{
   const member=state.memberships.find(item=>item.actorId===revokedActor)!;member.revokedAt=timestamp();member.version++;
   const source=state.sources.find(item=>item.id===sourceId)!;source.status='deleted';source.text='';source.title='Removed evidence';source.url=null;source.externalId=null;source.externalRevision=null;source.aclVersion++;source.version++;source.updatedAt=timestamp();
   state.tombstones.push({sourceId,deletedAt:timestamp(),reason:'Synthetic managed backup deletion',backupExpiresAt:null});
  });
  const retained=await retainMongoOriginal(tenantId,Buffer.from(`synthetic retained ${suffix}`));
  const deleted=await retainMongoOriginal(tenantId,Buffer.from(`synthetic deleted ${suffix}`));
  await purgeMongoOriginal(tenantId,deleted);
  const state=await readNormalized(tenantId);
  const manifest:StateRestoreManifest={tenantId,checks:[{reference:retained,expected:'readable'},{reference:deleted,expected:'deleted'}],expectedStateHash:digest(state),expectedVersion:state.version,activeActorIds:[activeActor],revokedActorIds:[revokedActor],deletedSourceIds:[sourceId],receipts:[{key:'recovery-probe',hash:sha('synthetic-managed-recovery-receipt')}],identities:[{issuer,subject:activeSubject,actorId:activeActor,version:1,expected:'active'},{issuer,subject:revokedSubject,actorId:revokedActor,version:2,expected:'revoked'}]};
  const target={database:sourceDatabase,sourceDatabase:'kiara_v2',manifestPath:path};
  await close();assert.equal((await verifyRestoredOriginals(target,manifest)).verified,true);assert.equal((await verifyRestoredState(manifest)).verified,true);
  file.stage='seeded';file.manifest=manifest;await save(path,file);
  console.log('MANAGED_BACKUP_SEED_READY '+JSON.stringify({sourceDatabase,tenantHash:sha(tenantId),stateHash:manifest.expectedStateHash,version:manifest.expectedVersion,privateManifestPath:path,awaitingManagedSnapshot:true,managedRestoreVerified:false}));
 }finally{await close();await client.close().catch(()=>{});}
}

async function verify(base:ConnectionString,path:string,database:string){
 const file=await load(path);targetName(database);
 if(file.stage==='preparing'||database===file.sourceDatabase||!file.manifest)throw new Error('A finished seed and distinct Atlas-restored database are required.');
 selectedEnvironment(base,database,file.originalsKey);
 const client=new MongoClient(process.env.MONGODB_URI!,{serverSelectionTimeoutMS:10000,maxPoolSize:4});
 try{
  await client.connect();const marker=await client.db(database).collection<Marker>('qualification_identity').findOne({_id:file.marker});
  if(marker?.purpose!=='managed_backup_drill'||marker.sourceDatabase!==file.sourceDatabase||marker.tenantId!==file.tenantId)throw new Error('The restored database lacks the exact synthetic backup marker.');
  if(file.candidateRestoredDatabase&&file.candidateRestoredDatabase!==database&&!file.cleanedDatabases?.includes(file.candidateRestoredDatabase))throw new Error('Clean the previous marker-matched candidate before verifying another restored copy.');
  file.candidateRestoredDatabase=database;await save(path,file);
  const target={database,sourceDatabase:file.sourceDatabase,manifestPath:path};validateRestoreTarget(target,process.env);
  const originals=await verifyRestoredOriginals(target,file.manifest),state=await verifyRestoredState(file.manifest);
  assert.equal(originals.verified,true);assert.equal(state.verified,true);
  file.stage='verified';file.restoredDatabase=database;file.verifiedAt=new Date().toISOString();await save(path,file);
  console.log('MANAGED_BACKUP_SELECTED_DATA_VERIFIED '+JSON.stringify({database,sourceDatabase:file.sourceDatabase,tenantHash:sha(file.tenantId),stateHash:state.stateHash,retainedAndDeletedOriginals:originals.checks.length,activeIdentities:state.activeIdentities,revokedIdentities:state.revokedIdentities,atlasRestoreJobProvenanceVerified:false}));
 }finally{await close();await client.close().catch(()=>{});}
}

function requireStopped(host:string,pid:number){
 if(host!==hostname()||!Number.isSafeInteger(pid)||pid<1)throw new Error('Cleanup requires the originating host and a stopped seed process.');
 try{process.kill(pid,0);}catch(error){if(typeof error==='object'&&error&&'code' in error&&error.code==='ESRCH')return;throw new Error('Seed process status is uncertain; cleanup refused.');}
 throw new Error('Seed process is still running; cleanup refused.');
}
async function cleanup(base:ConnectionString,path:string,database:string,abandon:boolean){
 const file=await load(path);targetName(database);
 if(!abandon&&(file.stage!=='verified'||![file.sourceDatabase,file.restoredDatabase].includes(database))||abandon&&![file.sourceDatabase,file.restoredDatabase,file.candidateRestoredDatabase].includes(database))throw new Error('Verify the restored copy first, or explicitly abandon only a manifest-bound generated database.');
 const client=new MongoClient(targetUri(base,database),{serverSelectionTimeoutMS:10000,maxPoolSize:4});
 try{
  await client.connect();const db=client.db(database),marker=await db.collection<Marker>('qualification_identity').findOne({_id:file.marker});
  if(marker?.purpose!=='managed_backup_drill'||marker.sourceDatabase!==file.sourceDatabase||marker.tenantId!==file.tenantId)throw new Error('Exact managed-backup drill marker is absent; cleanup refused.');
  requireStopped(marker.runHost,marker.runPid);
  const allowed=new Set(['qualification_identity','v2_workspaces','v2_normalized_heads','v2_oidc_identities','v2_original_manifests','v2_original_chunks','v2_original_fences',...NORMALIZED_COLLECTIONS.map(kind=>`v2_records_${kind}`)]);
  const names=(await db.listCollections().toArray()).map(item=>item.name),tenantHash=sha(file.tenantId);
  if(names.some(name=>!allowed.has(name))||await db.collection('qualification_identity').countDocuments({})!==1||await db.collection<{_id:string}>('v2_workspaces').countDocuments({_id:{$ne:file.tenantId}})||await db.collection<{_id:string}>('v2_normalized_heads').countDocuments({_id:{$ne:file.tenantId}})||await db.collection('v2_oidc_identities').countDocuments({tenantId:{$ne:file.tenantId}})||await db.collection('v2_original_manifests').countDocuments({tenantHash:{$ne:tenantHash}}))throw new Error('Generated database has an unexpected collection or owner; cleanup refused.');
  for(const kind of NORMALIZED_COLLECTIONS)if(await db.collection(`v2_records_${kind}`).countDocuments({tenantId:{$ne:file.tenantId}}))throw new Error('Generated database has a foreign normalized row; cleanup refused.');
  const chunks=await db.collection<{manifestId:string}>('v2_original_chunks').find({},{projection:{manifestId:1}}).toArray(),fences=await db.collection<{_id:string}>('v2_original_fences').find({},{projection:{_id:1}}).toArray();
  if(chunks.some(row=>!row.manifestId?.startsWith(`${tenantHash}/`))||fences.some(row=>!row._id.startsWith(`${tenantHash}/`)))throw new Error('Generated database has a foreign original chunk or fence; cleanup refused.');
  await db.dropDatabase();assert.equal((await db.listCollections().toArray()).length,0);
  file.cleanedDatabases=[...new Set([...(file.cleanedDatabases||[]),database])];await save(path,file);
  console.log('MANAGED_BACKUP_CLEANUP '+JSON.stringify({database,dropVerified:true,backupExpiryVerified:false}));
 }finally{await client.close().catch(()=>{});}
}

async function main(){
 if(!['--seed','--verify','--cleanup'].includes(mode)||mode==='--seed'&&args.length!==2||mode==='--verify'&&args.length!==3||mode==='--cleanup'&&![3,4].includes(args.length)||mode==='--cleanup'&&args.length===4&&args[3]!=='--abandon')throw new Error('Use --seed PRIVATE_MANIFEST, --verify PRIVATE_MANIFEST RESTORED_DB, or --cleanup PRIVATE_MANIFEST DB [--abandon].');
 const base=baseUri();
 if(mode==='--seed')await seed(base,args[1]);
 else if(mode==='--verify')await verify(base,args[1],args[2]);
 else await cleanup(base,args[1],args[2],args[3]==='--abandon');
}
main().catch(error=>{console.error('MANAGED_BACKUP_DRILL_FAILURE '+JSON.stringify({code:typeof error==='object'&&error&&'code' in error&&typeof error.code==='string'?error.code:'QUALIFICATION_FAILED'}));process.exitCode=1;});
