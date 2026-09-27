/** Read-only state and access checks for an operator-restored, isolated Atlas database. */
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {V2Error,type WorkspaceState} from '../src/v2/contracts';
import {closeNormalizedStore,readNormalized} from '../src/v2/normalized-store';
import {closeOidcIdentityStore,inspectOidcIdentity,resolveOidcIdentity} from '../src/v2/oidc-identities';
import {closeMongoOriginalStore} from '../src/v2/mongo-originals';
import {digest} from '../src/v2/store';
import {parseRestoreCommand,validateRestoreManifest,validateRestoreTarget,verifyRestoredOriginals,type RestoreManifest} from './v2-original-restore-verify';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
type IdentityCheck={issuer:string;subject:string;actorId:string;version:number;expected:'active'|'revoked'};
type ReceiptCheck={key:string;hash:string};
export interface StateRestoreManifest extends RestoreManifest {
 expectedStateHash:string;expectedVersion:number;
 activeActorIds:string[];revokedActorIds:string[];deletedSourceIds:string[];
 receipts:ReceiptCheck[];identities:IdentityCheck[];
}
const ids=(value:unknown,max:number)=>Array.isArray(value)&&value.length>0&&value.length<=max&&value.every(id=>typeof id==='string'&&id.length>0&&id.length<=200)&&new Set(value).size===value.length;
export function validateStateRestoreManifest(value:unknown):StateRestoreManifest {
 validateRestoreManifest(value);
 const row=value as StateRestoreManifest;
 if(!/^[a-f0-9]{64}$/.test(row.expectedStateHash)||!Number.isSafeInteger(row.expectedVersion)||row.expectedVersion<2||
  !ids(row.activeActorIds,20)||!ids(row.revokedActorIds,20)||!ids(row.deletedSourceIds,20)||
  row.activeActorIds.some(id=>row.revokedActorIds.includes(id))||
  !Array.isArray(row.receipts)||row.receipts.length<1||row.receipts.length>20||
  row.receipts.some(item=>!item||typeof item.key!=='string'||!item.key||item.key.length>200||!/^[a-f0-9]{64}$/.test(item.hash))||
  new Set(row.receipts.map(item=>item.key)).size!==row.receipts.length||
  !Array.isArray(row.identities)||row.identities.length<2||row.identities.length>20||
  row.identities.some(item=>!item||!['active','revoked'].includes(item.expected)||typeof item.issuer!=='string'||!item.issuer.startsWith('https://')||item.issuer.length>200||typeof item.subject!=='string'||!item.subject||item.subject.length>200||typeof item.actorId!=='string'||!item.actorId||item.actorId.length>200||!Number.isSafeInteger(item.version)||item.version<1)||
  !row.identities.some(item=>item.expected==='active')||!row.identities.some(item=>item.expected==='revoked')||
  new Set(row.identities.map(item=>JSON.stringify([item.issuer,item.subject]))).size!==row.identities.length
 )throw new Error('Restore manifest must name an exact state hash, active/revoked actors and identities, deleted source, and receipts.');
 return row;
}

type StateReader=(tenantId:string)=>Promise<WorkspaceState>;
type IdentityInspector=typeof inspectOidcIdentity;
type IdentityResolver=typeof resolveOidcIdentity;
export async function verifyRestoredState(manifest:StateRestoreManifest,deps:{read:StateReader;inspect:IdentityInspector;resolve:IdentityResolver}={read:readNormalized,inspect:inspectOidcIdentity,resolve:resolveOidcIdentity}){
 const checked=validateStateRestoreManifest(manifest),state=await deps.read(checked.tenantId);
 if(state.tenantId!==checked.tenantId||state.version!==checked.expectedVersion||digest(state)!==checked.expectedStateHash)throw new Error('Restored normalized workspace does not match the exact expected snapshot.');
 for(const actorId of checked.activeActorIds){const member=state.memberships.find(row=>row.actorId===actorId);if(!member||member.revokedAt||!member.roles.includes('member')||member.expiresAt&&Date.parse(member.expiresAt)<=Date.now())throw new Error('Expected active restored membership is unavailable.');}
 for(const actorId of checked.revokedActorIds){const member=state.memberships.find(row=>row.actorId===actorId);if(!member?.revokedAt)throw new Error('Expected membership revocation is absent from the restore.');}
 for(const sourceId of checked.deletedSourceIds){const source=state.sources.find(row=>row.id===sourceId);if(!source||source.status!=='deleted'||source.text!==''||!state.tombstones.some(row=>row.sourceId===sourceId))throw new Error('Expected source deletion or tombstone is absent from the restore.');}
 for(const receipt of checked.receipts)if(state.receipts[receipt.key]?.hash!==receipt.hash)throw new Error('Expected durable receipt differs after restore.');
 for(const item of checked.identities){
  const binding=await deps.inspect(item.issuer,item.subject);
  if(binding.status!==item.expected||binding.version!==item.version||binding.tenantId!==checked.tenantId||binding.actorId!==item.actorId)throw new Error('Restored identity binding differs from the inspected expectation.');
  if(item.expected==='active'){
   const resolved=await deps.resolve(item.issuer,item.subject);
   if(resolved.tenantId!==checked.tenantId||resolved.actorId!==item.actorId||resolved.version!==item.version)throw new Error('Active restored identity did not resolve to the expected membership.');
  }else{
   try{await deps.resolve(item.issuer,item.subject);}catch(error){if(error instanceof V2Error&&error.code==='MEMBERSHIP_REQUIRED')continue;throw error;}
   throw new Error('Revoked restored identity still resolved.');
  }
 }
 return {tenantHash:sha(checked.tenantId),stateHash:checked.expectedStateHash,version:state.version,activeMemberships:checked.activeActorIds.length,revokedMemberships:checked.revokedActorIds.length,deletedSources:checked.deletedSourceIds.length,receipts:checked.receipts.length,activeIdentities:checked.identities.filter(item=>item.expected==='active').length,revokedIdentities:checked.identities.filter(item=>item.expected==='revoked').length,verified:true};
}

if(import.meta.url===`file://${process.argv[1]}`){
 try{
  const target=parseRestoreCommand(process.argv.slice(2));
  validateRestoreTarget(target,process.env);
  if(process.env.KIARA_V2_STORE_MODE!=='normalized')throw new Error('Select normalized storage for the isolated recovery database.');
  const file=await stat(target.manifestPath);
  if(!file.isFile()||file.size>65536)throw new Error('Restore manifest must be a file of at most 64 KiB.');
  const manifest=validateStateRestoreManifest(JSON.parse(await readFile(target.manifestPath,'utf8')));
  const originals=await verifyRestoredOriginals(target,manifest);
  const state=await verifyRestoredState(manifest);
  process.stdout.write(`${JSON.stringify({target:target.database,sourceDatabase:target.sourceDatabase,manifestHash:sha(JSON.stringify(manifest)),originals:originals.checks,state,verified:true},null,2)}\n`);
 }catch(error){process.stderr.write(`${error instanceof V2Error?error.code:error instanceof SyntaxError?'Restore manifest is invalid JSON.':'Restore state verification failed; inspect the recovery database and manifest.'}\n`);process.exitCode=1;}
 finally{await closeMongoOriginalStore();await closeNormalizedStore();await closeOidcIdentityStore();}
}
