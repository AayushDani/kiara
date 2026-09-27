import {canRead,membership} from './authority';
import type {ActorContext,FactAssertion,LearningCandidate,Matter,WorkspaceState} from './contracts';
import {digest} from './store';
import {protectedProcedureCorpus} from './evaluation-corpus';
export type ProcedureKey='release_evidence_before_live_claim';
export const PROCEDURES=Object.freeze({release_evidence_before_live_claim:{title:'Require current release evidence before live deployment claims',description:'For confirmed deployment or production_deployment facts labeled live, require a confirmed, live production_release_verified=true assertion with at least one currently authorized active source. Planned practice is not deployment.'}});
export interface ProcedureInput {claimsLive:boolean;releaseConfirmation:'current'|'absent'|'revoked'|'planned';authorized:boolean}
export type ProcedureOutcome='ready'|'needs_release_evidence'|'denied';
/** Finite executable guard; neither free text nor model output can replace this function. */
export function runProcedure(input:ProcedureInput,enabled:boolean):ProcedureOutcome {if(!input.authorized)return 'denied';if(enabled&&input.claimsLive&&input.releaseConfirmation!=='current')return 'needs_release_evidence';return 'ready';}
export function procedureInput(s:WorkspaceState,a:ActorContext,facts:FactAssertion[]):ProcedureInput {
 const claims=facts.filter(f=>['deployment','production_deployment'].includes(f.predicate)&&f.status==='confirmed'&&f.practice==='live');
 const release=facts.find(f=>f.predicate==='production_release_verified'&&f.status==='confirmed'&&f.value===true);
 const current=(f:FactAssertion)=>canRead(s,a,f)&&(!f.validUntil||Date.parse(f.validUntil)>Date.now())&&(!f.validFrom||Date.parse(f.validFrom)<=Date.now());
 const releaseConfirmation:ProcedureInput['releaseConfirmation']=!release?'absent':!current(release)||!release.provenance.sourceIds.length||release.provenance.sourceIds.some(id=>!s.sources.some(src=>src.id===id&&src.status==='active'&&canRead(s,a,src)))?'revoked':release.practice!=='live'?'planned':'current';
 return {claimsLive:claims.length>0,releaseConfirmation,authorized:claims.every(current)};
}
export interface ProcedureEvaluation {suiteVersion:string;corpusHash:string;runAt:string;baselineFailures:number;candidateFailures:number;totalCaseCount:number;withheldHoldoutCount:number;cases:{id:string;group:'original'|'near_miss'|'holdout';expected:ProcedureOutcome;baseline:ProcedureOutcome;candidate:ProcedureOutcome;passed:boolean}[];qualification:'deterministic_replay_not_legal_quality';inputHash:string;baselinePolicyVersion:number;membershipVersion:number}
export interface ExecutableLearning {procedureKey?:ProcedureKey;evaluation?:ProcedureEvaluation;reviewDueAt?:string;effectSummary?:string;originInput?:ProcedureInput;originInputHash?:string;approvalMembershipVersion?:number;appliedMatterIds?:string[]}
export function activeProcedures(s:WorkspaceState,a:ActorContext,m:Matter):LearningCandidate[]{return s.learning.filter(l=>l.status==='promoted'&&l.procedureKey&&l.effectiveVersion!==null&&l.effectiveVersion<=s.ruleVersion&&digest(l.scope)===digest(m.scope));}
export function procedureAssessment(s:WorkspaceState,a:ActorContext,m:Matter){
 const facts=m.factIds.map(id=>s.facts.find(f=>f.id===id)).filter((f):f is FactAssertion=>!!f),input=procedureInput(s,a,facts);const lessons=activeProcedures(s,a,m);
 const blockers:string[]=[];
 for(const lesson of lessons){if(!canRead(s,a,lesson)){blockers.push('An applicable approved procedure has unavailable evidence and requires owner review.');continue;}const owner=s.memberships.find(x=>x.actorId===lesson.approvedBy);if(!owner||owner.revokedAt||owner.version!==lesson.approvalMembershipVersion||!owner.roles.includes(lesson.kind==='legal_playbook'?'legal_reviewer':'business_owner')||(owner.expiresAt&&Date.parse(owner.expiresAt)<=Date.now())||!lesson.reviewDueAt||Date.parse(lesson.reviewDueAt)<=Date.now())blockers.push(`Approved procedure ${lesson.title} requires owner review before further action.`);else if(runProcedure(input,true)!=='ready')blockers.push(`Approved procedure: ${PROCEDURES[lesson.procedureKey!].description}`);}
 return {lessons,input,blockers};
}
/** Full holdout labels live only in protected receipts. Candidate authors never receive them. */
export function learningViews(s:WorkspaceState,a:ActorContext):LearningCandidate[]{const member=membership(s,a);return s.learning.filter(l=>canRead(s,a,l)).map(lesson=>{const safe=structuredClone(lesson),independent=member.roles.includes('evaluator')&&lesson.provenance.actorId!==a.actorId;safe.tests=safe.tests.filter(t=>t.group!=='holdout');if(safe.evaluation){safe.evaluation.cases=safe.evaluation.cases.filter(t=>t.group!=='holdout');if(independent&&safe.evaluationHash){const recorded=s.receipts[`learning-evaluation:${safe.evaluationHash}`]?.result.evaluation as ProcedureEvaluation|undefined;if(recorded?.corpusHash===safe.evaluation.corpusHash){safe.evaluation=structuredClone(recorded);safe.evaluation.withheldHoldoutCount=0;safe.tests=recorded.cases.map(t=>({name:t.id,group:t.group,passed:t.passed,evidence:`frozen:${recorded.corpusHash}:${t.id}`}));}}}return safe;});}
export function evaluateProcedure(original:ProcedureInput,baselineEnabled:boolean){
 // Original-case label follows the declared protocol independently of mutable candidate prose.
 const expected:ProcedureOutcome=!original.authorized?'denied':original.claimsLive&&original.releaseConfirmation!=='current'?'needs_release_evidence':'ready';
 const corpus=[{id:'frozen-origin-matter',group:'original' as const,input:structuredClone(original),expected},...protectedProcedureCorpus().cases];
 const cases=corpus.map(c=>{const baseline=runProcedure(c.input,baselineEnabled),candidate=runProcedure(c.input,true);return {id:c.id,group:c.group,expected:c.expected,baseline,candidate,passed:candidate===c.expected};});
 return {suiteVersion:'release-evidence-protocol-1',corpusHash:digest(corpus),cases,baselineFailures:cases.filter(c=>c.baseline!==c.expected).length,candidateFailures:cases.filter(c=>!c.passed).length};
}
