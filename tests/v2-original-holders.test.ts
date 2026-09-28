import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {emptyWorkspace} from '../src/v2/store';
import {liveMongoOriginalHolders} from '../src/v2/original-holders';
import type {OriginalReference} from '../src/v2/objects';

const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
test('alias cleanup retains an unresolved effect whose only original holder is nested readback or frozen action content',()=>{
 const tenant='synthetic-effect-holder',bytes=Buffer.from('effect-owned original bytes'),keyId='a'.repeat(16);
 const reference:OriginalReference={key:`${sha(tenant)}/${sha(bytes)}/${keyId}`,sha256:sha(bytes),bytes:bytes.length,encryption:'aes-256-gcm',storage:'mongo_encrypted',keyId};
 const state=emptyWorkspace(tenant),intent={status:'uncertain',providerReceipt:JSON.stringify({readback:reference}),actionSnapshot:{content:bytes.toString('utf8')},redactedAt:null};
 state.receipts['execution:x']={hash:'effect',result:{intent}};
 assert.deepEqual(liveMongoOriginalHolders(state,reference,undefined,{forReconciliation:true}),['effect:execution:x','effect:execution:x:content']);
 intent.providerReceipt='';
 assert.deepEqual(liveMongoOriginalHolders(state,reference,undefined,{forReconciliation:true}),['effect:execution:x:content']);
 intent.actionSnapshot.content='redacted current action';intent.providerReceipt=JSON.stringify({readback:reference});
 assert.deepEqual(liveMongoOriginalHolders(state,reference,undefined,{forReconciliation:true}),['effect:execution:x']);
});
test('alias cleanup retains a staging intake by content hash before its reference is recorded',()=>{
 const tenant='synthetic-staging-holder',bytes=Buffer.from('staged original'),keyId='b'.repeat(16);
 const reference:OriginalReference={key:`${sha(tenant)}/${sha(bytes)}/${keyId}`,sha256:sha(bytes),bytes:bytes.length,encryption:'aes-256-gcm',storage:'mongo_encrypted',keyId};
 const state=emptyWorkspace(tenant);state.receipts['artifact-intake:x']={hash:'intake',result:{intake:{status:'staging',contentHash:reference.sha256,reference:null}}};
 assert.deepEqual(liveMongoOriginalHolders(state,reference,undefined,{forReconciliation:true}),['intake:artifact-intake:x:staging']);
});
test('alias cleanup retains staged and inventoried migration archives',()=>{
 const tenant='synthetic-migration-holder',bytes=Buffer.from('legacy archive bytes'),keyId='d'.repeat(16);
 const reference:OriginalReference={key:`${sha(tenant)}/${sha(bytes)}/${keyId}`,sha256:sha(bytes),bytes:bytes.length,encryption:'aes-256-gcm',storage:'mongo_encrypted',keyId};
 const state=emptyWorkspace(tenant),key='migration-archive:'+sha(bytes);
 state.receipts[key]={hash:'archive',result:{archive:{status:'staging',contentHash:reference.sha256,reference:null}}};
 assert.deepEqual(liveMongoOriginalHolders(state,reference,undefined,{forReconciliation:true}),[`migration:${key}:unresolved`]);
 (state.receipts[key].result.archive as {status:string;reference:string|null}).reference=JSON.stringify(reference);
 assert.deepEqual(liveMongoOriginalHolders(state,reference,undefined,{forReconciliation:true}),[`migration:${key}`]);
});
test('alias cleanup fails closed on an excessively nested effect readback',()=>{
 const tenant='synthetic-deep-holder',bytes=Buffer.from('deep original'),keyId='c'.repeat(16);
 const reference:OriginalReference={key:`${sha(tenant)}/${sha(bytes)}/${keyId}`,sha256:sha(bytes),bytes:bytes.length,encryption:'aes-256-gcm',storage:'mongo_encrypted',keyId};
 let nested:unknown=reference;for(let n=0;n<10;n++)nested={readback:nested};
 const state=emptyWorkspace(tenant);state.receipts['execution:deep']={hash:'effect',result:{intent:{status:'uncertain',providerReceipt:JSON.stringify(nested)}}};
 assert.deepEqual(liveMongoOriginalHolders(state,reference,undefined,{forReconciliation:true}),['effect:execution:deep:unclassified']);
});
