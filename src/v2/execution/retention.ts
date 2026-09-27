import type {WorkspaceState} from '../contracts';
import {timestamp} from '../store';
import type {EffectIntent} from './contracts';

function originalReference(value:unknown):string|null {
 if(!value||typeof value!=='object')return null;
 const r=value as Record<string,unknown>;
 if(!['local_encrypted','mongo_encrypted','s3_kms'].includes(String(r.storage))||!['aes-256-gcm','aws-kms'].includes(String(r.encryption))||typeof r.key!=='string'||r.key.length>2000||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isSafeInteger(r.bytes)||Number(r.bytes)<0||Number(r.bytes)>20000000||typeof r.keyId!=='string'||r.keyId.length>2000||r.versionId!==undefined&&typeof r.versionId!=='string')return null;
 if(!/^[a-f0-9]{64}\/[a-f0-9]{64}(?:\/[a-f0-9]{16})?$/.test(r.key)||r.key.split('/')[1]!==r.sha256||['local_encrypted','mongo_encrypted'].includes(String(r.storage))&&(r.encryption!=='aes-256-gcm'||!/^[a-f0-9]{16}$/.test(r.keyId))||r.storage==='s3_kms'&&(r.encryption!=='aws-kms'||typeof r.versionId!=='string'||!r.versionId||r.versionId==='null'))return null;
 return JSON.stringify({key:r.key,sha256:r.sha256,bytes:r.bytes,encryption:r.encryption,storage:r.storage,keyId:r.keyId,...(r.versionId!==undefined?{versionId:r.versionId}:{})});
}
function retainedOriginals(intent:EffectIntent):string[]{
 const refs=new Set(intent.retentionOriginalReferences||[]);
 for(const text of [intent.providerReceipt,intent.completionArtifact,intent.actionSnapshot.completion?.artifact]){
  if(!text)continue;
  try{const value=JSON.parse(text),direct=originalReference(value),readback=originalReference(value?.readback);if(direct)refs.add(direct);if(readback)refs.add(readback);}catch{/* Provider identifiers and human attestations are not object manifests. */}
 }
 return [...refs];
}

/** Payload deletion cannot convert a possibly accepted external effect into an unsent one. */
export function redactEffectReceipts(state:WorkspaceState,affectedRecordIds:Set<string>,options:{historical?:boolean}={}):string[]{
 const exceptions:string[]=[];
 for(const [key,receipt] of Object.entries(state.receipts)){
  if(!key.startsWith('execution:'))continue;
  const intent=receipt.result.intent as EffectIntent|undefined;
  if(!intent||intent.owner!=='v2'||intent.tenantId!==state.tenantId||key!==`execution:${intent.actionId}`)continue;
  const action=intent.actionSnapshot,refs=[intent.actionId,action.matterId,action.proposalId,...action.provenance.sourceIds,...action.provenance.factIds||[],...Object.keys(intent.dependencies.sourceVersions),...Object.keys(intent.dependencies.factVersions),...Object.keys(intent.dependencies.documentHashes)];
  if(!intent.deletionRequestedAt&&!refs.some(id=>affectedRecordIds.has(id)))continue;
  intent.deletionRequestedAt||=timestamp();
  if(intent.redactedAt)continue;
  if(!options.historical&&['dispatched','verifying','uncertain'].includes(intent.status)){
   exceptions.push(intent.actionId);
   continue;
  }
  if(!options.historical&&intent.status==='prepared'){
   intent.status='failed';intent.failure='EVIDENCE_DELETED_BEFORE_DISPATCH';
   const live=state.actions.find(a=>a.id===intent.actionId);
   if(live){live.status='failed';live.leaseUntil=null;live.version++;live.updatedAt=timestamp();}
  }
  // Retain effect identity, hashes, actor, provider identity and historical outcome.
  // An already verified email is no longer polled after deleting its comparison bytes.
  intent.retentionOriginalReferences=retainedOriginals(intent);
  action.title='';action.content='';action.recipients=[];action.destination=null;
  action.provenance.description='Payload deleted; effect identity and outcome retained.';
  if(action.completion)action.completion.artifact='';
  intent.executionDecision.sender=null;intent.completionArtifact=null;
  intent.leaseToken=null;intent.leaseUntil=null;intent.redactedAt=timestamp();intent.updatedAt=intent.redactedAt;
 }
 return [...new Set(exceptions)];
}
