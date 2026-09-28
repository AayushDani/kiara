import {V2Error,type Source,type WorkspaceState} from '../contracts';
import {invalidateSourceWithdrawalDecisions,retainSourceWithdrawalWork} from '../source-corrective';
import {digest,operatorDestinationIdentity,readWorkspace,timestamp,transactWorkspace} from '../store';
import {currentInstallations,sourceInstallationEligible} from './config';
import {emailInstallations} from './email-config';

const kinds=new Set(['github','slack','drive','email']);
const batchLimit=100;
const activeIntegrationSources=(s:WorkspaceState)=>s.sources.filter(source=>source.status==='active'&&kinds.has(source.kind));

function configuration(s:WorkspaceState,allowEmpty:boolean,required?:{provider:boolean;email:boolean}){
 const sources=activeIntegrationSources(s),hasProvider=required?.provider??sources.some(source=>source.kind!=='email'),hasEmail=required?.email??sources.some(source=>source.kind==='email');
 let providers:ReturnType<typeof currentInstallations>,email:ReturnType<typeof emailInstallations>;
 try{providers=hasProvider?currentInstallations():[];email=hasEmail?emailInstallations():[];}catch(error){
  throw new V2Error('INSTALLATION_CONFIG_UNAVAILABLE',`Installation configuration could not be safely inspected: ${error instanceof V2Error?error.code:'read_failed'}. No source state changed.`,503);
 }
 const providerDeclared=!!(process.env.KIARA_V2_INSTALLATIONS_FILE||process.env.KIARA_V2_INSTALLATIONS);
 const emailDeclared=!!(process.env.KIARA_V2_EMAIL_INSTALLATIONS_FILE||process.env.KIARA_V2_EMAIL_INSTALLATIONS);
 if(hasProvider&&(!providerDeclared||!providers.length&&!allowEmpty)||hasEmail&&(!emailDeclared||!email.length&&!allowEmpty))throw new V2Error('INSTALLATION_CONFIG_UNAVAILABLE','An installation config is absent or empty while retained sources exist. Restore it or explicitly review an empty-config withdrawal.',503);
 return {hash:digest({providers,email,allowEmpty}),providerCount:providers.length,emailCount:email.length};
}

export interface InstallationAccessPlan {
 tenantId:string;stateVersion:number;stateHash:string;destinationFingerprint:string;configurationHash:string;planHash:string;
 sourceIds:string[];remaining:number;batchLimit:number;providerCount:number;emailCount:number;providerSourcesPresent:boolean;emailSourcesPresent:boolean;
 interpretation:string;
}

interface InstallationAccessResult {tenantId:string;reviewedPlanHash:string;revokedSources:number;correctiveMatters:number;remaining:number;replayed:boolean}

function plan(s:WorkspaceState,allowEmpty:boolean):InstallationAccessPlan {
 const active=activeIntegrationSources(s),required={provider:active.some(source=>source.kind!=='email'),email:active.some(source=>source.kind==='email')};
 const config=configuration(s,allowEmpty,required),lost=active.filter(source=>!sourceInstallationEligible(s,source)).sort((a,b)=>a.id.localeCompare(b.id));
 // A file-backed config may change while individual grants are being inspected.
 if(configuration(s,allowEmpty,required).hash!==config.hash)throw new V2Error('INSTALLATION_CONFIG_CHANGED','Installation configuration changed during inspection. Repeat the check.',409);
 const sourceIds=lost.slice(0,batchLimit).map(source=>source.id),stateHash=digest(s);
 const basis={tenantId:s.tenantId,stateVersion:s.version,stateHash,destinationFingerprint:operatorDestinationIdentity().fingerprint,configurationHash:config.hash,sourceIds,remaining:Math.max(0,lost.length-sourceIds.length),batchLimit,providerSourcesPresent:required.provider,emailSourcesPresent:required.email};
 return {...basis,providerCount:config.providerCount,emailCount:config.emailCount,planHash:digest({operation:'installation-access-reconcile',...basis}),interpretation:'Read-only plan. Access is already denied at read time. Applying this exact plan revokes retained source revisions, preserves historical effects and creates source-free corrective work; it does not contact providers.'};
}

/** Read-only, bounded operator plan; identifiers only, never source bodies or titles. */
export async function checkInstallationAccess(tenantId:string,allowEmpty=false):Promise<InstallationAccessPlan>{return plan(await readWorkspace(tenantId),allowEmpty);}

