import {createHash} from 'node:crypto';
import {MongoClient,type Collection} from 'mongodb';
import {V2Error} from './contracts';
import {digest,readWorkspace} from './store';

interface IdentityBinding {
  _id:string;issuer:string;tenantId:string;actorId:string;version:number;
  createdAt:string;updatedAt:string;revokedAt:string|null;
}
export interface IdentityTarget {tenantId:string;actorId:string;version:number}
let client:MongoClient|undefined,connectionKey:string|undefined;

const valid=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=200;
export const identityBindingKey=(issuer:string,subject:string)=>createHash('sha256').update(JSON.stringify([issuer,subject])).digest('hex');
function source(){
  if(process.env.KIARA_OIDC_IDENTITY_SOURCE==='fixture_env'){
    if(process.env.VERCEL||process.env.NODE_ENV==='production')throw new V2Error('IDENTITY_SOURCE_UNSAFE','Hosted identity bindings require MongoDB.',503);
    return 'fixture_env';
  }
  if(process.env.KIARA_OIDC_IDENTITY_SOURCE&&process.env.KIARA_OIDC_IDENTITY_SOURCE!=='mongo')throw new V2Error('IDENTITY_SOURCE_INVALID','Choose MongoDB identity bindings.',503);
  return 'mongo';
}
async function collection():Promise<Collection<IdentityBinding>>{
  if(process.env.KIARA_V2_STORE_MODE!=='normalized'||!process.env.MONGODB_URI)throw new V2Error('IDENTITY_STORE_NOT_CONFIGURED','Hosted identity bindings require normalized MongoDB storage.',503);
  const key=JSON.stringify([process.env.MONGODB_URI,process.env.MONGODB_DB||'kiara']);
  if(client&&connectionKey!==key)throw new V2Error('IDENTITY_STORE_CHANGED','Restart the identity adapter after a storage configuration change.',503);
  if(!client){const next=new MongoClient(process.env.MONGODB_URI,{maxPoolSize:4,serverSelectionTimeoutMS:5000});await next.connect();client=next;connectionKey=key;}
  return client.db(process.env.MONGODB_DB||'kiara').collection<IdentityBinding>('v2_oidc_identities');
}
export async function closeOidcIdentityStore(){await client?.close();client=undefined;connectionKey=undefined;}
async function activeMember(tenantId:string,actorId:string):Promise<boolean>{
  if(source()==='fixture_env'){
    const workspace=await readWorkspace(tenantId),member=workspace.memberships.find(m=>m.actorId===actorId);
    return !!member&&!member.revokedAt&&(!member.expiresAt||Date.parse(member.expiresAt)>Date.now())&&member.roles.includes('member');
  }
  await collection();const db=client!.db(process.env.MONGODB_DB||'kiara');
  const head=await db.collection<{_id:string;mode:string;generation:string}>('v2_normalized_heads').findOne({_id:tenantId},{readConcern:{level:'majority'}});
  if(head?.mode!=='normalized'||!head.generation)return false;
  const row=await db.collection<{tenantId:string;generation:string;recordKey:string;hash:string;value:{actorId:string;roles:string[];revokedAt:string|null;expiresAt:string|null}}>('v2_records_memberships').findOne({tenantId,generation:head.generation,recordKey:actorId},{readConcern:{level:'majority'}});
  const m=row?.value;return !!m&&row.hash===digest(m)&&m.actorId===actorId&&!m.revokedAt&&(!m.expiresAt||Date.parse(m.expiresAt)>Date.now())&&Array.isArray(m.roles)&&m.roles.includes('member');
}

export async function inspectOidcIdentity(issuer:string,subject:string){
  if(!valid(issuer)||!valid(subject)||source()!=='mongo')throw new V2Error('IDENTITY_INPUT_INVALID','Inspect a MongoDB identity with an exact issuer and subject.',400);
  const bindingId=identityBindingKey(issuer,subject),row=await (await collection()).findOne({_id:bindingId},{readConcern:{level:'majority'}});
  if(row&&row.issuer!==issuer)throw new V2Error('IDENTITY_CONFLICT','The identity binding key has a conflicting issuer.',409);
  return {bindingId,version:row?.version||0,status:!row?'absent':row.revokedAt?'revoked':'active',tenantId:row?.tenantId||null,actorId:row?.actorId||null};
}

/** Read-only connected release check; only tenant coverage counts leave this module. */
export async function activeOidcBindingTenants(issuer:string,tenantIds:string[]):Promise<string[]>{
  if(!valid(issuer)||!tenantIds.length||tenantIds.some(id=>!valid(id))||source()!=='mongo')return [];
  const c=await collection(),rows=await c.find({issuer,revokedAt:null,tenantId:{$in:tenantIds}},{readConcern:{level:'majority'}}).project<Pick<IdentityBinding,'tenantId'|'actorId'>>({tenantId:1,actorId:1}).toArray(),active=new Set<string>();
  for(const row of rows)try{if(await activeMember(row.tenantId,row.actorId))active.add(row.tenantId);}catch{/* An unavailable tenant never counts as an active identity. */}
  return [...active];
}

