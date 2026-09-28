import {digest} from '../src/v2/store';
import {closeOidcIdentityStore,inspectOidcIdentity,provisionOidcIdentity,revokeOidcIdentity} from '../src/v2/oidc-identities';
import ConnectionString from 'mongodb-connection-string-url';

type Action='provision'|'revoke';
type Phase='preview'|'apply';
type Inspection=Awaited<ReturnType<typeof inspectOidcIdentity>>;
type Dependencies={inspect:typeof inspectOidcIdentity;provision:typeof provisionOidcIdentity;revoke:typeof revokeOidcIdentity};
const actual:Dependencies={inspect:inspectOidcIdentity,provision:provisionOidcIdentity,revoke:revokeOidcIdentity};
const fields=new Set(['--issuer','--subject','--tenant','--actor','--expected-version','--preview-hash']);
const present=(value:string|undefined)=>!!value&&value.length<=200;
const isolatedDatabase=(value:string|undefined)=>!!value&&value.length<=100&&/^kiara_(?:qualification|synthetic)_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value);
const syntheticReleaseTenant=(value:string|undefined)=>!!value&&/^synthetic[-_][a-z0-9][a-z0-9_-]{0,98}$/.test(value);
const atlasReleaseUri=(value:string)=>{
  try{
    const url=new ConnectionString(value),options=[...url.searchParams].map(([key,setting])=>[key.toLowerCase(),setting.toLowerCase()] as const);
    const tls=options.filter(([key])=>key==='tls'||key==='ssl');
    const atlasHosts=url.hosts.length>0&&url.hosts.every(host=>host.replace(/:\d+$/,'').toLowerCase().endsWith('.mongodb.net'));
    const srv=url.protocol==='mongodb+srv:'&&url.hosts.length===1;
    const standard=url.protocol==='mongodb:'&&tls.length===1&&['true','1'].includes(tls[0][1]);
    return (srv||standard)&&atlasHosts&&(url.pathname==='/'||url.pathname==='/kiara_v2')&&tls.length<=1&&tls.every(([,setting])=>['true','1'].includes(setting))&&
      !options.some(([key,setting])=>['tlsinsecure','tlsallowinvalidcertificates','tlsallowinvalidhostnames'].includes(key)&&!['false','0'].includes(setting))&&
      !['tls','ssl','tlsinsecure','tlsallowinvalidcertificates','tlsallowinvalidhostnames'].some(key=>options.filter(([name])=>name===key).length>1);
  }catch{return false;}
};
const exactIssuer=(value:string|undefined)=>{try{if(!value||value.includes('?')||value.includes('#'))return false;const url=new URL(value);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}};

export interface IdentityCliInput {
  phase:Phase;action:Action;issuer:string;subject:string;tenantId:string;actorId:string;
  expectedVersion:number;previewHash?:string;
}

export function parseIdentityCommand(args:string[]):IdentityCliInput {
  const [phase,action,...rest]=args;
  if(!['preview','apply'].includes(phase)||!['provision','revoke'].includes(action))throw new Error('Usage: v2:identity <preview|apply> <provision|revoke> --issuer URL --subject EXACT --tenant ID --actor ID --expected-version N [--preview-hash SHA256]');
  const options=new Map<string,string>();
  for(let i=0;i<rest.length;i+=2){const key=rest[i],value=rest[i+1];if(!fields.has(key)||options.has(key)||!value||value.startsWith('--'))throw new Error('Identity command has a missing, duplicate or unknown option.');options.set(key,value);}
  const issuer=options.get('--issuer'),subject=options.get('--subject'),tenantId=options.get('--tenant'),actorId=options.get('--actor'),rawVersion=options.get('--expected-version'),previewHash=options.get('--preview-hash');
  if(![issuer,subject,tenantId,actorId].every(present)||!exactIssuer(issuer)||!/^(0|[1-9]\d*)$/.test(rawVersion||'')||!Number.isSafeInteger(Number(rawVersion)))throw new Error('Identity command requires an exact HTTPS issuer without credentials, query or fragment, subject, tenant, actor and safe expected version.');
  if(phase==='preview'&&previewHash||phase==='apply'&&!/^[a-f0-9]{64}$/i.test(previewHash||''))throw new Error('Apply requires a SHA-256 preview hash; preview must not supply one.');
  return {phase:phase as Phase,action:action as Action,issuer:issuer!,subject:subject!,tenantId:tenantId!,actorId:actorId!,expectedVersion:Number(rawVersion),...(previewHash?{previewHash:previewHash.toLowerCase()}:{})};
}