function applyPlan(s:WorkspaceState,checked:InstallationAccessPlan,allowEmpty:boolean):InstallationAccessResult{
  const receiptKey=`installation-access-plan:${checked.planHash}`,prior=s.receipts[receiptKey];
  if(prior)return {...prior.result as unknown as InstallationAccessResult,replayed:true};
  if(!checked.sourceIds.length)return {tenantId:s.tenantId,reviewedPlanHash:checked.planHash,revokedSources:0,correctiveMatters:0,remaining:0,replayed:false};
  let corrective=0;
  for(const id of checked.sourceIds){
   const source=s.sources.find(item=>item.id===id) as Source|undefined;
   if(!source||source.status!=='active'||sourceInstallationEligible(s,source))throw new V2Error('INSTALLATION_PLAN_CHANGED','A selected source changed before reconciliation.',409);
   corrective+=retainSourceWithdrawalWork(s,source,'system:installation-access-reconcile');
   invalidateSourceWithdrawalDecisions(s,source);
   source.status='revoked';source.aclVersion++;source.version++;source.updatedAt=timestamp();
   s.receipts[`installation-access-source:${id}`]={hash:digest({sourceId:id,sourceVersion:source.version,configurationHash:checked.configurationHash}),result:{sourceId:id,status:'revoked',configurationHash:checked.configurationHash,reviewedPlanHash:checked.planHash,reconciledAt:source.updatedAt}};
  }
  if(configuration(s,allowEmpty,{provider:checked.providerSourcesPresent,email:checked.emailSourcesPresent}).hash!==checked.configurationHash)throw new V2Error('INSTALLATION_CONFIG_CHANGED','Installation configuration changed during reconciliation. No source state changed.',409);
  const result={tenantId:s.tenantId,reviewedPlanHash:checked.planHash,revokedSources:checked.sourceIds.length,correctiveMatters:corrective,remaining:checked.remaining,replayed:false};
  s.receipts[receiptKey]={hash:checked.planHash,result};
  return result;
}

/** Atomic, idempotent finalization of a reviewed access-loss batch. */
export async function reconcileInstallationAccess(tenantId:string,expectedPlanHash:string,allowEmpty=false):Promise<InstallationAccessResult>{
 if(!/^[a-f0-9]{64}$/.test(expectedPlanHash))throw new V2Error('INSTALLATION_PLAN_REQUIRED','Supply the exact reviewed installation-access plan hash.',400);
 return (await transactWorkspace(tenantId,s=>{
  const prior=s.receipts[`installation-access-plan:${expectedPlanHash}`];if(prior)return {...prior.result as unknown as InstallationAccessResult,replayed:true};
  const checked=plan(s,allowEmpty);
  if(checked.planHash!==expectedPlanHash)throw new V2Error('INSTALLATION_PLAN_CHANGED','Workspace or installation configuration changed. Repeat the read-only check.',409);
  return applyPlan(s,checked,allowEmpty);
 })).result;
}

/** A normal authenticated workspace refresh reconciles one bounded batch without waiting
 * for another provider event. Missing/malformed config raises a visible error and writes nothing. */
export function reconcileInstallationAccessOnSnapshot(s:WorkspaceState){
 if(!activeIntegrationSources(s).length)return {revokedSources:0,correctiveMatters:0,remaining:0};
 const checked=plan(s,false);
 return applyPlan(s,checked,false);
}

/** Retry only a recorded owner-unavailable exception after membership repair. The
 * withdrawn source stays revoked and no old content is projected into the result. */
export async function retryInstallationAccessOwner(tenantId:string,sourceId:string,expectedSourceVersion:number){
 if(!sourceId||sourceId.length>200||!Number.isSafeInteger(expectedSourceVersion)||expectedSourceVersion<1)throw new V2Error('INSTALLATION_SOURCE_REQUIRED','Supply the exact withdrawn source ID and inspected version.',400);
 return (await transactWorkspace(tenantId,s=>{
  const source=s.sources.find(item=>item.id===sourceId);
  if(!source||source.status!=='revoked'||source.version!==expectedSourceVersion||!s.receipts[`installation-access-source:${sourceId}`])throw new V2Error('INSTALLATION_SOURCE_CHANGED','Inspect the exact reconciled source and current version before retrying owner assignment.',409);
  const created=retainSourceWithdrawalWork(s,source,'system:installation-access-reconcile');
  const pendingOwnerExceptions=Object.values(s.receipts).filter(receipt=>receipt.result.sourceId===sourceId&&receipt.result.status==='owner_unavailable').length;
  return {tenantId,sourceId,sourceVersion:source.version,correctiveMatters:created,pendingOwnerExceptions};
 })).result;
}
