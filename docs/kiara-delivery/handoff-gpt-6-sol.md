# Kiara v2 — GPT-6 Sol takeover

Prepared September 27, 2026. This is the current execution checkpoint; it supersedes chronological status statements in older delivery notes. It supplements, and does not narrow, the original user brief or target product contract.

## 1. Authorization, objective and model

The user explicitly requested a new chat on **GPT-6 Sol, high reasoning effort**, and authorized that team to use Sol/high subagents to finish the entire product. They called it “Soul”; the available model identifier is `gpt-6-sol`. They want a detailed transfer and implementation through completion, not another plan or a reduced demonstration. Prior usage-related stop markers are superseded for the successor chat by this instruction. The old chat and its three agents cease engineering; the successor is the sole integration owner.

Use Sol/high for the lead and every engineering/review agent. Inherit the new chat's selected settings. If explicitly setting subagent overrides, use `gpt-6-sol` and `high` with a supported limited/no-history fork; full-history forks inherit settings and do not accept overrides. Actual capacity was four total slots, lead plus three workers; inspect the successor's available capacity and use waves. Do not switch to Astra, raise global limits, or create more user-owned chats or automations. The user specifically authorized this one new chat as an exception to the original brief's same-chat delegation rule.

The full objective is to implement and independently qualify Kiara v2 in this repository, preserving controls and data while delivering integrated customer flows, durable services, migrations, evidence traceability and truthful external qualification gaps. Use persistent goal tracking without inventing a token budget, as the original brief requests. Do not mark the full goal complete while essential capabilities or required qualification are absent. Respect the goal tool's rules for external blockers.

Usage matters: avoid restarting discovery, duplicating completed modules, repeated full-suite runs on unchanged code, long recursive critique loops and documentation churn. This is an efficiency requirement, not permission to reduce product scope, skip independent review or invent evidence. The backlog below is grounded in inspection, but is not a guaranteed exhaustive estimate; reconcile it with the complete target. There is no defensible exact completion percentage or fixed time promise.

## 2. Read these authoritative inputs

Repository: `/Users/aayushdani/Documents/ChatGPT/Kiara`.

1. Full original user execution brief: `/Users/aayushdani/.codex/attachments/1b945d51-4364-40a2-9275-5e0bf36d4672/Pasted text.txt`. Read completely. It specifies autonomy, authority, team review, delivery and completion conditions.
2. `docs/product-plan/kiara-product-plan-v2.md` — complete authoritative target, all 17 sections. Sections 15–17 require the whole reference journey, all 16 acceptance stories and five deliverables.
3. `docs/platform-review/current-state-report.md` — full baseline findings and cross-reviews. Treat it as historical evidence; verify today's code.
4. `AGENTS.md` and applicable nested instructions. Before Next.js code, read the relevant installed guide in `node_modules/next/dist/docs/`.
5. Current delivery ledger: `docs/kiara-delivery/product-acceptance.md`, `regression-qualification.md`, `platform-contracts.md`, and this checkpoint. Track F01–F18 and B01–B15 through exact evidence.

Older product architecture, workflows, screen specifications, positioning and renders under `docs/product-plan/` are supporting references only when consistent with v2. The navigation is **Kiara · Work · Documents · Company · Activity**, not the old Inbox-first concept. Public headline: “Talk to Kiara. Keep legal in step with your business.”

Reports are untracked and present in this checkout. Do not lose them by switching to a clean worktree. The successor is intentionally created in this existing local project, retaining all source material and unfinished code.

## 3. Verified repository and process state

- Branch: `codex/kiara-v2`.
- Latest committed checkpoint: **`3678797` — Checkpoint scoped engagement, intake, learning and task controls**.
- Earlier integrated commits: `3bfafab` scoped drafting/source chronology/attention; `02f28f4` collaboration/retention/storage migration; `9d8e662` integrated workspace and preserved legacy controls.
- Old agents `/root/platform_contracts`, `/root/product_acceptance`, `/root/regression_qualification` were all **interrupted**, verified at handoff. Do not message/restart them to write concurrently. Spawn successor-owned agents.
- Existing loopback preview: `http://localhost:3091/`, `/welcome` public page, `/legacy` retained old interface. Listener rechecked: node PID **72982**, bound **127.0.0.1:3091**. Historical exec session **41942** may not be usable from another chat; inspect before relying on it.
- No full live worker fleet was started. Do not silently start workers against inherited credentials.

