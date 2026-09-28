import {createHash,createHmac,createPublicKey,randomBytes,timingSafeEqual,verify} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {V2Error,type ActorContext,type Role} from './contracts';
import {readWorkspace} from './store';
import {membership} from './authority';
import {resolveOidcIdentity} from './oidc-identities';
import {requestOriginMatches} from '../server/request-origin';

interface Session {actor:ActorContext;csrf:string;profile:string;subject?:string;identityVersion?:number;issuer?:string;audience?:string}
const profiles:Record<string,Role[]>={founder:['member','fact_owner','business_owner','publisher','admin'],engineer:['member','fact_owner'],counsel:['member','legal_reviewer'],publisher:['member','publisher'],evaluator:['member','evaluator'],signatory:['member','signatory']};
const directory=()=>resolve(process.env.KIARA_V2_DATA_DIR||process.env.KIARA_DATA_DIR||join(process.cwd(),'.kiara-v2'));
const mode=()=>process.env.KIARA_V2_AUTH_MODE||'local_demo';
const cookieName=()=>`kiara_v2_${createHash('sha256').update(directory()).digest('hex').slice(0,12)}`;
const safeEqual=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function checkMode(request:Request){
  const url=new URL(request.url);
  if(mode()==='local_demo'){
    if(process.env.VERCEL||process.env.KIARA_AUTH_MODE==='hosted_password'||process.env.KIARA_AUTH_MODE==='public_demo'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new V2Error('LOCAL_ONLY','Simulated identities are available only in a local development workspace.',403);
  }else if(mode()==='oidc'){
    if(url.protocol!=='https:')throw new V2Error('HTTPS_REQUIRED','Use the secure application URL.',403);
    if((process.env.KIARA_SESSION_SECRET?.length||0)<32)throw new V2Error('AUTH_NOT_CONFIGURED','Configure the server session signing secret.',503);
  }else throw new V2Error('AUTH_NOT_CONFIGURED','Choose a configured authentication mode.',503);
}
async function secret(){
  if(process.env.KIARA_SESSION_SECRET){if(process.env.KIARA_SESSION_SECRET.length<32)throw new V2Error('AUTH_NOT_CONFIGURED','The session signing secret must contain at least 32 characters.',503);return process.env.KIARA_SESSION_SECRET;}
  if(mode()!=='local_demo')throw new V2Error('AUTH_NOT_CONFIGURED','Configure the session signing secret.',503);
  await mkdir(directory(),{recursive:true,mode:0o700});const path=join(directory(),'v2-session-secret');
  try{return await readFile(path,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const value=randomBytes(48).toString('hex');
  try{await writeFile(path,value,{flag:'wx',mode:0o600});return value;}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return readFile(path,'utf8');throw e;}
}
function cookie(value:string,maxAge:number){return `${cookieName()}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${mode()==='oidc'?'; Secure':''}`;}
async function issue(session:Session){const encoded=Buffer.from(JSON.stringify(session)).toString('base64url');const signature=createHmac('sha256',await secret()).update(encoded).digest('base64url');return {session,cookie:cookie(`${encoded}.${signature}`,Math.max(0,Math.floor((session.actor.expiresAt-Date.now())/1000)))};}
export function sameV2Origin(request:Request){
  if(!requestOriginMatches(request,mode()==='local_demo'&&!process.env.VERCEL&&(!process.env.KIARA_AUTH_MODE||process.env.KIARA_AUTH_MODE==='demo_simulated')))throw new V2Error('ORIGIN_REJECTED','This action must originate from the Kiara application.',403);
}
export function csrfV2(request:Request,session:Session){sameV2Origin(request);if(!safeEqual(request.headers.get('x-csrf-token')||'',session.csrf))throw new V2Error('CSRF_REJECTED','Refresh the workspace before trying this action.',403);}
export async function localSession(request:Request,profile='founder'){
  checkMode(request);if(mode()!=='local_demo'||!Object.hasOwn(profiles,profile))throw new V2Error('INVALID_PROFILE','Choose a supported local demonstration role.',400);
  return issue({actor:{tenantId:'local-workspace',actorId:`local-${profile}`,expiresAt:Date.now()+8*60*60*1000,mode:'local_demo',bootstrapRoles:profiles[profile]},csrf:randomBytes(24).toString('hex'),profile});
}
export async function authenticateV2(request:Request,initialize=false):Promise<{session:Session;cookie?:string}>{
  checkMode(request);
  const value=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName()+'='))?.slice(cookieName().length+1);
  if(!value){if(initialize&&mode()==='local_demo')return localSession(request);throw new V2Error('SESSION_REQUIRED','Sign in with your configured identity provider.',401);}
  const [encoded,signature,extra]=value.split('.');if(!encoded||!signature||extra)throw new V2Error('INVALID_SESSION','Session is invalid.',401);
  const expected=createHmac('sha256',await secret()).update(encoded).digest('base64url');
  if(!safeEqual(signature,expected))throw new V2Error('INVALID_SESSION','Session is invalid.',401);
  let session:Session;try{session=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{throw new V2Error('INVALID_SESSION','Session is invalid.',401);}
  if(!session?.actor||!Number.isFinite(session.actor.expiresAt)||session.actor.expiresAt<=Date.now()||typeof session.csrf!=='string')throw new V2Error('SESSION_EXPIRED','Sign in again to continue.',401);
  if(mode()==='oidc'){
    if(session.actor.mode!=='authenticated'||!session.subject||!session.issuer||!session.audience||session.issuer!==process.env.KIARA_OIDC_ISSUER||session.audience!==process.env.KIARA_OIDC_CLIENT_ID)throw new V2Error('INVALID_SESSION','Sign in with your identity provider.',401);
    const mapping=await resolveOidcIdentity(process.env.KIARA_OIDC_ISSUER||'',session.subject);
    if(mapping.actorId!==session.actor.actorId||mapping.tenantId!==session.actor.tenantId||mapping.version!==session.identityVersion||session.actor.oidcBinding&&session.actor.oidcBinding.key!==mapping.bindingId)throw new V2Error('MEMBERSHIP_REVOKED','This identity mapping changed. Sign in again.',403);
    session.actor.oidcBinding={key:mapping.bindingId,version:mapping.version};
    delete session.actor.bootstrapRoles;
  }else if(session.actor.mode!=='local_demo'||!Object.hasOwn(profiles,session.profile)||session.actor.actorId!==`local-${session.profile}`||session.actor.tenantId!=='local-workspace')throw new V2Error('INVALID_SESSION','Invalid local identity.',401);
  return {session};
}

/** Validate a provider-issued ID token. Identity mappings are server managed; token roles are ignored. */
export async function verifyOidcToken(token:string,fetcher:typeof fetch=fetch,expectedNonce?:string){
  const issuer=process.env.KIARA_OIDC_ISSUER, audience=process.env.KIARA_OIDC_CLIENT_ID;
  if(!issuer||!audience||!issuer.startsWith('https://'))throw new V2Error('OIDC_NOT_CONFIGURED','Configure the OIDC issuer and client ID.',503);
  if(typeof token!=='string'||token.length>16000)throw new V2Error('INVALID_TOKEN','Provide a valid identity token.',401);
  let header:{alg:string;kid:string},claims:{iss:string;aud:string|string[];azp?:string;sub:string;exp:number;nbf?:number;iat:number;nonce?:string};
  const parts=token.split('.');if(parts.length!==3)throw new V2Error('INVALID_TOKEN','Malformed identity token.',401);
  try{header=JSON.parse(Buffer.from(parts[0],'base64url').toString());claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());}catch{throw new V2Error('INVALID_TOKEN','Malformed identity token.',401);}
  if(header.alg!=='RS256'||typeof header.kid!=='string')throw new V2Error('INVALID_TOKEN','Unsupported identity-token signature.',401);
  const clock=Date.now()/1000, audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==issuer||!audiences.includes(audience)||((audiences.length>1||claims.azp!==undefined)&&claims.azp!==audience)||typeof claims.sub!=='string'||!claims.sub||!Number.isFinite(claims.exp)||claims.exp<=clock||!Number.isFinite(claims.iat)||claims.iat>clock+60||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>clock+60)))throw new V2Error('INVALID_TOKEN','Identity token has expired or has the wrong audience or issuer.',401);
  if(expectedNonce&&(typeof claims.nonce!=='string'||!safeEqual(claims.nonce,expectedNonce)))throw new V2Error('OIDC_NONCE_MISMATCH','The identity response does not belong to this sign-in attempt.',401);
  const discovery=await fetcher(`${issuer.replace(/\/$/,'')}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!discovery.ok)throw new V2Error('OIDC_UNAVAILABLE','Identity provider discovery is unavailable.',503);
  const metadata=await boundedProviderJson(discovery);if(metadata.issuer!==issuer||typeof metadata.jwks_uri!=='string'||!metadata.jwks_uri.startsWith('https://'))throw new V2Error('OIDC_INVALID_METADATA','Identity provider metadata is invalid.',503);
  const response=await fetcher(metadata.jwks_uri,{signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw new V2Error('OIDC_UNAVAILABLE','Identity provider signing keys are unavailable.',503);
  const keys=(await boundedProviderJson(response)).keys;
  const matching=Array.isArray(keys)?keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256')):[];
  if(matching.length!==1)throw new V2Error('INVALID_TOKEN','Identity token signing key is unavailable.',401);
  try{if(!verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),createPublicKey({key:matching[0],format:'jwk'}),Buffer.from(parts[2],'base64url')))throw new Error();}catch{throw new V2Error('INVALID_TOKEN','Identity token signature is invalid.',401);}
  const identity=await resolveOidcIdentity(issuer,claims.sub);
  return {actor:{tenantId:identity.tenantId,actorId:identity.actorId,expiresAt:Math.min(claims.exp*1000,Date.now()+30*60*1000),mode:'authenticated',oidcBinding:{key:identity.bindingId,version:identity.version}} as ActorContext,subject:claims.sub,identityVersion:identity.version,issuer:claims.iss,audience};
}
export const clearV2Session=()=>cookie('',0);

interface OidcFlow {returnTo?:string;state:string;nonce:string;verifier:string;redirectUri:string;expiresAt:number;issuer:string;clientId:string}
const validReturnTo=(value:string)=>value==='/'||value==='/review/attention'||/^\/\?matter=[A-Za-z0-9-]{1,200}$/.test(value);
const flowCookieName=()=>`__Host-${cookieName()}_signin`;
export const clearOidcFlow=()=>`${flowCookieName()}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
function browserOidcConfig(request:Request){
 checkMode(request);if(mode()!=='oidc')throw new V2Error('OIDC_DISABLED','Organization sign-in is not enabled in this workspace.',400);
 const configured=process.env.KIARA_PUBLIC_ORIGIN,issuer=process.env.KIARA_OIDC_ISSUER,clientId=process.env.KIARA_OIDC_CLIENT_ID;
 let origin:URL;try{origin=new URL(configured||'');}catch{throw new V2Error('OIDC_NOT_CONFIGURED','Configure the application’s public HTTPS origin.',503);}
 if(origin.protocol!=='https:'||origin.origin!==configured||origin.username||origin.password||!issuer?.startsWith('https://')||!clientId)throw new V2Error('OIDC_NOT_CONFIGURED','Configure an HTTPS public origin, issuer and client ID.',503);
 if(new URL(request.url).origin!==origin.origin)throw new V2Error('ORIGIN_REJECTED','Open sign-in from the configured application origin.',403);
 return {origin:origin.origin,issuer,clientId,redirectUri:`${origin.origin}/api/v2/auth/callback`};
}
async function boundedProviderJson(response:Response):Promise<Record<string,unknown>>{
 if(!response.ok||!response.body)throw new V2Error('OIDC_UNAVAILABLE','The identity provider could not complete sign-in.',503);
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>64000){await reader.cancel();throw new Error();}chunks.push(part.value);}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new V2Error('OIDC_INVALID_RESPONSE','The identity provider returned an invalid response.',503);}
}
async function browserMetadata(issuer:string,fetcher:typeof fetch){
 const value=await boundedProviderJson(await fetcher(`${issuer.replace(/\/$/,'')}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(10000),redirect:'error'}));
 if(value.issuer!==issuer||![value.authorization_endpoint,value.token_endpoint].every(endpoint=>{try{const url=new URL(String(endpoint));return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash;}catch{return false;}})||!Array.isArray(value.code_challenge_methods_supported)||!value.code_challenge_methods_supported.includes('S256'))throw new V2Error('OIDC_INVALID_METADATA','The identity provider must support authorization code sign-in with S256 PKCE.',503);
 return value as {authorization_endpoint:string;token_endpoint:string;token_endpoint_auth_methods_supported?:string[]};
}
/** Redirect-based sign-in uses state, nonce and PKCE; no bearer token is entered in the UI. */
export async function startOidcSignIn(request:Request,fetcher:typeof fetch=fetch){
 const config=browserOidcConfig(request),targets=new URL(request.url).searchParams.getAll('returnTo'),returnTo=targets[0]||'/';
 if(targets.length>1||!validReturnTo(returnTo))throw new V2Error('OIDC_RETURN_INVALID','Choose a supported Kiara sign-in destination.',400);
 const metadata=await browserMetadata(config.issuer,fetcher);
 const flow:OidcFlow={returnTo,state:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url'),verifier:randomBytes(48).toString('base64url'),redirectUri:config.redirectUri,expiresAt:Date.now()+10*60*1000,issuer:config.issuer,clientId:config.clientId};
 const encoded=Buffer.from(JSON.stringify(flow)).toString('base64url'),signature=createHmac('sha256',await secret()).update(encoded).digest('base64url');
 const url=new URL(metadata.authorization_endpoint);for(const [key,value] of Object.entries({client_id:config.clientId,redirect_uri:flow.redirectUri,response_type:'code',scope:'openid',state:flow.state,nonce:flow.nonce,code_challenge:createHash('sha256').update(flow.verifier).digest('base64url'),code_challenge_method:'S256',response_mode:'query'}))url.searchParams.set(key,value);
 return {location:url.href,cookie:`${flowCookieName()}=${encoded}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`};
}
export async function completeOidcSignIn(request:Request,fetcher:typeof fetch=fetch){
 const config=browserOidcConfig(request),url=new URL(request.url),raw=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(flowCookieName()+'='))?.slice(flowCookieName().length+1);
 if(!raw||raw.length>8000)throw new V2Error('OIDC_STATE_REQUIRED','Start a new sign-in attempt from Kiara.',401);
 const [encoded,signature,extra]=raw.split('.');if(!encoded||!signature||extra||!safeEqual(signature,createHmac('sha256',await secret()).update(encoded).digest('base64url')))throw new V2Error('OIDC_STATE_INVALID','Start a new sign-in attempt from Kiara.',401);
 let flow:OidcFlow;try{flow=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{throw new V2Error('OIDC_STATE_INVALID','Start a new sign-in attempt from Kiara.',401);}
 const state=url.searchParams.get('state');if(flow.returnTo!==undefined&&!validReturnTo(flow.returnTo)||!Number.isFinite(flow.expiresAt)||flow.expiresAt<=Date.now()||typeof flow.state!=='string'||!state||url.searchParams.getAll('state').length!==1||!safeEqual(state,flow.state)||flow.issuer!==config.issuer||flow.clientId!==config.clientId||flow.redirectUri!==config.redirectUri||typeof flow.nonce!=='string'||typeof flow.verifier!=='string')throw new V2Error('OIDC_STATE_INVALID','This sign-in response is expired or does not match the current attempt.',401);
 if(url.searchParams.has('error'))throw new V2Error('OIDC_DECLINED','Organization sign-in was not completed. You can try again.',401);
 const code=url.searchParams.get('code');if(!code||code.length>8000||url.searchParams.getAll('code').length!==1)throw new V2Error('OIDC_CODE_REQUIRED','The sign-in response is missing its authorization code.',401);
 if(url.searchParams.has('iss')&&url.searchParams.get('iss')!==config.issuer)throw new V2Error('OIDC_ISSUER_MISMATCH','The sign-in response came from a different identity provider.',401);
 const metadata=await browserMetadata(config.issuer,fetcher),body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:flow.redirectUri,client_id:config.clientId,code_verifier:flow.verifier});const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'};
 const clientSecret=process.env.KIARA_OIDC_CLIENT_SECRET;
 if(clientSecret){if(metadata.token_endpoint_auth_methods_supported&&!metadata.token_endpoint_auth_methods_supported.includes('client_secret_basic'))throw new V2Error('OIDC_NOT_CONFIGURED','Configure a provider supporting client_secret_basic authentication.',503);headers.Authorization=`Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`;}else if(!metadata.token_endpoint_auth_methods_supported?.includes('none'))throw new V2Error('OIDC_NOT_CONFIGURED','Configure the organization identity client secret.',503);
 const token=await boundedProviderJson(await fetcher(metadata.token_endpoint,{method:'POST',headers,body,signal:AbortSignal.timeout(10000),redirect:'error'}));if(typeof token.id_token!=='string')throw new V2Error('OIDC_INVALID_RESPONSE','The identity provider returned no identity token.',401);
 const identity=await verifyOidcToken(token.id_token,fetcher,flow.nonce);membership(await readWorkspace(identity.actor.tenantId),identity.actor);
 const issued=await issue({...identity,csrf:randomBytes(24).toString('hex'),profile:'oidc'});return {...issued,location:config.origin+(flow.returnTo||'/')};
}
