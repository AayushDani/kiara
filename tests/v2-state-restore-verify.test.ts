import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {V2Error} from '../src/v2/contracts';
import {digest,emptyWorkspace} from '../src/v2/store';
import {validateStateRestoreManifest,verifyRestoredState} from '../scripts/v2-state-restore-verify';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const tenant='synthetic-recovery-state',issuer='https://identity.example.test';
const state=emptyWorkspace(tenant);
state.version=2;
state.memberships.push({actorId:'active-actor',roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});
state.memberships.push({actorId:'revoked-actor',roles:['member'],version:2,expiresAt:null,revokedAt:'2026-09-01T00:00:00.000Z',matterIds:null,entityIds:null});
state.sources.push({id:'deleted-source',tenantId:tenant,version:2,createdAt:'2026-08-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',scope:{kind:'team',actorIds:[]},provenance:{actorId:'active-actor',sourceIds:[],description:'Removed.'},title:'Removed evidence',kind:'manual',externalId:null,externalRevision:null,text:'',contentHash:digest('prior content'),url:null,status:'deleted',aclVersion:2,observedAt:'2026-08-01T00:00:00.000Z',effectiveAt:null,authority:'draft',originalObjectRef:null});
state.tombstones.push({sourceId:'deleted-source',deletedAt:'2026-09-01T00:00:00.000Z',reason:'synthetic deletion',backupExpiresAt:null});
state.receipts['recovery-probe']={hash:sha('receipt'),result:{accepted:true}};
const keyId='a'.repeat(16),reference=(content:string)=>({key:`${sha(tenant)}/${sha(content)}/${keyId}`,sha256:sha(content),bytes:Buffer.byteLength(content),encryption:'aes-256-gcm' as const,storage:'mongo_encrypted' as const,keyId});
const manifest={tenantId:tenant,checks:[{reference:reference('readable'),expected:'readable' as const},{reference:reference('deleted'),expected:'deleted' as const}],expectedStateHash:digest(state),expectedVersion:2,activeActorIds:['active-actor'],revokedActorIds:['revoked-actor'],deletedSourceIds:['deleted-source'],receipts:[{key:'recovery-probe',hash:sha('receipt')}],identities:[{issuer,subject:'active-subject',actorId:'active-actor',version:1,expected:'active' as const},{issuer,subject:'revoked-subject',actorId:'revoked-actor',version:2,expected:'revoked' as const}]};
const deps={
 read:async()=>structuredClone(state),
 inspect:async(_issuer:string,subject:string)=>({bindingId:sha(subject),version:subject==='active-subject'?1:2,status:subject==='active-subject'?'active' as const:'revoked' as const,tenantId:tenant,actorId:subject==='active-subject'?'active-actor':'revoked-actor'}),
 resolve:async(_issuer:string,subject:string)=>{if(subject==='revoked-subject')throw new V2Error('MEMBERSHIP_REQUIRED','Revoked.',403);return {tenantId:tenant,actorId:'active-actor',version:1};},
};

test('restored state manifest requires exact positive and negative probes',()=>{
 assert.deepEqual(validateStateRestoreManifest(manifest),manifest);
 assert.throws(()=>validateStateRestoreManifest({...manifest,revokedActorIds:[]}));
 assert.throws(()=>validateStateRestoreManifest({...manifest,deletedSourceIds:[]}));
 assert.throws(()=>validateStateRestoreManifest({...manifest,identities:[manifest.identities[0]]}));
 assert.throws(()=>validateStateRestoreManifest({...manifest,identities:[null,manifest.identities[1]]}));
});

test('normalized state, revocations, deletion and identity denial must all survive restore',async()=>{
 const result=await verifyRestoredState(manifest,deps);
 assert.equal(result.verified,true);
 assert.equal(result.deletedSources,1);
 assert.equal(result.revokedIdentities,1);
 assert.doesNotMatch(JSON.stringify(result),/active-subject|deleted-source|active-actor/);
 await assert.rejects(verifyRestoredState({...manifest,expectedStateHash:'0'.repeat(64)},deps),/expected snapshot/);
 await assert.rejects(verifyRestoredState(manifest,{...deps,read:async()=>({...structuredClone(state),tombstones:[]})}),/expected snapshot/);
 await assert.rejects(verifyRestoredState(manifest,{...deps,resolve:async()=>({tenantId:tenant,actorId:'active-actor',version:1})}),/Revoked restored identity still resolved/);
 await assert.rejects(verifyRestoredState(manifest,{...deps,inspect:async()=>({bindingId:'',version:1,status:'active' as const,tenantId:tenant,actorId:'active-actor'})}),/identity binding differs/);
});