Dirty state immediately before adding this handoff:

```text
 M README.md
 M kiara-architecture/validation/storage-results.json
?? deliverables/
?? docs/kiara-build-prompt.md
?? docs/kiara-delivery/company-memory.md
?? docs/kiara-delivery/evidence/company-memory-tests.log
?? docs/kiara-delivery/evidence/dev-server.log
?? docs/platform-review-prompt.md
?? docs/platform-review-research.md
?? docs/platform-review/
?? docs/product-plan/
?? docs/verification/conservative-unknown-charge.json
?? docs/verification/production-new-demo.json
?? docs/verification/provider-acceptance-complete.json
?? src/v2/company-memory-validity.ts
?? src/v2/company-memory.ts
?? tests/v2-company-memory.test.ts
```

Preserve all entries. The two memory source files, test and memory note/log are unfinished team work to integrate. The main README, storage result, report/prompt/deliverable and verification files include prior user work; do not blanket-stage, reset, clean or overwrite them. This handoff and the delivery README takeover notice are the only intended new handoff edits. Initial status record: `/private/tmp/kiara-v2-initial-git-status.txt`.

Only the successor lead stages, commits or changes branches. Agree ownership of shared contracts, service dispatcher, persistence, routing and global styles before parallel edits. Local commits on the current branch are authorized; public deployment, protected-branch merges and blanket staging are not implied. `.git` was read-only in the sandbox, so selective staging/commits needed the normal escalation review. Do not treat successful past approval as a way to bypass a later rejection.

Runtime is **Node 24**, not the shell's Node 26. Known installed binary:

```sh
/Users/aayushdani/.npm/_npx/09ae5d3560c7b1f2/node_modules/node/bin/node
env PATH='/Users/aayushdani/.npm/_npx/09ae5d3560c7b1f2/node_modules/node/bin:/opt/homebrew/bin:/usr/bin:/bin' npm run check
env PATH='/Users/aayushdani/.npm/_npx/09ae5d3560c7b1f2/node_modules/node/bin:/opt/homebrew/bin:/usr/bin:/bin' npm test
env PATH='/Users/aayushdani/.npm/_npx/09ae5d3560c7b1f2/node_modules/node/bin:/opt/homebrew/bin:/usr/bin:/bin' npm run build
```

Installed Next 16.3.6, React 19.3.0, TypeScript 5.9.3, OpenAI SDK 7.23.0, MongoDB 7.6.0, Temporal SDK 1.24.0, S3 SDK 3.1141.0, Resend 6.30.0. The production build script explicitly uses Webpack. Do not upgrade dependencies to solve an unrelated issue without a reason.

## 4. Preview isolation and external-action boundaries

Current preview uses `KIARA_DATA_DIR=/private/tmp/kiara-v2-development-3091`, v2 data under its `v2` directory and encrypted originals under `originals`. It explicitly sets **`MONGODB_URI=''`**, overriding `.env.local`. Preserve that override on every restart. AI is local/deterministic, legacy execution scripted, email preview-only and `KIARA_ALLOW_LIVE_EMAIL=false`. These are labeled local modes, not proof of connected services.

Synthetic preview notification grant: owner `local-founder`, `founder@example.test`, sender `kiara@example.test`, origin `http://localhost:3091`, expiry 2030. Protected synthetic email settings are `/private/tmp/kiara-v2-development-3091/v2/email-ui-environment.json` and `email-ui-installations.json`. Synthetic cancellation budget fixtures use `/private/tmp/kiara-v2-run-ui-synthetic-budget`. Reuse only after inspecting actual configuration; do not expose credentials or dump `.env.local`.

**Important preserved boundary:** an earlier preview inherited `.env.local` MongoDB configuration and wrote fictional browser fixtures into remote tenant `v2_workspaces/local-workspace`. A metadata-only lookup observed version 77, five matters, seven sources, six documents and five conversations. Those records remain intact. Automatic approval review rejected copying the full remote tenant payload to local storage because its private source/document/conversation content was not proven synthetic and explicit permission was absent. That permission was never received. Do not copy or inspect the remote payload, reconnect the preview, reset it or delete it as a workaround. The latest handoff instruction authorizes continued building, not that particular customer-data transfer. Continue with isolated local fixtures.

