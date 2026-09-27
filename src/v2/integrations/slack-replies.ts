import {randomUUID} from 'node:crypto';
import {V2Error} from '../contracts';
import {digest,readWorkspace,timestamp,transactWorkspace} from '../store';
import {credential,resolveInstallation,type Installation} from './config';
import {providerJson,type ProviderFetch} from './read';
import {assertReplyAuthority,getSlackReply,replyMessage,type SlackReplyIntent} from './slack';

export interface SlackReplyProgress {id:string;status:SlackReplyIntent['status'];nextCheckMs:number}
const metadataType='kiara_thread_reply_v1';
const progress=(r:SlackReplyIntent):SlackReplyProgress=>({id:r.id,status:r.status,nextCheckMs:['waiting_answer','prepared','dispatched'].includes(r.status)?60000:r.status==='uncertain'?6*3600000:0});
const wireText=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const unavailable=(code:string)=>new V2Error(code,'The scoped Slack operation could not be verified.',503);
async function boundedBody(response:Response):Promise<any>{
 if(!response.body||Number(response.headers.get('content-length')||0)>2_000_000)throw unavailable('SLACK_RESPONSE_LIMIT');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>2_000_000){await reader.cancel();throw unavailable('SLACK_RESPONSE_LIMIT');}chunks.push(part.value);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw unavailable('SLACK_RESPONSE_INVALID');}
}
async function preflight(i:Installation,r:SlackReplyIntent,fetcher:ProviderFetch){
 const auth=await providerJson(i,new URL('https://slack.com/api/auth.test'),fetcher);
 if(auth.ok!==true||!auth.bot_id||auth.team_id!==i.slackTeamId||auth.user_id!==i.slackReplies?.botUserId)throw unavailable('SLACK_BOT_IDENTITY');
 const url=new URL('https://slack.com/api/conversations.info');url.search=new URLSearchParams({channel:r.channel}).toString();const result=await providerJson(i,url,fetcher);
 if(result.ok!==true||result.channel?.id!==r.channel||result.channel.is_archived===true||result.channel.is_member!==true)throw unavailable('SLACK_CHANNEL_ACCESS');
}
/** Readback sends no content and cannot initiate or repeat a post. Unknown absence is never success. */
async function readback(i:Installation,r:SlackReplyIntent,fetcher:ProviderFetch):Promise<string|null>{
 if(!r.contentHash)return null;let cursor='',found:string|null=null;
 const reader=i.slackReplies?.readTokenEnv?{...i,tokenEnv:i.slackReplies.readTokenEnv}:i;
 for(let page=0;page<5;page++){
  const url=new URL('https://slack.com/api/conversations.replies');url.search=new URLSearchParams({channel:r.channel,ts:r.threadTs,limit:'100',include_all_metadata:'true',...(cursor?{cursor}:{})}).toString();const data=await providerJson(reader,url,fetcher);
  if(data.ok!==true||!Array.isArray(data.messages))throw unavailable('SLACK_READBACK_UNAVAILABLE');
  const matches=data.messages.filter((m:any)=>m.metadata?.event_type===metadataType&&m.metadata?.event_payload?.id===r.id);
  if(matches.length>1||found&&matches.length)throw unavailable('SLACK_READBACK_AMBIGUOUS');
  if(matches.length){const m=matches[0];if(m.user!==i.slackReplies?.botUserId||m.thread_ts!==r.threadTs||typeof m.ts!=='string'||!/^\d+\.\d+$/.test(m.ts)||r.providerTs&&m.ts!==r.providerTs||typeof m.text!=='string'||digest(m.text)!==r.contentHash)throw unavailable('SLACK_READBACK_MISMATCH');found=m.ts;}
  cursor=data.response_metadata?.next_cursor||'';if(!cursor)return found;
 }
 return null;
}
/** The operator's expiring thread grant authorizes this answer only; no matter action is authorized. */
export async function processSlackReply(tenantId:string,id:string,options:{fetcher?:ProviderFetch}={}):Promise<SlackReplyProgress>{
 const fetcher=options.fetcher||fetch;
 let r=getSlackReply(await readWorkspace(tenantId),id);
 if(['verified','blocked'].includes(r.status))return progress(r);
 if(r.leaseUntil&&r.leaseUntil>Date.now())return progress(r);
 if(r.status==='dispatched'||r.status==='uncertain'){
  // Submitted effects are read-only even after a process crash. A changed grant prevents new reads.
  try{
   const state=await readWorkspace(tenantId),current=getSlackReply(state,id),{installation}=assertReplyAuthority(state,current),ts=await readback(installation,current,fetcher);
   await transactWorkspace(tenantId,s=>{const x=getSlackReply(s,id);if(['dispatched','uncertain'].includes(x.status)){x.status=ts?'verified':'uncertain';x.providerTs=ts||x.providerTs;x.reason=ts?null:'SLACK_DELIVERY_UNKNOWN';x.leaseToken=null;x.leaseUntil=null;x.updatedAt=timestamp();}});
  }catch{await transactWorkspace(tenantId,s=>{const x=getSlackReply(s,id);if(['dispatched','uncertain'].includes(x.status)){x.status='uncertain';x.reason='SLACK_READBACK_UNAVAILABLE';x.leaseToken=null;x.leaseUntil=null;x.updatedAt=timestamp();}});}
  return progress(getSlackReply(await readWorkspace(tenantId),id));
 }
 const token=randomUUID();let claimed=false;
 try{
  const prepared=await transactWorkspace(tenantId,s=>{
   const x=getSlackReply(s,id);if(x.leaseUntil&&x.leaseUntil>Date.now()||!['waiting_answer','prepared'].includes(x.status))return false;
   const answer=replyMessage(s,x);if(!answer)return false;const text=wireText(answer.message.text);if(text.length>39000)throw unavailable('SLACK_ANSWER_TOO_LONG');
   x.status='prepared';x.messageHash=digest(answer.message);x.contentHash=digest(text);x.leaseToken=token;x.leaseUntil=Date.now()+60000;x.updatedAt=timestamp();return true;
  });
  claimed=prepared.result;if(!claimed)return progress(getSlackReply(await readWorkspace(tenantId),id));
  r=getSlackReply(await readWorkspace(tenantId),id);const i=await resolveInstallation(r.installationId,'slack'),writeToken=credential(i.tokenEnv);
  const pinnedFetch:ProviderFetch=(url,init)=>{const headers=new Headers(init?.headers);headers.set('Authorization',`Bearer ${writeToken}`);return fetcher(url,{...init,headers});};
  await preflight(i,r,pinnedFetch);
  const admission=await transactWorkspace(tenantId,s=>{
   const x=getSlackReply(s,id);if(x.status!=='prepared'||x.leaseToken!==token||!x.leaseUntil||x.leaseUntil<=Date.now())throw unavailable('SLACK_REPLY_LEASE');
   const answer=replyMessage(s,x);if(!answer||digest(answer.installation)!==digest(i)||digest(wireText(answer.message.text))!==x.contentHash)throw unavailable('SLACK_ANSWER_CHANGED');
   x.status='dispatched';x.updatedAt=timestamp();return {text:wireText(answer.message.text),receipt:structuredClone(x)};
  });
  const outgoing=admission.result;
  // No automatic retry at the provider boundary. Timeout and ambiguous errors become uncertain.
  let ts:string|null=null;
  try{
   const response=await pinnedFetch(new URL('https://slack.com/api/chat.postMessage'),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:r.channel,thread_ts:r.threadTs,text:outgoing.text,mrkdwn:false,parse:'none',link_names:false,reply_broadcast:false,unfurl_links:false,unfurl_media:false,metadata:{event_type:metadataType,event_payload:{id:r.id}}})});
   const body=await boundedBody(response);if(response.ok&&body.ok===true&&body.channel===r.channel&&typeof body.ts==='string'&&/^\d+\.\d+$/.test(body.ts))ts=body.ts;
  }catch{/* An unacknowledged provider post remains potentially delivered. */}
  await transactWorkspace(tenantId,s=>{const x=getSlackReply(s,id);if(x.leaseToken===token&&x.status==='dispatched'){x.providerTs=ts;x.status='uncertain';x.reason=ts?'SLACK_READBACK_PENDING':'SLACK_DELIVERY_UNKNOWN';x.leaseToken=null;x.leaseUntil=null;x.updatedAt=timestamp();}});
  return processSlackReply(tenantId,id,{fetcher});
 }catch(error){
  await transactWorkspace(tenantId,s=>{const x=getSlackReply(s,id);if(!claimed&&x.status==='waiting_answer'||claimed&&x.leaseToken===token&&x.status==='prepared'){x.status='blocked';x.reason=error instanceof V2Error?error.code:'SLACK_REPLY_UNAVAILABLE';x.leaseToken=null;x.leaseUntil=null;x.updatedAt=timestamp();}});
  return progress(getSlackReply(await readWorkspace(tenantId),id));
 }
}
