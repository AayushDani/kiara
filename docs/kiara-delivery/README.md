# Kiara v2 delivery status

Status: **active implementation; target not complete**. The authoritative contract is [the v2 product plan](../product-plan/kiara-product-plan-v2.md); the full autonomous execution brief is supplied in this chat. Source reports are preserved in the original checkout.

## Baseline and coordination

- Integration owner: root lead. Shared checkout, disjoint file ownership; no worker stages or commits.
- Starting branch/commit: `main`, `5e4c25dee13721e6b4ec82c1fa1c838eb517f433`; delivery branch: `codex/kiara-v2`.
- Existing user changes: `README.md`, `kiara-architecture/validation/storage-results.json`; untracked deliverables, product/platform reports, prompts and verification artifacts are preserved. Initial full status: `/private/tmp/kiara-v2-initial-git-status.txt`.
- Supported runtime is Node 24; shell defaults to Node 26. Qualification uses `/Users/aayushdani/.npm/_npx/09ae5d3560c7b1f2/node_modules/node/bin/node` (24.19.0), Next 16.3.6, React 19.3.0.
- Initial process inspection found detached telemetry/esbuild processes, no active Next server or Kiara worker. New state and ports must be isolated. No paid/external-effect probes are authorized by this build.
- Baseline typecheck/test logs: `evidence/baseline-typecheck.log`, `evidence/baseline-tests.log`. Results are pending until processes exit.

## Delivery sequence

1. Shared identity, typed records, durable transactions, visibility, command receipts and migration boundaries.
2. Conversation → isolated scenario → deliberate adoption → one matter; scoped memory and actual evidence.
3. Source enrichment, document authority/inventory, maintained coverage, counsel routes and exact decisions.
4. Restricted execution/reconciliation, obligations, connectors, controlled learning and cancellation.
5. Integrated role-based journeys, adversarial/regression checks, running UI review at desktop/390/320, production build, cutover/rollback qualification.

The Northstar/RelayAI slice is the first milestone, not the full scope. Provider, counsel and customer validation remain distinct from local and simulated tests.

## Active ownership

| Owner | Paths / outcome | Review |
|---|---|---|
| Root | API routes, app routing, legacy engine/context/operations and legacy UI intent fixes; integration and evidence | Independent worker |
| Product acceptance | `docs/kiara-delivery/product-acceptance.md`, `src/ui/v2/**`; v2 customer flows and public component | Platform/QA plus running UI review |
| Platform contracts | `docs/kiara-delivery/platform-contracts.md`, `src/v2/{contracts,store,authority,service}.ts`, platform tests | Regression worker and root |
| Regression qualification | `docs/kiara-delivery/regression-qualification.md`, legacy sources/legal/runtime/adaptation/worker/notification fixes and regressions | Platform worker and root |

## Decisions and limits

- Preserve the old execution path while an additive v2 path is qualified. Do not claim deployment of managed Temporal, Atlas retrieval, or encrypted object storage from a local implementation.
- Customer workspace starts empty; fictional rehearsal must be explicit and labeled. No fabricated counsel coverage, delivery, legal clearance, or provider success.
- Authentication supplies actor/tenant; client input never establishes tenant or legal authority. Every output and mutation is service scoped.
- Existing immutable history, uncertainty, spend caps and exact guards remain protected during migration.

## Resumption checkpoint

Read this file and the specialist records; inspect `git status` and actual files before continuing. Goal remains active. Shared branch `codex/kiara-v2`; first integrated implementation committed as `9d8e662`. The latest checkpoint below supersedes historical process IDs and pending statements. Preserve the initial user changes and report directories.

## Integration checkpoint — first runnable v2 slice

- Local entry: http://localhost:3091/ ; public information page `/welcome`; retained old path `/legacy`. Loopback only. Server exec session `12495`; isolated state `/private/tmp/kiara-v2-development-3091`. Never reset the original `.kiara` store.
- Baseline: 154/154 tests passed. Initial typecheck failed solely on stale generated `.next/dev/types` product routes; these were preserved at `/private/tmp/kiara-stale-next-types-1790485251`, then regenerated. Integrated TypeScript now passes.
- Platform: 19/19 Node24 service tests. Auth/legacy independent read and execution: 13/13. Focused legacy repair suite: 60/60. Root integration: 19/19. Document files/KMS adapter: 2/2 mocked tests; migration/encrypted-local storage: 2/2. These are local/simulated results, not provider qualification.
- Browser observed: empty goal-first home; a real question creates a retained conversation and isolated scenario without a matter or confirmed fact. Scenario assumptions can be edited and resumed. Further role journeys and screenshots remain in progress.
- Independent review repaired team-list restrictions, matter-restricted memberships, and private-fact derived-content lineage. Source refresh stranding of queued sibling work was found in independent review and is being repaired; do not mark F03 fully qualified until the new test passes.
- SDK dependencies added: Temporal 1.24.0, AWS S3 3.1141.0, docx 9.7.2, mammoth 1.13.0. Install audit reported zero vulnerabilities; this is not a full dependency-security qualification. Build uses documented Webpack option to avoid the report's unresolved default Turbopack behavior.
- Operator tooling: `npm run v2:operator -- ...`; additive legacy archive migration retains exact source bytes in encrypted originals and leaves old execution ownership intact. This is an archive/rollback foundation, not a completed normalized data cutover.
- Next active wave: platform agent implements bounded shared-service AI/retrieval; regression agent implements authenticated connector intake and Temporal outbox; product agent implements UI and review-intent tests then visual acceptance. Root owns document/original adapters, APIs, integration, recovery and remaining customer-operation services.