The original build authorizes local code, tests, browser rehearsal, real adapters, setup/runbooks and failure handling. It does not authorize paid probes, raised spend caps, live email/Slack messages, public publication, production migrations, purchases, destructive operations, new customer-data access or invented counsel/customer approval. Finish all independent engineering before surfacing a specific external prerequisite. Real customer/legal validation must remain a separate evidence category.

## 5. What is already implemented — preserve and extend

The code is substantial and integrated. Read these modules and their delivery notes before replacing anything:

- Shared authenticated services under `src/v2/` and real UI under `src/ui/v2/`; OIDC browser flow, sessions/CSRF, strict commands, membership roles and scoped actor/matter/entity access. Client input does not confer tenant or legal authority. Explicit simulated demo profiles remain labeled.
- Durable local/Mongo storage; normalized collections, versioned migration/cutover/rollback and execution fencing; immutable revisions, encrypted originals, S3/KMS adapter, retention, deletion tombstones, recovery and uncertain-effect preservation.
- GitHub/Slack/Drive selected-source intake adapters, authenticated installations, correlated events, source chronology/current/historical/conflicting states, revocation/deletion lineage, document structure anchors and Atlas hybrid retrieval adapters with final exact access rechecks.
- Conversation, private/shared scenario exploration and deliberate adoption into one matter, personal/team preference isolation, candidate versus owner-confirmed facts and planned versus deployed distinctions.
- Bounded AI answering/drafting/planning with token accounting, durable reservations/attempts/leases, usage receipts and conservative unknown outcomes. Support checks do not confer legal clearance. Never resend an uncertain external/model effect just to obtain a clean status.
- Exact selected document/version drafting, immutable successor drafts and amendments preserving signed originals, typed generated plans accepted explicitly, approved-template internal preparation with separate business/action gates.
- Matter proposals, scoped business/legal decisions, exact action authorization, broker/reconciliation, obligations/deadlines/effort, quiet attention/digests, coverage freshness and reviewed applicability, legal-source maintenance.
- Counsel/no-counsel packet routes with exact sharing, current reviewer grants, terms/fee/intake gates, returned edits reopening affected decisions, and exportable owned pending work when no provider exists. No real referral/counsel availability is claimed.
- Selected-thread Slack continuation, references-only outward workflows, exact outbound intent, readback and uncertainty. Email intake has exclusive protected account configuration, signed metadata then authenticated provider fetch, encrypted originals, authentication-result quarantine and exact owner accept/reject. Email attachment manifests exist; attachments are not fully parsed into authoritative facts.
- Opt-in notifications use verified recipients, stable installation identity, semantic deduplication, protected delivery grants, late-result receipts, generic secure links and conservative readback. Unknown legacy identities fail closed; preview is not delivery.
- Goal/first-useful-output measurement, exact historical receipt withdrawal and stable baseline. Rehearsals are excluded; observed elapsed time is not demonstrated savings.
- Classified feedback and two finite learning strategies: local-keyword `exact_clause_reference`, and literal date/number preservation for recognized rewrites via `preserve_material_values`. Frozen original/near-miss/holdout replay, separate author/evaluator/owner roles, shadow execution, exact adoption, later changed behavior, rollback and affected records. These are not general legal or model quality qualification.
- Initiating-owner run cancellation, queued cancellation without effect, submitted cancellation retaining usage reconciliation and unknown accounting, and source-deletion/revocation fencing of retained output.

Two recent substantive changes need particular care:

1. `matter-preparation.ts` supports explicitly accepted generated plans: exact objective/tasks/plan/policy/current audience, unconditional basis proof even with empty retrieval, pending legal review, uncertainty fences and explicit packet adoption. General non-plan matters still need work below.
2. Task purposes are `proposal_review`, `artifact_review` and `work`. Generic proposal approval can complete only proposal-review tasks. `matter.task_complete` requires the current routed owner and appropriate role, with exact evidence IDs, versions, content hashes and recursive dependency fingerprints. Changed evidence invalidates readiness; legacy/stale done tasks without current attestation cannot close work and can be renewed. Scoped counsel attestation exists. Retention removes completion notes; parent matter/conversation access gates tasks, attention and private events.

The final small procedure-learning repair removed holdout rows from `learningViews` for independent evaluators as well as authors; holdout material remains server-only. A regression covers an evaluator later becoming an author. It was mechanically repaired by the old lead after independent detection; **a separate post-repair independent review is still needed**.

