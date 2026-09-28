import {createHash} from 'node:crypto';
import type {ProcedureInput,ProcedureOutcome} from './procedures';

// Node-only module: importing this from a client entry is a build error.
/** Fixed labels are operator-owned regression evidence; no request can supply its pass results. */
const FIXTURES:ReadonlyArray<{id:string;group:'near_miss'|'holdout';input:ProcedureInput;expected:ProcedureOutcome}>=Object.freeze([
 {id:'planned-is-not-a-live-claim',group:'near_miss',input:{claimsLive:false,releaseConfirmation:'absent',authorized:true},expected:'ready'},
 {id:'live-with-attributed-release',group:'near_miss',input:{claimsLive:true,releaseConfirmation:'current',authorized:true},expected:'ready'},
 {id:'merged-pr-is-not-release-confirmation',group:'holdout',input:{claimsLive:true,releaseConfirmation:'absent',authorized:true},expected:'needs_release_evidence'},
 {id:'revoked-release-cannot-support-live-claim',group:'holdout',input:{claimsLive:true,releaseConfirmation:'revoked',authorized:true},expected:'needs_release_evidence'},
 {id:'planned-release-cannot-support-live-claim',group:'holdout',input:{claimsLive:true,releaseConfirmation:'planned',authorized:true},expected:'needs_release_evidence'},
 {id:'unauthorized-evidence-stays-denied',group:'holdout',input:{claimsLive:true,releaseConfirmation:'current',authorized:false},expected:'denied'},
]);

export function protectedProcedureCorpus(){return {cases:structuredClone(FIXTURES),digest:createHash('sha256').update(JSON.stringify(FIXTURES)).digest('hex')};}
