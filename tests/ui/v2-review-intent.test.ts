import assert from 'node:assert/strict';
import test from 'node:test';
import {proposalPreviewCurrent,actionPreviewCurrent,counselPreviewCurrent,lessonOriginCurrent,selectedLessonOrigin} from '../../src/ui/v2/review-intent';

test('a review preview cannot follow a newly polled proposal or lost access',()=>{
  const inspected={id:'proposal-v3',version:3,contentHash:'content-3'};
  assert.equal(proposalPreviewCurrent(inspected,{...inspected,status:'current'}),true);
  assert.equal(proposalPreviewCurrent(inspected,{...inspected,id:'proposal-v4',contentHash:'content-4',status:'current'}),false);
  assert.equal(proposalPreviewCurrent(inspected,{...inspected,version:4,status:'current'}),false);
  assert.equal(proposalPreviewCurrent(inspected,{...inspected,status:'invalidated'}),false);
  assert.equal(proposalPreviewCurrent(inspected,undefined),false);
});

test('an action preview rejects changed recipients/content, dispatch and withdrawn access',()=>{
  const inspected={id:'action-1',version:1,contentHash:'content-and-destination'};
  assert.equal(actionPreviewCurrent(inspected,{...inspected,status:'planned'}),true);
  assert.equal(actionPreviewCurrent(inspected,{...inspected,contentHash:'different-recipient',status:'planned'}),false);
  assert.equal(actionPreviewCurrent(inspected,{...inspected,version:2,status:'planned'}),false);
  assert.equal(actionPreviewCurrent(inspected,{...inspected,status:'pending_manual'}),false);
  assert.equal(actionPreviewCurrent(inspected,{...inspected,status:'uncertain'}),false);
  assert.equal(actionPreviewCurrent(inspected,undefined),false);
});

test('a counsel decision rejects changed scope, recipient, lifecycle or withdrawn access',()=>{
  const inspected={id:'counsel-1',version:3,packetHash:'full-sources-terms-fees',counselActorId:'reviewer-1'};
  assert.equal(counselPreviewCurrent(inspected,{...inspected}),true);
  assert.equal(counselPreviewCurrent(inspected,{...inspected,packetHash:'changed-source-record'}),false);
  assert.equal(counselPreviewCurrent(inspected,{...inspected,counselActorId:'reviewer-2'}),false);
  assert.equal(counselPreviewCurrent(inspected,{...inspected,version:4}),false);
  assert.equal(counselPreviewCurrent(inspected,undefined),false);
});

test('lesson origin preview never follows a previous Work selection or changed matter',()=>{
 const selected={id:'matter-b',version:3,title:'Second project',scope:{kind:'team' as const,actorIds:[]}};
 const matters=[{...selected,id:'matter-a',title:'Previous Work project'},selected];
 assert.equal(selectedLessonOrigin(matters,''),undefined);
 assert.equal(selectedLessonOrigin(matters,'missing'),undefined);
 assert.equal(selectedLessonOrigin(matters,selected.id),selected);
 assert.equal(lessonOriginCurrent(selected,{...selected}),true);
 assert.equal(lessonOriginCurrent(selected,{...selected,id:'matter-a',title:'Previous Work project'}),false);
 assert.equal(lessonOriginCurrent(selected,{...selected,version:4}),false);
 assert.equal(lessonOriginCurrent(selected,{...selected,title:'Renamed project'}),false);
 assert.equal(lessonOriginCurrent(selected,{...selected,scope:{kind:'private',actorIds:['owner']}}),false);
 assert.equal(lessonOriginCurrent(selected,undefined),false);
});
