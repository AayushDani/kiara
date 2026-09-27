import {randomUUID} from 'node:crypto';
import {membership,readRecord} from '../authority';
import {V2Error,type Conversation,type Message,type WorkspaceState} from '../contracts';
import {command} from '../service';
import {recheckEvidence,type EvidencePacket} from '../retrieval';
import {digest,readWorkspace,timestamp,transactWorkspace} from '../store';
import {currentInstallations,type Installation} from './config';
import {assertSlackChannelGrant,configuredSlackBinding,scopeAudienceHash,slackAudienceEligible,slackMessageEvidenceHash,type SlackChannelGrant} from './slack-scope';

export interface SlackReplyIntent {
 id:string;tenantId:string;installationId:string;configurationHash:string;conversationId:string;sourceId:string;sourceHash:string;
 actorId:string;membershipVersion:number;channel:string;threadTs:string;commandId:string;runId:string|null;messageId:string|null;
 status:'waiting_answer'|'prepared'|'dispatched'|'verified'|'uncertain'|'blocked';reason:string|null;
 messageHash:string|null;contentHash:string|null;providerTs:string|null;leaseToken:string|null;leaseUntil:number|null;
 createdAt:string;updatedAt:string;
}
export const replyKey=(id:string)=>`slack-reply:${id}`;
export function getSlackReply(s:WorkspaceState,id:string):SlackReplyIntent {const r=s.receipts[replyKey(id)]?.result.reply as SlackReplyIntent|undefined;if(!r||r.id!==id||r.tenantId!==s.tenantId)throw new V2Error('SLACK_REPLY_NOT_FOUND','This retained reply is unavailable.',404);return r;}
const fail=(code:string)=>new V2Error(code,'The exact Slack continuation is no longer authorized.',403);
export function assertReplyAuthority(s:WorkspaceState,r:SlackReplyIntent){
 const conversation=s.conversations.find(c=>c.id===r.conversationId);if(!conversation)throw fail('SLACK_GRANT_CHANGED');
 const current=assertSlackChannelGrant(s,conversation);
 if(current.installation.id!==r.installationId||digest(current.installation)!==r.configurationHash||current.grant.actorId!==r.actorId||current.grant.membershipVersion!==r.membershipVersion||current.grant.channel!==r.channel||current.grant.threadTs!==r.threadTs)throw fail('SLACK_GRANT_CHANGED');
 const source=readRecord(s,current.actor,s.sources,r.sourceId);if(digest(source)!==r.sourceHash||!slackAudienceEligible(s,conversation,source))throw fail('SLACK_INPUT_CHANGED');
 return {...current,conversation};
}
/** Only the verified webhook caller supplies these fields; web commands cannot select a binding. */
export async function continueSlackThread(i:Installation,eventId:string,message:{channel:string;threadTs:string;user:string;text:string;ts:string},sourceId:string){
 const binding=configuredSlackBinding(i,message.channel,message.threadTs);if(!binding)return {continued:false};
 if(binding.slackUserId!==message.user)throw fail('SLACK_USER_UNMAPPED');
 const commandId=`slack-message:${digest({installationId:i.id,eventId})}`,intentId=digest({installationId:i.id,eventId,kind:'reply'});
 await transactWorkspace(i.tenantId,s=>{
  const current=assertConfigured(i),conversation=s.conversations.find(c=>c.id===binding.conversationId) as (Conversation&{channelGrant?:SlackChannelGrant})|undefined;
  if(!conversation||scopeAudienceHash(conversation.scope)!==scopeAudienceHash(current.scope))throw fail('SLACK_CONVERSATION_SCOPE');
  if(!conversation.channelGrant){
   // Existing history cannot be retroactively declared safe for another destination.
   if(conversation.scenarioId||conversation.matterId||s.messages.some(m=>m.conversationId===conversation.id)||conversation.provenance.sourceIds.length||conversation.provenance.factIds?.length)throw fail('SLACK_BINDING_REQUIRES_EMPTY_CONVERSATION');
   const actor={tenantId:s.tenantId,actorId:binding.actorId,mode:'authenticated' as const,expiresAt:Date.parse(i.slackReplies!.validUntil)};
   const member=membership(s,actor);conversation.channelGrant={...binding,installationId:i.id,configurationHash:digest(i),membershipVersion:member.version,boundAt:timestamp()};conversation.version++;conversation.updatedAt=timestamp();
  }
  const {actor}=assertSlackChannelGrant(s,conversation),source=readRecord(s,actor,s.sources,sourceId);
  if(source.externalId!==`${i.id}:${message.channel}:message:${message.ts}`||!slackAudienceEligible(s,conversation,source))throw fail('SLACK_INPUT_CHANGED');
  let body:{text?:string;user?:string};try{body=JSON.parse(source.text);}catch{throw fail('SLACK_INPUT_CHANGED');}if(body.text!==message.text||body.user!==message.user)throw fail('SLACK_INPUT_CHANGED');
 });
 let result:Record<string,unknown>|undefined;
 for(let attempt=0;attempt<5;attempt++){
  const s=await readWorkspace(i.tenantId),conversation=s.conversations.find(c=>c.id===binding.conversationId)!;const {actor}=assertSlackChannelGrant(s,conversation);
  try{result=(await command(actor,{idempotencyKey:commandId,expectedVersion:s.version,command:{type:'message.send',conversationId:binding.conversationId,channel:'slack',text:message.text}},{slackSourceId:sourceId})).result;break;}catch(error){if(!(error instanceof V2Error)||error.code!=='VERSION_CONFLICT')throw error;}
 }
 if(!result)throw new V2Error('STORE_BUSY','This signed message remains retryable with its original identity.',503);
 return (await transactWorkspace(i.tenantId,s=>{
  const prior=s.receipts[replyKey(intentId)];if(prior)return {continued:true,replyId:intentId,conversationId:binding.conversationId};
  const conversation=s.conversations.find(c=>c.id===binding.conversationId)!;const {actor}=assertSlackChannelGrant(s,conversation),source=readRecord(s,actor,s.sources,sourceId);
  const r:SlackReplyIntent={id:intentId,tenantId:s.tenantId,installationId:i.id,configurationHash:digest(i),conversationId:conversation.id,sourceId,sourceHash:digest(source),actorId:binding.actorId,membershipVersion:membership(s,actor).version,channel:binding.channel,threadTs:binding.threadTs,commandId,runId:typeof result.runId==='string'?result.runId:null,messageId:typeof result.messageId==='string'?result.messageId:null,status:'waiting_answer',reason:null,messageHash:null,contentHash:null,providerTs:null,leaseToken:null,leaseUntil:null,createdAt:timestamp(),updatedAt:timestamp()};
  s.receipts[replyKey(r.id)]={hash:digest({id:r.id,commandId:r.commandId,sourceId}),result:{reply:r}};
  s.outbox.push({id:randomUUID(),tenantId:s.tenantId,kind:'slack_reply',aggregateId:r.id,commandId,status:'pending',owner:'v2',createdAt:timestamp()});
  return {continued:true,replyId:r.id,conversationId:conversation.id};
 })).result;
}
function assertConfigured(i:Installation){return requireCurrent(i);}
// Synchronous re-read is essential inside the final state transaction.
function requireCurrent(i:Installation){const current=currentInstallations().find(x=>x.id===i.id);if(!current?.enabled||digest(current)!==digest(i))throw fail('SLACK_GRANT_CHANGED');return current;}
export function replyMessage(s:WorkspaceState,r:SlackReplyIntent):{message:Message;installation:Installation}|null {
 const {conversation,actor,installation}=assertReplyAuthority(s,r);
 if(!r.messageId&&r.runId){const run=s.receipts[`conversation-run:${r.runId}`]?.result.run as {id:string;conversationId:string;status:string;assistantMessageId:string|null}|undefined;if(!run||run.id!==r.runId||run.conversationId!==r.conversationId)throw fail('SLACK_RUN_IDENTITY');if(['queued','running'].includes(run.status))return null;if(run.status!=='complete'||!run.assistantMessageId)throw fail('SLACK_ANSWER_UNAVAILABLE');r.messageId=run.assistantMessageId;}
 const message=readRecord(s,actor,s.messages,r.messageId||'');
 if(message.role!=='assistant'||message.conversationId!==r.conversationId||message.channel!=='slack'||!slackAudienceEligible(s,conversation,message)||!message.text||message.text.length>30000)throw fail('SLACK_ANSWER_UNAVAILABLE');
 if(r.messageHash&&r.messageHash!==digest(message))throw fail('SLACK_ANSWER_CHANGED');
 if(!message.channelEvidenceHash||message.channelEvidenceHash!==slackMessageEvidenceHash(s,message))throw fail('SLACK_ANSWER_CHANGED');
 if(r.runId){const run=s.receipts[`conversation-run:${r.runId}`]?.result.run as {packet?:EvidencePacket;channelGrantHash?:string}|undefined;if(!run?.packet||run.channelGrantHash!==digest(conversation.channelGrant))throw fail('SLACK_ANSWER_CHANGED');recheckEvidence(s,actor,conversation.id,run.packet);}
 return {message,installation};
}
