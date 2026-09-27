import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {authenticateV2,localSession,csrfV2,verifyOidcToken,startOidcSignIn,completeOidcSignIn} from '../src/v2/auth';
import {closeV2Store,transactWorkspace} from '../src/v2/store';

test('v2 local sessions are signed, origin bound, role limited and explicitly simulated',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-v2-auth-'));
 try{
  process.env.KIARA_V2_DATA_DIR=dir;process.env.KIARA_V2_AUTH_MODE='local_demo';delete process.env.VERCEL;delete process.env.KIARA_SESSION_SECRET;delete process.env.KIARA_AUTH_MODE;
  const issued=await localSession(new Request('http://localhost:3091/api/v2/workspace'),'engineer');
  const req=new Request('http://localhost:3091/api/v2/commands',{headers:{cookie:issued.cookie.split(';')[0],origin:'http://localhost:3091','x-csrf-token':issued.session.csrf}});
  const {session}=await authenticateV2(req);assert.equal(session.actor.mode,'local_demo');assert.deepEqual(session.actor.bootstrapRoles,['member','fact_owner']);csrfV2(req,session);
  assert.throws(()=>csrfV2(new Request(req,{headers:{origin:'http://evil.example','x-csrf-token':session.csrf}}),session),/originate/);
  await assert.rejects(localSession(new Request('https://kiara.example/api/v2/workspace')),/local development/);
  await assert.rejects(localSession(req,'admin'),/demonstration role/);
  await assert.rejects(authenticateV2(new Request(req,{headers:{cookie:issued.cookie.split(';')[0]+'x'}})),/invalid/);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

for(const returnTo of ['/','/review/attention'])test(`organization browser sign-in binds code, state, PKCE, nonce and provisioned membership for ${returnTo}`,async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-oidc-browser-'));await closeV2Store();
 try{
  Object.assign(process.env,{KIARA_V2_DATA_DIR:dir,KIARA_V2_AUTH_MODE:'oidc',KIARA_PUBLIC_ORIGIN:'https://kiara.example',KIARA_OIDC_ISSUER:'https://identity.example',KIARA_OIDC_CLIENT_ID:'kiara-client',KIARA_SESSION_SECRET:'s'.repeat(48),KIARA_OIDC_IDENTITIES:JSON.stringify([{subject:'user-1',tenantId:'tenant-a',actorId:'actor-a'}])});delete process.env.MONGODB_URI;delete process.env.KIARA_OIDC_CLIENT_SECRET;
  await transactWorkspace('tenant-a',s=>{s.memberships.push({actorId:'actor-a',roles:['member'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});let nonce='',wrongNonce=false,used=false;let challenge='';const now=Math.floor(Date.now()/1000);
  const token=()=>{const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'key-1'})).toString('base64url');const claims=Buffer.from(JSON.stringify({iss:'https://identity.example',aud:'kiara-client',sub:'user-1',iat:now,exp:now+600,nonce:wrongNonce?'foreign-attempt':nonce})).toString('base64url');return `${header}.${claims}.${sign('RSA-SHA256',Buffer.from(`${header}.${claims}`),privateKey).toString('base64url')}`;};
  const provider:typeof fetch=async(input,init)=>{const url=String(input);if(url.endsWith('/token')){assert.equal(init?.method,'POST');const form=new URLSearchParams(String(init?.body));const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'),challenge);assert.equal(form.get('redirect_uri'),'https://kiara.example/api/v2/auth/callback');assert.equal(form.get('code'),'issued-once');if(used)return new Response('{}',{status:400});used=true;return Response.json({id_token:token()});}return Response.json(url.includes('openid-configuration')?{issuer:'https://identity.example',authorization_endpoint:'https://identity.example/authorize',token_endpoint:'https://identity.example/token',jwks_uri:'https://identity.example/keys',code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']}:{keys:[{...publicKey.export({format:'jwk'}),kid:'key-1',use:'sig'}]});};
  for(const bad of ['https://evil.example','//evil.example','/review/attention?approve=true','/other'])await assert.rejects(startOidcSignIn(new Request('https://kiara.example/api/v2/auth/start?returnTo='+encodeURIComponent(bad)),provider),{code:'OIDC_RETURN_INVALID'});
  await assert.rejects(startOidcSignIn(new Request('https://kiara.example/api/v2/auth/start?returnTo=%2F&returnTo=%2Freview%2Fattention'),provider),{code:'OIDC_RETURN_INVALID'});
  const start=await startOidcSignIn(new Request('https://kiara.example/api/v2/auth/start?returnTo='+encodeURIComponent(returnTo)),provider),authorize=new URL(start.location);nonce=authorize.searchParams.get('nonce')!;challenge=authorize.searchParams.get('code_challenge')!;assert.equal(authorize.searchParams.get('response_type'),'code');assert.equal(authorize.searchParams.get('scope'),'openid');assert.match(start.cookie,/HttpOnly; Secure; SameSite=Lax/);
  const callback=new Request(`https://kiara.example/api/v2/auth/callback?code=issued-once&state=${authorize.searchParams.get('state')}`,{headers:{cookie:start.cookie.split(';')[0]}});
  await assert.rejects(completeOidcSignIn(new Request(callback.url.replace('state=','state=forged'),{headers:callback.headers}),provider),/does not match/);assert.equal(used,false);
  wrongNonce=true;await assert.rejects(completeOidcSignIn(callback,provider),/sign-in attempt/);used=false;wrongNonce=false;
  const result=await completeOidcSignIn(callback,provider);assert.equal(result.location,'https://kiara.example'+returnTo);assert.equal(result.session.actor.actorId,'actor-a');assert.equal(result.session.actor.bootstrapRoles,undefined);assert.match(result.cookie,/SameSite=Strict/);
  await assert.rejects(completeOidcSignIn(callback,provider),/could not complete/);
  used=false;await transactWorkspace('tenant-a',s=>{s.memberships[0].revokedAt=new Date().toISOString();});await assert.rejects(completeOidcSignIn(callback,provider),/membership/);
  await assert.rejects(startOidcSignIn(new Request('https://evil.example/api/v2/auth/start'),provider),/configured application origin/);
 }finally{await closeV2Store();for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});

test('OIDC identity verification rejects forged tokens, wrong audience, expiry and unmapped subjects',async()=>{
 const before={...process.env};
 try{
  process.env.KIARA_OIDC_ISSUER='https://identity.example';process.env.KIARA_OIDC_CLIENT_ID='kiara-client';process.env.KIARA_OIDC_IDENTITIES=JSON.stringify([{subject:'user-1',tenantId:'tenant-a',actorId:'actor-a'}]);
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const now=Math.floor(Date.now()/1000);
  const make=(changes:Record<string,unknown>={})=>{const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'key-1'})).toString('base64url');const claims=Buffer.from(JSON.stringify({iss:'https://identity.example',aud:'kiara-client',sub:'user-1',iat:now,exp:now+600,roles:['admin'],...changes})).toString('base64url');return `${header}.${claims}.${sign('RSA-SHA256',Buffer.from(`${header}.${claims}`),privateKey).toString('base64url')}`;};
  const provider:typeof fetch=async input=>new Response(JSON.stringify(String(input).includes('openid-configuration')?{issuer:'https://identity.example',jwks_uri:'https://identity.example/keys'}:{keys:[{...publicKey.export({format:'jwk'}),kid:'key-1',use:'sig'}]}),{status:200});
  const identity=await verifyOidcToken(make(),provider);assert.equal(identity.actor.actorId,'actor-a');assert.equal(identity.actor.tenantId,'tenant-a');assert.equal(identity.actor.bootstrapRoles,undefined,'Token roles cannot create authority');
  for(const change of [{aud:'another-client'},{exp:now-1},{iss:'https://evil.example'},{aud:['kiara-client','other'],azp:'other'},{sub:'unknown-user'}])await assert.rejects(verifyOidcToken(make(change),provider));
  const token=make();await assert.rejects(verifyOidcToken(token.slice(0,token.lastIndexOf('.')+1)+'forged',provider),/signature/);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
});
