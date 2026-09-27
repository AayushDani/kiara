import assert from 'node:assert/strict';
import {test} from 'node:test';
import {interpretVoice,voiceInterpretationCurrent} from '../../src/ui/v2/voice-interpretation';

test('ambiguous spoken numeric dates cannot be frozen as a resolved voice request',()=>{
 const heard=interpretVoice('Send the Acme notice on 09/10 for $5,000','');
 assert.deepEqual(heard.ambiguous,['09/10']);
 const corrected=interpretVoice('Discuss the Acme notice on 2026-09-10 for $5,000','');
 assert.deepEqual(corrected.ambiguous,[]);
 assert.deepEqual(corrected.dates,['2026-09-10']);
 assert.deepEqual(corrected.amounts,['$5,000']);
});

test('frozen voice interpretation fails after transcript or exact subject changes',()=>{
 const transcript='Discuss the notice on September 10, 2026 for $5,000';
 const current=interpretVoice(transcript,'');
 const frozen={transcript,subjectId:'',subjectHash:current.subjectHash,names:current.names,dates:current.dates,amounts:current.amounts};
 assert.equal(voiceInterpretationCurrent(frozen,transcript,'',undefined),true);
 assert.equal(voiceInterpretationCurrent(frozen,transcript.replace('$5,000','$50,000'),'',undefined),false);
 assert.equal(voiceInterpretationCurrent(frozen,transcript,'different',undefined),false);
 assert.deepEqual(interpretVoice('Discuss on September 10','').ambiguous,['September 10']);
});
