import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Session,Role} from './contracts';
import {AppError} from './contracts';
import {publicDemo,demoScope} from './demo-context';
import {TENANT,ACTORS} from '../data/fixtures';
import {authorizedBudget} from '../runtime/config';

export const hostedAuth=()=>process.env.KIARA_AUTH_MODE==='hosted_password';
let localSecret:Promise<string>|undefined;
async function getSecret(){
  if(process.env.KIARA_SESSION_SECRET)return process.env.KIARA_SESSION_SECRET;
  if(hostedAuth()||publicDemo())throw new AppError('AUTH_NOT_CONFIGURED','Hosted authentication is not configured.',503);
  return localSecret ||= (async()=>{
    const dir=process.env.KIARA_DATA_DIR||join(process.cwd(),'.kiara');
    await mkdir(dir,{recursive:true});const p=join(dir,'session-secret');
    try{return await readFile(p,'utf8');}catch(e:any){
      if(e.code!=='ENOENT')throw e;
      const value=randomBytes(48).toString('hex');
      try{await writeFile(p,value,{flag:'wx',mode:0o600});return value;}
      catch(e:any){if(e.code==='EEXIST')return readFile(p,'utf8');throw e;}
    }
  })();
}
export function requireLocalDemo(request:Request){
  if((process.env.KIARA_AUTH_MODE||'demo_simulated')!=='demo_simulated')throw new AppError('AUTH_NOT_CONFIGURED','Local demo authentication is disabled.',403);
  if(!['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname))throw new AppError('DEMO_LOCAL_ONLY','Simulated demo identities are available only on the loopback development server.',403);
}
export function requireAuthMode(request:Request){
  if(publicDemo()){
    if((process.env.KIARA_SESSION_SECRET?.length||0)<32)throw new AppError('AUTH_NOT_CONFIGURED','Demo sessions are not configured.',503);
    if(process.env.KIARA_EMAIL_MODE!=='preview'||process.env.KIARA_ALLOW_LIVE_EMAIL==='true')throw new AppError('DEMO_CONFIG_INVALID','Public workspaces require email previews.',503);
    if(process.env.KIARA_MODEL_MODE==='openai'){if(process.env.KIARA_PUBLIC_LIVE_ENABLED!=='true'||!process.env.OPENAI_API_KEY)throw new AppError('DEMO_CONFIG_INVALID','Public AI execution requires explicit operator enablement and a server-side API key.',503);authorizedBudget();}else if(process.env.KIARA_MODEL_MODE!=='scripted')throw new AppError('DEMO_CONFIG_INVALID','Choose a configured model adapter.',503);
    if(new URL(request.url).protocol!=='https:')throw new AppError('HTTPS_REQUIRED','Use the secure demo URL.',403);
    return;
  }
  if(!hostedAuth())return requireLocalDemo(request);
  if((process.env.KIARA_SESSION_SECRET?.length||0)<32||!['FOUNDER','LAWYER'].every(role=>/^[a-f0-9]{64}$/.test(process.env[`KIARA_${role}_PASSWORD_HASH`]||'')))throw new AppError('AUTH_NOT_CONFIGURED','Hosted authentication is not configured.',503);
  if(process.env.KIARA_FOUNDER_PASSWORD_HASH===process.env.KIARA_LAWYER_PASSWORD_HASH)throw new AppError('AUTH_NOT_CONFIGURED','Founder and lawyer credentials must be distinct.',503);
  if(new URL(request.url).protocol!=='https:')throw new AppError('HTTPS_REQUIRED','Use the secure application URL.',403);
}
export function sameOrigin(request:Request){
  if(request.headers.get('origin')!==new URL(request.url).origin)throw new AppError('ORIGIN_REJECTED','This action must originate from the Kiara application.',403);
}
export function checkLogin(request:Request,role:unknown,password:unknown):Role{
  requireAuthMode(request);sameOrigin(request);
  if(!hostedAuth())throw new AppError('LOGIN_UNAVAILABLE','Use the local demo role selector.',400);
  const validRole=role==='founder'||role==='lawyer';
  const expected=Buffer.from(process.env[`KIARA_${role==='lawyer'?'LAWYER':'FOUNDER'}_PASSWORD_HASH`]!,'hex');
  const supplied=createHash('sha256').update(typeof password==='string'&&password.length<=256?password:'').digest();
  if(!timingSafeEqual(expected,supplied)||!validRole)throw new AppError('INVALID_CREDENTIALS','The account or password is incorrect.',401);
  return role as Role;
}
// Cookies are shared across localhost ports. Isolate local stores that use different
// signing keys, so polling a second development server cannot replace this session.
const cookieName=()=>publicDemo()?'kiara_demo_session':hostedAuth()?'kiara_session':`kiara_local_${createHash('sha256').update(resolve(/* turbopackIgnore: true */ process.env.KIARA_DATA_DIR||join(process.cwd(),'.kiara'))).digest('hex').slice(0,16)}`;
export const clearSessionCookie=()=>`${cookieName()}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${hostedAuth()||publicDemo()?'; Secure':''}`;
export async function issueSession(role:Role,epoch:number):Promise<{session:Session;cookie:string}>{
  const scope=publicDemo()?demoScope():undefined;
  const session:Session={...(scope?{demo_id:scope.id}:{}),role,actor_id:ACTORS[role],tenant_id:TENANT,reset_epoch:epoch,csrf:randomBytes(24).toString('hex'),expires_at:scope?.expires_at??Date.now()+8*60*60*1000};
  const encoded=Buffer.from(JSON.stringify(session)).toString('base64url');
  const sig=createHmac('sha256',await getSecret()).update(encoded).digest('base64url');
  return {session,cookie:`${cookieName()}=${encoded}.${sig}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${hostedAuth()||publicDemo()?'; Secure':''}`};
}
export async function getSession(request:Request,epoch?:number):Promise<Session>{
  requireAuthMode(request);
  const value=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName()+'='))?.slice(cookieName().length+1);
  if(!value)throw new AppError('SESSION_REQUIRED',hostedAuth()?'Sign in to open this workspace.':'Refresh to initialize your local demo session.',401);
  const [encoded,sig,extra]=value.split('.');
  if(!encoded||!sig||extra)throw new AppError('INVALID_SESSION','Invalid session.',401);
  const expected=createHmac('sha256',await getSecret()).update(encoded).digest(),actual=Buffer.from(sig,'base64url');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new AppError('INVALID_SESSION','Invalid session.',401);
  let s:Session;try{s=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{throw new AppError('INVALID_SESSION','Invalid session.',401);}
  if(!s||s.tenant_id!==TENANT||!Number.isFinite(s.expires_at)||s.expires_at<Date.now()||!['founder','lawyer'].includes(s.role)||s.actor_id!==ACTORS[s.role]||typeof s.csrf!=='string')throw new AppError('INVALID_SESSION','Session expired. Sign in again.',401);
  if(publicDemo()&&!/^[a-f0-9]{32}$/.test(s.demo_id||''))throw new AppError('INVALID_SESSION','Open a fresh demo session.',401);
  if(epoch!==undefined&&s.reset_epoch!==epoch)throw new AppError('RESET_EPOCH_MISMATCH','Refresh after resetting this workspace.',409);
  return s;
}
export function csrf(request:Request,session:Session){sameOrigin(request);const a=Buffer.from(request.headers.get('x-csrf-token')||''),b=Buffer.from(session.csrf);if(a.length!==b.length||!timingSafeEqual(a,b))throw new AppError('CSRF_REJECTED','Refresh the page before trying this action.',403);}
