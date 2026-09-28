import {randomUUID} from 'node:crypto';
import {scopeVisible} from './authority';
import type {ActorContext,Matter,Membership,Proposal,RecordBase,Source,WorkspaceState} from './contracts';
import {digest,timestamp} from './store';

/** A source loss must not make its owner's outstanding work disappear with its evidence. */
function dependsOnSource(s:WorkspaceState,record:RecordBase,sourceId:string,seen=new Set<string>()):boolean {
 if(seen.has(record.id))return false;
 seen.add(record.id);
 for(const id of record.provenance.sourceIds){
  if(id===sourceId)return true;
  const source=s.sources.find(item=>item.id===id);
  if(source&&dependsOnSource(s,source,sourceId,seen))return true;
 }
 for(const id of record.provenance.factIds||[]){
  const fact=s.facts.find(item=>item.id===id);
  if(fact&&dependsOnSource(s,fact,sourceId,seen))return true;
 }
 return false;
}

function affected(s:WorkspaceState,matter:Matter,sourceId:string){
 if(matter.sourceIds.includes(sourceId)||dependsOnSource(s,matter,sourceId))return true;
 if(matter.sourceIds.some(id=>{const source=s.sources.find(item=>item.id===id);return !!source&&dependsOnSource(s,source,sourceId)}))return true;
 if(matter.factIds.some(id=>{const fact=s.facts.find(item=>item.id===id);return !!fact&&dependsOnSource(s,fact,sourceId)}))return true;
 if(matter.documentIds.some(id=>{const document=s.documents.find(item=>item.id===id);return !!document&&dependsOnSource(s,document,sourceId)}))return true;
 return s.proposals.some(proposal=>proposal.matterId===matter.id&&proposalAffected(s,proposal,sourceId));
}

function proposalAffected(s:WorkspaceState,proposal:Proposal,sourceId:string){
 if(dependsOnSource(s,proposal,sourceId)||Object.hasOwn(proposal.dependencies.sourceVersions,sourceId))return true;
 if(Object.keys(proposal.dependencies.factVersions).some(id=>{const fact=s.facts.find(item=>item.id===id);return !!fact&&dependsOnSource(s,fact,sourceId)}))return true;
 return Object.keys(proposal.dependencies.documentHashes).some(id=>{const document=s.documents.find(item=>item.id===id);return !!document&&dependsOnSource(s,document,sourceId)});
}

/** Revocation removes future authority but does not rewrite submitted or completed effects. */
export function invalidateSourceWithdrawalDecisions(s:WorkspaceState,source:Source){
 for(const proposal of s.proposals.filter(item=>proposalAffected(s,item,source.id))){
  if(proposal.status==='current'){proposal.status='invalidated';proposal.version++;proposal.updatedAt=timestamp();}
  for(const approval of s.approvals.filter(item=>item.proposalId===proposal.id&&item.status==='active')){approval.status='invalidated';approval.version++;approval.updatedAt=timestamp();}
  for(const action of s.actions.filter(item=>item.proposalId===proposal.id&&['planned','authorized','pending_manual'].includes(item.status))){
   if(action.status==='planned'&&!action.authorizationId)continue;
   action.status='planned';action.authorizationId=null;action.version++;action.updatedAt=timestamp();
  }
 }
}

function activeRole(s:WorkspaceState,membership:Membership,role:'business_owner'|'admin'){
 if(membership.revokedAt||membership.expiresAt&&Date.parse(membership.expiresAt)<=Date.now()||!membership.roles.includes('member')||!membership.roles.includes(role))return false;
 return !membership.entityIds||membership.entityIds.includes(s.entityId);
}

function eligibleOwner(s:WorkspaceState,membership:Membership,matter:Matter){
 if(!activeRole(s,membership,'business_owner'))return false;
 const actor:ActorContext={tenantId:s.tenantId,actorId:membership.actorId,mode:'authenticated',expiresAt:Date.now()+60_000};
 try{
  if(!scopeVisible(s,actor,matter.scope))return false;
  if(membership.matterIds&&!membership.matterIds.includes(matter.id)&&!(matter.scope.kind==='private'&&matter.scope.actorIds.includes(membership.actorId)))return false;
  return true;
 }catch{return false;}
}

