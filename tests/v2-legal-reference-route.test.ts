import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {POST} from '../src/app/api/v2/legal/govinfo/route';
import {closeV2Store,readWorkspace,transactWorkspace} from '../src/v2/store';

test('GovInfo route derives a provisioned reviewer, requires same-origin CSRF, and rejects missing exact preview',async()=>{
 const before={...process.env},dir=await mkdtemp(join(tmpdir(),'kiara-govinfo-route-'));await closeV2Store();
 try{
  Object.assign(process.env,{KIARA_V2_DATA_DIR:dir,KIARA_V2_AUTH_MODE:'oidc',KIARA_OIDC_IDENTITY_SOURCE:'fixture_env',KIARA_PUBLIC_ORIGIN:'https://kiara.example',KIARA_OIDC_ISSUER:'https://identity.example',KIARA_OIDC_CLIENT_ID:'kiara-client',KIARA_SESSION_SECRET:'s'.repeat(48),KIARA_OIDC_IDENTITIES:JSON.stringify([{subject:'reviewer-sub',tenantId:'legal-route',actorId:'reviewer'}])});delete process.env.MONGODB_URI;delete process.env.VERCEL;
  await transactWorkspace('legal-route',s=>{s.memberships.push({actorId:'reviewer',roles:['member','legal_reviewer'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});});
  const cookieName=`kiara_v2_${createHash('sha256').update(resolve(dir)).digest('hex').slice(0,12)}`,csrf='review-csrf',payload=Buffer.from(JSON.stringify({actor:{tenantId:'legal-route',actorId:'reviewer',expiresAt:Date.now()+300000,mode:'authenticated'},csrf,profile:'oidc',subject:'reviewer-sub',identityVersion:1,issuer:'https://identity.example',audience:'kiara-client'})).toString('base64url'),signature=createHmac('sha256',process.env.KIARA_SESSION_SECRET!).update(payload).digest('base64url'),cookie=`${cookieName}=${payload}.${signature}`;
  const selection={operation:'stage',packageId:'USCODE-2024-title17',granuleId:'USCODE-2024-title17-chap1-sec105',domain:'copyright scope',expectedPreviewHash:'bad'};
  const request=(headers:Record<string,string>={})=>new Request('https://kiara.example/api/v2/legal/govinfo',{method:'POST',headers:{'content-type':'application/json',origin:'https://kiara.example',cookie,'x-csrf-token':csrf,...headers},body:JSON.stringify(selection)});
  assert.equal((await POST(new Request(request().url,{method:'POST',headers:{origin:'https://kiara.example','content-type':'application/json'},body:JSON.stringify(selection)}))).status,401);
  assert.equal((await POST(request({'x-csrf-token':'wrong'}))).status,403);
  assert.equal((await POST(request({origin:'https://other.example'}))).status,403);
  const invalid=await POST(request());assert.equal(invalid.status,400);assert.equal((await invalid.json()).error.code,'GOVINFO_PREVIEW_REQUIRED');
  assert.equal((await readWorkspace('legal-route')).sources.length,0);
 }finally{await closeV2Store();for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
});
