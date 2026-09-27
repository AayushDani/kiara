import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {structuredSourceChunks,expandSourceContext,rankSourceChunks,SOURCE_STRUCTURE_VERSION} from '../src/v2/source-structure';
import {command,snapshot} from '../src/v2/service';
import {readWorkspace,closeV2Store} from '../src/v2/store';
import {retrieveConversationEvidence} from '../src/v2/retrieval';
import {authorizedHybridChunks} from '../src/v2/hybrid';
import type {ActorContext,WorkspaceCommand} from '../src/v2/contracts';

const body=`# 1 Definitions
“Customer Data” means information provided by a named customer, excluding anonymized aggregate statistics.

“Business Day” means a day other than Saturday, Sunday or a public holiday in London.

# 2 Notices
2.1 Before adding a subprocessor that will process Customer Data, Provider must give 30 Business Days of prior written notice in accordance with Schedule A.

## Exceptions
The advance notice period does not apply to an emergency replacement necessary to prevent imminent service interruption. Prompt written notice is still required.

# 3 Liability
3.1 Except for fraud, liability is limited to fees paid under Section 4.

# 4 Fees
The fees used in Section 3 are the amounts paid during the previous twelve months, excluding taxes.

# Schedule A
| Recipient | Address | Method |
| Acme legal | notices@example.test | Email |
`;

test('source parsing preserves exact UTF-16 anchors, heading siblings and bounded complete Unicode',()=>{
 const chunks=structuredSourceChunks(body);for(const c of chunks){assert.equal(c.text,body.slice(c.offset,c.end));assert.equal(c.structureVersion,SOURCE_STRUCTURE_VERSION);assert.ok(c.text.length<=2400);}
 const notices=chunks.find(c=>c.label==='2 Notices')!,exceptions=chunks.find(c=>c.label==='Exceptions')!,liability=chunks.find(c=>c.label==='3 Liability')!;
 assert.equal(notices.parentOffset,null);assert.equal(liability.parentOffset,null);assert.equal(exceptions.parentOffset,notices.offset);assert.ok(chunks.some(c=>c.kind==='table'&&c.text.includes('notices@example.test')));
 const unicode='x'.repeat(199)+'🪷'+'y'.repeat(300),parts=structuredSourceChunks(unicode,200);assert.equal(parts.map(c=>c.text).join(''),unicode);assert.ok(parts.every(c=>!/[\uD800-\uDBFF]$/.test(c.text)&&!/^[\uDC00-\uDFFF]/.test(c.text)));assert.equal(structuredSourceChunks('').length,0);
});

test('a notice clause brings its exact definitions, exception and referenced schedule table',()=>{
 const chunks=structuredSourceChunks(body),primary=chunks.find(c=>c.text.startsWith('2.1 '))!;
 const context=expandSourceContext(chunks,[primary.offset],12).chunks.map(c=>c.text).join('\n');
 for(const expected of ['30 Business Days','excluding anonymized aggregate','other than Saturday','emergency replacement','notices@example.test'])assert.ok(context.includes(expected),expected);
 const result=rankSourceChunks(body,'What prior notice applies before adding a subprocessor?',1,12);assert.ok(result.chunks.some(c=>c.offset===primary.offset));
});

test('bounded expansion reports omissions and handles repeated references without inventing source text',()=>{
 const chunks=structuredSourceChunks(body),selected=chunks.find(c=>c.text.startsWith('2.1 '))!;const expanded=expandSourceContext(chunks,[selected.offset],2);assert.equal(expanded.chunks.length,2);assert.equal(expanded.omittedContext,true);assert.equal(new Set(expanded.chunks.map(c=>c.offset)).size,2);
 const circular='Section 1\nRead Section 2.\n\nSection 2\nRead Section 1.\n';const c=structuredSourceChunks(circular);assert.ok(expandSourceContext(c,[c[1].offset],8).chunks.length<=4);
 const liability=chunks.find(c=>c.text.startsWith('3.1 '))!;assert.ok(expandSourceContext(chunks,[liability.offset],8).chunks.some(c=>c.text.includes('previous twelve months')));
});

let dir='';const envKeys=['KIARA_V2_DATA_DIR','MONGODB_URI','VERCEL','KIARA_V2_AI_MODE'];const old=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'kiara-source-structure-'));process.env.KIARA_V2_DATA_DIR=dir;delete process.env.MONGODB_URI;delete process.env.VERCEL;process.env.KIARA_V2_AI_MODE='local';});
afterEach(async()=>{await closeV2Store();for(const k of envKeys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}await rm(dir,{recursive:true,force:true});});
const actor:ActorContext={tenantId:'structure-test',actorId:'alice',mode:'local_demo',expiresAt:Date.now()+3600000,bootstrapRoles:['member','business_owner','fact_owner','admin']};
async function send(c:WorkspaceCommand){return command(actor,{expectedVersion:(await snapshot(actor)).version,idempotencyKey:randomUUID(),command:c});}

test('both local and selected hybrid evidence hydrate structured source slices and bounded supporting context',async()=>{
 const added=await send({type:'document.add',title:'Acme agreement',body,authority:'executed',kind:'agreement'}),asked=await send({type:'message.send',text:'Explain subprocessor prior notice for Acme'});const state=await readWorkspace(actor.tenantId),conversation=state.conversations.find(c=>c.id===asked.result.conversationId)!,message=state.messages.filter(m=>m.role==='user').at(-1)!;
 const local=retrieveConversationEvidence(state,actor,conversation,message.id);assert.ok(local.evidence.some(e=>e.quote.includes('emergency replacement')));assert.ok(local.evidence.some(e=>e.quote.includes('excluding anonymized aggregate')));
 const chunks=authorizedHybridChunks(state,actor),primary=chunks.find(c=>c.text.startsWith('2.1 '))!;assert.ok(primary);assert.equal(primary.structureVersion,SOURCE_STRUCTURE_VERSION);
 const hybrid=retrieveConversationEvidence(state,actor,conversation,message.id,{hybrid:true,chunks:[{kind:'document',id:String(added.result.documentId),offset:primary.offset}]});assert.equal(hybrid.evidence[0].quote,primary.text);assert.ok(hybrid.evidence.some(e=>e.quote.includes('notices@example.test')));assert.match(hybrid.limitations.join(' '),/heuristic/);
 for(const item of hybrid.evidence){const anchor=item.anchor.match(/:chars:(\d+)-(\d+)$/)!;assert.equal(item.quote,body.slice(Number(anchor[1]),Number(anchor[2])));assert.ok(item.structure);}
 assert.equal(hybrid.agreementInventory.length,1);
});

test('packet bound reports truncation while agreement inventory stays exhaustive',async()=>{
 for(let n=0;n<6;n++)await send({type:'document.add',title:`Notice agreement ${n}`,body:Array.from({length:20},(_,i)=>`# Section ${i+1}\nNotice terms ${n}-${i}. Read Section ${i===19?1:i+2}.\n`).join('\n'),authority:'executed',kind:'agreement'});
 const asked=await send({type:'message.send',text:'Explain notice terms'}),state=await readWorkspace(actor.tenantId),c=state.conversations.find(c=>c.id===asked.result.conversationId)!,m=state.messages.filter(m=>m.role==='user').at(-1)!;const packet=retrieveConversationEvidence(state,actor,c,m.id);assert.equal(packet.agreementInventory.length,6);assert.ok(packet.evidence.length<=24);assert.ok(packet.evidence.reduce((n,e)=>n+e.quote.length,0)<=40000);assert.match(packet.limitations.join(' '),/omitted/);
});