/** Called before the source changes status, inside the same workspace transaction. */
export function retainSourceWithdrawalWork(s:WorkspaceState,source:Source,actorId:string):number {
 const matters=s.matters.filter(matter=>affected(s,matter,source.id));
 let created=0;
 for(const matter of matters){
  const key=`source-withdrawal:${digest({matterId:matter.id,sourceId:source.id})}`;
  const previous=s.receipts[key];
  if(previous&&previous.result.status!=='owner_unavailable')continue;
  const reviewRef=`EW-${key.slice('source-withdrawal:'.length,'source-withdrawal:'.length+12).toUpperCase()}`;
  const assigned=s.memberships.find(member=>member.actorId===matter.ownerId&&eligibleOwner(s,member,matter));
  const administrator=assigned?null:s.memberships.filter(member=>activeRole(s,member,'admin')).sort((a,b)=>a.actorId.localeCompare(b.actorId))[0]||null;
  const owner=assigned||administrator;
  if(!owner){
   // Never keep unavailable evidence current simply because no qualified owner exists.
   // The receipt is a durable operator exception; the former owner sees no source content.
   s.receipts[key]={hash:key,result:{status:'owner_unavailable',reviewRef,affectedMatterId:matter.id,sourceId:source.id}};
   continue;
  }
  const now=timestamp(),id=randomUUID(),adminException=!assigned;
  const correction:Matter={
   id,tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,
   scope:{kind:'private',actorIds:[owner.actorId]},
   provenance:{actorId,sourceIds:[],factIds:[],description:'Source-independent corrective work after evidence access changed.'},
   title:adminException?`Assign an owner for affected work · ${reviewRef}`:`Review work after evidence access changed · ${reviewRef}`,
   objective:adminException?'An earlier work item lost supporting evidence. Assign an authorized business owner and assess completed or unresolved effects from currently permitted records.':'An earlier work item lost supporting evidence. Reassess its decisions and any completed or unresolved effects from currently permitted records.',
   entityId:s.entityId,state:'needs_facts',ownerId:owner.actorId,conversationIds:[],scenarioId:null,eventIds:[],sourceIds:[],factIds:[],documentIds:[],proposalId:null,
   tasks:[{id:randomUUID(),title:adminException?'Assign an authorized owner and review the evidence-loss exception':'Review affected work using current authorized evidence',ownerId:owner.actorId,status:'pending',kind:adminException?'verification':'business',purpose:'work',dueAt:null,deadlineType:'undated',evidenceIds:[]}],
   blockers:[adminException?'The previous owner is unavailable or no longer authorized. Assign a qualified owner before work resumes.':'Supporting evidence is unavailable. Earlier external effects remain historical; check their current outcome before further action.'],
   outcome:null,closedAt:null,ruleVersion:s.ruleVersion,correlationKeys:[]
  };
  s.matters.push(correction);
  s.events.push({id:randomUUID(),tenantId:s.tenantId,version:1,createdAt:now,updatedAt:now,scope:structuredClone(correction.scope),provenance:{actorId,sourceIds:[],factIds:[],description:'Source-independent corrective work.'},type:'source.withdrawal_correction',title:'Affected work needs review',detail:'Supporting evidence became unavailable. The assigned owner must review current evidence and historical effects.',matterId:id,recordId:id,measurement:s.rehearsal?'fictional_rehearsal':'observed'});
  s.outbox.push({id:randomUUID(),tenantId:s.tenantId,kind:'matter_changed',aggregateId:id,commandId:key,status:'pending',owner:'v2',createdAt:now});
  s.receipts[key]={hash:key,result:{status:adminException?'admin_exception':'owner_review',reviewRef,correctiveMatterId:id,affectedMatterId:matter.id,sourceId:source.id}};
  created++;
 }
 return created;
}
