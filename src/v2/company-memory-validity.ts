import {documentHeads} from './document-lifecycle';
import {factCurrentlyConfirmed} from './fact-validity';
import {digest} from './store';
import {canRead} from './authority';
import type {RecordBase} from './contracts';
import type {MemoryRelationship,MemoryState} from './company-memory';

export function memoryEntityCurrent(s:MemoryState,id:string):boolean {
 const entity=s.memoryEntities?.find(e=>e.id===id);
 if(!entity||entity.status!=='active')return false;
 const owner=s.memberships.find(m=>m.actorId===entity.ownerId&&!m.revokedAt&&(!m.expiresAt||Date.parse(m.expiresAt)>Date.now()));
 if(!owner)return false;
 try{return canRead(s,{tenantId:s.tenantId,actorId:owner.actorId,expiresAt:Date.now()+60000,mode:'authenticated'},entity);}catch{return false;}
}

/** Dependency checks without importing command, authority or lineage services. */
export function memoryBasisCurrent(s:MemoryState,r:MemoryRelationship):boolean {
 if(!Object.entries(r.basis.entityHashes).every(([id,hash])=>s.memoryEntities?.some(e=>e.id===id&&memoryEntityCurrent(s,id)&&digest(e)===hash)))return false;
 if(!Object.entries(r.basis.sourceHashes).every(([id,hash])=>s.sources.some(x=>x.id===id&&x.status==='active'&&digest(x)===hash)))return false;
 if(!Object.entries(r.basis.factHashes).every(([id,hash])=>s.facts.some(x=>x.id===id&&factCurrentlyConfirmed(x)&&digest(x)===hash)))return false;
 return Object.entries(r.basis.documentHashes).every(([id,hash])=>documentHeads(s.documents).some(x=>x.id===id&&digest(x)===hash));
}
export function memoryRecordCurrent(s:MemoryState,r:RecordBase):boolean {
 const marked=r as RecordBase&{subjectEntityId?:string;relationshipId?:string};
 if(marked.subjectEntityId&&(marked.subjectEntityId!==s.entityId||s.memoryEntities?.some(e=>e.id===s.entityId))&&!memoryEntityCurrent(s,marked.subjectEntityId))return false;
 if(marked.relationshipId){const relationship=s.memoryRelationships?.find(x=>x.id===marked.relationshipId);return !!relationship&&relationship.status==='confirmed'&&relationship.factId===r.id&&memoryBasisCurrent(s,relationship);}
 return true;
}
