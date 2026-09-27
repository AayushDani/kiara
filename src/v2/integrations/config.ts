import {readFileSync,statSync} from 'node:fs';
import {digest} from '../store';
import {V2Error,type ActorContext,type Scope,type Source,type WorkspaceState} from '../contracts';
export type Provider='github'|'slack'|'drive';
/** Server-only installation binding. Credential values never enter workspace records or histories. */
export interface Installation {
 id:string;provider:Provider;tenantId:string;actorId:string;enabled:boolean;
 tokenEnv:string;webhookSecretEnv:string;resources:string[];scope:Scope;
 providerInstallationId?:string;slackTeamId?:string;
 driveChannelId?:string;driveResourceId?:string;driveStartPageToken?:string;
}
const key=/^[A-Z][A-Z0-9_]{0,99}$/;
export function credential(name:string):string {if(!key.test(name)||!process.env[name])throw new V2Error('CONNECTION_UNAVAILABLE','The installation requires a configured credential.',503);return process.env[name]!;}
export function currentInstallations():Installation[] {
 let raw=process.env.KIARA_V2_INSTALLATIONS;
 if(process.env.KIARA_V2_INSTALLATIONS_FILE){const path=process.env.KIARA_V2_INSTALLATIONS_FILE,info=statSync(path);if(!info.isFile()||info.size>256000||(info.mode&0o077)!==0)throw new V2Error('INSTALLATION_CONFIG_INVALID','Installation configuration must be a bounded private file.',503);raw=readFileSync(path,'utf8');}
 if(!raw)return [];
 let values:unknown;try{values=JSON.parse(raw);}catch{throw new V2Error('INSTALLATION_CONFIG_INVALID','Installation configuration is invalid.',503);}
 if(!Array.isArray(values)||values.length>100)throw new V2Error('INSTALLATION_CONFIG_INVALID','Installation configuration is invalid.',503);
 const ids=new Set<string>();
 for(const i of values as Installation[]){if(!i||!['github','slack','drive'].includes(i.provider)||![i.id,i.tenantId,i.actorId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200)||ids.has(i.id)||typeof i.enabled!=='boolean'||!key.test(i.tokenEnv)||!key.test(i.webhookSecretEnv)||!Array.isArray(i.resources)||!i.resources.length||i.resources.length>100||i.resources.some(r=>typeof r!=='string'||!r||r.length>200)||!i.scope||!['private','team','matter'].includes(i.scope.kind)||!Array.isArray(i.scope.actorIds)||i.scope.actorIds.some(a=>typeof a!=='string')||i.scope.kind==='matter'&&!i.scope.matterId)throw new V2Error('INSTALLATION_CONFIG_INVALID','Installation scope is invalid.',503);ids.add(i.id);}
 return values as Installation[];
}
export async function installations():Promise<Installation[]>{return currentInstallations();}
export async function resolveInstallation(id:string,provider?:Provider):Promise<Installation>{const i=(await installations()).find(i=>i.id===id&&(!provider||i.provider===provider));if(!i||!i.enabled)throw new V2Error('CONNECTION_UNAVAILABLE','This installation is unavailable or revoked.',503);return i;}
export function installationActor(i:Installation):ActorContext{return {tenantId:i.tenantId,actorId:i.actorId,installationId:i.id,installationGrant:{installationId:i.id,configurationHash:digest(i)},mode:'authenticated',expiresAt:Date.now()+60000};}
export function requireResource(i:Installation,resource:string){if(!i.resources.includes(resource))throw new V2Error('INSTALLATION_SCOPE','The provider resource is outside the installation selection.',403);}
export async function connectionAvailability(tenantId:string){return (await installations()).filter(i=>i.tenantId===tenantId).map(i=>({id:i.id,provider:i.provider,available:i.enabled&&!!process.env[i.tokenEnv]&&!!process.env[i.webhookSecretEnv],selectedResourceCount:i.resources.length,qualification:'configured_not_connected_tested'}));}

/** Read-time grant validation is deliberately synchronous: retained/indexed evidence cannot outlive an installation selection. */
export function sourceInstallationEligible(state:WorkspaceState,source:Source):boolean {
 if(!['github','slack','drive'].includes(source.kind))return true;
 const grant=source.installationGrant;if(!grant)return false;
 let i:Installation|undefined;try{i=currentInstallations().find(i=>i.id===grant.installationId);}catch{return false;}
 if(!i||!i.enabled||i.tenantId!==state.tenantId||i.provider!==source.kind||i.actorId!==source.provenance.actorId||!source.externalId?.startsWith(`${i.id}:`)||digest(i)!==grant.configurationHash||digest(source.scope)!==digest(i.scope))return false;
 const member=state.memberships.find(m=>m.actorId===i.actorId);
 return !!member&&!member.revokedAt&&(!member.expiresAt||Date.parse(member.expiresAt)>Date.now())&&member.roles.includes('integration');
}