## Integration checkpoint — model, connector and counsel services

- Assembled `npm test` on pinned Node 24 passed **240/240** (`evidence/integrated-suite.log`). Subsequent focused auth/origin 4/4, counsel 4/4, encrypted migration/originals 3/3 and Word/KMS 2/2 passed. Tests use injected providers and isolated stores. Latest integrated typecheck ran while a UI file was being added; rerun after the current wave. Production build/CI still pending.
- AI: bounded real OpenAI answering and support-check adapter, pre-count and shared spending controls, durable runs/outbox, access rechecks and recovery. `ai-knowledge.md` records exact local/injected qualification. No live AI generation was performed. Local default remains explicitly deterministic.
- Connectors: real scoped GitHub/Slack/Drive intake/read adapters and authenticated installation registry; current installation grant checks deny retained source/derived content on removal or narrowing. Temporal SDK orchestration and local durable worker commands are implemented; connected Temporal/Atlas qualification remains outstanding.
- Counsel: separate attributed intake/conflicts evidence, approved terms/fee cap, exact full-record sharing to a provisioned reviewer, expiry/revocation, evidence requests, returned successor proposals and escalation. Browser role journey completed on fictional test data at desktop and 320px. Private conversation history remains excluded. No real provider referral, email, fee charge or legal clearance was implied.
- Independent review repaired private-counsel access loss across trusted business/legal review state transitions. Changes to material matter content still require renewed sharing. Returned edits preserve originals and invalidate prior consequential decisions.
- Authentication: RS256 OIDC browser authorization-code flow with state, nonce and S256 PKCE, HTTPS origin pinning and current provisioned membership checks; simulated tests only. Local evaluator/signatory profiles are explicitly simulated. Real IdP configuration/qualification pending.
- F16 is reproduced and repaired in both old and new API paths: localhost and 127.0.0.1 session requests now return 200. Evidence `loopback-auth.json` and `loopback-auth-after.json`. Local Host normalization is allowed only for loopback/same scheme/port; forwarded headers never confer origin authority.
- Original storage: independent review found and repaired same-byte overwrite after encryption-key rotation. Key-specific immutable ciphertext paths, backward-compatible references, no-replace writes and fsync retain recoverability. Word admission validates actual bounded decompression, local/central headers and CRC before parsing. S3 requires a version receipt and the exact configured customer-managed KMS key ARN.
- Current ownership: platform = procedures/coverage/frozen evaluation; regression = restricted execution/reconciliation; product = counsel/learning/voice/amendment UI and browser acceptance; root = integration, OIDC/originals, obligations/effort mechanisms and remaining migration/setup. Product owns browser tab 1 until it releases it. Root owns branch/staging/commits.
- Preview remains loopback `http://localhost:3091/`, dev session `12495`, isolated state `/private/tmp/kiara-v2-development-3091`. No existing customer state reset. Worker entrypoints `npm run worker:v2-local` and `npm run worker:v2` require explicit tenant/configuration; neither was launched against live services.

Essential remaining engineering includes complete controlled document creation/reimport, maintained coverage and usable standing procedures, verified execution, obligations/reminders, observed effort/value, connected channel continuity, Atlas hybrid retrieval, normalized migration/cutover/rollback, retention/deletion propagation, CI/build and all target/adversarial journeys. External legal/provider/customer qualification remains separately pending; this checkpoint is not target completion.

## Integration checkpoint — reviewed execution and operations

