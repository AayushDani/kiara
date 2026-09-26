import {randomBytes} from 'node:crypto';
import {publicDemo,withDemoScope} from '@/server/demo-context';
import {NextResponse} from 'next/server';
import {readState,transaction} from '@/data/store';
import {hash,now} from '@/server/hash';
import type {Json,Session} from '@/server/contracts';
import {provisions,bindings,followups} from '@/data/fixtures';
import {AppError,type Role} from '@/server/contracts';
import {getSession,issueSession,csrf,requireLocalDemo,requireAuthMode,hostedAuth,checkLogin,clearSessionCookie} from '@/server/auth';
import {readiness} from '@/server/readiness';
import * as engine from '@/workflow/engine';
import {recheckSources} from '@/server/sources';
import {retryNotification,webhook} from '@/server/notifications';
import {scheduleWorker} from '@/server/hosted-worker';
export const maxDuration=300;
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function json(value:unknown,status=200,cookie?:string){return NextResponse.json(value,{status,headers:{...headers,...(cookie?{'Set-Cookie':cookie}:{})}});}
function fail(error:unknown){if(error instanceof AppError)return json({error:{code:error.code,message:error.message}},error.status);console.error('Kiara request failed:',error instanceof Error?error.name:'unknown');return json({error:{code:'INTERNAL_ERROR',message:'The action could not complete. Check the server readiness and retry.'}},500);}
async function body(request:Request,keys:string[]){const text=await request.text();if(text.length>65536)throw new AppError('PAYLOAD_TOO_LARGE','Request is too large.',413);let b:any;try{b=JSON.parse(text||'{}');}catch{throw new AppError('INVALID_JSON','Invalid JSON body.',400);}if(!b||Array.isArray(b)||typeof b!=='object'||Object.keys(b).some(k=>!keys.includes(k)))throw new AppError('INVALID_BODY','Unexpected request fields.',400);return b;}
function string(v:any,name:string,max=5000){if(typeof v!=='string'||!v.trim()||v.length>max)throw new AppError('INVALID_FIELD',`Provide a valid ${name}.`,400);return v.trim();}
function epoch(v:any){if(!Number.isSafeInteger(v)||v<1)throw new AppError('INVALID_EPOCH','A valid reset generation is required.',400);return v;}
async function handleGet(request:Request,context:{params:Promise<{path:string[]}>}){try{requireAuthMode(request);const p=(await context.params).path;if(p[0]==='health')return json({status:'ok',application:'kiara'});const authenticated=hostedAuth()?await getSession(request):null;const s=await readState();let session,cookie;try{session=await getSession(request,s.reset_epoch);}catch(e){if(p[0]!=='workspace'||(hostedAuth()&&(!authenticated||!(e instanceof AppError)||e.code!=='RESET_EPOCH_MISMATCH')))throw e;const issued=await issueSession(authenticated?.role||'founder',s.reset_epoch);session=issued.session;cookie=issued.cookie;}if(p[0]==='readiness')return json(readiness(s));if(p[0]==='workspace')return json({state:{...s,receipts:{}},session,sources:provisions().map(({text,...source})=>source),bindings:bindings(),followups:followups(),readiness:readiness(s),model_proposals:engine.modelProposals(s)},200,cookie);if(p[0]==='sources'&&p[1]){const source=provisions().find(x=>x.provision_key===p[1]);if(!source)throw new AppError('NOT_FOUND','Source not found.',404);return json(source);}if(p[0]==='documents'&&p[2]==='export'){const r=s.revisions.find(r=>r.revision_id===p[1]);if(!r)throw new AppError('NOT_FOUND','Document not found.',404);return new Response(`${r.title}\nVersion ${r.revision_number} · ${r.policy_updated_on}\nFictional demonstration — proposed/internal policy, not public publication.\n\n${r.clauses.map(c=>c.heading+'\n'+c.body).join('\n\n')}`,{headers:{...headers,'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="kiara-policy-v${r.revision_number}.txt"`}});}throw new AppError('NOT_FOUND','Endpoint not found.',404);}catch(e){return fail(e);}}
async function command(request:Request,context:{params:Promise<{path:string[]}>}){try{const p=(await context.params).path;if(p[0]==='webhooks'&&p[1]==='resend')return json(await webhook(request));requireAuthMode(request);if(p[0]==='login'){const b=await body(request,['role','password']);const role=checkLogin(request,b.role,b.password);const s=await readState();const issued=await issueSession(role,s.reset_epoch);return json(issued.session,200,issued.cookie);}if(hostedAuth())await getSession(request);const s=await readState();const session=await getSession(request,s.reset_epoch);csrf(request,session);const key=request.headers.get('idempotency-key')||'';const commandEpoch=(v:unknown)=>{const value=epoch(v);if(value!==session.reset_epoch)throw new AppError('RESET_EPOCH_MISMATCH','This session belongs to an older workspace. Refresh before continuing.');return value;};
if(p[0]==='logout')return json({signed_out:true},200,clearSessionCookie());
if(p[0]==='session'){if(!publicDemo())requireLocalDemo(request);const b=await body(request,['role']);if(!['founder','lawyer'].includes(b.role))throw new AppError('INVALID_ROLE','Choose founder or lawyer.',400);const next=await issueSession(b.role as Role,s.reset_epoch);return json(next.session,200,next.cookie);}
if(p[0]==='events'){if(session.role!=='founder')throw new AppError('FORBIDDEN','Only the founder can simulate a company signup.',403);const b=await body(request,['customer_name','postal_address','residence','scenario','expected_reset_epoch']);string(b.customer_name,'name',100);if(b.postal_address!==undefined){const a=b.postal_address;if(!a||Array.isArray(a)||typeof a!=='object'||Object.keys(a).sort().join()!=='city,country,line1,postal_code,region')throw new AppError('INVALID_ADDRESS','Provide the structured synthetic address.',400);for(const k of ['line1','city','region','postal_code','country'])a[k]=string(a[k],k,k==='line1'?150:60);if(a.country!=='US'||!['CA','NY'].includes(a.region)||!/^\d{5}$/.test(a.postal_code))throw new AppError('INVALID_ADDRESS','Use a supported US synthetic address.',400);}if(!['US-CA','US-NY'].includes(b.residence)||!['covered','unknown','not_covered'].includes(b.scenario))throw new AppError('INVALID_SCENARIO','Choose a supported scenario.',400);commandEpoch(b.expected_reset_epoch);if(publicDemo()&&s.workflows.length>=20)throw new AppError('DEMO_LIMIT','Reset this demo before adding more signups.',429);return json(await engine.signup(b,key),201);}
if(p[0]==='workflows'&&p[2]==='review'){const b=await body(request,['action','expected_state_version','expected_reset_epoch','bundle_hash','note']);if(!['viewed','reviewed','approved','requested_changes','rejected'].includes(b.action)||!Number.isSafeInteger(b.expected_state_version))throw new AppError('INVALID_REVIEW','Invalid review action or version.',400);commandEpoch(b.expected_reset_epoch);string(b.bundle_hash,'review bundle',64);if(typeof b.note!=='string'||b.note.length>5000)throw new AppError('INVALID_NOTE','Invalid note.',400);const result=await engine.review(p[1],session.role,b,key);if('demo_reset' in result&&result.demo_reset){const next=await issueSession('founder',result.reset_epoch);return json(result,200,next.cookie);}return json(result);}
if(p[0]==='workflows'&&p[2]==='feedback'){const b=await body(request,['type','text','fact_key','proposed_value','clause_id','expected_candidate_revision_id','expected_state_version','expected_reset_epoch']);if(!['fact_correction','document_edit','legal_interpretation_note','harness_improvement'].includes(b.type))throw new AppError('INVALID_FEEDBACK','Choose a feedback category.',400);string(b.text,'feedback',5000);commandEpoch(b.expected_reset_epoch);if(b.type==='fact_correction'){string(b.fact_key,'fact',100);if(b.proposed_value===undefined)throw new AppError('VALUE_REQUIRED','Supply the proposed fact value.',400);}if(b.type==='document_edit'){string(b.clause_id,'clause',100);string(b.expected_candidate_revision_id,'candidate revision',100);if(!Number.isSafeInteger(b.expected_state_version))throw new AppError('INVALID_REVIEW','An exact draft version is required.',400);}return json(await engine.feedback(p[1],session.role,b,key),201);}
if(p[0]==='workflows'&&p[2]==='recheck-sources'){const b=await body(request,['expected_reset_epoch']);return json(await recheckSources(p[1],session.role,commandEpoch(b.expected_reset_epoch)));}
if(p[0]==='model-proposals'&&p[2]==='evaluate'){if(session.role!=='founder')throw new AppError('FORBIDDEN','Founder/operator action required.',403);await body(request,[]);const proposal=s.receipts[`${s.reset_epoch}:model_harness_proposal:${p[1]}`]?.result as any;if(!proposal||proposal.kind!=='model_harness_proposal')throw new AppError('PROPOSAL_REQUIRED','An attributed harness proposal is required.',400);if(s.receipts[`${s.reset_epoch}:model_proposal_resolution:${p[1]}`])throw new AppError('PROPOSAL_RESOLVED','This proposal has already been evaluated.');const result=await engine.evaluateHarness({patch:proposal.patch,expected_reset_epoch:s.reset_epoch,expected_champion_generation:s.champion_generation});await transaction(current=>{if(current.reset_epoch!==s.reset_epoch)throw new AppError('RESET_EPOCH_MISMATCH','Workspace reset during evaluation.');const resolution={kind:'model_proposal_resolution',proposal_id:p[1],role:session.role,actor_id:session.actor_id,status:'evaluated',created_at:now(),evaluation:result as unknown as Json};current.receipts[`${s.reset_epoch}:model_proposal_resolution:${p[1]}`]={hash:hash(resolution),result:resolution};});return json(result);}
if(p[0]==='model-proposals'&&p[2]==='verify'){const b=await body(request,['expected_reset_epoch','expected_context_epoch']);if(!Number.isSafeInteger(b.expected_context_epoch))throw new AppError('INVALID_EPOCH','A company context version is required.',400);return json(await engine.verifyModelFact(p[1],session.role,commandEpoch(b.expected_reset_epoch),b.expected_context_epoch));}
if(p[0]==='facts'&&p[2]==='verify'){const b=await body(request,['expected_reset_epoch']);return json(await engine.verifyFact(p[1],session.role,commandEpoch(b.expected_reset_epoch)));}
if(p[0]==='harness'){if(session.role!=='founder')throw new AppError('FORBIDDEN','Founder/operator action required.',403);await body(request,[]);if(p[1]==='evaluate')return json(await engine.evaluateHarness({expected_reset_epoch:session.reset_epoch,expected_champion_generation:s.champion_generation}));if(p[1]==='rollback')return json(await engine.rollback({expected_reset_epoch:session.reset_epoch,expected_champion_generation:s.champion_generation}));}
if(p[0]==='notifications'&&p[2]==='retry'){const b=await body(request,['expected_reset_epoch']);return json(await retryNotification(p[1],commandEpoch(b.expected_reset_epoch)));}
if(p[0]==='worker'&&p[1]==='resume'){await body(request,[]);return json({resumed:true});}
if(p[0]==='reset'){if(!publicDemo()&&session.role!=='founder')throw new AppError('FORBIDDEN','Only the demo founder can reset.',403);const b=await body(request,['expected_reset_epoch']);const reset=await engine.reset(commandEpoch(b.expected_reset_epoch));if(publicDemo()){const next=await issueSession('founder',reset.reset_epoch);return json({...reset,demo_reset:true},200,next.cookie);}return json(reset);}
throw new AppError('NOT_FOUND','Endpoint not found.',404);}catch(e){return fail(e);}}

// Enqueue durable work before acknowledging a mutation. Retrying an idempotent
// command also retries enqueueing if the platform was temporarily unavailable.
async function handlePost(request:Request,context:{params:Promise<{path:string[]}>}){
  const response=await command(request,context);
  const path=(await context.params).path[0];
  if(response.ok&&!['login','logout','session','webhooks'].includes(path)){
    try{await scheduleWorker();}catch{return json({error:{code:'WORKER_UNAVAILABLE',message:'The action was saved, but background processing could not start. Use Resume processing in System & activity.'}},503);}
  }
  return response;
}

// Derive isolation only from a server-signed cookie, never a URL or body field.
// Existing password-mode cookies cannot grant access to the shared workspace.
type RouteContext={params:Promise<{path:string[]}>};
async function inDemo(request:Request,context:RouteContext,handler:(request:Request,context:RouteContext)=>Promise<Response>):Promise<Response>{
  if(!publicDemo())return handler(request,context);
  try{
    requireAuthMode(request);
    const path=(await context.params).path;
    if(request.method==='GET'&&path[0]==='health')return handler(request,context);
    if(path[0]==='webhooks')throw new AppError('DEMO_ONLY','Public demos do not accept delivery webhooks.',403);
    let session:Session|undefined;
    try{session=await getSession(request);}catch(error){
      if(request.method!=='GET'||path[0]!=='workspace'||!(error instanceof AppError)||error.status!==401)throw error;
    }
    const scope={id:session?.demo_id||randomBytes(16).toString('hex'),expires_at:session?.expires_at||Date.now()+4*60*60*1000};
    return await withDemoScope(scope,async()=>{
      let cookie:string|undefined;
      if(!session){const issued=await issueSession('founder',1);cookie=issued.cookie;const headers=new Headers(request.headers);headers.set('cookie',cookie.split(';')[0]);request=new Request(request,{headers});}
      const response=await handler(request,context);
      if(cookie&&!response.headers.has('set-cookie'))response.headers.set('set-cookie',cookie);
      return response;
    });
  }catch(error){return fail(error);}
}
export async function GET(request:Request,context:RouteContext){return inDemo(request,context,handleGet);}
export async function POST(request:Request,context:RouteContext){return inDemo(request,context,handlePost);}