## 6. Evidence at the checkpoint — exact limits

- `evidence/assembled-engagement-suite.log`: **541/541 passed**, 69.25 seconds, before the final small procedure holdout repair. The working tree included eight memory-module tests from untracked files; do not call this 541 committed-only tests.
- `evidence/holdout-custody-repair.log`: **28/28 learning/strategy tests passed** after that repair.
- `evidence/assembled-engagement-build.log`: production Webpack build and TypeScript succeeded after the repair. `assembled-engagement-typecheck.log` is the earlier separate typecheck.
- `evidence/matter-preparation-independent-after.log`: **46/46** independent preparation/drafting/counsel/attention tests. Task evidence **18/18**; AI/cancellation **37/37** in their focused records. Temporal SDK bundle contains 11 workflows; it was not deployed to managed Temporal.
- Prior committed checkpoint `3bfafab`: **433/433**, typecheck and build passed.
- Real isolated local MongoDB 8.0.32 replica-set qualification passed **4/4** earlier. This does not qualify Atlas Search or production load.
- Browser-observed synthetic flows include first usefulness, quarantined email accept/reject, preview notifications, three-role strategy shadow/adopt/changed ranking/rollback, and queued/dispatched cancellation retaining uncertainty. Earlier document, counsel, sharing, migration and scope evidence is in the ledgers/renders.
- **Still pending in the browser:** accepted-plan `matter_packet` adoption, substantive task attestation/renewal, and remaining whole-target stories. An intended fixture script was not actually created; do not cite it as evidence.

When the host slept, some tests took 15–30 minutes and leases expired. Preserve `assembled-engagement-suspended.log`, `matter-preparation-independent-suspended.log` and the related task-purpose log as failed/interrupted context. Awake reruns passed without weakening lease timeouts. Do not treat host suspension as justification to weaken production invariants.

Do not rerun every historical suite immediately just to get a new timestamp. Inspect this checkpoint, run affected tests as implementation advances, independently review, then run the assembled suite/typecheck/build after meaningful integration. Keep test revision, configuration, command and limitations with the result. Raw logs may contain CR/trailing spaces; do not rewrite them to appease whitespace checks.

## 7. Immediate unfinished module: company memory, target §7

The following files already exist, untracked:

- `src/v2/company-memory.ts`
- `src/v2/company-memory-validity.ts`
- `tests/v2-company-memory.test.ts`
- `docs/kiara-delivery/company-memory.md`
- `docs/kiara-delivery/evidence/company-memory-tests.log`

Latest focused evidence is **8/8**. The narrative note still says seven; fix that as part of integration. Platform reviewed the design; root repaired owner access and strict date parsing afterward. Final strict-date/root-label changes need independent re-review.

**Agreed design to preserve:** security `entityId` continues to mean the workspace boundary. Optional **`subjectEntityId`** selects a declared company/product/data practice/vendor/counterparty; legacy absent subjects mean the root company. Never replace the security entity with a product/vendor ID.

`MemoryEntity` has an exact ID, kind, declared name/aliases, owner, scope and declaration source. A declaration is user-attributed identification, not legal existence or deployment proof. Same names/aliases never auto-merge. Both actor and named owner must have current access to the proposed audience. A root-company declaration can be created once; it deliberately does not copy its label to global `companyName`, which could expose scoped content. Root declarations cannot be archived.

`MemoryRelationship` goes candidate → confirmed → withdrawn. Typed edges include `owns_product`, `has_data_practice`, `uses_vendor`, `contracts_with`, `subsidiary_of`; planned/live/unknown practice and strict effective/expiry dates remain explicit. Confirmation binds exact subject IDs, version and entity/source/fact/document hashes, including nested dependencies with the same audience, and creates a real `FactAssertion` carrying `subjectEntityId` and a relationship marker. Conflicting active relationships must be withdrawn, not silently overwritten. Current graph eligibility checks current fact validity, document heads, membership/access and source status. Archive revokes the declaration source so derived records must become unavailable through normal lineage.

Exports include `applyCompanyMemoryCommand`, `companyMemoryView`, `resolveMemorySubject`, `resolveCompanyContext`, `memoryRecordCurrent`, `memoryBasisCurrent` and command-field definitions. Inspect actual signatures before wiring.