- Full assembled suite passed 284/284 on Node 24; integrated typecheck and production Webpack build passed. Subsequent execution/integration/counsel focused replay passed 45/45 and independent auth/AI/origin/learning/legacy/UI-intent replay passed 45/45. Logs are local/injected evidence, not live provider qualification. Archived terminal-log whitespace was normalized without changing result content.
- Counsel sharing now requires the exact prepared proposal, material matter and source/fact/document evidence. Obligation fulfillment binds reviewed criteria and an optional exact action; legal fulfillment requires legal-review authority. Independent review reproduced the original gaps and reread the fixes.
- Effect reconciliation is durable, readback-only and scheduled through local/Temporal workers. Local worker selection skips deferred entries before applying its batch bound to avoid starving new work.
- Preview restarted after successful build: exec session `39367`, same isolated state `/private/tmp/kiara-v2-development-3091`; product acceptance now owns IAB tab 2. Earlier session IDs above are historical checkpoints.
- In-progress Atlas files are deliberately excluded from this checkpoint. The target remains incomplete and work continues.

## Integration checkpoint — documents, retention, collaboration and database qualification

- Assembled working-tree suite **368/368 passed**, TypeScript passed, and the production Webpack build passed: `evidence/assembled-wave-{suite,typecheck,build}.log`. Four suite tests cover the next-wave attention foundation, deliberately excluded from this commit until service/UI integration and independent review. No paid provider or external delivery occurred.
- Actual isolated MongoDB 8.0.32 replica-set qualification **4/4 passed**: concurrent aggregate/normalized writes, staged migration/replay, stale-hash fences, fresh-process reads, rollback preserving current receipts/effects, paused index writer versus deletion, and historical application archive redaction. Each generated test database was dropped, then root stopped the loopback server. See `mongo-qualification.md`; this does not qualify managed Atlas Search or operational scale.
- Atlas hybrid exact/keyword/vector adapters, exact embedding token accounting, durable scoped index maintenance, normalized Mongo collections/cutover/rollback, and permanent deletion fences are integrated. Full-tenant hydration and bounded chunk enumeration remain scale limitations. Index admission needs explicit operator policy and existing spending authorization; no credentials or caps were changed.
- Document originals, approved-template substitutions, immutable draft reimport, exact extracted-text comparison and separate executed-document amendments are usable. Direct API-handler tests verify byte preservation, replay, stale/CSRF rejection and revoked downloads. Browser tests verify the corresponding template/revision/recovery workflows. Word formatting, annotations and tracked-change semantics remain original-file review responsibilities.
- Selected private scenario snapshots can be shared with named current members without opening the original history. Recipient-accepted bounded routing changes pending task ownership while preserving all approval capacities. Same-scope conversation links reuse existing work. Browser tests confirmed recipient isolation, apply/revoke behavior and preserved conversation/matter identity.
- A named fact owner can attest the exact supplied agreement/amendment register, evidence, population and expiry. Preparation binds that attestation; changed heads, source/owner authority, revocation or expiry require renewed review. Browser acceptance was explicitly fictional and does not certify external agreement discovery or legal applicability.
- Deletion redacts connected current/historical application payloads, preserves hidden uncertain-effect exceptions, queues physical cleanup, and exposes opaque recovery controls. Exact original purge obeys holds, shared writers and delay. Interrupted original writes require verified manifest recovery. External backups and provider retention remain unverified. See `retention-recovery.md` for operator procedures and actual evidence.
- Independent review repaired orphan-purge versus new-intake races, stale source revival through historical revisions, missing global-spend recovery identities, late effect payload restoration and worker starvation. The final retention race suite passed **10/10** and the independent shared-spend/retention/orchestration replay passed **31/31**.
- Next wave: real attention policy/digests, permission-scoped Slack conversation continuation, substantive natural-language draft creation/editing and planning, approved standing-policy work, scheduled legal-source maintenance/applicability review, and remaining full-target evaluation. The independent product critique found these gaps in actual code; this checkpoint does not claim the target complete.
- Final index-admission repair passed **10/10** (`evidence/index-admission-repair.log`): malformed maintenance policy or missing Atlas configuration cannot roll back a source/member revocation. This focused repair followed the assembled build. Next-wave unintegrated Slack files are excluded from the checkpoint.

### Preview storage correction

Earlier browser fixtures used the project's configured MongoDB `v2_workspaces/local-workspace` tenant because Next loaded `.env.local`; the stated filesystem directory covered sessions/originals but did not override MongoDB persistence. A read-only metadata lookup confirmed version 77, five matters, seven sources, six documents and five conversations, including the known browser-created matter. Those records remain intact. This corrects earlier claims that the whole preview state was filesystem-isolated; it is not additional Atlas Search or deployment qualification.

The restarted preview explicitly sets `MONGODB_URI=''` and uses the isolated local store. Automatic approval review rejected copying the remote tenant's full payload into that store without explicit permission. Root requested permission asynchronously and continues with fresh local fixtures. No copy, remote write, reset or deletion occurred. Preserve this boundary; do not reconnect or transfer remote payload as a workaround while approval is pending.
