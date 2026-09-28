import {V2Error,type Source,type WorkspaceState} from '../contracts';
import {invalidateSourceWithdrawalDecisions,pendingSourceWithdrawalMatters,retainSourceWithdrawalWork} from '../source-corrective';
import {digest,operatorDestinationIdentity,readWorkspace,timestamp,transactWorkspace} from '../store';
import {currentInstallations,sourceInstallationEligible} from './config';
import {emailInstallations} from './email-config';

const kinds=new Set(['github','slack','drive','email']);
const batchLimit=100;
const correctiveMatterBatchLimit=20;
const activeIntegrationSources=(s:WorkspaceState)=>s.sources.filter(source=>source.status==='active'&&kinds.has(source.kind));
const progressKey=(id:string)=>`installation-access-progress:${id}`;
const pendingIntegrationSources=(s:WorkspaceState)=>s.sources.filter(source=>source.status==='revoked'&&kinds.has(source.kind)&&s.receipts[progressKey(source.id)]?.result.status==='pending');

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

interface InstallationAccessResult {tenantId:string;reviewedPlanHash:string;revokedSources:number;correctiveMatters:number;processedMatters:number;remaining:number;replayed:boolean;destinationFingerprint:string;configurationHash:string;allowEmpty:boolean;providerSourcesPresent:boolean;emailSourcesPresent:boolean;sourceRevisions:{id:string;version:number;aclVersion:number}[]}

function plan(s:WorkspaceState,allowEmpty:boolean):InstallationAccessPlan {
 const candidates=[...activeIntegrationSources(s),...pendingIntegrationSources(s)],required={provider:candidates.some(source=>source.kind!=='email'),email:candidates.some(source=>source.kind==='email')};
 const config=configuration(s,allowEmpty,required),lost=candidates.filter(source=>source.status==='revoked'||!sourceInstallationEligible(s,source)).sort((a,b)=>a.id.localeCompare(b.id));
 // A file-backed config may change while individual grants are being inspected.
 if(configuration(s,allowEmpty,required).hash!==config.hash)throw new V2Error('INSTALLATION_CONFIG_CHANGED','Installation configuration changed during inspection. Repeat the check.',409);
 const sourceIds=lost.slice(0,batchLimit).map(source=>source.id),stateHash=digest(s);
 const basis={tenantId:s.tenantId,stateVersion:s.version,stateHash,destinationFingerprint:operatorDestinationIdentity().fingerprint,configurationHash:config.hash,sourceIds,remaining:Math.max(0,lost.length-sourceIds.length),batchLimit,providerSourcesPresent:required.provider,emailSourcesPresent:required.email};
 return {...basis,providerCount:config.providerCount,emailCount:config.emailCount,planHash:digest({operation:'installation-access-reconcile',...basis}),interpretation:`Read-only plan. Access is already denied at read time. Each apply processes at most ${correctiveMatterBatchLimit} affected matters and ${batchLimit} source revisions, preserving historical effects. Repeat check/apply while remaining is nonzero; no provider is contacted.`};
}

/** Read-only, bounded operator plan; identifiers only, never source bodies or titles. */
export async function checkInstallationAccess(tenantId:string,allowEmpty=false):Promise<InstallationAccessPlan>{return plan(await readWorkspace(tenantId),allowEmpty);}

function replayResult(s:WorkspaceState,planHash:string,allowEmpty:boolean):InstallationAccessResult|null{
 const receipt=s.receipts[`installation-access-plan:${planHash}`];if(!receipt)return null;
 const result=receipt.result as unknown as InstallationAccessResult;
 const revisions=result?.sourceRevisions;
 if(receipt.hash!==planHash||result.reviewedPlanHash!==planHash||result.tenantId!==s.tenantId||result.allowEmpty!==allowEmpty||result.destinationFingerprint!==operatorDestinationIdentity().fingerprint||!Array.isArray(revisions)||revisions.length<1||revisions.length>batchLimit||result.revokedSources!==revisions.length)throw new V2Error('INSTALLATION_PLAN_CHANGED','The historical reconciliation receipt cannot prove current destination and source state. Repeat the read-only check.',409);
 const config=configuration(s,allowEmpty,{provider:result.providerSourcesPresent,email:result.emailSourcesPresent});
 if(config.hash!==result.configurationHash||revisions.some(revision=>{
  const source=s.sources.find(item=>item.id===revision.id),sourceReceipt=s.receipts[`installation-access-source:${revision.id}`];
  return !source||source.status!=='revoked'||source.version!==revision.version||source.aclVersion!==revision.aclVersion||sourceReceipt?.hash!==digest({sourceId:revision.id,sourceVersion:revision.version,configurationHash:result.configurationHash})||sourceReceipt.result.status!=='revoked'||sourceReceipt.result.reviewedPlanHash!==planHash;
 }))throw new V2Error('INSTALLATION_PLAN_CHANGED','The historical reconciliation receipt cannot prove current destination and source state. Repeat the read-only check.',409);
 const remaining=[...activeIntegrationSources(s),...pendingIntegrationSources(s)].filter(source=>source.status==='revoked'||!sourceInstallationEligible(s,source)).length;
 return {...result,remaining,replayed:true};
}