export function identityOperationPlan(input:IdentityCliInput,current:Inspection,storeFingerprint:string,syntheticScope:{tenantId:string;database:string}){
  if(current.version!==input.expectedVersion)throw new Error('Identity binding version changed; inspect and preview again.');
  if(current.tenantId&&current.tenantId!==input.tenantId||current.actorId&&current.actorId!==input.actorId)throw new Error('Identity binding names a different tenant or actor.');
  if(input.action==='provision'&&current.status==='active')throw new Error('Identity binding is already active; no provision operation is needed.');
  if(input.action==='revoke'&&current.status!=='active')throw new Error('Only an active identity binding can be revoked.');
  const operation=input.action==='revoke'?'revoke':current.status==='revoked'?'reactivate':'create';
  const exact={issuer:input.issuer,subject:input.subject,tenantId:input.tenantId,actorId:input.actorId,expectedVersion:input.expectedVersion,currentBinding:{bindingId:current.bindingId,status:current.status,version:current.version,tenantId:current.tenantId,actorId:current.actorId},operation,nextVersion:current.version+1,storeFingerprint,syntheticScope};
  return {...exact,previewHash:digest(exact)};
}

/** Preview is read-only. Apply re-inspects and requires the exact current plan hash. */
export async function runIdentityCommand(input:IdentityCliInput,env:NodeJS.ProcessEnv=process.env,deps:Dependencies=actual){
  if(env.KIARA_V2_STORE_MODE!=='normalized'||!env.MONGODB_URI||env.KIARA_OIDC_IDENTITY_SOURCE&&env.KIARA_OIDC_IDENTITY_SOURCE!=='mongo')throw new Error('Identity operations require normalized MongoDB and Mongo identity bindings.');
  const syntheticTenant=env.KIARA_V2_RELEASE_SYNTHETIC_TENANT,syntheticDb=env.KIARA_V2_RELEASE_SYNTHETIC_DB;
  const isolated=isolatedDatabase(syntheticDb)&&env.MONGODB_DB===syntheticDb&&!env.KIARA_V2_RELEASE_DB;
  const release=!syntheticDb&&env.KIARA_V2_RELEASE_DB==='kiara_v2'&&env.MONGODB_DB==='kiara_v2'&&
    syntheticReleaseTenant(syntheticTenant)&&atlasReleaseUri(env.MONGODB_URI);
  if(!present(syntheticTenant)||input.tenantId!==syntheticTenant||isolated===release||!isolated&&!release)
    throw new Error('Identity operations require the exact configured synthetic tenant and isolated Mongo database or the exact synthetic tenant on the kiara_v2 Atlas release database.');
  const current=await deps.inspect(input.issuer,input.subject);
  const plan=identityOperationPlan(input,current,digest([env.MONGODB_URI,env.MONGODB_DB]),{tenantId:syntheticTenant!,database:env.MONGODB_DB!});
  if(input.phase==='apply'&&plan.previewHash!==input.previewHash)throw new Error('Preview hash changed; inspect and preview again.');
  const operation=input.action==='provision'
    ?{issuer:input.issuer,subject:input.subject,tenantId:input.tenantId,actorId:input.actorId,expectedVersion:input.expectedVersion}
    :{issuer:input.issuer,subject:input.subject,expectedVersion:input.expectedVersion};
  const result=input.action==='provision'
    ?await deps.provision({...operation,tenantId:input.tenantId,actorId:input.actorId,dryRun:input.phase==='preview'})
    :await deps.revoke({...operation,dryRun:input.phase==='preview'});
  if(result.bindingId!==current.bindingId||result.nextVersion!==plan.nextVersion||input.phase==='apply'&&!result.changed)throw new Error('Identity operation did not match the previewed binding transition.');
  return {...plan,phase:input.phase==='apply'?'applied':'preview',changed:result.changed};
}

if(import.meta.url===`file://${process.argv[1]}`){
  (async()=>{const report=await runIdentityCommand(parseIdentityCommand(process.argv.slice(2)));process.stdout.write(`${JSON.stringify(report,null,2)}\n`);})()
    .catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'Identity operation failed.'}\n`);process.exitCode=1;})
    .finally(closeOidcIdentityStore);
}
