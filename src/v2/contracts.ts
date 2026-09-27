import type {EffortEntry,EffortBaseline,EffortComparison,MeasurementCommand} from './measurement';
import type {Obligation,ObligationCommand} from './obligations';
import type {AuthorityMaintenance,CoverageMaintenance,CoverageCommand} from './coverage';
import type {ExecutableLearning,ProcedureKey} from './procedures';
import type {CounselCommand} from './counsel';
import type {CounselLifecycle} from './sharing';
/** Kiara v2 contracts. Tenant and actor context are supplied by the authenticated server. */
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type Role = 'member'|'fact_owner'|'business_owner'|'legal_reviewer'|'publisher'|'signatory'|'admin'|'evaluator'|'integration';
export interface ActorContext {tenantId:string;actorId:string;expiresAt:number;mode:'local_demo'|'authenticated';bootstrapRoles?:Role[];installationId?:string;installationGrant?:{installationId:string;configurationHash:string}}
export interface Scope {kind:'private'|'team'|'matter';actorIds:string[];matterId?:string}
export interface Provenance {actorId:string;sourceIds:string[];factIds?:string[];messageId?:string;description:string}
export interface RecordBase {id:string;tenantId:string;version:number;createdAt:string;updatedAt:string;scope:Scope;provenance:Provenance}
export interface Membership {actorId:string;roles:Role[];version:number;expiresAt:string|null;revokedAt:string|null;matterIds:string[]|null;entityIds:string[]|null}
export interface Conversation extends RecordBase {title:string;entityId:string;reuse:'conversation_only'|'propose_memory';matterId:string|null;scenarioId:string|null}
export interface Message extends RecordBase {conversationId:string;role:'user'|'assistant';channel:'web'|'slack'|'voice';text:string;intent:'question'|'scenario'|'instruction'|'correction'|'preference'|'ambiguous';artifactIds:string[];citations:{sourceId:string;anchor:string;quote:string}[];generation:'human'|'bounded_local'|'model';retention:'workspace_policy';voiceConfirmed:boolean}
export interface Scenario extends RecordBase {conversationId:string;title:string;assumptions:string[];questions:string[];status:'exploring'|'adopted'|'withdrawn';adoptedMatterId:string|null;adoptionDecisionId:string|null}
export interface FactAssertion extends RecordBase {entityId:string;predicate:string;value:Json;status:'candidate'|'confirmed'|'disputed'|'superseded'|'unknown';practice:'planned'|'live'|'unknown';ownerId:string;observedAt:string;validFrom:string|null;validUntil:string|null;confirmedBy:string|null;confirmedAt:string|null;supersedesId:string|null;originVersion:number;reuse:'company'|'conversation_only';conversationId:string|null}
export interface Preference extends RecordBase {key:'response_length'|'interruptions'|'routing';value:string;target:'personal'|'team';ownerId:string;active:boolean}
export interface Source extends RecordBase {title:string;kind:'manual'|'github'|'slack'|'drive'|'legal';externalId:string|null;externalRevision:string|null;text:string;contentHash:string;url:string|null;status:'active'|'revoked'|'deleted';aclVersion:number;observedAt:string;effectiveAt:string|null;authority:'draft'|'executed'|'effective'|'template'|'unknown';originalObjectRef:string|null;installationGrant?:{installationId:string;configurationHash:string}}
export interface DocumentRecord extends RecordBase {documentId:string;title:string;body:string;contentHash:string;authority:Source['authority'];sourceId:string;revision:number;parentRevisionId:string|null;amendsDocumentId:string|null;status:'current'|'proposed'|'superseded';kind:'agreement'|'notice'|'template'|'draft'|'other'}
export interface LegalAuthority extends RecordBase, AuthorityMaintenance {title:string;sourceUrl:string;jurisdiction:string;domain:string;authorityType:'statute'|'regulation'|'guidance'|'contract'|'company_policy';publishedAt:string|null;effectiveFrom:string|null;effectiveUntil:string|null;verifiedAt:string|null;reviewOwnerId:string|null;sourceId:string}
export interface CoverageEntry extends RecordBase, CoverageMaintenance {domain:string;jurisdiction:string;sourceIds:string[];ownerId:string|null;qualifiedReviewerId:string|null;status:'available'|'stale'|'unsupported'|'pending_review';reviewedAt:string|null;reviewDueAt:string|null;limitations:string[]}
export type MatterState = 'observed'|'triaging'|'needs_facts'|'proposed'|'business_review'|'legal_review'|'authorized_action'|'executing'|'verifying'|'closed'|'canceled';
export interface MatterTask {id:string;title:string;ownerId:string;status:'pending'|'done'|'blocked';kind:'fact'|'business'|'legal'|'action'|'verification';dueAt:string|null;deadlineType:'contractual'|'legal'|'launch_target'|'response_target'|'undated';evidenceIds:string[]}
export interface Matter extends RecordBase {title:string;objective:string;entityId:string;state:MatterState;ownerId:string;conversationIds:string[];scenarioId:string|null;eventIds:string[];sourceIds:string[];factIds:string[];documentIds:string[];proposalId:string|null;tasks:MatterTask[];blockers:string[];outcome:string|null;closedAt:string|null;ruleVersion:number;legacyWorkflowId?:string;correlationKeys?:string[]}
export interface DependencySnapshot {sourceVersions:Record<string,number>;factVersions:Record<string,number>;documentHashes:Record<string,string>;policyVersion:number;scopeHash:string}
export interface Proposal extends RecordBase {matterId:string;title:string;body:string;contentHash:string;baselineRevisionIds:string[];dependencies:DependencySnapshot;status:'current'|'superseded'|'invalidated';route:'standing_policy'|'legal_review';noticeMatrix:{documentId:string;title:string;clause:string;status:'review_required'|'confirmed'|'unknown'}[];inventoryComplete:boolean;unknowns:string[];supersedesId:string|null}
export interface Approval extends RecordBase {matterId:string;proposalId:string;proposalHash:string;actionId:string|null;actionHash:string|null;capacity:'business'|'legal'|'sharing'|'publication'|'signature'|'no_action';actorId:string;membershipVersion:number;dependencies:DependencySnapshot;conditions:string[];recipients:string[];destination:string|null;validUntil:string;status:'active'|'invalidated'|'revoked';note:string}
export interface Action extends RecordBase {matterId:string;proposalId:string;kind:'publish'|'send'|'signature_request'|'internal_document'|'product_change'|'no_action';title:string;content:string;contentHash:string;recipients:string[];destination:string|null;status:'planned'|'authorized'|'pending_manual'|'dispatching'|'uncertain'|'verifying'|'verified'|'failed'|'canceled';authorizationId:string|null;providerIdempotencyKey:string;providerReceipt:string|null;completion:{kind:'readback'|'human_attestation'|'executed_agreement';artifact:string;verifierId:string;verifiedAt:string}|null;executionOwner:'v2'|'legacy';leaseUntil:string|null}
export interface CounselEngagement extends RecordBase, CounselLifecycle {matterId:string;route:'existing'|'referral';providerName:string|null;recipient:string|null;status:'intake_pending'|'unavailable'|'sharing_pending'|'engagement_pending'|'review_pending'|'returned'|'complete';conflictsCleared:boolean;sharingApprovalId:string|null;approvedSourceIds:string[];terms:string|null;feeCap:number|null;currency:string;responseDueAt:string|null;ownerId:string;packet:string;returnedProposalId:string|null}
export interface LearningCandidate extends RecordBase, ExecutableLearning {title:string;rule:string;kind:'procedure'|'legal_playbook';scopeDescription:string;originMatterId:string;status:'candidate'|'evaluated'|'promoted'|'rolled_back'|'rejected';tests:{name:string;group:'original'|'near_miss'|'holdout';passed:boolean;evidence:string}[];evaluationHash:string|null;evaluatedBy:string|null;approvedBy:string|null;effectiveVersion:number|null;rollbackVersion:number|null;affectedMatterIds:string[]}
export interface Connection extends RecordBase {provider:'github'|'slack'|'drive'|'manual';status:'unconfigured'|'connected'|'stale'|'revoked';selectedScopes:string[];lastSyncAt:string|null;cursor:string|null;limitations:string[]}
export interface ActivityEvent extends RecordBase {type:string;title:string;detail:string;matterId:string|null;recordId:string|null;measurement:'observed'|'estimate'|'fictional_rehearsal'}
export interface OutboxEntry {id:string;tenantId:string;kind:'matter_changed'|'external_action'|'conversation_answer'|'effect_reconcile';aggregateId:string;commandId:string;status:'pending'|'dispatched'|'canceled';owner:'v2'|'legacy';createdAt:string}
export interface ConversationRunView {id:string;conversationId:string;userMessageId:string;status:'queued'|'running'|'complete'|'blocked'|'unknown';reason:string|null;assistantMessageId:string|null;createdAt:string;updatedAt:string}
export interface Tombstone {sourceId:string;deletedAt:string;reason:string;backupExpiresAt:string|null}
export interface WorkspaceState {effortEntries?:EffortEntry[];effortBaselines?:EffortBaseline[];obligations?:Obligation[];schemaVersion:2;tenantId:string;version:number;companyName:string;entityId:string;rehearsal:boolean;memberships:Membership[];conversations:Conversation[];messages:Message[];scenarios:Scenario[];facts:FactAssertion[];preferences:Preference[];sources:Source[];documents:DocumentRecord[];legalAuthorities:LegalAuthority[];coverage:CoverageEntry[];matters:Matter[];proposals:Proposal[];approvals:Approval[];actions:Action[];counsel:CounselEngagement[];learning:LearningCandidate[];connections:Connection[];events:ActivityEvent[];outbox:OutboxEntry[];tombstones:Tombstone[];receipts:Record<string,{hash:string;result:Record<string,unknown>}>;ruleVersion:number;migration:{sourceHash:string;legacyArchive:unknown;importedAt:string;effectOwner:'legacy';status:'imported_read_only'}|null}
export interface WorkspaceSnapshot extends Omit<WorkspaceState,'receipts'|'memberships'|'migration'|'outbox'> {effortComparisons:EffortComparison[];actor:{id:string;roles:Role[];mode:ActorContext['mode']};capabilities:Role[];limitations:string[];migrationStatus:string|null;aiMode:'local'|'openai'|'invalid';aiRuns:ConversationRunView[]}
export type WorkspaceCommand = MeasurementCommand | ObligationCommand | CoverageCommand | CounselCommand
 | {type:'company.configure';name:string}
 | {type:'demo.load'}
 | {type:'conversation.create';title?:string;scope?:Scope;reuse?:Conversation['reuse']}
 | {type:'message.send';text:string;conversationId?:string;scope?:Scope;channel?:Message['channel'];voiceConfirmed?:boolean}
 | {type:'scenario.update';scenarioId:string;assumptions:string[];expectedRecordVersion:number}
 | {type:'scenario.adopt';scenarioId:string;expectedRecordVersion:number;objective?:string}
 | {type:'fact.propose';predicate:string;value:Json;practice?:FactAssertion['practice'];sourceIds?:string[];conversationId?:string;reuse?:FactAssertion['reuse'];supersedesId?:string}
 | {type:'fact.confirm';factId:string;expectedRecordVersion:number;expectedOriginVersion:number}
 | {type:'preference.set';key:Preference['key'];value:string;target:'personal'|'team'}
 | {type:'document.add';title:string;body:string;authority:Source['authority'];kind?:DocumentRecord['kind'];scope?:Scope;amendsDocumentId?:string}
 | {type:'matter.create';title:string;objective:string;conversationId?:string;scope?:Scope}
 | {type:'matter.prepare';matterId:string;expectedRecordVersion:number}
 | {type:'matter.cancel';matterId:string;reason:string;expectedRecordVersion:number}
 | {type:'matter.close';matterId:string;reason:string;expectedRecordVersion:number;noAction?:boolean}
 | {type:'proposal.revise';proposalId:string;body:string;expectedRecordVersion:number}
 | {type:'approval.record';proposalId:string;proposalHash:string;capacity:Approval['capacity'];validUntil:string;note?:string;recipients?:string[];destination?:string;conditions?:string[]}
 | {type:'action.plan';matterId:string;proposalId:string;kind:Action['kind'];title:string;content:string;recipients?:string[];destination?:string}
 | {type:'action.authorize';actionId:string;contentHash:string;expectedRecordVersion:number;validUntil:string}
 | {type:'action.attest';actionId:string;expectedRecordVersion:number;artifact:string;completionKind:'human_attestation'|'executed_agreement'}
 | {type:'counsel.request';matterId:string;route:'existing'|'referral';providerName?:string;recipient?:string;sourceIds?:string[];feeCap?:number;terms?:string}
 | {type:'source.revoke';sourceId:string;reason:string;delete?:boolean}
 | {type:'learning.propose';matterId:string;title:string;rule:string;kind:LearningCandidate['kind'];scopeDescription:string;procedureKey?:ProcedureKey}
 | {type:'learning.run_evaluation';candidateId:string;expectedRecordVersion:number}
 | {type:'learning.evaluate';candidateId:string;tests:LearningCandidate['tests'];expectedRecordVersion:number}
 | {type:'learning.promote';candidateId:string;evaluationHash:string;expectedRecordVersion:number}
 | {type:'learning.renew';candidateId:string;expectedRecordVersion:number;evaluationHash:string}
 | {type:'learning.rollback';candidateId:string;expectedRecordVersion:number;reason:string}
 | {type:'event.ingest';provider:'github'|'slack'|'drive'|'manual';externalEventId:string;externalObjectId:string;externalRevision:string;occurredAt:string;title:string;text:string;matterId?:string;correlationKey?:string;scope?:Scope}
 | {type:'membership.revoke';actorId:string};
export interface CommandEnvelope {idempotencyKey:string;expectedVersion:number;command:WorkspaceCommand}
export interface CommandResult {snapshot:WorkspaceSnapshot;result:Record<string,unknown>;replayed:boolean}
export class V2Error extends Error {constructor(public code:string,message:string,public status=409){super(message);this.name='V2Error';}}