function applyPlan(s:WorkspaceState,checked:InstallationAccessPlan,allowEmpty:boolean):InstallationAccessResult{
  const receiptKey=`installation-access-plan:${checked.planHash}`,prior=s.receipts[receiptKey];
  if(prior)return replayResult(s,checked.planHash,allowEmpty)!;
  const base={tenantId:s.tenantId,reviewedPlanHash:checked.planHash,destinationFingerprint:checked.destinationFingerprint,configurationHash:checked.configurationHash,allowEmpty,providerSourcesPresent:checked.providerSourcesPresent,emailSourcesPresent:checked.emailSourcesPresent,replayed:false};
  if(!checked.sourceIds.length)return {...base,revokedSources:0,correctiveMatters:0,processedMatters:0,remaining:0,sourceRevisions:[]};
  let corrective=0,processed=0;const sourceRevisions:InstallationAccessResult['sourceRevisions']=[];
  for(const id of checked.sourceIds){
   const source=s.sources.find(item=>item.id===id) as Source|undefined;
   const pendingProgress=source&&s.receipts[progressKey(id)]?.result.status==='pending';
   if(!source||source.status!=='active'&&!(source.status==='revoked'&&pendingProgress)||source.status==='active'&&sourceInstallationEligible(s,source))throw new V2Error('INSTALLATION_PLAN_CHANGED','A selected source changed before reconciliation.',409);
   const pending=pendingSourceWithdrawalMatters(s,source);
   if(pending&&processed>=correctiveMatterBatchLimit)break;
   corrective+=retainSourceWithdrawalWork(s,source,'system:installation-access-reconcile',{maxMatters:correctiveMatterBatchLimit-processed,retryUnavailable:false});
   processed+=pending-pendingSourceWithdrawalMatters(s,source);
   invalidateSourceWithdrawalDecisions(s,source);
   if(source.status==='active'){
    source.status='revoked';source.aclVersion++;source.version++;source.updatedAt=timestamp();
    s.receipts[progressKey(id)]={hash:digest({sourceId:id,sourceVersion:source.version,startedPlanHash:checked.planHash}),result:{sourceId:id,sourceVersion:source.version,status:'pending',startedPlanHash:checked.planHash,startedAt:source.updatedAt}};
   }
   if(pendingSourceWithdrawalMatters(s,source)>0)break;
   s.receipts[progressKey(id)]!.result.status='complete';
   s.receipts[`installation-access-source:${id}`]={hash:digest({sourceId:id,sourceVersion:source.version,configurationHash:checked.configurationHash}),result:{sourceId:id,status:'revoked',configurationHash:checked.configurationHash,reviewedPlanHash:checked.planHash,reconciledAt:source.updatedAt}};
   sourceRevisions.push({id,version:source.version,aclVersion:source.aclVersion});
  }
  if(configuration(s,allowEmpty,{provider:checked.providerSourcesPresent,email:checked.emailSourcesPresent}).hash!==checked.configurationHash)throw new V2Error('INSTALLATION_CONFIG_CHANGED','Installation configuration changed during reconciliation. No source state changed.',409);
  const result={...base,revokedSources:sourceRevisions.length,correctiveMatters:corrective,processedMatters:processed,remaining:checked.remaining+checked.sourceIds.length-sourceRevisions.length,sourceRevisions};
  if(sourceRevisions.length===checked.sourceIds.length)s.receipts[receiptKey]={hash:checked.planHash,result};
  return result;
}

/** Atomic, idempotent finalization of a reviewed access-loss batch. */
export async function reconcileInstallationAccess(tenantId:string,expectedPlanHash:string,allowEmpty=false):Promise<InstallationAccessResult>{
 if(!/^[a-f0-9]{64}$/.test(expectedPlanHash))throw new V2Error('INSTALLATION_PLAN_REQUIRED','Supply the exact reviewed installation-access plan hash.',400);
 return (await transactWorkspace(tenantId,s=>{
  const prior=replayResult(s,expectedPlanHash,allowEmpty);if(prior)return prior;
  const checked=plan(s,allowEmpty);
  if(checked.planHash!==expectedPlanHash)throw new V2Error('INSTALLATION_PLAN_CHANGED','Workspace or installation configuration changed. Repeat the read-only check.',409);
  return applyPlan(s,checked,allowEmpty);
 })).result;
}

/** A normal authenticated workspace refresh reconciles one bounded batch without waiting
 * for another provider event. Missing/malformed config raises a visible error and writes nothing. */
export function reconcileInstallationAccessOnSnapshot(s:WorkspaceState){
 if(!activeIntegrationSources(s).length&&!pendingIntegrationSources(s).length)return {revokedSources:0,correctiveMatters:0,remaining:0};
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
