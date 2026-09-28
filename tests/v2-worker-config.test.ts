import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertManagedWorkerIdentityConfig} from '../src/v2/orchestration/worker-config';

test('managed worker requires an issuer for queued OIDC grant validation',()=>{
 const env:NodeJS.ProcessEnv={NODE_ENV:'production',KIARA_V2_AUTH_MODE:'oidc',KIARA_OIDC_IDENTITY_SOURCE:'mongo'};
 assert.throws(()=>assertManagedWorkerIdentityConfig(env),/OIDC issuer/);
 env.KIARA_OIDC_ISSUER='https://identity.example.test/';
 assert.doesNotThrow(()=>assertManagedWorkerIdentityConfig(env));
 env.KIARA_OIDC_ISSUER='http://identity.example.test/';
 assert.throws(()=>assertManagedWorkerIdentityConfig(env),/OIDC issuer/);
 env.KIARA_OIDC_ISSUER='https://identity.example.test/';env.KIARA_V2_AUTH_MODE='local_demo';
 assert.throws(()=>assertManagedWorkerIdentityConfig(env),/OIDC mode/);
});

test('Render worker Blueprint prompts for the same OIDC issuer as the web tier',async()=>{
 const blueprint=await readFile(new URL('../render.yaml',import.meta.url),'utf8');
 assert.match(blueprint,/key: KIARA_V2_AUTH_MODE\s+value: oidc/);
 assert.match(blueprint,/key: KIARA_OIDC_IDENTITY_SOURCE\s+value: mongo/);
 assert.match(blueprint,/key: KIARA_OIDC_ISSUER\s+sync: false/);
});
