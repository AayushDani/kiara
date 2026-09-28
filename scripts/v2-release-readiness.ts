/** Secret-free, read-only preflight. Connected qualifications are separate release gates. */
import {ConnectionString} from 'mongodb-connection-string-url';
export interface ReleaseCheck {code:string;configured:boolean}
export interface ReleaseReadiness {
  target:'kiara-v2-hosted';configurationReady:boolean;releaseQualified:false;
  legacyMode:'disabled'|'public_demo'|'hosted_password'|'local_or_unset';checks:ReleaseCheck[];
  connectedEvidenceRequired:string[];
}

const key=/^[A-Z][A-Z0-9_]{0,99}$/;
const has=(env:NodeJS.ProcessEnv,name:string)=>typeof env[name]==='string'&&env[name]!.length>0;
const httpsOrigin=(value:string|undefined)=>{try{const url=new URL(value||'');return url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password&&!url.hash;}catch{return false;}};
const httpsIssuer=(value:string|undefined)=>{try{const url=new URL(value||'');return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}};
const mongoTls=(value:string|undefined)=>{
  if(!value)return false;
  try{
    const url=new ConnectionString(value),entries=[...url.searchParams].map(([name,setting])=>[name.toLowerCase(),setting.toLowerCase()] as const),parameters=new Map(entries);
    const tls=parameters.get('tls'),ssl=parameters.get('ssl');
    const insecure=entries.some(([name,setting])=>['tlsinsecure','tlsallowinvalidcertificates','tlsallowinvalidhostnames'].includes(name)&&!['false','0'].includes(setting));
    const ambiguous=['tls','ssl','tlsinsecure','tlsallowinvalidcertificates','tlsallowinvalidhostnames'].some(name=>entries.filter(([key])=>key===name).length>1);
    return !insecure&&!ambiguous&&!['false','0'].includes(tls||'')&&!['false','0'].includes(ssl||'')&&(url.protocol==='mongodb+srv:'||url.protocol==='mongodb:'&&(['true','1'].includes(tls||'')||['true','1'].includes(ssl||'')));
  }catch{return false;}
};
const rows=(value:string|undefined):Record<string,unknown>[]|null=>{try{const parsed=JSON.parse(value||'');return Array.isArray(parsed)&&parsed.length>0&&parsed.length<=100&&parsed.every(v=>v&&typeof v==='object'&&!Array.isArray(v))?parsed:null;}catch{return null;}};
const nonempty=(value:unknown,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max;

export function inspectV2ReleaseEnvironment(env:NodeJS.ProcessEnv,connected:{activeBindingTenants?:string[];ledgerAnchorVerified?:boolean}={}):ReleaseReadiness {
  const checks:ReleaseCheck[]=[];
  const add=(code:string,configured:boolean)=>checks.push({code,configured});
  const workerTenants=(env.KIARA_V2_WORKER_TENANTS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const tenants=new Set(workerTenants),active=new Set(connected.activeBindingTenants||[]);
  const execution=rows(env.KIARA_V2_EXECUTION);
  const liveEmailTenants=new Set((execution||[]).filter(i=>{
    const e=i.email as Record<string,unknown>|undefined;
    return nonempty(i.tenantId)&&tenants.has(i.tenantId as string)&&e?.mode==='resend'&&nonempty(e.from,320)&&
      Array.isArray(e.allowedRecipients)&&e.allowedRecipients.length>0&&e.allowedRecipients.every(a=>nonempty(a,320))&&
      typeof e.tokenEnv==='string'&&key.test(e.tokenEnv)&&has(env,e.tokenEnv);
  }).map(i=>i.tenantId as string));
  const liveEmail=tenants.size>0&&[...tenants].every(t=>liveEmailTenants.has(t));
  add('LEGACY_API_DISABLED',env.KIARA_AUTH_MODE==='disabled');
  add('OIDC_MODE',env.KIARA_V2_AUTH_MODE==='oidc');
  add('OIDC_PUBLIC_HTTPS_ORIGIN',httpsOrigin(env.KIARA_PUBLIC_ORIGIN));
  add('OIDC_ISSUER_AND_CLIENT',httpsIssuer(env.KIARA_OIDC_ISSUER)&&has(env,'KIARA_OIDC_CLIENT_ID'));
  add('OIDC_MONGO_BINDING_SOURCE',!env.KIARA_OIDC_IDENTITY_SOURCE||env.KIARA_OIDC_IDENTITY_SOURCE==='mongo');
  add('OIDC_ACTIVE_BINDINGS_AND_MEMBERSHIPS',tenants.size>0&&[...tenants].every(t=>active.has(t)));
  add('SESSION_SIGNING_SECRET',!!env.KIARA_SESSION_SECRET&&env.KIARA_SESSION_SECRET.length>=32);
  add('NORMALIZED_MONGO_TLS',env.KIARA_V2_STORE_MODE==='normalized'&&mongoTls(env.MONGODB_URI));
  add('V2_DATABASE_TARGET',env.MONGODB_DB==='kiara_v2');
  add('MONGO_ENCRYPTED_ORIGINALS',env.KIARA_ORIGINALS_MODE==='mongo_encrypted'&&/^[a-f0-9]{64}$/i.test(env.KIARA_ORIGINALS_KEY||''));
  add('ATLAS_HYBRID_INDEXES',env.KIARA_V2_RETRIEVAL_MODE==='atlas'&&!!env.KIARA_V2_ATLAS_SEARCH_INDEX&&!!env.KIARA_V2_ATLAS_VECTOR_INDEX&&(!env.KIARA_V2_ATLAS_URI||mongoTls(env.KIARA_V2_ATLAS_URI)));
  add('EXPLICIT_OPENAI_BUDGET_LEDGER',has(env,'KIARA_BUDGET_DB'));
  add('PINNED_OPENAI_BUDGET_LEDGER',/^[a-f0-9]{64}$/i.test(env.KIARA_BUDGET_LEDGER_ANCHOR||'')&&/^[1-9]\d*$/.test(env.KIARA_BUDGET_LEDGER_MIN_REQUESTS||'')&&/^(0|[1-9]\d*)$/.test(env.KIARA_BUDGET_LEDGER_MIN_SPENT_MICRO||'')&&connected.ledgerAnchorVerified===true);
  add('OPENAI_EMBEDDING_AND_AI',env.KIARA_V2_AI_MODE==='openai'&&has(env,'OPENAI_API_KEY'));
  const budget=Number(env.KIARA_OPENAI_BUDGET_USD);
  add('AUTHORIZED_OPENAI_BUDGET',Number.isFinite(budget)&&budget>0&&budget<=50);
  add('TEMPORAL_NAMESPACE_AND_CREDENTIAL',env.KIARA_V2_ORCHESTRATION_MODE==='temporal'&&['KIARA_TEMPORAL_ADDRESS','KIARA_TEMPORAL_NAMESPACE','KIARA_TEMPORAL_TASK_QUEUE','KIARA_TEMPORAL_API_KEY'].every(name=>has(env,name)));
  add('WORKER_TENANT_SELECTION',workerTenants.length>0&&workerTenants.length===tenants.size);
  add('MANAGED_WORKER_HOST',has(env,'KIARA_V2_WORKER_HOST')&&env.KIARA_V2_WORKER_HOST!=='vercel');
  add('LIVE_EMAIL_DELIVERY_CONFIGURATION',liveEmail);
  return {
    target:'kiara-v2-hosted',configurationReady:checks.every(c=>c.configured),releaseQualified:false,
    legacyMode:env.KIARA_AUTH_MODE==='disabled'?'disabled':env.KIARA_AUTH_MODE==='public_demo'?'public_demo':env.KIARA_AUTH_MODE==='hosted_password'?'hosted_password':'local_or_unset',
    checks,connectedEvidenceRequired:[
      'OIDC_LOGIN_AND_MEMBERSHIP_REVOCATION','ATLAS_HYBRID_READ_AND_INDEX_RECOVERY',
      'MONGO_ENCRYPTED_ORIGINAL_ROUND_TRIP_AND_RESTORE','MANAGED_TEMPORAL_WORKER_REPLAY',
      'SANDBOX_PROVIDER_SEND_AND_EXACT_READBACK','GLOBAL_OPENAI_LEDGER_RECONCILIATION',
      'RECOVERY_DRILL_AND_CUSTOMER_ACCEPTANCE',
    ],
  };
}

if(import.meta.url===`file://${process.argv[1]}`){
  (async()=>{
    let activeBindingTenants:string[]=[],ledgerAnchorVerified=false;
    try{
      if(process.env.KIARA_V2_STORE_MODE==='normalized'&&process.env.MONGODB_URI&&process.env.KIARA_OIDC_ISSUER){
        const {activeOidcBindingTenants,closeOidcIdentityStore}=await import('../src/v2/oidc-identities');
        const tenants=(process.env.KIARA_V2_WORKER_TENANTS||'').split(',').map(x=>x.trim()).filter(Boolean);
        try{activeBindingTenants=await activeOidcBindingTenants(process.env.KIARA_OIDC_ISSUER,tenants);}finally{await closeOidcIdentityStore();}
      }
    }catch{/* Missing connected evidence is reported as a failed check, without provider details. */}
    try{
      if(process.env.MONGODB_URI&&process.env.KIARA_BUDGET_DB){
        const {inspectSpendLedgerAnchor}=await import('../src/server/global-spend');
        const {closeStore}=await import('../src/data/store');
        try{ledgerAnchorVerified=await inspectSpendLedgerAnchor();}finally{await closeStore();}
      }
    }catch{/* Wrong or missing ledger fails the check without disclosing credentials or charge identities. */}
    const result=inspectV2ReleaseEnvironment(process.env,{activeBindingTenants,ledgerAnchorVerified});
    process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
    // A successful configuration preflight is not a connected release qualification.
    if(!result.configurationReady||!process.argv.includes('--config-only'))process.exitCode=1;
  })().catch(()=>{process.stderr.write('Release preflight could not complete.\n');process.exitCode=1;});
}
