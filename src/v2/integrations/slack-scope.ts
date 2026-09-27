import {canRead,membership,requireRole} from '../authority';
import {V2Error,type ActorContext,type Conversation,type Matter,type Message,type RecordBase,type Scope,type WorkspaceState} from '../contracts';
import {currentEvidenceLineage,currentSourceEvidence} from '../source-lifecycle';
import {factCurrentlyConfirmed} from '../fact-validity';
import {documentHeads} from '../document-lifecycle';
import {digest} from '../store';
import {currentInstallations,installationActor,type Installation} from './config';

export interface SlackThreadBinding {channel:string;threadTs:string;conversationId:string;actorId:string;slackUserId:string;matterId?:string}
export interface SlackReplyGrant {botUserId:string;validUntil:string;readTokenEnv?:string;bindings:SlackThreadBinding[]}
/** Server-stamped destination authority; a browser message cannot create or change it. */
export interface SlackChannelGrant extends SlackThreadBinding {installationId:string;configurationHash:string;membershipVersion:number;boundAt:string}
type BoundConversation=Conversation&{channelGrant?:SlackChannelGrant};
export type SlackInstallation=Installation&{slackReplies?:SlackReplyGrant};
const fail=()=>new V2Error('SLACK_GRANT_CHANGED','The selected Slack audience or its authority is unavailable.',403);
export const scopeAudienceHash=(scope:Scope)=>digest({kind:scope.kind,actorIds:[...new Set(scope.actorIds)].sort(),matterId:scope.matterId||null});
/** Called by configuration validation. No provider calls and no credentials in the returned grant. */
export function validSlackReplies(value:unknown,installation:Installation):value is SlackReplyGrant {
 if(!value||typeof value!=='object'||installation.provider!=='slack')return false;
 const g=value as SlackReplyGrant;
 if(!/^[UW][A-Z0-9]{1,99}$/.test(g.botUserId)||!Number.isFinite(Date.parse(g.validUntil))||g.readTokenEnv!==undefined&&!/^[A-Z][A-Z0-9_]{0,99}$/.test(g.readTokenEnv)||!Array.isArray(g.bindings)||!g.bindings.length||g.bindings.length>100)return false;
 const destinations=new Set<string>(),conversations=new Set<string>();
 return g.bindings.every(b=>{if(!b||!/^([CDG])[A-Z0-9]{1,99}$/.test(b.channel)||!installation.resources.includes(b.channel)||!/^\d{1,15}\.\d{1,10}$/.test(b.threadTs)||![b.conversationId,b.actorId].every(value=>typeof value==='string'&&value.length>0&&value.length<=200)||b.matterId!==undefined&&(typeof b.matterId!=='string'||!b.matterId||b.matterId.length>200)||!/^[UW][A-Z0-9]{1,99}$/.test(b.slackUserId)||b.slackUserId===g.botUserId)return false;const destination=`${b.channel}:${b.threadTs}`;if(destinations.has(destination)||conversations.has(b.conversationId))return false;destinations.add(destination);conversations.add(b.conversationId);return true;});
}
export function configuredSlackBinding(i:Installation,channel:string,threadTs:string):SlackThreadBinding|undefined {
 const grant=(i as SlackInstallation).slackReplies;
 if(!grant)return undefined;
 if(!validSlackReplies(grant,i)||Date.parse(grant.validUntil)<=Date.now())throw fail();
 return grant.bindings.find(b=>b.channel===channel&&b.threadTs===threadTs);
}
/** Rechecked at retrieval, model admission, attachment and final external dispatch. */
export function assertSlackChannelGrant(state:WorkspaceState,conversation:Conversation){
 const grant=(conversation as BoundConversation).channelGrant;if(!grant)throw fail();
 const installation=currentInstallations().find(i=>i.id===grant.installationId) as SlackInstallation|undefined;
 if(!installation?.enabled||installation.provider!=='slack'||installation.tenantId!==state.tenantId||digest(installation)!==grant.configurationHash||conversation.id!==grant.conversationId||scopeAudienceHash(conversation.scope)!==scopeAudienceHash(installation.scope))throw fail();
 const binding=configuredSlackBinding(installation,grant.channel,grant.threadTs);
 if(!binding||digest(binding)!==digest({channel:grant.channel,threadTs:grant.threadTs,conversationId:grant.conversationId,actorId:grant.actorId,slackUserId:grant.slackUserId,...(grant.matterId?{matterId:grant.matterId}:{})}))throw fail();
 const actor:ActorContext={tenantId:state.tenantId,actorId:grant.actorId,mode:'authenticated',expiresAt:Date.parse(installation.slackReplies!.validUntil)};
 const member=membership(state,actor);requireRole(state,installationActor(installation),'integration');
 if(member.version!==grant.membershipVersion||!member.roles.includes('member')||!canRead(state,actor,conversation)||!canRead(state,installationActor(installation),conversation))throw fail();
 let matter:Matter|null=null;
 if(grant.matterId){
  matter=state.matters.find(item=>item.id===grant.matterId)||null;const owner=matter&&state.memberships.find(item=>item.actorId===matter!.ownerId),ownerActor:ActorContext={...actor,actorId:matter?.ownerId||''},integration=installationActor(installation);
  if(!matter||matter.legacyWorkflowId||['closed','canceled'].includes(matter.state)||conversation.matterId!==matter.id||!matter.conversationIds.includes(conversation.id)||scopeAudienceHash(matter.scope)!==scopeAudienceHash(conversation.scope)||!owner||owner.revokedAt||owner.expiresAt&&Date.parse(owner.expiresAt)<=Date.now()||!owner.roles.includes('business_owner')||!canRead(state,ownerActor,matter)||!canRead(state,actor,matter)||!canRead(state,integration,matter)||!currentEvidenceLineage(state,matter))throw fail();
  const seen=new Set<string>(),exact=(record:RecordBase):boolean=>{if(seen.has(record.id))return true;seen.add(record.id);if(scopeAudienceHash(record.scope)!==scopeAudienceHash(matter!.scope)||!canRead(state,actor,record)||!canRead(state,integration,record)||!canRead(state,ownerActor,record))return false;return record.provenance.sourceIds.every(id=>{const source=state.sources.find(item=>item.id===id);return !!source&&exact(source);})&&(record.provenance.factIds||[]).every(id=>{const fact=state.facts.find(item=>item.id===id);return !!fact&&exact(fact);});};
  if(!exact(matter))throw fail();
 }
 return {installation,actor,grant,matter};
}
/** Canonical configured app origin; URLs contain only opaque matter IDs, never source text. */
export function slackMatterDeepLink(matterId:string){
 const raw=process.env.KIARA_PUBLIC_ORIGIN;let origin:URL;try{origin=new URL(raw||'');}catch{throw new V2Error('SLACK_LINK_UNAVAILABLE','Configure the public Kiara HTTPS origin before replying with a matter link.',503);}
 if(origin.protocol!=='https:'||origin.origin!==raw||origin.username||origin.password||!/^[-a-zA-Z0-9]{1,200}$/.test(matterId))throw new V2Error('SLACK_LINK_UNAVAILABLE','Configure a valid public Kiara HTTPS origin and matter identity.',503);
 const link=new URL('/',origin);link.searchParams.set('matter',matterId);return link.href;
}
export const isWhyMatterPrompt=(text:string)=>/^\s*why (?:does this matter|is this matter important)\s*\??\s*$/i.test(text);
/** Equal destination audience plus complete transitive lineage, before any text enters a prompt. */
export function slackAudienceEligible(state:WorkspaceState,conversation:Conversation,record:RecordBase):boolean {
 if(!(conversation as BoundConversation).channelGrant)return true;
 try{
  const {installation,actor}=assertSlackChannelGrant(state,conversation),integration=installationActor(installation),audience=scopeAudienceHash(installation.scope),seen=new Set<string>();
  const eligible=(r:RecordBase):boolean=>{if(seen.has(r.id))return true;seen.add(r.id);if(scopeAudienceHash(r.scope)!==audience||!canRead(state,actor,r)||!canRead(state,integration,r))return false;return r.provenance.sourceIds.every(id=>{const source=state.sources.find(x=>x.id===id);return !!source&&eligible(source);})&&(r.provenance.factIds||[]).every(id=>{const fact=state.facts.find(x=>x.id===id);return !!fact&&eligible(fact);});};
  return eligible(record);
 }catch{return false;}
}
/** Capture when an answer is created, before any asynchronous reply worker can observe newer truth. */
export function slackMessageEvidenceHash(state:WorkspaceState,message:Message):string {
 const records=new Map<string,RecordBase>(),seen=new Set<string>();
 const visit=(record:RecordBase)=>{if(seen.has(record.id))return;seen.add(record.id);for(const id of record.provenance.sourceIds){const source=state.sources.find(x=>x.id===id);if(!source||!currentSourceEvidence(state,source))throw fail();records.set(`source:${id}`,source);visit(source);}for(const id of record.provenance.factIds||[]){const fact=state.facts.find(x=>x.id===id);if(!fact||!factCurrentlyConfirmed(fact))throw fail();records.set(`fact:${id}`,fact);visit(fact);}};
 visit(message);
 for(const citation of message.citations){const id=/^document:([^:]+)/.exec(citation.anchor)?.[1];if(!id)continue;const doc=documentHeads(state.documents).find(d=>d.id===id&&d.sourceId===citation.sourceId);if(!doc)throw fail();records.set(`document:${doc.id}`,doc);visit(doc);}
 return digest([...records].sort(([a],[b])=>a.localeCompare(b)));
}
