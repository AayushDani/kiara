import {randomUUID} from 'node:crypto';
import OpenAI from 'openai';
import {getEncoding} from 'js-tiktoken';
import {authorizedBudget} from '../runtime/config';
import {reserveGlobalSpend,settleGlobalSpend,recoverGlobalSpend} from '../server/global-spend';
import {membership} from './authority';
import {V2Error,type ActorContext,type WorkspaceState} from './contracts';
import {digest,readWorkspace,timestamp,transactWorkspace} from './store';
import {assertOidcBindingCurrent} from './oidc-identities';

/** Standard non-batch price, pinned to the official model page on 2026-09-27. */
export const EMBEDDING_POLICY=Object.freeze({model:'text-embedding-3-small',dimensions:1536,encoding:'cl100k_base',inputUsdPerMillion:0.02,version:'openai-embedding-small-standard-2026-09-27'});
const PREFIX='embedding:',LEASE=300_000;
let encoding:ReturnType<typeof getEncoding>|undefined;
export function embeddingTokens(text:string){encoding||=getEncoding('cl100k_base');const tokens=encoding.encode(text,[],[]);if(!tokens.length||tokens.length>8191)throw new V2Error('EMBEDDING_CONTEXT_LIMIT','Embedding input must contain 1–8191 exact tokens.');return tokens;}
export interface EmbeddingResponse {model:string;data:{index:number;embedding:number[]}[];usage:{prompt_tokens:number;total_tokens:number};_request_id?:string|null}
export interface EmbeddingProvider {create(request:{model:string;dimensions:number;input:number[];encoding_format:'float'}):Promise<EmbeddingResponse>}
interface EmbeddingJob {observedUsage?:{totalTokens:number;estimatedUsd:number;observedAt:string};providerDispatched?:boolean;admissionHistory?:{id:string;reason:string|null}[];evidenceIds?:string[];redacted?:boolean;id:string;key:string;actorId:string;membershipVersion:number;inputHash:string;authorityHash:string;policyHash:string;budget:number;tokens:number;status:'prepared'|'dispatched'|'complete'|'rejected'|'unknown';leaseUntil:number;createdAt:string;finishedAt:string|null;vector:number[]|null;responseHash:string|null;requestId:string|null;actualUsd:number|null;recoveryPending:boolean;reason:string|null}
function job(s:WorkspaceState,key:string){return s.receipts[PREFIX+key]?.result.job as EmbeddingJob|undefined;}
function save(s:WorkspaceState,value:EmbeddingJob){s.receipts[PREFIX+value.key]={hash:digest({key:value.key,inputHash:value.inputHash,actorId:value.actorId,authorityHash:value.authorityHash,policyHash:value.policyHash}),result:{job:value}};}
function provider():EmbeddingProvider {if(!process.env.OPENAI_API_KEY)throw new V2Error('OPENAI_API_KEY_MISSING','Embedding provider credential is unavailable.');const api=new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0,timeout:45000});return {create:request=>api.embeddings.create(request)};}
const code=(e:unknown)=>typeof e==='object'&&e&&'code' in e&&typeof e.code==='string'?e.code:'EMBEDDING_FAILED';
function assertJob(s:WorkspaceState,a:ActorContext,j:EmbeddingJob,authorize:(state:WorkspaceState)=>void){const m=membership(s,a);if(j.redacted)throw new V2Error('KNOWLEDGE_DELETED','Embedding evidence was deleted.');if(j.actorId!==a.actorId||j.membershipVersion!==m.version||j.budget!==authorizedBudget()||j.policyHash!==digest(EMBEDDING_POLICY))throw new V2Error('EMBEDDING_AUTHORITY_CHANGED','Embedding identity, policy or budget changed.');authorize(s);}
export async function reconcileEmbedding(tenantId:string,key:string){let j=job(await readWorkspace(tenantId),key);if(j&&['prepared','dispatched'].includes(j.status)&&j.leaseUntil<=Date.now()&&!j.recoveryPending){await transactWorkspace(tenantId,s=>{const current=job(s,key)!;if(['prepared','dispatched'].includes(current.status)&&current.leaseUntil<=Date.now())current.recoveryPending=true;});j=job(await readWorkspace(tenantId),key);}if(!j||!j.recoveryPending)return;const recoveredId=j.id;await recoverGlobalSpend(recoveredId,j.status==='dispatched'||j.status==='unknown');await transactWorkspace(tenantId,s=>{const current=job(s,key)!;if(current.id===recoveredId&&current.recoveryPending){current.status=current.status==='prepared'?'rejected':current.status==='dispatched'?'unknown':current.status;current.recoveryPending=false;current.finishedAt=timestamp();}});}
export async function reconcilePendingEmbeddings(tenantId:string){const s=await readWorkspace(tenantId);for(const key of Object.keys(s.receipts).filter(k=>k.startsWith(PREFIX))){const j=job(s,key.slice(PREFIX.length))!;const expired=['prepared','dispatched'].includes(j.status)&&j.leaseUntil<=Date.now();if(!expired&&!j.recoveryPending)continue;if(expired)await transactWorkspace(tenantId,state=>{const current=job(state,j.key)!;if(['prepared','dispatched'].includes(current.status)&&current.leaseUntil<=Date.now())current.recoveryPending=true;});await reconcileEmbedding(tenantId,j.key);}}
/** Server-only bounded operation. The caller supplies an authority recheck, never a browser callback.
 * Stable owner keys replay completed vectors; a dispatched/unknown request is never submitted again. */
