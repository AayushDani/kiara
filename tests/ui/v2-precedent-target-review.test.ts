import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import type {WorkspaceSnapshot} from '../../src/v2/contracts';

registerHooks({load(url,context,nextLoad){if(url.endsWith('.css'))return {format:'module',source:'export default {}',shortCircuit:true};return nextLoad(url,context)}});
const {precedentTargetReviewReady}=await import('../../src/ui/v2/ScopedPrecedentsPanel');
const scope={kind:'team',actorIds:[]};
const command={type:'precedent.target.set' as const,inspectedVersion:7,matterId:'matter-1',expectedMatterVersion:2,counterpartyEntityId:'counterparty-1',jurisdiction:'New York',transaction:'Customer AI transcript summaries',asOfDate:'2026-09-27',productEntityIds:['product-1'],factIds:['fact-1','fact-2']};

function fixture(){return {version:7,entityId:'company-1',actor:{id:'owner-1'},capabilities:['business_owner'],matters:[{id:'matter-1',entityId:'company-1',ownerId:'owner-1',version:2,state:'active',scope,objective:'Customer AI transcript summaries',factIds:['fact-1','fact-2'],sourceIds:[],documentIds:[]}],facts:[{id:'fact-1',entityId:'company-1',status:'confirmed',current:true,reuse:'company',scope},{id:'fact-2',entityId:'company-1',status:'confirmed',current:true,reuse:'company',scope}],companyMemory:{entities:[{id:'counterparty-1',kind:'counterparty',scope},{id:'product-1',kind:'product',scope}]},sources:[],documents:[]} as unknown as WorkspaceSnapshot;}

test('target review requires exact open owned matter, current workspace, and calendar date',()=>{
 const data=fixture();
 assert.equal(precedentTargetReviewReady(data,command),true);
 assert.equal(precedentTargetReviewReady(data,{...command,inspectedVersion:6}),false);
 assert.equal(precedentTargetReviewReady(data,{...command,expectedMatterVersion:1}),false);
 assert.equal(precedentTargetReviewReady(data,{...command,asOfDate:'2026-02-30'}),false);
 assert.equal(precedentTargetReviewReady({...data,actor:{...data.actor,id:'other'}},command),false);
 assert.equal(precedentTargetReviewReady({...data,matters:[{...data.matters[0],state:'closed'}]},command),false);
});

test('target review includes every exact current matter fact and declared subject',()=>{
 const data=fixture();
 assert.equal(precedentTargetReviewReady(data,{...command,factIds:['fact-1']}),false);
 assert.equal(precedentTargetReviewReady(data,{...command,factIds:['fact-1','fact-2','extra']}),false);
 assert.equal(precedentTargetReviewReady(data,{...command,factIds:['fact-1','fact-1']}),false);
 assert.equal(precedentTargetReviewReady(data,{...command,counterpartyEntityId:'missing'}),false);
 assert.equal(precedentTargetReviewReady(data,{...command,productEntityIds:['missing']}),false);
 assert.equal(precedentTargetReviewReady({...data,facts:[{...data.facts[0],current:false},data.facts[1]]},command),false);
 assert.equal(precedentTargetReviewReady({...data,facts:[{...data.facts[0],reuse:'conversation_only'},data.facts[1]]},command),false);
});
