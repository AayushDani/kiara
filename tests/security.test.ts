import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GET,POST} from '../src/app/api/[...path]/route';
import {signup,tick,review,feedback,verifyFact} from '../src/workflow/engine';
import {dispatchNotification} from '../src/server/notifications';
import {assess} from '../src/workflow/legal';
import {readState,resetStore,transaction} from '../src/data/store';
import {provisions} from '../src/data/fixtures';
import type {Workflow} from '../src/server/contracts';

const origin='http://localhost:3000';
const context=(path:string)=>({params:Promise.resolve({path:path.split('/')})});
async function ready(wid:string){for(let i=0;i<30;i++){const w=(await readState()).workflows.find(w=>w.workflow_id===wid)!;if(w.state==='awaiting_founder')return w;if(['needs_human_review','failed','closed_no_change','needs_information'].includes(w.state))throw new Error('Unexpected fixture state '+w.state+' '+JSON.stringify(w.validations.at(-1)));await tick();}throw new Error('Workflow did not reach review');}
const approval=(w:Workflow)=>({action:'approved' as const,expected_state_version:w.state_version,expected_reset_epoch:w.reset_epoch,bundle_hash:w.bundle_hash!,note:'Explicit test approval'});

test('security: HTTP permissions and persisted human-review guards',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'kiara-security-test-'));
 const old={...process.env};process.env.KIARA_DATA_DIR=directory;delete process.env.MONGODB_URI;process.env.KIARA_MODEL_MODE='scripted';process.env.KIARA_EMAIL_MODE='preview';process.env.KIARA_ALLOW_LIVE_EMAIL='false';process.env.KIARA_AUTH_MODE='demo_simulated';
 t.after(async()=>{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);await rm(directory,{recursive:true,force:true});});
 const workspace=await GET(new Request(origin+'/api/workspace'),context('workspace'));assert.equal(workspace.status,200);const boot=await workspace.json();const cookie=workspace.headers.get('set-cookie')!.split(';')[0],token=boot.session.csrf;
 const post=(path:string,body:unknown,extra:Record<string,string>={})=>POST(new Request(origin+'/api/'+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':token,'idempotency-key':'http-'+path,...extra},body:JSON.stringify(body)}),context(path));
 const event={customer_name:'Security Fixture',residence:'US-CA',scenario:'covered',expected_reset_epoch:boot.state.reset_epoch};
 await t.test('rejects client identity injection, unexpected fields, bad CSRF and cross-origin actions',async()=>{assert.equal((await post('events',{...event,actor_id:'forged'})).status,400);assert.equal((await post('events',{...event,role:'lawyer'})).status,400);assert.equal((await post('events',event,{'x-csrf-token':'invalid'})).status,403);assert.equal((await post('events',event,{origin:'https://malicious.example'})).status,403);assert.equal((await post('events',event,{cookie:cookie+'tamper'})).status,401);const remote=await GET(new Request('https://public.example/api/workspace'),context('workspace'));assert.equal(remote.status,403);});
 await t.test('lawyer cannot inject company signup',async()=>{const switchRole=await post('session',{role:'lawyer'});const session=await switchRole.json();const response=await post('events',event,{cookie:switchRole.headers.get('set-cookie')!.split(';')[0],'x-csrf-token':session.csrf});assert.equal(response.status,403);});
 const created=await signup(event,'security-flow');let w=await ready(created.workflow_id);
 await t.test('lawyer-first, stale state and stale bundle approvals are rejected',async()=>{await assert.rejects(review(w.workflow_id,'lawyer',approval(w),'lawyer-first'),/Founder approval/);await assert.rejects(review(w.workflow_id,'founder',{...approval(w),expected_state_version:0},'stale-version'),/review changed/);await assert.rejects(review(w.workflow_id,'founder',{...approval(w),bundle_hash:'0'.repeat(64)},'stale-bundle'),/older review packet/);});
 await t.test('source integrity changes invalidate an otherwise matching approval',async()=>{const p=provisions().find(p=>w.evidence_keys.includes(p.provision_key))!,before=p.source_hash;p.source_hash='0'.repeat(64);try{await assert.rejects(review(w.workflow_id,'founder',approval(w),'changed-source'),/source|evidence|validation|bundle|content changed/i);}finally{p.source_hash=before;}});
 // Tests continue against whichever review state remains if a preceding regression was exposed.
 w=(await readState()).workflows.find(x=>x.workflow_id===w.workflow_id)!;
 if(w.state==='awaiting_founder'){const command=approval(w);await review(w.workflow_id,'founder',command,'founder-good');await review(w.workflow_id,'founder',command,'founder-good');}
 await t.test('replayed same approval does not add another decision',async()=>{const s=await readState(),current=s.workflows.find(x=>x.workflow_id===w.workflow_id)!;assert.equal(current.approvals.filter(a=>a.action==='approved'&&a.role==='founder').length,1);});
 await t.test('old notification is canceled after new feedback changes its sealed bundle',async()=>{const state=await readState(),current=state.workflows.find(x=>x.workflow_id===w.workflow_id)!,draft=state.revisions.find(r=>r.revision_id===current.candidate_revision_id)!;const clause=draft.clauses.find(c=>c.heading==='California privacy rights')||draft.clauses.find(c=>c.heading==='Information we collect')!;await feedback(w.workflow_id,'lawyer',{type:'document_edit',text:clause.body+' Contact us with privacy questions.',clause_id:clause.clause_id,expected_state_version:current.state_version,expected_candidate_revision_id:current.candidate_revision_id!,expected_reset_epoch:state.reset_epoch},'edit-after-founder');await ready(w.workflow_id);await dispatchNotification();const n=(await readState()).notifications.find(n=>n.kind==='lawyer_review_requested')!;assert.equal(n.status,'canceled');});
 await t.test('malformed business facts cannot be promoted to verified known facts',async()=>{const state=await readState();await assert.rejects(async()=>{const proposal=await feedback(w.workflow_id,'founder',{type:'fact_correction',text:'Malformed boolean reproduction',fact_key:'for_profit',proposed_value:'false',expected_reset_epoch:state.reset_epoch},'malformed-fact');await verifyFact(proposal.feedback_id,'founder',state.reset_epoch);},/type|boolean|invalid|value/i);});
 await t.test('applicability fails closed when a required boolean has invalid type',async()=>{const state=await readState(),facts=structuredClone(state.facts);facts.find(f=>f.fact_key==='declared_legal_residence')!.value='US-CA';facts.find(f=>f.fact_key==='for_profit')!.value='false';assert.equal(assess(facts).outcome,'needs_information');});
 await t.test('old session and stale reset command cannot mutate a new epoch',async()=>{const before=await readState();await resetStore(before.reset_epoch);assert.equal((await post('events',{...event,expected_reset_epoch:before.reset_epoch+1})).status,409);await assert.rejects(resetStore(before.reset_epoch),/workspace has reset/);});
});
