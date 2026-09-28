# Platform contracts and initial implementation checkpoint

Source coverage: read the complete 403-line authoritative `docs/product-plan/kiara-product-plan-v2.md`, complete 223-line supporting `cto-architecture.md`, and complete 1,911-line `docs/platform-review/current-state-report.md`, including every specialist/cross-review. Inspected current `src/server/auth.ts`, `contracts.ts`, `src/data/store.ts`, `physical.ts`, and workflow engine. V2 controls below are additive; historical tests are not today's qualification.

## Shared executable boundary

`src/v2/contracts.ts` defines Conversation, Message, Scenario, FactAssertion, Preference, LegalAuthority, CoverageEntry, Matter, Proposal, Approval, Action, CounselEngagement and LearningCandidate, plus current memberships, immutable document revisions, sources, activity, durable outbox and deletion tombstones. Every content record includes stable id, tenantId, version, timestamps, visibility scope and provenance; facts retain planned/live distinction and observed/effective time fields. Provenance includes both source and fact dependencies so a private fact cannot leak through a shared summary or proposal.

`src/v2/service.ts` exports:

```ts
snapshot(actor: ActorContext): Promise<WorkspaceSnapshot>
command(actor: ActorContext, envelope: CommandEnvelope,
  trusted?: {originalObjectRef?: string}): Promise<CommandResult>
```

Actor identity and tenant are server-derived. Authenticated mode requires a persisted active membership. Only the explicitly simulated local mode may create an initial local role membership. Role changes are not copied from subsequent session assertions. No command accepts client tenant, actor, grants or an original-object storage pointer. The trusted upload argument is server-only and is included in the idempotency digest.

Commands require `{idempotencyKey, expectedVersion, command:{type,...}}`; unknown command fields reject. Exact replay returns the saved result before checking stale workspace version. Changed content under a reused key conflicts. All new commands check the workspace CAS; inspected scenario/fact/proposal/action controls add object-version/hash guards. V2Error provides `code`, `message`, `status` for the HTTP adapter.

Membership roles separate member, fact owner, business owner, legal reviewer, publisher, signatory, admin, evaluator and integration. Membership expiry/revocation and resource scope are checked in services. Empty team participant lists mean all eligible workspace members; a nonempty team list is restrictive. Matter-restricted counsel cannot browse global team records, and must receive explicitly scoped packet sources. Private facts and their derived responses retain restrictions.

## Requirement decisions

| Contract/source | Implementation and invariant | Evidence / remaining scope |
|---|---|---|
| V2 §§3–5 conversation/scenario/memory | Empty customer workspace; optional explicit local fictional rehearsal; explanations do not create matters; scenario assumptions stay isolated; adoption creates exactly one matter; candidate facts need owner confirmation; personal preferences are owner scoped | Platform tests cover no integrations, ambiguity, unconfirmed voice, unauthorized correction, stale fact replacement, scope isolation. Local answer generation is explicitly `bounded_local`; real model adapter is a separate workstream |
| V2 §§7,9,13 access and authority | Tenant storage key derived from auth; membership roles/expiry/revocation; selected team/private/matter scopes; source and fact dependency eligibility rechecked before snapshot/retrieval; revoked records and derived text are denied | Local adversarial access tests, including stale retained derived text. Background indexes are not relied on for authorization |
| V2 §§9,11 human intent | Approval binds proposal hash, snapshot, source/fact/doc/rule versions, capacity, membership version, exact action content, recipients/destination and expiry; changed inputs invalidate gates | Stale proposal, canceled matter, conditioned approval, missing original, expiry, and arbitrary action text reject. Browser frozen-target evidence belongs to UI review |
| V2 §11 completion | Action stays pending manual without configured broker; exact reviewed content required; human attestation distinguished from read-back; signature completion requires retained executed original; unresolved effects/tasks block closure, including no-action closure | Simulated/local command tests. No claim of publication, send, signing or qualified review from local success |
| V2 §§6,13 durable intake | Installation role and identity for nonmanual events; provider event fingerprint dedupe; source and event/outbox stored atomically; explicit matter links/exact correlation keys; event itself cannot confirm deployment | Local receipt/outbox/replay tests. Actual provider signature/reconciliation adapters are owned by integration worker |
| V2 §12 learning | Candidate author cannot evaluate own candidate; evaluator role records original/near-miss/holdout evidence; owner approval binds evaluation hash; version promotion/rollback retained | This is independently attributed manual evidence, not an executed model comparison or expert-validation result. Fully frozen automatic benchmarking and changed later behavior remain open |
| User migration mandate/B14 | Additive v2 state and collection; no legacy schema replacement or customer-data reset; archive/read-only legacy import belongs to lead migration module; v2 rejects mutation/effects on legacy-owned matter | Store backup checksum/dry run/restore and tombstone tests pass. Production cutover/rollback and managed provider replay remain unqualified |

