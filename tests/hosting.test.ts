import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GET,POST} from '../src/app/api/[...path]/route';
import {readState,resetStore} from '../src/data/store';
import {processWorkerStep} from '../src/server/worker-step';
import {signup,review} from '../src/workflow/engine';

const origin='https://kiara.example';
const ctx=(path:string)=>({params:Promise.resolve({path:path.split('/')})});
const passwords={founder:'founder-test-password-with-sufficient-entropy',lawyer:'lawyer-test-password-with-sufficient-entropy'};
test('hosted login and durable worker preserve protected review gates',async t=>{
  const old={...process.env},directory=await mkdtemp(join(tmpdir(),'kiara-hosting-test-'));
  delete process.env.MONGODB_URI;delete process.env.VERCEL;delete process.env.KIARA_WORKER_MODE;
  Object.assign(process.env,{KIARA_DATA_DIR:directory,KIARA_AUTH_MODE:'hosted_password',KIARA_SESSION_SECRET:'a'.repeat(64),KIARA_MODEL_MODE:'scripted',KIARA_EMAIL_MODE:'preview',KIARA_ALLOW_LIVE_EMAIL:'false'});
  for(const role of ['founder','lawyer'] as const)process.env[`KIARA_${role.toUpperCase()}_PASSWORD_HASH`]=createHash('sha256').update(passwords[role]).digest('hex');
  t.after(async()=>{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);await rm(directory,{recursive:true,force:true});});
  const post=(path:string,body:unknown,headers:Record<string,string>={})=>POST(new Request(origin+'/api/'+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}),ctx(path));
  const get=(cookie?:string)=>GET(new Request(origin+'/api/workspace',{headers:cookie?{cookie}:{}}),ctx('workspace'));
  await t.test('no automatic remote identity; login requires the matching password and origin',async()=>{
    assert.equal((await get()).status,401);
    assert.equal((await post('login',{role:'lawyer',password:passwords.founder})).status,401);
    assert.equal((await post('login',{role:'founder',password:passwords.founder},{origin:'https://attacker.example'})).status,403);
    assert.equal((await post('events',{})).status,401);
  });
  const loggedIn=await post('login',{role:'founder',password:passwords.founder});
  assert.equal(loggedIn.status,200);assert.match(loggedIn.headers.get('set-cookie')!,/; Secure/);
  const cookie=loggedIn.headers.get('set-cookie')!.split(';')[0],session=await loggedIn.json();
  const headers={cookie,'x-csrf-token':session.csrf,'idempotency-key':'hosting-test'};
  await t.test('an authenticated founder cannot switch to lawyer without signing in',async()=>{
    assert.equal((await post('session',{role:'lawyer'},headers)).status,403);
    assert.equal((await get(cookie)).status,200);
    assert.equal((await get(cookie+'tampered')).status,401);
  });
  await t.test('worker drains, pauses at review, resumes the queue, and fences old generations',async()=>{
    const epoch=(await readState()).reset_epoch;
    const first=await signup({customer_name:'Hosting first',residence:'US-CA',scenario:'covered',expected_reset_epoch:epoch},'first');
    const second=await signup({customer_name:'Hosting second',residence:'US-NY',scenario:'not_covered',expected_reset_epoch:epoch},'second');
    let steps=0;while(await processWorkerStep(epoch)){assert.ok(++steps<30);}
    let s=await readState();const w=s.workflows.find(w=>w.workflow_id===first.workflow_id)!;
    assert.equal(w.state,'awaiting_founder');assert.equal(w.approvals.length,0);
    assert.ok(['queued','waiting_for_document_slot'].includes(s.workflows.find(w=>w.workflow_id===second.workflow_id)!.state));
    await review(w.workflow_id,'founder',{action:'rejected',expected_state_version:w.state_version,expected_reset_epoch:epoch,bundle_hash:w.bundle_hash!,note:'Release queue in hosting regression'},'reject');
    steps=0;while(await processWorkerStep(epoch)){assert.ok(++steps<30);}
    assert.equal((await readState()).workflows.find(w=>w.workflow_id===second.workflow_id)!.state,'closed_no_change');
    await resetStore(epoch);const before=await readState();assert.equal(await processWorkerStep(epoch),false);assert.deepEqual(await readState(),before);
    const refreshed=await get(cookie);assert.equal(refreshed.status,200);assert.equal((await refreshed.json()).session.role,'founder');
    assert.equal((await post('events',{customer_name:'Stale',residence:'US-CA',scenario:'covered',expected_reset_epoch:epoch},headers)).status,409);
  });
  await t.test('missing Atlas configuration on Vercel fails closed',async()=>{
    process.env.VERCEL='1';await assert.rejects(readState(),/Atlas persistence is required/);delete process.env.VERCEL;
  });
});