/** The fixture path is explicit, local-only and never accepted on a hosted deployment. */
function fixtureBinding(subject:string):IdentityTarget{
  let rows:unknown;try{rows=JSON.parse(process.env.KIARA_OIDC_IDENTITIES||'[]');}catch{throw new V2Error('IDENTITY_CONFIG_INVALID','Local identity fixture configuration is invalid.',503);}
  if(!Array.isArray(rows)||rows.length>100||rows.some(x=>!x||typeof x!=='object'||!valid(x.subject)||!valid(x.tenantId)||!valid(x.actorId)))throw new V2Error('IDENTITY_CONFIG_INVALID','Local identity fixture configuration is invalid.',503);
  const matches=rows.filter(x=>x.subject===subject);
  if(matches.length!==1)throw new V2Error('MEMBERSHIP_REQUIRED','This identity has no unique workspace mapping. Ask the workspace administrator.',403);
  return {tenantId:matches[0].tenantId,actorId:matches[0].actorId,version:1};
}

export async function resolveOidcIdentity(issuer:string,subject:string):Promise<IdentityTarget>{
  if(!valid(issuer)||!valid(subject))throw new V2Error('MEMBERSHIP_REQUIRED','This identity has no workspace mapping.',403);
  const target=source()==='fixture_env'?fixtureBinding(subject):await (async()=>{
    const row=await (await collection()).findOne({_id:identityBindingKey(issuer,subject)},{readConcern:{level:'majority'}});
    if(!row||row.issuer!==issuer||row.revokedAt||!valid(row.tenantId)||!valid(row.actorId)||!Number.isSafeInteger(row.version)||row.version<1)throw new V2Error('MEMBERSHIP_REQUIRED','This identity has no active workspace mapping.',403);
    return {tenantId:row.tenantId,actorId:row.actorId,version:row.version};
  })();
  if(!await activeMember(target.tenantId,target.actorId))throw new V2Error('MEMBERSHIP_REQUIRED','This identity has no current workspace membership.',403);
  return target;
}

/** Operator-only CLI primitive. This is never exposed through an HTTP route. */
export async function provisionOidcIdentity(input:{issuer:string;subject:string;tenantId:string;actorId:string;expectedVersion:number;dryRun:boolean}){
  if(![input.issuer,input.subject,input.tenantId,input.actorId].every(valid)||!input.issuer.startsWith('https://')||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw new V2Error('IDENTITY_INPUT_INVALID','Provide exact issuer, subject, tenant, actor and inspected version.',400);
  if(source()!=='mongo')throw new V2Error('IDENTITY_SOURCE_UNSAFE','Operator provisioning requires MongoDB identity bindings.',503);
  const id=identityBindingKey(input.issuer,input.subject),c=await collection(),prior=await c.findOne({_id:id},{readConcern:{level:'majority'}});
  if((prior?.version||0)!==input.expectedVersion||prior&&(prior.tenantId!==input.tenantId||prior.actorId!==input.actorId||prior.issuer!==input.issuer))throw new V2Error('IDENTITY_CONFLICT','The inspected identity binding changed or names a different tenant or actor.',409);
  if(!await activeMember(input.tenantId,input.actorId))throw new V2Error('MEMBERSHIP_REQUIRED','Provision an active tenant membership before identity binding.',403);
  const nextVersion=input.expectedVersion+1;
  if(input.dryRun)return {bindingId:id,operation:prior?'reactivate':'create',expectedVersion:input.expectedVersion,nextVersion,changed:false};
  const now=new Date().toISOString();
  if(prior){const changed=await c.updateOne({_id:id,version:input.expectedVersion},{$set:{revokedAt:null,updatedAt:now},$inc:{version:1}},{writeConcern:{w:'majority'}});if(changed.modifiedCount!==1)throw new V2Error('IDENTITY_CONFLICT','Identity binding changed during provisioning.',409);}
  else{try{await c.insertOne({_id:id,issuer:input.issuer,tenantId:input.tenantId,actorId:input.actorId,version:1,createdAt:now,updatedAt:now,revokedAt:null},{writeConcern:{w:'majority'}});}catch{throw new V2Error('IDENTITY_CONFLICT','Identity binding changed during provisioning.',409);}}
  return {bindingId:id,operation:prior?'reactivate':'create',expectedVersion:input.expectedVersion,nextVersion,changed:true};
}

/** Revocation is allowed even if membership has already been removed. */
export async function revokeOidcIdentity(input:{issuer:string;subject:string;expectedVersion:number;dryRun:boolean}){
  if(!valid(input.issuer)||!valid(input.subject)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)throw new V2Error('IDENTITY_INPUT_INVALID','Provide exact issuer, subject and inspected version.',400);
  if(source()!=='mongo')throw new V2Error('IDENTITY_SOURCE_UNSAFE','Operator revocation requires MongoDB identity bindings.',503);
  const id=identityBindingKey(input.issuer,input.subject),c=await collection(),prior=await c.findOne({_id:id},{readConcern:{level:'majority'}});
  if(!prior||prior.issuer!==input.issuer||prior.version!==input.expectedVersion)throw new V2Error('IDENTITY_CONFLICT','Identity binding changed before revocation.',409);
  if(input.dryRun)return {bindingId:id,operation:'revoke',expectedVersion:input.expectedVersion,nextVersion:prior.revokedAt?prior.version:prior.version+1,changed:false};
  if(prior.revokedAt)return {bindingId:id,operation:'revoke',expectedVersion:input.expectedVersion,nextVersion:prior.version,changed:false};
  const now=new Date().toISOString(),changed=await c.updateOne({_id:id,version:input.expectedVersion,revokedAt:null},{$set:{revokedAt:now,updatedAt:now},$inc:{version:1}},{writeConcern:{w:'majority'}});
  if(changed.modifiedCount!==1)throw new V2Error('IDENTITY_CONFLICT','Identity binding changed during revocation.',409);
  return {bindingId:id,operation:'revoke',expectedVersion:input.expectedVersion,nextVersion:input.expectedVersion+1,changed:true};
}