## Technology decisions and tradeoffs

Retain the modular TypeScript application and installed MongoDB driver. V2 uses an independent `v2_workspaces` Mongo aggregate with CAS; local development uses per-tenant, hash-verified atomic envelopes, fsync/rename, process-aware locks and a bounded 12 MB capacity. This makes identity, state, receipts and outbox atomic without pretending there is an Atlas–Temporal transaction. It deliberately preserves the legacy store and controls while the new customer journey is integrated.

The aggregate is a temporary bounded implementation, not evidence of scalable per-record Atlas architecture. Normalized records and Atlas keyword/vector indexes need a measured backfill/cutover and retrieval benchmark. No separate graph database is justified by current evidence. Both adapters fail closed on hosted deployments without Mongo configuration; no silent ephemeral fallback is allowed. Mongo code is implemented but live Atlas transactions/failover have not been exercised.

Managed Temporal remains the target orchestration boundary. Existing Workflow orchestration owns old effects; v2 outbox rows are explicitly owned by v2. No v2 process consumes legacy notification/provider intents. Integration worker owns the managed Temporal adapter and outbox dispatcher; the app must not claim managed operation merely because that adapter compiles. External effects need action-specific broker idempotency and reconciliation even after Temporal integration.

Lead owns encrypted local/S3 original storage and setup. Document text intake makes no claim of preserving original bytes unless the trusted upload handler supplies the immutable encrypted object reference. Models never receive execution credentials.

## Migration and restore gates

1. Take an immutable backup with source-byte hashes, state version, approvals/receipts, pending and unknown outcomes, and tombstone ledger; run a dry run before mutation.
2. Import additive records/archive under a migration identity; leave legacy workflows/effects owned by legacy. Replay of the migration ID must return its saved report, not duplicate records.
3. Resolve or explicitly retain legacy unknown sends/model charges and in-flight waits. Never infer success from archived internal finalization.
4. A future execution cutover needs a single durable ownership fence shared with the legacy dispatcher. Until that fence is implemented and qualified, imported work remains read-only and execution remains legacy-owned.
5. Restore into an isolated recovery store whenever live state differs from the backup, even if activity events have not changed. Verify hashes, restore source originals separately, and reconcile current tombstones, membership revocations, command receipts and uncertain/completed action records before serving.
6. Rollback cannot erase dispatched effects or resurrect withdrawn source content. The store accepts an empty target or an exact replay and refuses a divergent active target during both dry run and apply.

Current deletion denies originals and derived records immediately and redacts local source/document text. Full physical purging of all derived payloads, object-store versions/backups and retention exceptions is not yet implemented and must not be called completed deletion.

## Owned paths, verification and handoff

Platform owner changed `src/v2/contracts.ts`, `store.ts`, `authority.ts`, `service.ts`, `tests/v2-platform.test.ts`, this record and its test log. Lead owns API/auth, encrypted originals and migration; UI owner consumes the same types; integration owner adds connector/Temporal adapters. No legacy application file was changed by this platform workstream.

On the integrated working tree, pinned Node 24.19.0 ran:

```sh
/Users/aayushdani/.npm/_npx/09ae5d3560c7b1f2/node_modules/node/bin/node --import tsx --test tests/v2-platform.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

19 platform tests pass, 0 fail. TypeScript passes. Raw output: `docs/kiara-delivery/evidence/v2-platform-tests.log`. Tests use isolated temporary stores and simulated role/provider states; no paid model call, live email, customer data, Atlas mutation or public deployment was made. Tests establish local service invariants; neither author assertion nor manual evidence certifies legal quality.

Independent review: regression reviewer identified restrictive-team and derived-private-fact leaks; lead identified restricted-counsel access and five completion/authority defects. Repairs and dedicated tests are present. Re-review requested; author does not self-approve.

Outstanding platform work: actual authenticated participant invitations/delegation management; scoped counsel sharing/returned-edit/fee engagement gates; source-to-source version/revocation sync; all-facts contradiction handling; per-agreement inventory attestation and clause quality evaluation; durable bounded model gateway; evaluation runner/holdout custody and demonstrated later lesson behavior; physical deletion traversal; broker dispatch/read-back/reconciliation; managed-service and browser qualification. Unsupported capabilities stay visibly pending.


## Later integrated waves

The initial checkpoint above is historical. Current bounded AI/knowledge work is documented in `ai-knowledge.md`; maintained sources and executed deterministic procedure comparisons are documented in `learning-coverage.md`. Counsel sharing/returned edits, selected-source installation fencing and execution adapters are now separate implemented workstreams with their own tests and independent findings. They still require connected-provider and production qualification. Current tests supersede the initial 19-test count; do not treat the historical outstanding list as current delivery status.