export async function embedAuthorized(a:ActorContext,key:string,text:string,authorityHash:string,authorize:(state:WorkspaceState)=>void,options:{provider?:EmbeddingProvider;evidenceIds?:string[];afterReservation?:()=>Promise<void>}={}):Promise<number[]>{
 await assertOidcBindingCurrent(a);
 if(!/^[a-zA-Z0-9:_-]{1,180}$/.test(key)||!/^[a-f0-9]{64}$/.test(authorityHash))throw new V2Error('INVALID_EMBEDDING_OWNER','A stable server-owned embedding reference is required.');
 const tokens=embeddingTokens(text),inputHash=digest(tokens),policyHash=digest(EMBEDDING_POLICY),budget=authorizedBudget();
 const claim=await transactWorkspace(a.tenantId,s=>{const member=membership(s,a);authorize(s);const existing=job(s,key);if(existing){if(existing.inputHash!==inputHash||existing.authorityHash!==authorityHash||existing.actorId!==a.actorId||existing.policyHash!==policyHash)throw new V2Error('EMBEDDING_OWNER_CONFLICT','This embedding owner already represents a different input or authority.');assertJob(s,a,existing,authorize);if(['prepared','dispatched'].includes(existing.status)&&existing.leaseUntil<=Date.now())existing.recoveryPending=true;if(existing.status==='rejected'&&existing.providerDispatched===false&&!existing.recoveryPending){existing.admissionHistory=[...(existing.admissionHistory||[]),{id:existing.id,reason:existing.reason}];existing.id=randomUUID();existing.status='prepared';existing.leaseUntil=Date.now()+LEASE;existing.reason=null;existing.finishedAt=null;return {created:true,job:existing};}return {created:false,job:existing};}const value:EmbeddingJob={providerDispatched:false,admissionHistory:[],evidenceIds:options.evidenceIds||[],id:randomUUID(),key,actorId:a.actorId,membershipVersion:member.version,inputHash,authorityHash,policyHash,budget,tokens:tokens.length,status:'prepared',leaseUntil:Date.now()+LEASE,createdAt:timestamp(),finishedAt:null,vector:null,responseHash:null,requestId:null,actualUsd:null,recoveryPending:false,reason:null};save(s,value);return {created:true,job:value};});
 if(!claim.result.created){await reconcileEmbedding(a.tenantId,key);const currentState=await readWorkspace(a.tenantId),current=job(currentState,key)!;assertJob(currentState,a,current,authorize);if(current.status==='complete'&&current.vector)return current.vector;throw new V2Error(current.status==='unknown'?'EMBEDDING_CHARGE_UNKNOWN':'EMBEDDING_ALREADY_ACCEPTED','The embedding request is pending or interrupted; it cannot be invoked again.');}
 const value=claim.result.job;let dispatched=false,settled=false,providerResponseReceived=false;
 try{
  const adapter=options.provider||provider();await reserveGlobalSpend(value.id,tokens.length*EMBEDDING_POLICY.inputUsdPerMillion/1_000_000);await options.afterReservation?.();await assertOidcBindingCurrent(a);
  await transactWorkspace(a.tenantId,s=>{const current=job(s,key)!;assertJob(s,a,current,authorize);if(current.id!==value.id||current.status!=='prepared'||current.leaseUntil<=Date.now())throw new V2Error('EMBEDDING_LEASE_EXPIRED','Embedding admission expired.');current.status='dispatched';current.providerDispatched=true;});
  await assertOidcBindingCurrent(a);
  dispatched=true;let timer:ReturnType<typeof setTimeout>|undefined;const response=await Promise.race([adapter.create({model:EMBEDDING_POLICY.model,dimensions:EMBEDDING_POLICY.dimensions,input:tokens,encoding_format:'float'}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new V2Error('EMBEDDING_TIMEOUT','Embedding outcome is uncertain.')),50000);})]).finally(()=>clearTimeout(timer));
  providerResponseReceived=true;
  const vector=response.data?.[0]?.embedding,usage=response.usage;
  const valid=response.model===EMBEDDING_POLICY.model&&usage?.prompt_tokens===tokens.length&&usage.total_tokens===tokens.length&&response.data?.length===1&&response.data[0].index===0&&Array.isArray(vector)&&vector.length===EMBEDDING_POLICY.dimensions&&vector.every(Number.isFinite);
  const actual=usage&&Number.isSafeInteger(usage.total_tokens)&&usage.total_tokens>=0?usage.total_tokens*EMBEDDING_POLICY.inputUsdPerMillion/1_000_000:0;
  // Preserve a late provider receipt before ledger reconciliation. Unknown charges remain
  // unknown until an operator reconciles them; this receipt never restores a vector or retry.
  await transactWorkspace(a.tenantId,s=>{const current=job(s,key)!;if(current.id!==value.id)throw new V2Error('EMBEDDING_ATTEMPT_CHANGED','The embedding attempt changed before receipt retention.');current.responseHash=digest(response);current.requestId=response._request_id||null;if(usage&&Number.isSafeInteger(usage.total_tokens)&&usage.total_tokens>=0)current.observedUsage={totalTokens:usage.total_tokens,estimatedUsd:actual,observedAt:timestamp()};});
  await settleGlobalSpend(value.id,actual,!valid);settled=true;
  await transactWorkspace(a.tenantId,s=>{const current=job(s,key)!;if(current.id!==value.id)throw new V2Error('EMBEDDING_ATTEMPT_CHANGED','The embedding attempt was replaced before settlement.');current.actualUsd=actual;current.responseHash=digest(response);current.requestId=response._request_id||null;current.finishedAt=timestamp();current.status=valid?'complete':'unknown';current.vector=valid&&!current.redacted?vector:null;});
  if(!valid)throw new V2Error('EMBEDDING_USAGE_UNKNOWN','Embedding model, vector or exact usage could not be reconciled.');
  const currentState=await readWorkspace(a.tenantId);assertJob(currentState,a,job(currentState,key)!,authorize);return vector;
 }catch(error){
  const knownRejected=dispatched&&!settled&&!providerResponseReceived&&typeof error==='object'&&error&&'status' in error&&[400,401,403,404,409,422,429].includes(Number(error.status));
  const unknown=dispatched&&!settled&&!knownRejected;
  // Commit intent to reconcile before ledger I/O; a ledger outage can never strand the reservation.
  await transactWorkspace(a.tenantId,s=>{const current=job(s,key)!;if(current.id!==value.id)return;if(!settled){current.recoveryPending=true;current.status=unknown?'unknown':knownRejected?'rejected':current.status;}current.reason=code(error);if(current.status==='complete')current.vector=null;current.finishedAt=timestamp();});
  if(!settled){if(knownRejected)await settleGlobalSpend(value.id,0);else await recoverGlobalSpend(value.id,unknown);await transactWorkspace(a.tenantId,s=>{const current=job(s,key)!;if(current.id===value.id){current.recoveryPending=false;if(current.status==='prepared')current.status='rejected';if(current.status==='dispatched')current.status='unknown';}});}
  throw error;
 }
}
