import {createHash} from 'node:crypto';
import {companyMemoryView} from './company-memory';
import {scopeAudienceHash} from './integrations/slack-scope';
import {interpretVoice,type VoiceInterpretationReview} from './voice-interpretation';
import {V2Error,type ActorContext,type Conversation,type WorkspaceState} from './contracts';

const fail=()=>new V2Error('VOICE_INTERPRETATION_CHANGED','Review and freeze the exact transcript, subject, names, dates and amounts again.');
/** Human confirmation binds the exact submitted bytes and currently accessible declared identities. */
export function verifyVoiceInterpretation(s:WorkspaceState,a:ActorContext,c:Conversation,transcript:string,review:VoiceInterpretationReview|undefined):string[]{
 if(!review||typeof review!=='object'||Array.isArray(review))throw new V2Error('VOICE_INTERPRETATION_REQUIRED','Freeze and confirm the interpreted transcript before sending a confirmed voice message.');
 const fields=['transcriptHash','subjectId','subjectHash','names','dates','amounts','ambiguityResolved'];
 if(Object.keys(review).some(key=>!fields.includes(key))||review.ambiguityResolved!==true||typeof review.transcriptHash!=='string'||!/^[a-f0-9]{64}$/.test(review.transcriptHash)||typeof review.subjectId!=='string'||typeof review.subjectHash!=='string'||!Array.isArray(review.names)||!Array.isArray(review.dates)||!Array.isArray(review.amounts))throw fail();
 const hash=createHash('sha256').update(transcript,'utf8').digest('hex');if(hash!==review.transcriptHash||review.subjectId!==(c.subjectEntityId||''))throw fail();
 const all=companyMemoryView(s,a),memory={...all,entities:all.entities.filter(e=>e.id!==s.entityId&&scopeAudienceHash(e.scope)===scopeAudienceHash(c.scope))};
 const current=interpretVoice(transcript,review.subjectId,memory);
 if(current.ambiguous.length||current.subjectHash!==review.subjectHash||JSON.stringify(current.names)!==JSON.stringify(review.names)||JSON.stringify(current.dates)!==JSON.stringify(review.dates)||JSON.stringify(current.amounts)!==JSON.stringify(review.amounts))throw fail();
 return [...new Set(current.names.map(name=>memory.entities.find(e=>e.id===name.id)!.declarationSourceId))];
}