**Required integration work:**

1. Shared contracts/dispatcher/store defaults and normalization, Mongo normalized persistence, migrations, snapshot filtering and history/deletion/retention.
2. Explicit subject selection in conversation and fact creation; subject-aware correction identity, retrieval and approved-template fact mappings; root-compatible migration semantics.
3. Inherit declaration and exact relationship/fact/source lineage into model context, answers, drafts, packets and tasks. Call per-record memory validity from source-lifecycle eligibility so archive, expiry, changed proof, membership loss and deletion also gate derived content.
4. Reserve `relationship.*` generic fact creation/confirmation/correction predicates; prevent an unmarked generic fact from bypassing relationship dependency checks.
5. Invalidate affected work/proposals on confirmation, withdrawal and archive. Preserve hypothetical/planned isolation and current audience intersection; graph edges never widen access.
6. Company UI for declaring/selecting subjects, reviewing exact candidate evidence, confirmation, withdrawal/archive and current versus historical relationships. Frozen user intent must survive polling without silently rebinding selection.
7. Meaningful integration/adversarial tests plus running role-based UI review. Existing tests cover nested private-evidence laundering, role/tenant denial, inaccessible owners, current document heads, conflicting relationships, dates and archive/expiry. Add tests at the shared boundaries rather than only repeating helper behavior.

## 8. Other remaining engineering — verify against full target

### Scoped precedents

Not implemented. A reviewer outlined a possible design but no precedent module landed. Start with a reviewable contract, not a fake “saved lesson” label. Candidate design: normal scoped record, exact declared counterparty subject ID, origin matter/proposal, attributed business/legal decision hashes, immutable document revision/hash and clause anchor, confirmed fact IDs and recursive basis, explicit reuse audience within originating authority, named legal reviewer and dated factual context. Possible lifecycle: proposed → exact legal review → origin business-owner adoption → withdrawn.

Treat it as scoped historical contextual material, not universal policy, current law, automatic legal clearance or training permission. Reuse must match explicit counterparty/context and current permissions, and respect parent/source deletion and withdrawal. Deliberately decide historical versus current document-head and approval-expiry semantics; do not blindly invalidate legitimate historical precedent or resurrect revoked material. Controlled external counsel access needs review. Wire to retrieval, drafting, UI and deletion, with independent review.

### General preparation and natural conversation

`service.ts` `matter.prepare` still uses a fixed data-flow/notice checklist for matters without an accepted generated plan. Accepted-plan preparation is done; extend general human-created, scenario-adopted and event-generated matters with objective-specific bounded preparation, alternatives and useful tasks. Reuse durable AI/services and exact acceptance; do not special-case only the Northstar fixture or break legacy migration ownership. Unsupported local reasoning must be shown honestly.

Natural-language factual corrections currently largely direct the user to a manual fact form; intent/preferences use limited pattern recognition. Implement structured typed correction candidates and useful paraphrase handling, with owner confirmation, exact subject/scope and frozen evidence. Natural instructions never confer action, legal or fact authority. Extend approved-template discovery, appropriate remedy/artifact selection and multiple-artifact planning where the full target requires it, using existing generated-draft infrastructure.

### Voice interpretation

Existing opt-in capture, editable transcript and visual confirmation are a foundation. Add a frozen structured interpretation showing recognized entities/names, dates/amounts, unresolved ambiguity, candidate facts and proposed actions, and require corrections before consequential mutations. Preserve initiation/retention choices. Test misheard vendor/date through the actual UI. Real microphone/provider accuracy and external retention are separate qualification.

### Agreement applicability and measurement

Complete per-agreement applicability linking exact counterparties/products/facts and executed documents/amendments. Existing inventory attestation enumerates the supplied authorized population, not every customer agreement everywhere. Do not call top-k retrieval an exhaustive inventory.

The two finite learning strategies do not establish general quality improvement. Complete required feedback/benchmark and repeat-error/rework/human-effort measurement mechanisms, with frozen independent examples and scope controls. Legal/domain quality labels and customer savings need actual reviewers/customer evidence; model agreement is not a substitute.

### Final integrated acceptance and release material

