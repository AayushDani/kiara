import {V2Error} from '../contracts';
import {digest} from '../store';
import {credential,requireResource,type Installation} from './config';
export interface ProviderObject {objectId:string;revision:string;title:string;text:string;url:string|null;occurredAt:string;removed?:boolean;confirmedCurrent?:boolean}
export type ProviderFetch=typeof fetch;
const MAX_BYTES=2_000_000;
/** Fixed provider origins, no redirects, bounded response/time. Provider bodies never become errors. */
export async function providerRequest(i:Installation,url:URL,fetcher:ProviderFetch=fetch,accept='application/json'):Promise<string>{
 const origin=i.provider==='github'?'https://api.github.com':i.provider==='slack'?'https://slack.com':'https://www.googleapis.com';
 if(url.origin!==origin||url.username||url.password)throw new V2Error('PROVIDER_ORIGIN','Untrusted provider origin.',400);
 let response:Response;try{response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${credential(i.tokenEnv)}`,Accept:accept,...(i.provider==='github'?{'X-GitHub-Api-Version':'2022-11-28'}:{})}});}catch(e){if(e instanceof V2Error)throw e;throw new V2Error('PROVIDER_UNAVAILABLE','The provider read did not complete. Retry the same operation.',503);}
 if(!response.ok)throw new V2Error(response.status===401||response.status===403?'PROVIDER_ACCESS_REMOVED':response.status===404?'PROVIDER_OBJECT_UNAVAILABLE':'PROVIDER_UNAVAILABLE','The provider could not supply this selected resource.',response.status===429?429:503);
 if(Number(response.headers.get('content-length')||0)>MAX_BYTES||!response.body)throw new V2Error('PROVIDER_RESPONSE_LIMIT','The provider response is outside the bounded read limit.',413);
 const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>MAX_BYTES){await reader.cancel();throw new V2Error('PROVIDER_RESPONSE_LIMIT','The provider response is outside the bounded read limit.',413);}chunks.push(part.value);}return Buffer.concat(chunks).toString('utf8');
}
export async function providerJson(i:Installation,url:URL,fetcher?:ProviderFetch):Promise<any>{try{return JSON.parse(await providerRequest(i,url,fetcher));}catch(e){if(e instanceof V2Error)throw e;throw new V2Error('PROVIDER_RESPONSE_INVALID','The provider returned an invalid response.',502);}}
export async function readGitHubPullRequest(i:Installation,repo:string,number:number,fetcher?:ProviderFetch):Promise<ProviderObject>{
 requireResource(i,repo);if(i.provider!=='github'||!/^[-\w.]+\/[-\w.]+$/.test(repo)||!Number.isSafeInteger(number)||number<1)throw new V2Error('INVALID_RESOURCE','Provide a selected repository and pull request.',400);
 const url=new URL(`https://api.github.com/repos/${repo}/pulls/${number}`),p=await providerJson(i,url,fetcher);
 if(!p.head?.sha||typeof p.title!=='string'||!p.updated_at)throw new V2Error('PROVIDER_RESPONSE_INVALID','The pull request revision is unavailable.',502);
 const after=await providerJson(i,url,fetcher);if(p.updated_at!==after.updated_at||githubPullText(p)!==githubPullText(after))throw new V2Error('PROVIDER_REVISION_CHANGED','The pull request changed during current-state verification.',409);
 return {objectId:`${repo}:pull:${number}`,revision:`${p.head.sha}:${p.updated_at}`,title:p.title,text:githubPullText(p),url:`https://github.com/${repo}/pull/${number}`,occurredAt:p.updated_at,confirmedCurrent:true};
}
/** One revision has one material representation across signed events and scoped current reads. */
export function githubPullText(p:any):string {return JSON.stringify({title:p.title,body:p.body||'',state:p.state||'open',merged:p.merged===true,merged_at:p.merged_at||null,head_sha:p.head?.sha||null,base_sha:p.base?.sha||null,interpretation:'Merge status is source evidence; it does not establish deployment.'});}
async function slackThreadSnapshot(i:Installation,channel:string,threadTs:string,fetcher?:ProviderFetch){
 const messages:{ts:string;user:string|null;text:string;edited:string|null}[]=[];let cursor='';for(let page=0;page<5;page++){const url=new URL('https://slack.com/api/conversations.replies');url.search=new URLSearchParams({channel,ts:threadTs,limit:'100',...(cursor?{cursor}:{})}).toString();const body=await providerJson(i,url,fetcher);if(body.ok!==true||!Array.isArray(body.messages))throw new V2Error('PROVIDER_ACCESS_REMOVED','The selected Slack thread is unavailable to this installation.',503);for(const m of body.messages){if(typeof m.ts!=='string'||typeof m.text!=='string')throw new V2Error('PROVIDER_RESPONSE_INVALID','Slack supplied an invalid thread message.',502);messages.push({ts:m.ts,user:typeof m.user==='string'?m.user:null,text:m.text,edited:typeof m.edited?.ts==='string'?m.edited.ts:null});}cursor=body.response_metadata?.next_cursor||'';if(!cursor)return messages;}
 throw new V2Error('PROVIDER_RESPONSE_LIMIT','This Slack thread exceeds the bounded pagination limit; no complete-thread claim is made.',413);
}
export async function readSlackThread(i:Installation,channel:string,threadTs:string,fetcher?:ProviderFetch):Promise<ProviderObject>{
 requireResource(i,channel);if(i.provider!=='slack'||!/^\d+\.\d+$/.test(threadTs))throw new V2Error('INVALID_RESOURCE','Provide a selected channel and thread timestamp.',400);
 const messages=await slackThreadSnapshot(i,channel,threadTs,fetcher),after=await slackThreadSnapshot(i,channel,threadTs,fetcher);if(digest(messages)!==digest(after))throw new V2Error('PROVIDER_REVISION_CHANGED','The Slack thread changed during current-state verification.',409);
 const text=JSON.stringify({channel,threadTs,messages}),last=messages.map(m=>m.edited||m.ts).sort().at(-1)||threadTs;
 // A thread can lose messages without advancing its largest message timestamp. Its complete observed bytes identify this snapshot.
 return {objectId:`${channel}:thread:${threadTs}`,revision:`snapshot:${digest(text)}`,title:`Slack thread ${channel} / ${threadTs}`,text,url:null,occurredAt:new Date(Number(last)*1000).toISOString(),confirmedCurrent:true};
}
export async function readDriveFile(i:Installation,fileId:string,fetcher?:ProviderFetch):Promise<ProviderObject>{
 if(i.provider!=='drive'||!/^[-\w]+$/.test(fileId))throw new V2Error('INVALID_RESOURCE','Provide a valid selected Drive file.',400);
 const metaUrl=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);metaUrl.search=new URLSearchParams({fields:'id,name,mimeType,modifiedTime,version,parents,trashed,webViewLink',supportsAllDrives:'true'}).toString();const m=await providerJson(i,metaUrl,fetcher);
 if(!i.resources.includes(`file:${fileId}`)&&!m.parents?.some((p:string)=>i.resources.includes(`folder:${p}`)))throw new V2Error('INSTALLATION_SCOPE','The file is outside selected files and direct folder children.',403);
 if(m.trashed)return {objectId:fileId,revision:String(m.version||m.modifiedTime),title:m.name||'Removed Drive file',text:'',url:null,occurredAt:m.modifiedTime,removed:true};
 const native=m.mimeType==='application/vnd.google-apps.document';if(!native&&!['text/plain','text/markdown','text/csv'].includes(m.mimeType))throw new V2Error('PARSER_UNAVAILABLE','This Drive format requires a configured, verified parser. The original is not represented as extracted text.',422);
 const url=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}${native?'/export':''}`);url.search=new URLSearchParams(native?{mimeType:'text/plain'}:{alt:'media'}).toString();const body=await providerRequest(i,url,fetcher,'text/plain');
 const after=await providerJson(i,metaUrl,fetcher);if(after.version!==m.version||after.modifiedTime!==m.modifiedTime||after.trashed||JSON.stringify(after.parents)!==JSON.stringify(m.parents))throw new V2Error('PROVIDER_REVISION_CHANGED','The Drive file changed during extraction; retry to bind one current revision.',409);
 if(!m.modifiedTime||!m.version||typeof m.name!=='string')throw new V2Error('PROVIDER_RESPONSE_INVALID','The Drive revision is unavailable.',502);
 return {objectId:fileId,revision:String(m.version),title:m.name,text:body,url:typeof m.webViewLink==='string'?m.webViewLink:null,occurredAt:m.modifiedTime,confirmedCurrent:true};
}
