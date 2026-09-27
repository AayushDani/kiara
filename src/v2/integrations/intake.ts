import {createHmac,timingSafeEqual} from 'node:crypto';
import {V2Error,type WorkspaceCommand} from '../contracts';
import {requireRole} from '../authority';
import {command} from '../service';
import {digest,readWorkspace,timestamp,transactWorkspace} from '../store';
import {credential,installationActor,requireResource,resolveInstallation,type Installation} from './config';
import {providerJson,readDriveFile,type ProviderFetch,type ProviderObject} from './read';
const equal=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function need(value:unknown,message:string):asserts value {if(!value)throw new V2Error('WEBHOOK_INVALID',message,401);}
function parse(raw:Uint8Array):any{try{return JSON.parse(Buffer.from(raw).toString('utf8'));}catch{throw new V2Error('WEBHOOK_INVALID','Expected a signed JSON event.',400);}}
/** Returns only validated payload; caller must still enforce provider resource selection. */
export function verifyWebhook(i:Installation,headers:Headers,raw:Uint8Array,now=Date.now()):any{
 if(raw.byteLength>1_000_000)throw new V2Error('WEBHOOK_LIMIT','The event exceeds the intake limit.',413);
 const secret=credential(i.webhookSecretEnv);
 if(i.provider==='github'){const expected=`sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`;need(equal(expected,headers.get('x-hub-signature-256')||''),'Invalid GitHub signature.');return parse(raw);}
 if(i.provider==='slack'){const ts=headers.get('x-slack-request-timestamp')||'';need(/^\d+$/.test(ts)&&Math.abs(now-Number(ts)*1000)<=300000,'Expired Slack event.');const expected=`v0=${createHmac('sha256',secret).update(`v0:${ts}:`).update(raw).digest('hex')}`;need(equal(expected,headers.get('x-slack-signature')||''),'Invalid Slack signature.');return parse(raw);}
 need(!!i.driveChannelId&&!!i.driveResourceId&&headers.get('x-goog-channel-id')===i.driveChannelId&&headers.get('x-goog-resource-id')===i.driveResourceId&&equal(secret,headers.get('x-goog-channel-token')||''),'Invalid Drive notification channel.');need(raw.byteLength===0,'Drive notifications contain no source body.');need(/^\d+$/.test(headers.get('x-goog-message-number')||''),'Invalid Drive notification identity.');return {notification:true};
}
async function assertInstallation(i:Installation){const state=await readWorkspace(i.tenantId);requireRole(state,installationActor(i),'integration');return state;}
function scopedId(i:Installation,id:string){return `${i.id}:${id}`;}
async function revokeObject(i:Installation,objectId:string,revision:string){
 return transactWorkspace(i.tenantId,s=>{requireRole(s,installationActor(i),'integration');let revoked=0;for(const source of s.sources.filter(x=>x.kind===i.provider&&x.externalId===scopedId(i,objectId)&&x.status==='active')){source.status='revoked';source.aclVersion++;source.version++;source.updatedAt=timestamp();revoked++;for(const proposal of s.proposals.filter(p=>p.provenance.sourceIds.includes(source.id))){proposal.status='invalidated';proposal.version++;for(const approval of s.approvals.filter(a=>a.proposalId===proposal.id&&a.status==='active')){approval.status='invalidated';approval.version++;}}}const key=`integration:revoked:${digest({installation:i.id,objectId,revision})}`;s.receipts[key]={hash:digest({objectId,revision}),result:{revoked}};return {revoked};});
}
async function revokeSlackThreadSnapshots(i:Installation,channel:string,messageTs:string,revision:string){
 const state=await readWorkspace(i.tenantId),prefix=`${i.id}:${channel}:thread:`;
 const affected=new Set(state.sources.filter(source=>source.kind==='slack'&&source.status==='active'&&source.externalId?.startsWith(prefix)).filter(source=>{try{const value=JSON.parse(source.text);return value.threadTs===messageTs||Array.isArray(value.messages)&&value.messages.some((m:any)=>m.ts===messageTs);}catch{return true;}}).map(source=>source.externalId!.slice(i.id.length+1)));
 for(const objectId of affected)await revokeObject(i,objectId,revision);
}
export async function ingestProviderObject(i:Installation,eventId:string,object:ProviderObject){
 if(object.removed)return (await revokeObject(i,object.objectId,object.revision)).result;
 if(!object.text||object.text.length>100000)throw new V2Error('EXTRACTION_LIMIT','The selected resource is empty or exceeds the evidence limit.',413);
 const c:Extract<WorkspaceCommand,{type:'event.ingest'}>={type:'event.ingest',provider:i.provider,externalEventId:eventId,externalObjectId:scopedId(i,object.objectId),externalRevision:object.revision,occurredAt:object.occurredAt,title:object.title.slice(0,300),text:object.text,scope:structuredClone(i.scope)};
 for(let n=0;n<5;n++){const current=await resolveInstallation(i.id,i.provider);if(digest(current)!==digest(i))throw new V2Error('INSTALLATION_CHANGED','The installation changed during this read. Retry under its current scope.',409);const state=await assertInstallation(current);try{return (await command(installationActor(current),{idempotencyKey:`provider:${digest({installation:i.id,eventId})}`,expectedVersion:state.version,command:c})).result;}catch(e){if(!(e instanceof V2Error)||e.code!=='VERSION_CONFLICT')throw e;}}
 throw new V2Error('STORE_BUSY','Intake is busy. Retry this delivery with the same identity.',503);
}
/** Read the authenticated changes feed. Notifications alone are never represented as source content. */
export async function syncDriveInstallation(i:Installation,fetcher?:ProviderFetch){
 await assertInstallation(i);const key=`integration:drive-cursor:${i.id}`;let state=await readWorkspace(i.tenantId);let cursor=String(state.receipts[key]?.result.cursor||i.driveStartPageToken||'');if(!cursor)throw new V2Error('DRIVE_CURSOR_REQUIRED','Configure an initial Drive changes cursor before enabling this channel.',503);let imported=0,skipped=0;
 for(let page=0;page<10;page++){
  const url=new URL('https://www.googleapis.com/drive/v3/changes');url.search=new URLSearchParams({pageToken:cursor,pageSize:'100',includeRemoved:'true',supportsAllDrives:'true',includeItemsFromAllDrives:'true',fields:'nextPageToken,newStartPageToken,changes(fileId,removed,time,file(id,parents,trashed))'}).toString();const data=await providerJson(i,url,fetcher);if(!Array.isArray(data.changes))throw new V2Error('PROVIDER_RESPONSE_INVALID','Drive changes response is invalid.',502);
  for(const change of data.changes){const id=change.fileId;if(typeof id!=='string')throw new V2Error('PROVIDER_RESPONSE_INVALID','Drive change has no file identity.',502);state=await readWorkspace(i.tenantId);const known=state.sources.some(s=>s.kind==='drive'&&s.externalId===scopedId(i,id));const selected=i.resources.includes(`file:${id}`)||change.file?.parents?.some((p:string)=>i.resources.includes(`folder:${p}`));if(change.removed||change.file?.trashed){if(known)await revokeObject(i,id,String(change.time||cursor));else skipped++;continue;}if(!selected){if(known)await revokeObject(i,id,String(change.time||cursor));skipped++;continue;}
   let object:ProviderObject;try{object=await readDriveFile(i,id,fetcher);}catch(e){if(e instanceof V2Error&&['PROVIDER_ACCESS_REMOVED','PROVIDER_OBJECT_UNAVAILABLE','INSTALLATION_SCOPE'].includes(e.code)){if(known)await revokeObject(i,id,String(change.time||cursor));skipped++;continue;}throw e;}
   await ingestProviderObject(i,`drive:${digest({id,revision:object.revision,text:object.text})}`,object);imported++;
  }
  const next=data.nextPageToken||data.newStartPageToken;if(typeof next!=='string'||!next)throw new V2Error('PROVIDER_RESPONSE_INVALID','Drive did not return a durable cursor.',502);
  const prior=cursor;const advanced=await transactWorkspace(i.tenantId,s=>{requireRole(s,installationActor(i),'integration');const current=String(s.receipts[key]?.result.cursor||i.driveStartPageToken||'');if(current!==prior)return false;s.receipts[key]={hash:digest({installation:i.id,cursor:next}),result:{cursor:next,updatedAt:timestamp()}};return true;});
  if(!advanced.result)return {accepted:true,imported,skipped,concurrentSync:true};cursor=next;if(!data.nextPageToken)return {accepted:true,imported,skipped};
 }
 throw new V2Error('SYNC_PAGE_LIMIT','The changes cursor was saved; more pages remain for the next retry.',503);
}
export async function acceptWebhook(installationId:string,headers:Headers,raw:Uint8Array,fetcher?:ProviderFetch):Promise<Record<string,unknown>>{
 const i=await resolveInstallation(installationId);await assertInstallation(i);const p=verifyWebhook(i,headers,raw);
 if(i.provider==='drive')return syncDriveInstallation(i,fetcher);
 if(i.provider==='slack'){
  if(p.type==='url_verification'){need(typeof p.challenge==='string'&&p.challenge.length<=500,'Invalid Slack challenge.');return {challenge:p.challenge};}
  need(!!i.slackTeamId&&p.team_id===i.slackTeamId,'Slack workspace does not match this installation.');const e=p.event;need(e&&typeof e.channel==='string','Unsupported Slack event.');requireResource(i,e.channel);need(typeof p.event_id==='string'&&p.event_id.length<=150,'Invalid Slack event identity.');
  if(e.subtype==='message_deleted'){need(typeof e.deleted_ts==='string','Deleted message identity is required.');await revokeSlackThreadSnapshots(i,e.channel,e.deleted_ts,p.event_id);await revokeObject(i,`${e.channel}:message:${e.deleted_ts}`,p.event_id);return {accepted:true,revoked:true};}
  const message=e.subtype==='message_changed'?e.message:e;need(e.type==='message'&&typeof message?.text==='string'&&typeof message.ts==='string','Unsupported Slack event.');if(e.subtype==='message_changed')await revokeSlackThreadSnapshots(i,e.channel,message.ts,p.event_id);const ts=Number(message.edited?.ts||e.event_ts||message.ts);need(Number.isFinite(ts),'Invalid Slack event time.');return {accepted:true,...await ingestProviderObject(i,p.event_id,{objectId:`${e.channel}:message:${message.ts}`,revision:String(message.edited?.ts||message.ts),title:`Slack evidence · ${e.channel}`,text:JSON.stringify({channel:e.channel,threadTs:message.thread_ts||message.ts,user:message.user||null,text:message.text}),url:null,occurredAt:new Date(ts*1000).toISOString()})};
 }
 need(!!i.providerInstallationId&&String(p.installation?.id)===i.providerInstallationId,'GitHub installation does not match.');need(typeof p.repository?.full_name==='string','Repository identity required.');requireResource(i,p.repository.full_name);const type=headers.get('x-github-event');let object:ProviderObject;
 if(type==='pull_request'&&p.pull_request){const pr=p.pull_request;need(pr.head?.sha&&pr.updated_at&&Number.isSafeInteger(pr.number),'Invalid pull request evidence.');object={objectId:`${p.repository.full_name}:pull:${pr.number}`,revision:`${pr.head.sha}:${pr.updated_at}`,title:String(pr.title||'Pull request'),text:JSON.stringify({action:p.action,title:pr.title,body:pr.body||'',merged:pr.merged===true,headSha:pr.head.sha,interpretation:'Merged code is not deployment evidence.'}),url:null,occurredAt:pr.updated_at};}
 else if(type==='push'){need(typeof p.after==='string'&&p.head_commit?.timestamp,'Push revision and timestamp required.');object={objectId:`${p.repository.full_name}:ref:${p.ref}`,revision:p.after,title:`Push · ${p.repository.full_name}`,text:JSON.stringify({ref:p.ref,after:p.after,before:p.before,headCommit:p.head_commit,interpretation:'A push does not establish production deployment.'}),url:null,occurredAt:p.head_commit.timestamp};}
 else if(type==='deployment_status'){need(p.deployment?.id&&p.deployment_status?.id&&p.deployment_status?.created_at,'Deployment evidence required.');object={objectId:`${p.repository.full_name}:deployment:${p.deployment.id}`,revision:String(p.deployment_status.id),title:`Deployment · ${p.repository.full_name}`,text:JSON.stringify({deployment:p.deployment,status:p.deployment_status,interpretation:'Provider deployment evidence requires contextual verification; it is not a legal approval.'}),url:null,occurredAt:p.deployment_status.created_at};}
 else throw new V2Error('EVENT_UNSUPPORTED','This authenticated GitHub event is not yet supported.',422);
 // GitHub delivery headers are not inside the signature. Body identity also prevents header-only replays.
 return {accepted:true,...await ingestProviderObject(i,`github:${digest({type,body:Buffer.from(raw).toString('utf8')})}`,object)};
}