Finish the complete ten-step Northstar/RelayAI journey and all 16 §16 stories, including useful explanation without forced onboarding/matter creation, scenario isolation, ambiguous action language, unauthorized corrections, personal preferences, first value without integrations, concurrent events, restricted-source leakage, stale coverage, unavailable counsel, changed draft approvals, staging versus deployment, signed amendments, accepted-send timeouts, learning rollback and voice corrections.

Also qualify outages, missed-webhook reconciliation, repeated/out-of-order events, stale two-session edits/approvals, restart/human waits, partial effects, cancellation, budget exhaustion, deletion/restore, source prompt injection and stale-index/derived-content leakage. Reuse earlier valid evidence where unchanged. UI and UX review must cover real founder/engineer/counsel/publisher tasks, desktop and 390/320 widths, keyboard/focus, empty/loading/error/stale/restricted states.

Provide all five §17 deliverables: requirement/dependency plan; schema/service/authority/state contracts; updated designs/renders; working end-to-end demonstration; accurately qualified automated and expert-reviewed acceptance evidence. Reconcile current requirement/evidence ledgers, F01–F18/B01–B15, CI, setup, migration and recovery instructions. Old delivery notes contain now-completed gaps and obsolete process IDs; update the current entry point rather than redoing completed work based on a historical paragraph.

Live IdP, Atlas Search, managed Temporal, S3/provider delivery, qualified counsel referral/legal playbooks and design-partner validation remain external inputs. Complete real adapters/config checks/failure modes/runbooks locally. Do not fabricate their success, and do not use these dependencies to excuse unfinished independent engineering.

## 9. Execution and review sequence

Read the inputs once, inspect actual current code/status, adopt the persistent objective, then dispatch concrete Sol/high work immediately. A useful first wave is: platform owns company-memory backend integration; product owns corresponding Company/conversation/voice UI against agreed contracts; independent QA reviews the latest holdout/task/memory fixes and audits scoped-precedent requirements/acceptance. The lead owns integration and settles shared contracts while advancing the next unowned slice. Reassign workers to precedents, generalized preparation and independent review as dependencies clear. This is a starting allocation, not a requirement to keep someone idle.

Each assignment needs a bounded outcome, relevant source/requirement IDs, dependencies, owned paths, tests, reviewer and evidence. One author cannot be their own sole approver; after material fixes another agent rechecks the affected conclusion. Rotate implementation/review responsibilities within the actual slot limit. Coordinate edits to `contracts.ts`, `service.ts`, persistence, common UI and global styles explicitly.

Integrate vertical slices through real customer UI, not a pile of disconnected modules. For each slice: focused tests → independent review → repair/re-review → integration → affected assembled checks. Keep concise milestone updates and a current runnable loopback preview. Broaden testing after meaningful integration or new failures, not simply because a previous run finished. Stop duplicate old-team work and preserve all unrelated files.

Completion means a coherent runnable product covering the full mandatory target, no unresolved blocking review findings, meaningful adversarial/regression/browser evidence, setup/migration/recovery material and requirement-to-evidence traceability. Distinguish implemented, locally exercised, simulated provider, connected-service verified and actual customer/counsel validation. Do not equate a queued send, counsel packet, signing request, empty work queue, pass count or attractive demo with completed legal work or full product completion.

## 10. Useful delivery notes

All paths below are under `docs/kiara-delivery/`:

- `product-acceptance.md`, `regression-qualification.md`, `platform-contracts.md`: requirement and baseline ledgers.
- `drafting-planning.md`, `matter-preparation.md`, `company-memory.md`: current work semantics and next integration.
- `ai-knowledge.md`, `source-structure.md`, `source-chronology.md`, `index-inventory.md`: evidence and reasoning boundaries.
- `hybrid-normalized-storage.md`, `mongo-qualification.md`, `retention-recovery.md`: persistence qualification and lifecycle.
- `integrations-orchestration.md`, `slack-continuity.md`, `email-intake.md`, `notifications.md`, `run-cancellation.md`: channels, durability and effects.
- `learning-coverage.md`, `feedback-strategies.md`, `legal-maintenance.md`, `execution.md`, `operations-and-review.md`: learning, legal review and operations.
- `target-gap-review-platform.md`: earlier gap analysis with later closures; check dates/current code before treating a finding as open.
- `evidence/` and `renders/`: raw command/browser artifacts. Read selectively against the changed behavior.

Begin from this checkpoint. Preserve the existing progress, finish the remaining implementation, and qualify the whole product honestly.
