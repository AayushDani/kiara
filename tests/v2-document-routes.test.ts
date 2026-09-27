import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GET as workspace} from '../src/app/api/v2/workspace/route';
import {POST as commands} from '../src/app/api/v2/commands/route';
import {POST as upload} from '../src/app/api/v2/documents/route';
import {GET as original} from '../src/app/api/v2/documents/[id]/original/route';
import {closeV2Store,readWorkspace} from '../src/v2/store';
import type {WorkspaceCommand,WorkspaceSnapshot} from '../src/v2/contracts';

const dirs:string[]=[];const origin='http://localhost:3091';let cookie='',csrf='';
beforeEach(async()=>{await closeV2Store();const dir=await mkdtemp(join(tmpdir(),'kiara-document-routes-'));dirs.push(dir);process.env.KIARA_V2_DATA_DIR=dir;process.env.KIARA_ORIGINALS_DIR=join(dir,'originals');process.env.KIARA_V2_AUTH_MODE='local_demo';process.env.KIARA_AUTH_MODE='demo_simulated';process.env.KIARA_V2_AI_MODE='local';delete process.env.MONGODB_URI;delete process.env.KIARA_ORIGINALS_MODE;delete process.env.VERCEL;const r=await workspace(new Request(origin+'/api/v2/workspace'));assert.equal(r.status,200);cookie=r.headers.get('set-cookie')!.split(';')[0];csrf=(await r.json()).csrf;});
after(async()=>{await closeV2Store();await Promise.all(dirs.map(dir=>rm(dir,{recursive:true,force:true})));});
async function current():Promise<WorkspaceSnapshot>{return (await (await workspace(new Request(origin+'/api/v2/workspace',{headers:{cookie}}))).json()).snapshot;}
function send(key:string,expectedVersion:number,command:WorkspaceCommand,token=csrf){return commands(new Request(origin+'/api/v2/commands',{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':token,'idempotency-key':key},body:JSON.stringify({idempotencyKey:key,expectedVersion,command})}));}
function download(id:string){return original(new Request(origin+`/api/v2/documents/${id}/original`,{headers:{cookie}}),{params:Promise.resolve({id})});}

test('pasted document route retains exact bytes, hands off its own revisions, and replays one document',async()=>{
 const before=await current(),body='Original input with Unicode café and line break.\nSecond paragraph.',command={type:'document.add',title:'Route agreement',body,authority:'draft',kind:'agreement'} as const;
 let response=await send('paste-original',before.version,command);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const first=await response.json(),document=first.snapshot.documents[0];assert.equal(first.replayed,false);assert.ok(first.snapshot.version>before.version);
 const file=await download(document.id);assert.equal(file.status,200);assert.equal(file.headers.get('cache-control'),'no-store');assert.equal(file.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.from(body));
 response=await send('paste-original',before.version,command);assert.equal(response.status,200);const replay=await response.json();assert.equal(replay.replayed,true);assert.equal(replay.snapshot.documents.length,1);assert.equal(replay.snapshot.documents[0].id,document.id);
 response=await send('paste-original',replay.snapshot.version,{...command,body:'Changed input'});assert.equal(response.status,409);assert.equal((await response.json()).error.code,'IDEMPOTENCY_CONFLICT');
});

test('multipart reimport preserves both exact originals and stale/CSRF requests cannot attach documents',async()=>{
 const first=await send('initial', (await current()).version,{type:'document.add',title:'Initial',body:'Initial exact bytes.',authority:'draft',kind:'agreement'});assert.equal(first.status,200);const initial=await first.json(),base=initial.snapshot.documents[0],bytes=Buffer.from('Imported successor.\nExact retained source.');
 const form=new FormData();form.set('file',new File([bytes],'successor.txt',{type:'text/plain'}));form.set('idempotencyKey','file-successor');form.set('expectedVersion',String(initial.snapshot.version));form.set('baseRevisionId',base.id);form.set('expectedContentHash',base.contentHash);form.set('note','Reviewed successor text.');
 const response=await upload(new Request(origin+'/api/v2/documents',{method:'POST',headers:{cookie,origin,'x-csrf-token':csrf,'idempotency-key':'file-successor'},body:form}));assert.equal(response.status,201,JSON.stringify(await response.clone().json()));const result=await response.json(),next=result.snapshot.documents.find((d:{parentRevisionId:string})=>d.parentRevisionId===base.id);assert.ok(next);assert.equal(next.revision,2);assert.deepEqual(Buffer.from(await (await download(next.id)).arrayBuffer()),bytes);assert.equal(await (await download(base.id)).text(),'Initial exact bytes.');
 const stale=await send('stale',initial.snapshot.version,{type:'document.add',title:'Stale',body:'Rejected stale bytes.',authority:'draft'});assert.equal(stale.status,409);assert.equal((await stale.json()).error.code,'VERSION_CONFLICT');
 const forbidden=await send('csrf-denied',(await current()).version,{type:'document.add',title:'Denied',body:'Rejected CSRF bytes.',authority:'draft'},'wrong');assert.equal(forbidden.status,403);const state=await readWorkspace('local-workspace');assert.equal(state.documents.length,2);assert.equal(Object.keys(state.receipts).filter(key=>key.startsWith('artifact-intake:')).length,2);
 const deletion=await send('delete-source',(await current()).version,{type:'source.revoke',sourceId:next.sourceId,reason:'Delete route fixture',delete:true});assert.equal(deletion.status,200);assert.equal((await download(next.id)).status,404);
});
