import {canRead,membership} from '../authority';
import type {ActorContext,WorkspaceState} from '../contracts';
import type {SlackReplyIntent} from './slack';
import {assertSlackChannelGrant} from './slack-scope';
export interface SlackDeliveryView {id:string;conversationId:string;messageId:string|null;status:SlackReplyIntent['status'];reason:'awaiting_answer'|'ready_to_send'|'delivery_unconfirmed'|'verified_readback'|'authority_or_evidence_changed';updatedAt:string}
/** Personal operational status only; no destination IDs, message content, credential or provider error. */
export function slackDeliveryViews(s:WorkspaceState,a:ActorContext):SlackDeliveryView[]{
 membership(s,a);const result:SlackDeliveryView[]=[];
 for(const [key,receipt] of Object.entries(s.receipts)){
  if(!key.startsWith('slack-reply:'))continue;const r=receipt.result.reply as SlackReplyIntent|undefined;if(!r||key!==`slack-reply:${r.id}`||r.tenantId!==s.tenantId||r.actorId!==a.actorId)continue;
  const conversation=s.conversations.find(c=>c.id===r.conversationId);if(!conversation||!canRead(s,a,conversation))continue;
  let status=r.status;try{assertSlackChannelGrant(s,conversation);}catch{if(['waiting_answer','prepared'].includes(status))status='blocked';}
  const message=r.messageId?s.messages.find(m=>m.id===r.messageId):null;
  result.push({id:r.id,conversationId:r.conversationId,messageId:message&&canRead(s,a,message)?message.id:null,status,reason:status==='verified'?'verified_readback':status==='blocked'?'authority_or_evidence_changed':status==='waiting_answer'?'awaiting_answer':status==='prepared'?'ready_to_send':'delivery_unconfirmed',updatedAt:r.updatedAt});
 }
 return result;
}
