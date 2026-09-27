import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import type {WorkspaceSnapshot} from '../../src/v2/contracts';

registerHooks({load(url,context,nextLoad){if(url.endsWith('.css'))return {format:'module',source:'export default {}',shortCircuit:true};return nextLoad(url,context)}});
const {applicabilityReviewReady}=await import('../../src/ui/v2/ApplicabilityPanel');

const scope={kind:'team',actorIds:[]};
const objective='Change how customer transcripts are summarized';
const resolvedTarget={transaction:objective,jurisdiction:'New York',counterpartyEntityId:'counterparty-1',productEntityIds:['product-1'],factIds:['fact-1']};
const unknownTarget={...resolvedTarget,counterpartyEntityId:null,productEntityIds:[],factIds:[]};
const clause={start:11,end:62,quote:'Notice is required before changing transcript use.'};
const notice={trigger:'Changing transcript use',recipients:['Customer legal team'],channel:'Email to contract notice address',timing:'At least 30 days before the change'};
const decisiveRow={documentId:'agreement-1',assessment:'notice_required' as const,clause,notice,reason:'The selected executed clause covers the proposed change.'};
const unknownRow={documentId:'agreement-1',assessment:'unknown' as const,clause:null,notice:null,reason:'Execution or operative terms are unresolved.'};

function fixture(authority:'executed'|'draft'='executed'){
 const body='Section 4. Notice is required before changing transcript use.';
 const document={id:'agreement-1',title:'Customer agreement',version:2,revision:2,kind:'agreement',authority,body,contentHash:'exact-hash',sourceId:'source-1'};
 const inventory={id:'register-1',matterId:'matter-1',status:'active',current:true,documentIds:['agreement-1'],documentHashes:{'agreement-1':'exact-hash'}};
 const matter={id:'matter-1',objective,scope,factIds:['fact-1'],sourceIds:[]};
 const fact={id:'fact-1',predicate:'transcript_use',value:'summaries',status:'confirmed',current:true,scope};
 const counterparty={id:'counterparty-1',kind:'counterparty',name:'Acme',scope};
 const product={id:'product-1',kind:'product',name:'Summary product',scope};
 return {version:7,inventories:[inventory],matters:[matter],facts:[fact],documents:[document],documentHeadIds:['agreement-1'],sources:[],companyMemory:{entities:[counterparty,product]}} as unknown as WorkspaceSnapshot;
}

test('decisive assessment requires every register row, exact clause, and frozen workspace version',()=>{
 const data=fixture();
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[decisiveRow],false),true);
 assert.equal(applicabilityReviewReady(data,'register-1',6,resolvedTarget,[decisiveRow],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[{...decisiveRow,clause:{...clause,quote:'Different words'}}],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[{...decisiveRow,reason:''}],false),false);
 assert.equal(applicabilityReviewReady(fixture('draft'),'register-1',7,resolvedTarget,[decisiveRow],false),false);
});

test('decisive rows require exact current counterparty and selected confirmed matter fact',()=>{
 const data=fixture();
 assert.equal(applicabilityReviewReady(data,'register-1',7,unknownTarget,[decisiveRow],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,{...resolvedTarget,factIds:[]},[decisiveRow],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,{...resolvedTarget,counterpartyEntityId:'missing'},[decisiveRow],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,{...resolvedTarget,transaction:'Different objective'},[decisiveRow],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,{...resolvedTarget,jurisdiction:' '},[decisiveRow],false),false);
 assert.equal(applicabilityReviewReady({...data,facts:[{...data.facts[0],current:false}]},'register-1',7,resolvedTarget,[decisiveRow],false),false);
 assert.equal(applicabilityReviewReady({...data,matters:[{...data.matters[0],factIds:[]}]},'register-1',7,resolvedTarget,[decisiveRow],false),false);
});

test('unknown draft row may leave counterparty and selected facts unresolved',()=>{
 const data=fixture('draft');
 assert.equal(applicabilityReviewReady(data,'register-1',7,unknownTarget,[unknownRow],false),true);
 assert.equal(applicabilityReviewReady(data,'register-1',7,{...unknownTarget,jurisdiction:''},[unknownRow],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,unknownTarget,[{...unknownRow,reason:''}],false),false);
});

test('notice-required rows freeze complete distinct structured notice terms',()=>{
 const data=fixture();
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[{...decisiveRow,notice:null}],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[{...decisiveRow,notice:{...notice,trigger:' '}}],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[{...decisiveRow,notice:{...notice,recipients:[]}}],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[{...decisiveRow,notice:{...notice,recipients:['Customer legal team','Customer legal team']}}],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[{...decisiveRow,notice:{...notice,channel:''}}],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[{...decisiveRow,notice:{...notice,timing:''}}],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[decisiveRow],false),true);
 const noNotice={...decisiveRow,assessment:'no_notice' as const,notice:null};
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[noNotice],false),true);
 assert.equal(applicabilityReviewReady(data,'register-1',7,resolvedTarget,[{...noNotice,notice}],false),false);
 assert.equal(applicabilityReviewReady(data,'register-1',7,unknownTarget,[{...unknownRow,notice}],false),false);
});
