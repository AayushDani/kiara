import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import type {WorkspaceSnapshot} from '../../src/v2/contracts';

registerHooks({load(url,context,nextLoad){if(url.endsWith('.css'))return {format:'module',source:'export default {}',shortCircuit:true};return nextLoad(url,context)}});
const {eventLinkCandidates,eventLinkFingerprint,eventLinkReviewReady}=await import('../../src/ui/v2/EventLinkPanel');
const scope={kind:'team',actorIds:[]};
const command={type:'event.link_matter' as const,sourceId:'source-1',expectedSourceVersion:2,matterId:'matter-1',expectedMatterVersion:3};
function fixture(){return {version:8,actor:{id:'owner-1'},capabilities:['business_owner'],matters:[{id:'matter-1',title:'Review change',ownerId:'owner-1',version:3,state:'active',scope,sourceIds:[]}],sources:[{id:'source-1',title:'GitHub release',kind:'github',version:2,status:'active',scope,externalRevision:'abc123',text:'Release merged',contentHash:'content-hash',observation:{state:'current'},installationGrant:{installationId:'install-1'}}],events:[{id:'event-1',type:'event.ingest',recordId:'source-1',matterId:null}]} as unknown as WorkspaceSnapshot;}

test('only current authenticated unlinked same-audience provider events are offered',()=>{
 const data=fixture();
 assert.deepEqual(eventLinkCandidates(data,'matter-1').map(item=>item.id),['source-1']);
 assert.equal(eventLinkCandidates({...data,sources:[{...data.sources[0],observation:{...data.sources[0].observation!,state:'historical'}}]},'matter-1').length,0);
 assert.equal(eventLinkCandidates({...data,sources:[{...data.sources[0],kind:'manual'}]},'matter-1').length,0);
 assert.equal(eventLinkCandidates({...data,events:[]},'matter-1').length,0);
 assert.equal(eventLinkCandidates({...data,matters:[{...data.matters[0],sourceIds:['source-1']}]},'matter-1').length,0);
 assert.equal(eventLinkCandidates({...data,sources:[{...data.sources[0],scope:{kind:'private',actorIds:['owner']}}]},'matter-1').length,0);
});

test('review freezes exact source and matter versions and visible evidence',()=>{
 const data=fixture(),frozen=eventLinkFingerprint(data,command);
 assert.equal(eventLinkReviewReady(data,command,8,frozen),true);
 assert.equal(eventLinkReviewReady({...data,version:9},command,8,frozen),false);
 assert.equal(eventLinkReviewReady(data,{...command,expectedSourceVersion:1},8,frozen),false);
 assert.equal(eventLinkReviewReady(data,{...command,expectedMatterVersion:2},8,frozen),false);
 assert.equal(eventLinkReviewReady({...data,sources:[{...data.sources[0],text:'Different content'}]},command,8,frozen),false);
 assert.equal(eventLinkReviewReady({...data,capabilities:[]},command,8,frozen),false);
 assert.equal(eventLinkReviewReady({...data,actor:{...data.actor,id:'different-owner'}},command,8,frozen),false);
});
