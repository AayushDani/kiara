import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectV2ReleaseEnvironment} from '../scripts/v2-release-readiness';

const configured=():NodeJS.ProcessEnv=>({
  NODE_ENV:'production',
  KIARA_AUTH_MODE:'disabled',KIARA_V2_AUTH_MODE:'oidc',KIARA_PUBLIC_ORIGIN:'https://kiara.example.test',
  KIARA_OIDC_ISSUER:'https://identity.example.test',KIARA_OIDC_CLIENT_ID:'kiara',
  KIARA_SESSION_SECRET:'s'.repeat(48),MONGODB_URI:'mongodb+srv://cluster.example.test/kiara_v2',MONGODB_DB:'kiara_v2',KIARA_BUDGET_DB:'kiara_legacy',
  KIARA_V2_STORE_MODE:'normalized',KIARA_ORIGINALS_MODE:'mongo_encrypted',KIARA_ORIGINALS_KEY:'a'.repeat(64),
  KIARA_V2_RETRIEVAL_MODE:'atlas',KIARA_V2_ATLAS_SEARCH_INDEX:'kiara_text',KIARA_V2_ATLAS_VECTOR_INDEX:'kiara_vector',
  KIARA_V2_AI_MODE:'openai',OPENAI_API_KEY:'private-provider-token',KIARA_OPENAI_BUDGET_USD:'10',
  KIARA_V2_ORCHESTRATION_MODE:'temporal',KIARA_TEMPORAL_ADDRESS:'temporal.example.test:7233',
  KIARA_TEMPORAL_NAMESPACE:'kiara',KIARA_TEMPORAL_TASK_QUEUE:'kiara-v2',KIARA_TEMPORAL_API_KEY:'private-temporal-token',
  KIARA_V2_WORKER_TENANTS:'tenant-1',KIARA_V2_WORKER_HOST:'render',KIARA_V2_EXECUTION:JSON.stringify([{tenantId:'tenant-1',email:{mode:'resend',from:'sender@example.test',tokenEnv:'TEST_RESEND_TOKEN',allowedRecipients:['sandbox@example.test']}}]),
  TEST_RESEND_TOKEN:'private-email-token',
});

test('Mongo SRV insecure overrides and one-tenant-only delivery fail release preflight',()=>{
  for(const override of ['tls=false','ssl=FALSE','tlsInsecure=true','TLSINSECURE=1','tlsAllowInvalidCertificates=true','TLSALLOWINVALIDCERTIFICATES=1','tlsAllowInvalidHostnames=true','TLSALLOWINVALIDHOSTNAMES=1','tlsInsecure=true&tlsInsecure=false','tls=false&tls=true','TLS=true&tls=true']){
    const env=configured();env.MONGODB_URI+=`?${override}`;
    assert.equal(inspectV2ReleaseEnvironment(env).checks.find(c=>c.code==='NORMALIZED_MONGO_TLS')?.configured,false);
  }
  const env=configured();env.KIARA_V2_WORKER_TENANTS='tenant-1,tenant-2';
  assert.equal(inspectV2ReleaseEnvironment(env,{activeBindingTenants:['tenant-1','tenant-2']}).checks.find(c=>c.code==='LIVE_EMAIL_DELIVERY_CONFIGURATION')?.configured,false);
  for(const change of [{MONGODB_DB:undefined},{MONGODB_DB:'kiara'},{KIARA_BUDGET_DB:undefined},{KIARA_V2_ATLAS_URI:'mongodb://host.example.test/kiara_v2?tls=false'}]){
    const target={...configured(),...change};
    assert.equal(inspectV2ReleaseEnvironment(target,{activeBindingTenants:['tenant-1']}).configurationReady,false);
  }
});

test('standard Atlas multi-host URI with explicit TLS passes the Mongo readiness check',()=>{
  const uri='mongodb://host-a.mongodb.net:27017,host-b.mongodb.net:27017,host-c.mongodb.net:27017/kiara_v2?replicaSet=atlas-test&authSource=admin&tls=true';
  const env=configured();
  env.MONGODB_URI=uri;
  env.KIARA_V2_ATLAS_URI=uri;
  const result=inspectV2ReleaseEnvironment(env,{activeBindingTenants:['tenant-1']});
  assert.equal(result.checks.find(c=>c.code==='NORMALIZED_MONGO_TLS')?.configured,true);
  assert.equal(result.checks.find(c=>c.code==='ATLAS_HYBRID_INDEXES')?.configured,true);
  assert.equal(result.configurationReady,true);
  for(const insecure of ['tls=false','tlsAllowInvalidCertificates=true','TLS=true&tls=true']){
    const rejected=inspectV2ReleaseEnvironment({...env,MONGODB_URI:`${uri}&${insecure}`},{activeBindingTenants:['tenant-1']});
    assert.equal(rejected.checks.find(c=>c.code==='NORMALIZED_MONGO_TLS')?.configured,false);
  }
});

test('v2 release preflight only reports configuration booleans and retains connected gates',()=>{
  const result=inspectV2ReleaseEnvironment(configured(),{activeBindingTenants:['tenant-1']});
  assert.equal(result.configurationReady,true);
  assert.equal(result.releaseQualified,false);
  assert.ok(result.connectedEvidenceRequired.includes('SANDBOX_PROVIDER_SEND_AND_EXACT_READBACK'));
  assert.ok(result.connectedEvidenceRequired.includes('GLOBAL_OPENAI_LEDGER_RECONCILIATION'));
  const report=JSON.stringify(result);
  for(const secret of ['private-provider-token','private-temporal-token','private-email-token','cluster.example.test','user-1','tenant-1','owner-1'])assert.equal(report.includes(secret),false);
});

test('v2 release preflight rejects inherited legacy authentication',()=>{
  for(const legacy of ['hosted_password','public_demo','demo_simulated',undefined]){
    const env=configured();
    if(legacy===undefined)delete env.KIARA_AUTH_MODE;else env.KIARA_AUTH_MODE=legacy;
    const result=inspectV2ReleaseEnvironment(env,{activeBindingTenants:['tenant-1']});
    assert.equal(result.checks.find(c=>c.code==='LEGACY_API_DISABLED')?.configured,false);
    assert.equal(result.configurationReady,false);
  }
});

test('public demo, fixture identity source, preview delivery, and missing worker fail closed',()=>{
  const env=configured();
  Object.assign(env,{KIARA_AUTH_MODE:'public_demo',KIARA_OIDC_IDENTITY_SOURCE:'fixture_env',KIARA_V2_WORKER_TENANTS:'',KIARA_V2_EXECUTION:JSON.stringify([{tenantId:'tenant-1',email:{mode:'preview',from:'sender@example.test',allowedRecipients:['sandbox@example.test']}}])});
  const result=inspectV2ReleaseEnvironment(env);
  assert.equal(result.configurationReady,false);
  assert.equal(result.legacyMode,'public_demo');
  for(const code of ['LEGACY_API_DISABLED','OIDC_MONGO_BINDING_SOURCE','OIDC_ACTIVE_BINDINGS_AND_MEMBERSHIPS','WORKER_TENANT_SELECTION','LIVE_EMAIL_DELIVERY_CONFIGURATION'])assert.equal(result.checks.find(c=>c.code===code)?.configured,false);
});
