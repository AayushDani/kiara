# Product acceptance and interaction contract

Owner: product/workflow/UI worker. Integration and review owner: root lead. Date: 27 September 2026.

This is an implementation acceptance map, not evidence that the requirements are already delivered. The authority is `docs/product-plan/kiara-product-plan-v2.md`, read in full. IDs below reference its numbered sections; the supporting September 26 documents apply only where consistent. No production files were changed in this initial derivation.

## Sources and baseline inspected

- Authoritative v2: sections 1–17, including all 10 reference-journey steps and all 16 acceptance scenarios.
- Supporting detail: `product-workflows.md` (full); `cto-architecture.md` (full); `screen-specification.md` (all surface descriptions and accessibility requirements); `positioning-and-experience.md` (customer, activation, copy and value measurement); `README.md` (precedence and reference journey).
- Current-state report: Part 1 capability/defect map, Part 11 product/API/forms/document lifecycle and current limitations. Inspected `src/app/page.tsx`, `src/ui/pages/KiaraApp.tsx` state and mutation handling, and `docs/ui.md`.
- Inspected saved current UI render `docs/platform-review/evidence/ui-workspace.png`, target matter render `docs/product-plan/renders/02-matter.png`, and target counsel render `08-counsel.png`. These are historical captures, not a fresh browser run of newly implemented work. The concept render verification explicitly covers presentation/local simulations only.
- Read repository `AGENTS.md`. Relevant installed Next.js documentation must be read before subsequent Next code.

### Explicit precedence decisions

1. Primary navigation is **Kiara · Work · Documents · Company · Activity** (v2 §3). Earlier Inbox-first navigation, separate top-level Playbooks and Connections, and a concept mode picker are superseded. Connections/settings belong in workspace controls; playbooks/learning belong within Company.
2. First interaction is **What would you like help with?** (v2 §5). Source connection and a multi-step questionnaire cannot block useful explanation or a bounded draft. An actual accepted useful output is activation; a fictional rehearsal is not.
3. V2 §§3–4 make conversation and scenario first-class, backed by the same truth/work services. A standalone local chat transcript and duplicated client matter state do not satisfy the contract.
4. V2 §14 public headline is **Talk to Kiara. Keep legal in step with your business.** Earlier shorter copy is supporting material.
5. Existing signup/privacy demo can be retained as a labeled legacy example, but must not silently be presented as the new platform or the Northstar journey.

## Traceable requirement matrix

The owner names are workstream roles. Integration lead assigns concrete files before implementation. Evidence required means evidence to collect, not a present pass.

| ID / source | Requirement | Components and owner | Dependency / release evidence |
|---|---|---|---|
| P01 / §1 | Useful company-specific help, meaningful observation, authorized completed work; count new review effort | Conversation, matter, Activity; Product + Applied AI | All three capabilities present in reference journey; no credit for draft-only completion |
| P02 / §2 | Understand/decide/explore/prepare/monitor/coordinate/act/recall; entities and coverage declared; explanation need not create work | Intent resolver, scope header, memory; Applied AI + Product | Questions leave matter count unchanged; real requested work gets owner and durable ID |
| P03a / §3 | Required navigation; conversation primary; compact attention; entity, visibility and coverage visible | Workspace shell; Product | Desktop/mobile renders; navigation and artifact links resolve the same IDs |
| P03b / §3 | Infer intent; answer first; narrow consequential clarification; progress and cancellation; durable interruption | Conversation service/run records; Applied AI + Platform | Ambiguous assent cannot dispatch; reload retains saved task; cancellation prevents new dispatch |
| P03c / §3 | Web, scoped Slack, explicit email intake and user-initiated voice share services; visual action confirmation | Channel adapters/voice UI; Integrations + Product | Channel identity/scope proofs; retention copy; uncertain transcript cannot mutate consequential state |
| P04a / §4 | Message, scenario, candidate fact, confirmed fact, preference, instruction, approval, rule remain different types | Shared contracts/memory; Platform + Knowledge | Type/state transition tests; synthetic-only scenario never becomes deployment fact |
| P04b / §4 | “What I’ll remember”, owner/scope, conversation-only reuse restriction, selective sharing preview | Memory controls/scenario details; Product + Knowledge | Conversation-only record excluded from cross-conversation retrieval; cannot imply retained text is deleted |
| P05 / §5 | Goal-first onboarding; one document/manual request works before integrations; unknown supported; reuse facts confirmed after value | Composer/intake; Product + Applied AI | Zero integrations + supplied text gives bounded useful result; no forced matter or fabricated issue |
| P06a / §6 | Selected-source connectors declare scope/events/backfill/freshness/deletion/execution; correlate business change | Connections/intake/ledger; Integrations | Duplicate PR + Slack links once; source access and current gaps visible |
| P06b / §6 | One useful factual/business/legal next question; deadlines classified; quiet hours/digests/preferences stay within authority | Tasks/notifications; Workflow + Product | No invented urgency; team routing cannot grant another role; dismissals retain reason where necessary |
| P07a / §7 | Versioned operational memory, originals, anchors/ACL lineage, provenance/time/authority/conflicts; separate legal sources | Records/artifact store/Company; Knowledge | Conflicting commitment and practice retained; newest file cannot replace signed authority |
| P07b / §7 | Permission prefilter and authoritative recheck; exact+keyword+semantic retrieval; definitions/contradictions; exhaustive inventories | Retrieval/context packets; Knowledge + Platform | Revoked source blocked before model/display; notice inventory enumerates all applicable agreements with gaps |
| P08 / §8 | Maintained legal coverage registry; official/licensed authority metadata; stale/unsupported visible; applicability review; bounded legal escalation | Legal knowledge/coverage views; Legal-content + Knowledge | No fabricated authority/reviewer; stale coverage blocks required clearance while plain explanation remains useful |
| P09a / §9 | Direct, standing-policy and matter-review routes; factual, business, legal, publish/send/sign capacities separate | Policy service/review UX; Platform + Workflow | A matched current playbook records skipped-gate basis; publisher authority independent of legal content approval |
| P09b / §9 | Exact approval binds actor/role/matter/hash/snapshot/document/policy/conditions/recipients/time; recheck at dispatch | Review/action services; Platform | Changed material dependencies invalidate approvals; UI preview freezes reviewed packet |
| P09c / §9 | Preserve signed originals; successor policies; approved templates; alternative product/no-action remedies | Documents/proposals; Knowledge + Workflow | Signed source hash unchanged across amendment; no missing terms invented |
| P10 / §10 | Existing counsel scoped packet + invitation; optional referral only when qualified capacity exists; conflicts/terms/fee/share approvals; no-counsel pending/export | Counsel engagement/view; Counsel ops + Platform + Product | No unavailable network advertised; export works; unassigned owner remains visible; invitation ≠ engagement |
| P11 / §11 | Matter owns evidence/facts/conversation/tasks/decisions/deadlines; explicit state and blockers; verified closure/reopen | Durable workflow/Work detail; Platform + Workflow | Timeout reconciles before retry; queued/delivered/accepted distinctions; all required tasks evidenced before close |
| P12 / §12 | Preferences reversible; corrections authorized; precedent scoped; lesson evaluated/approved/shadowed/promoted/rolled back; deletion lineage | Learning/Company; Evaluation + Knowledge | Regression rollback identifies affected work; one draft approval does not train across tenants |
| P13a / §13 | Shared stable scoped/versioned objects; typed model proposals validated by authorized services; no independent chat backend | Contracts/service boundary; Platform + Applied AI | Contract tests and deny paths; credentials unavailable to models |
| P13b / §13 | Durable intake/outbox/reconciliation; bounded agent activities and visible runs; revocation/deletion across derivations | Workers/ledger/runs; Platform + Integrations | Restart, duplicate, out-of-order, cancellation, budget and deletion tests; no cross-store atomicity claim |
| P14a / §14 | All named surfaces; desktop sidecar and mobile full detail; keyboard/screen reader; no decorative harness/no unexplained scores | Interaction system; Product | Visual/browser evidence; focus, named actions, source access and 320px overflow checks |
| P14b / §14 | Public page exact headline, three concrete journeys, same scenario sources/draft/approval, coverage/counsel/data/learning | Product page; Product + CX | Links open working journey; numerical/security/provider claims substantiated or omitted |
| P15 / §15 | Ten-step Northstar/RelayAI journey completes or states precise owned pending tasks | Integrated vertical slice; All owners | Journey ledger J01–J10 below; reload persistence and shared IDs |
| P16 / §16 | All adversarial and ordinary acceptance cases; useful-output, effort, grounding and integrity metrics; human/domain review | Qualification suite + Activity; Evaluation | A01–A16 below; automated vs independent expert evidence separated |
| P17 / §17 | Dependency-aware plan, schemas/transitions/tools/authority, updated renders, working full journey, evidence status | Delivery artifacts; Integration lead | Owner/contract ledger, implementation/demo, QA evidence and exact remaining operational prerequisites |

## Northstar / RelayAI reference journey

| ID | User-visible acceptance | Durable proof / negative invariant |
|---|---|---|
| J01 | Founder asks about AI summaries; direct useful answer cites current context and opens a scenario with questions | Conversation/message/scenario IDs; no new deployed fact |
| J02 | Synthetic-only branch shows assumptions and current-company facts separately | Editing assumptions leaves canonical fact version/hash unchanged |
| J03 | Explicit “Adopt this plan and prepare the work” creates one owned matter about customer transcripts | Adoption decision links scenario version and conversation; missing facts become owned tasks |
| J04 | PR and Slack launch evidence join the same matter; engineering confirms planned/actual separately from vendor terms/location | Event identity/revision retained; duplicate replay creates no duplicate matter/task; merge does not prove deployment |
| J05 | Relevant documents + exhaustive applicable agreement inventory produce proposal and clause-specific notice matrix | Each row has agreement/version/clause/trigger/recipients/channel/timing/uncertainty; unknown scope visible |
| J06 | A new Slack user gets a short scoped “Why this matters” explanation and same-matter link | User-specific authorization applied to inputs and output; no restricted clause leakage |
| J07 | Owner previews named counsel and included material before sharing; choose existing counsel or opt-in referral | Explicit exact sharing approval; unavailable provider => exportable packet, named owner, pending legal gate |
| J08 | Counsel edits or proposes another remedy, creating new proposal/document versions | Prior packet approval becomes stale; changed business decision returns to correct owner |
| J09 | Publisher authorizes exact destination/content/recipients/timing; execution produces evidence or owned unresolved work | Action idempotency, preflight and verification; no simulation called publication; no handoff called closed |
| J10 | Factual correction and drafting feedback become appropriately scoped records; later comparable matter reuses settled facts/approved lesson | Attribution, evaluation/owner approval for reusable rule, rollback and affected-matter list; no cross-tenant reuse |

## Section 16 acceptance suite

Each test should assert persisted state as well as visible output. Critical permission, approval, duplicate-effect and contamination tests gate release; passing a finite suite is not a universal safety guarantee.

| ID | Input / setup | Positive check | Required negative check |
|---|---|---|---|
| A01 | “Explain this contract” + accessible contract | Useful explanation with resolvable citations | No forced setup, counsel review, or matter creation |
| A02 | Hypothetical retention change | Scenario assumption visible and editable | Current practice and unrelated retrieval remain unchanged |
| A03 | “Go ahead” with multiple consequential choices | One narrow clarification and exact preview | No approval or action from ambiguous assent |
| A04 | Unauthorized correction to confirmed fact | Attributed disputed/candidate claim preserved | Existing authoritative fact not overwritten |
| A05 | “Give me the short answer first” | Next same-user response short; visible reversible preference | Other user/company policy/authority unchanged |
| A06 | New workspace with no integrations + real request/document | Bounded useful response/draft and source limitations | No fabricated source, setup gate, or activation from rehearsal |
| A07 | Related event during active conversation; repeat delivery | Matter enrichment and linked inline update | No duplicate matter, lost message, or stale source substituted |
| A08 | Restricted source exists; actor has narrower scope | Only authorized basis appears | No leak via answer, summary, scenario, notification or counsel packet |
| A09 | Stale/unsupported legal coverage | Visible limit, qualified review task and owner | No authoritative current-law conclusion or false clearance |
| A10 | No counsel/provider available | Exportable review packet + owned pending legal gate | No fabricated referral, engagement, approval or closure |
| A11 | Counsel replaces proposal/document v3 with v4 | Fresh review route; old intent visibly invalidated | V3 approval cannot execute v4, including polling during open preview |
| A12 | PR merged, no release evidence | Planned state displayed | No current/deployed fact inferred from merge |
| A13 | Signed agreement needs edits | Separate amendment/replacement with version lineage | Signed original bytes/hash unchanged |
| A14 | Provider timeout after accepted send | Uncertain status + reconciliation evidence before retry | No blind duplicate dispatch or misleading delivered/closed status |
| A15 | Promoted lesson fails regression | Previous version restored + affected-matter review tasks | No claim rollback undid existing external effects |
| A16 | Voice transcript uncertain vendor/date | Transcript and correction confirmation before use | No consequential record update/action from unresolved transcript |

### Measurement acceptance

Record time to accepted useful output separately from connection/setup completion. Track grounding and source recall; scope/intent mistakes; improper memory promotion; missed-event audits; unnecessary interruptions; repeat mistakes; rework; completion evidence integrity; and total human minutes on comparable outcomes. Baseline minus all Kiara effort includes setup, review and correction exactly once. Undated work, contractual/legal deadlines and internal response/launch targets must be separable. Dollar savings require customer billing evidence or an explicit estimate label. Expert legal adjudication remains a separate named prerequisite; a model or engineering test cannot certify legal correctness.

## Proposed minimal shared service contracts

These proposals are for lead integration to assign/freeze. They do not authorize a second independent chat store. Use the existing session/CSRF/idempotency machinery where sound, with one new canonical domain snapshot read and typed domain commands.

### Envelope and object identity

`ActorContext` is server-derived: tenant ID, actor ID, active entity, role/capacities, authorized scope IDs and permission revision. Client role selectors can exist only in prominently labeled demo mode. Every domain object has stable ID, tenant/entity/scope, version, timestamps, provenance/source IDs, lifecycle and authored-by identity. References in `Message.artifacts` are IDs/types/versions, never duplicated mutable objects.

`WorkspaceSnapshot`: `version`, `entity`, `actor`, `mode`, `capabilities`, `conversations`, `messages`, `scenarios`, `facts`, `preferences`, `sources`, `documents`, `coverage`, `matters`, `proposals`, `approvals`, `actions`, `engagements`, `learning`, `activity`. The server filters every collection; client filtering is presentation only. Capabilities expose why an operation is unavailable. Missing provider configuration is an owned capability gap.

`CommandEnvelope`: `commandId` (stable across ambiguous retries), `expectedVersion`, `type`, `targetId`, typed `input`; CSRF stays header-bound. Approval commands additionally carry the exact displayed immutable scope/hash/version. Return `commandId`, `status`, `newVersion`, `changedIds`, `artifacts`, and a recoverable typed error with remedy. A conflict does not refresh-and-approve automatically. Query command result before replaying uncertain mutation.

### Logical commands and invariant owners

| Command | Input that must be bound | Mutation owner / invariant |
|---|---|---|
| `conversation.message` | Conversation ID/version, content, channel, entity/visibility, memory reuse option | Conversation service resolves intent; message alone cannot confirm fact or authorize external effect |
| `scenario.update` / `scenario.adopt` | Scenario version, assumptions; explicit adopted plan and owner | Scenario service never changes actual facts; adoption records a decision and matter link |
| `fact.propose` / `fact.confirm` | Candidate statement, source anchors; exact assertion version and factual capacity | Memory service preserves conflicting candidate; only authorized confirmation supersedes fact |
| `preference.set` | Person/team scope, presentation/routing key, value | Immediate personal preference; team routing requires delegation; no authority creation |
| `source.intake` | Text/document metadata or authenticated event envelope, external ID/revision | Intake records provenance, deduplicates, correlates and distinguishes manual/fixture/provider |
| `matter.prepare` / `matter.cancel` | Matter version, scope/budget; cancellation reason | Workflow uses canonical facts; preserves pending work through reload; cancels future dispatch |
| `counsel.prepare` / `counsel.share` | Route, named recipient, packet version/material IDs, engagement scope/fee/expiry | Sharing service validates exact permission and business decision; unavailable referral stays pending |
| `proposal.revise` / `proposal.decide` | Frozen proposal hash/version, edited text/remedy, role/decision/conditions | New revision; invalidates only dependent approvals; legal and business decisions separate |
| `action.authorize` / `action.dispatch` / `action.reconcile` | Action content hash, target/base version, recipients, timing, approval dependencies | Broker checks current access/authority at dispatch; uncertain action cannot be blindly retried |
| `task.verify` / `matter.close` | Evidence type/receipt/artifact/verifier and required-task set | Distinguish read-back vs human attestation; no closure with unfulfilled requirements |
| `learning.propose` / `learning.promote` / `learning.rollback` | Scope, origin, eval digest, owner approval, pinned candidate/champion | No self-promotion or unapproved cross-tenant training; rollback identifies affected work |

### Typed UI states

- Matter state: `observed`, `triaging`, `needs_facts`, `proposed`, `business_review`, `legal_review`, `authorized_action`, `executing`, `verifying`, `closed`; blockers are separate typed records with owner and remedy.
- Scenario: `exploring`, `adopted`, `archived`; assumptions retain source and uncertainty. Adopted does not mean deployed.
- Fact: `candidate`, `confirmed`, `disputed`, `unknown`, `outdated`, `superseded` with effective/observed times.
- Action: `proposed`, `authorized`, `queued`, `submitted`, `uncertain`, `verified`, `failed`, `cancelled`; delivery evidence separately records accepted/delivered/bounced/unknown. A manual action stays pending until evidence and authorized verifier exist.
- Counsel: `unassigned`, `packet_ready`, `sharing_authorized`, `invited`, `intake_pending`, `engagement_pending`, `engaged`, `reviewing`, `returned`, `unavailable`; provider readiness is not inferred from invitation state.

## UI build handoff and observed gaps

The current UI is a single California-signup journey with Activity/Policy/Company context and an execution harness. Its source-driven progress and source dialog are useful reusable techniques, but there is no conversation, scenario, multi-matter Work queue, document register, counsel engagement, connector control, legal coverage registry, or voice path. It renders only approve despite existing backend reject/request-change actions. Current polling can move submitted approval targets without preserving the reviewer's original intent; new preview must pin packet identity and refuse stale submission. Current generic reconnect errors should become specific remedies. New screen labels must distinguish simulated providers and manual tasks from real external effects.

The older concept renders supply a calm visual baseline: warm neutral canvas, restrained purple, white document panels, readable status and a focused next-action card. Preserve that clarity while centering conversation. Do not reproduce the large developer harness or concept mode toolbar as daily product UI.

Proposed layout: left navigation with workspace controls; center conversation and composer; right working panel for selected scenario/document/matter artifact; compact attention and coverage strip above. On mobile, selected detail opens a full view with a clear return action. Company contains Context, Preferences, Coverage, Playbooks and Learning. Work groups owned next decisions, waiting tasks and completed outcomes; no invented attention count. Counsel is opened within the selected matter and sharing preview, with separate no-counsel state and export action.

Build sequence after contract freeze:

1. Read installed Next guidance; create shell and shared snapshot/command client.
2. Conversation, composer, source links, scenario sidecar, explicit adoption and memory controls over real typed commands.
3. Same matter record in Work; exact proposal/review/action preview; counsel and unavailable-counsel paths.
4. Documents/Company/Activity/Connections/coverage, truthful capability messages, goal-first empty state and public entry page.
5. Browser desktop/mobile/keyboard checks, J01–J10 walkthrough, A01–A16 service+UI checks where implemented, captured renders and evidence status.

Initial owned changed file: this document only. Production implementation ownership was subsequently assigned by the lead to `src/ui/v2/**`, with root retaining routes/auth/app entry ownership. Remaining empirical prerequisites include live provider credentials, qualified legal review and referral capacity; implemented local behavior and simulated dependencies must remain visibly distinguishable.

## Implemented frontend handoff

The lead assigned frontend implementation after the initial matrix. `src/ui/v2/KiaraWorkspace.tsx` exports the integrated client workspace; `PublicPage.tsx` exports the public product page. `Primitives.tsx`, `workspace.module.css` and `review-intent.ts` are local supporting modules. Existing global CSS and legacy UI files were preserved. Root owns `/`, `/welcome`, `/legacy` and API routes.

Implemented surfaces use `WorkspaceSnapshot` and `WorkspaceCommand` directly from `src/v2/contracts.ts`, `GET /api/v2/workspace` and `POST /api/v2/commands`. No client-side substitute business records are stored. The application provides:

- Required primary navigation, goal-first empty state, explicitly labeled optional fictional rehearsal (only before existing work), visible entity/access scope and connections/settings.
- Conversation history, company-team/private visibility selection, conversation-only memory policy, useful starter prompts, linked scenario artifacts, editable assumptions and explicit adoption into a matter.
- What I’ll remember, attributed fact proposals/corrections with supporting sources, planned/live/unknown distinctions, separate factual-owner confirmation and versioned personal preferences.
- Shared matter Overview, Evidence, Proposed work, Approvals & delivery and Counsel views. Manual evidence is explicitly attributed and never labeled an authenticated connector sync.
- Frozen exact proposal/action previews, role-specific buttons, disabled stale previews, review revision, manual completion evidence, closure validation and cancellation with a reason. Server rejection remains visible within the open dialog.
- Existing-counsel packet preparation and unavailable-referral route, exported text packet and owned pending states; no actual invitation, engagement or delivery is claimed.
- Pasted-text and Word/plain-text file intake through root APIs, document authority/lineage, source inspector and Word export; source text and original-file fidelity are distinguished.
- Coverage, preferences, learning records/rollback, Activity outcomes and explicit unavailable time-savings measurement; current provider limitations and local demonstration roles remain visible.
- User-reviewed transcript intake with explicit non-recording/unconfigured-live-voice copy. Confirmed transcript uses the shared conversation service; a visual action approval is still separate.
- Public page with v2 headline, three journeys, context and learning, counsel options, data controls and actual capability boundaries.

Reliability controls include stable command identity for ambiguous retries; retaining the same file/body/idempotency key for uncertain upload recovery; synchronous snapshot reference updates between conversation creation and message send; monotonic state reads; permission-loss closure of source/document/proposal/action modals; and session-expiry removal of stale workspace content. Work/Company tabs support arrow/Home/End keyboard movement, dialogs trap/restore focus, and narrow layouts stack the working panels.

### Verification recorded by this worker

- Installed Next 16 documentation read before code: `use-client.md`, `11-css.md`, and the server/client component guide.
- `npm run check` passed after implementation (subsequent parallel route generation may temporarily invalidate `.next` type cache; root owns final integrated checks).
- `node --import tsx --test tests/ui/v2-review-intent.test.ts`: 2 passing tests covering replacement proposals, version changes, invalidated state, revoked/missing access, changed action hashes, already-dispatched and uncertain actions.
- Live IAB screenshot/AX inspection of the implemented empty home at `http://localhost:3091` showed the required nav, useful-first composer, attention/memory/source panels and no unsolicited matter. Root took exclusive ownership of the shared browser tab for the complete functional walkthrough; this worker stopped browser interaction to avoid interference. This observation is a rendered UI check, not legal/domain acceptance or provider evidence.

Pending independent verification remains J01–J10 end to end under the final integrated code, restricted-scope leakage checks, full responsive/zoom/screen-reader testing and qualified legal review. Root maintains the final evidence ledger and browser artifacts. Frontend controls do not turn an unconfigured provider, unreviewed legal source, transcript paste or manual attestation into proof of a live integration.

### Follow-on live browser acceptance, isolated local state

This worker then held exclusive control of IAB tab 1 at `http://localhost:3091`, backed by root's isolated `/private/tmp/kiara-v2-development-3091` test state. All content entered was explicitly fictional acceptance data; no actual counsel engagement, provider delivery or legal assessment was performed.

| Browser check | Observed result |
|---|---|
| Team conversation asks about planned AI summaries | Durable user/assistant messages and linked exploratory scenario; current company facts remained separate |
| Explicit scenario adoption | One new team matter in Needs facts. Root's separate private matter remained separate; no duplicated adoption observed |
| Fictional executed Acme DPA text intake | Saved document appears with Agreement, revision 1 and Signed original authority; source is inspectable and retained separately from proposals |
| Factual correction/confirmation | Founder proposed planned/not-deployed assertion; switching to engineer allowed separate confirmation; visible status became Confirmed while practice remained Planned |
| Private versus team access | Founder saw two matters; engineer, counsel and publisher saw only the team matter. Private root matter did not appear in their Work list |
| Prepare and business review | Prepared packet included confirmed planned fact, agreement inventory gap and legal coverage unknowns; exact frozen business preview recorded actor/capacity/version |
| No counsel | Referral route became Unavailable with no recipient/engagement, named local founder owner, exportable packet and open Legal review state |
| Counsel review | Local counsel role could record the exact legal decision; explicit test note stated this was fictional role-bound qualification, not certified legal judgment |
| Exact action | Founder planned an internal review-packet task; publisher saw frozen exact content/destination/no recipients and authorized it. Result stayed Pending manual with matter Executing; no external effect was reported |
| Completion honesty | No completion attestation was invented for the browser run. Action remained pending with an Add completion evidence control |
| Mobile 390 / 320 | Matter/no-counsel view had viewport, body and document width equal to 390 and 320 respectively; no page overflow observed |
| Narrow document dialog | At viewport 320 the modal measured 300px; initial focus was the dialog; Escape closed it |
| Keyboard Company tabs | ArrowRight from Context selected and focused Preferences |
| Public page | v2 headline and capability boundaries present; 1280 and 320 viewport/body widths matched; desktop and mobile screenshots visually inspected |
| Browser reset | Temporary viewport override reset after checks; tab left on `/welcome`; root informed that test session role remained publisher |

The tests found and corrected frontend issues: nonempty-workspace rehearsal link; missing fact-proposal/manual-evidence controls; stale-role/source content; labels whose help text polluted accessible names; a publication default applied to a review packet; and incomplete exact-preview version comparison. The default action is now an internal review packet, while explicit publication remains a separately selected action requiring the exact content and destination. A service-level observation—zero open tasks while a legal blocker remained—was reported to the platform owner for durable task correction. Browser console contained a historical React hot-reload dependency-array warning from active source editing; later inspections showed the dev issue badge cleared. A clean reload/final build is still part of root's final verification.

Screenshots were returned inline by the supported browser API and visually inspected. That API's documented screenshot methods return bytes without a filesystem save destination; this worker did not invent an unsupported save method. Root owns the final rendered-artifact handoff.

The frontend also renders durable queued/running/blocked/unknown AI run states from the shared snapshot and polls more frequently while a response is running. This is support for the connected provider contract, not evidence of a live model result. The UI does not claim an answer exists when only the user message has been saved.

### Counsel lifecycle interface follow-up

`CounselPanel.tsx` now uses the authoritative counsel commands for attributed conflicts/intake evidence and a provisioned reviewer; exact engagement scope, professional fee cap/currency and response deadline; full selected source-record packet preview; exact server-derived packet hash, recipient and expiry approval; assigned reviewer evidence requests or successor proposals; and owner revocation/escalation. The no-provider route remains explicitly unavailable and exportable. No invitation, provider verification or payment is implied. The terms entered while preparing the original request are no longer presented as approved terms; the actual engagement decision has its own screen.

Every modal freezes the inspected engagement/proposal version. Field edits clear its confirmation, refreshed packet/recipient/version changes disable submission, identity/access loss closes the preview, and ambiguous command retries retain the shared idempotency envelope with a Check saved decision control. `ReviewDialog.tsx` now supplies the shared focus-trapped dialog for both existing and counsel controls.

`npm run check` passed after counsel integration. The focused review-intent suite now has 3 passing tests, including changed packet/source fingerprint, recipient, lifecycle version and withdrawn counsel access. Browser counsel lifecycle acceptance remains pending a coordinated handoff of the shared tab; no success is claimed from source inspection alone.

### Live counsel lifecycle acceptance

After root handed back the browser, the current code was exercised on the same isolated synthetic team matter. Named fictional counsel request became Intake pending; attributed simulated intake/conflicts evidence bound provisioned `local-counsel`; a separate nonbinding test scope with explicit USD 0 cap and response deadline became Sharing pending. The exact sharing dialog displayed its server fingerprint, named recipient, expiry, full Acme source text, factual assertion and proposed work. Approval moved the record to Review pending without email or provider effects.

Switching to the assigned counsel exposed Return edits or request evidence while the founder's private matter remained absent. An evidence request moved the matter to Needs facts. A successor proposal return then moved it to Business review; the previous business, legal and internal-action approvals visibly became Invalidated and the previous pending action became Planned. Owner escalation for a simulated budget increase revoked the packet grant and returned engagement to pending, with the next owner action retained. The UI now marks prior terms approval withdrawn when that happens.

At 320px the counsel dialog measured 300px and body/document widths both remained 320px; initial focus was the dialog and Escape closed it. Desktop sharing and narrow engagement screenshots were inspected inline. Temporary viewport was reset and the shared tab was released back to root at the founder's Counsel view. This is evidence of local software behavior on synthetic data, not provider-verified conflicts, real engagement, legal clearance or payment.

Additional interface completion: expired/absent identity now offers the root's organization sign-in route; an exact no-action decision records assessment rationale/reopen conditions, and matter closure has a separate frozen outcome/evidence review with completed-actions versus authorized-no-action selection. These new outcome controls were typechecked but were not used to fabricate completion in the browser run.

### Executed learning and final interface wave

The supported procedure lifecycle was exercised in the browser before final holdout-custody tightening: founder proposed the fixed release-evidence guard; `local-evaluator` ran the server-owned frozen suite (7 cases, 3 baseline failures, 0 candidate failures); the evaluator's promotion control was disabled; founder inspected and promoted the exact evaluation. Preparing the later team matter “Fictional later deployment review” recorded one application. An explicit rollback showed one affected matter and inactive status. These are executed deterministic guard results, not legal or model-quality performance. The subsequent custody fix withholds held-out rows from the author/non-evaluator; the interface now uses totalCaseCount and clearly states withheldHoldoutCount instead of presenting visible row count as the whole suite.

Additional implemented interfaces, with typecheck passing, include:

- `ExecutionControls.tsx`: a separate server-derived preview of exact mode, sender, recipients, destination/content and preview hash, followed by explicit execution. Internal document creation, live email, email preview, and publication read-back have distinct labels. Ambiguous responses switch to reconciliation; read-back never initiates a duplicate dispatch. Provider completion is shown only from the returned effect.
- `ObligationsPanel.tsx`: explicit owner/date/type/source-clause/calculation/fulfillment-criteria proposal; capacity-specific exact basis review; pre-bound action evidence or clearly attributed human completion; distinct acknowledgment, cancellation, overdue and completed-late states. Legal/contractual fulfillment requires legal reviewer capacity. No legal due date is inferred automatically.
- `EffortPanel.tsx`: user-started elapsed timers including idle time, manual stage reports, own-record exclusion with a reason, and owner-entered observed or estimated comparable baselines. The server's difference is shown once across all stages with running/open-work/coverage limits; it is not labeled validated savings.
- `CoveragePanel.tsx`: retained legal-source registry, exact source revision verification, domain/jurisdiction and access-scoped coverage definition, named review evidence/due dates/limitations, and unavailable states. An attestation is not described as external certification.
- `VoiceCapture.tsx`: browser SpeechRecognition/Webkit feature detection, explicit microphone/speech-service choice and start/stop, interim text, failure fallback, abort-on-close, transcript editing and separate confirmation before shared message submission. No microphone was started during automated acceptance. API and browser-service limitations checked against [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) and [result events](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/result_event).
- Separate proposed amendment creation retains the original document identity/access scope and creates a draft lineage record. Executed authority is labeled “Marked executed”; storage retention does not establish signature verification.

After independent review, the counsel sharing control additionally checks the packet's preparedProposal identity/hash against the current proposal and directs users to prepare a fresh request when they differ. All consequential form edits clear confirmation. Learning renewal reviews the unchanged evaluated rule and its deadline; it does not silently revise behavior.

Latest-wave browser validation was temporarily interrupted by the localhost preview refusing connection during root's build/restart cycle. Root was informed; these latest interfaces are not counted as browser-passed until the resumed observations below.

### Resumed latest-wave browser results

The server was available; the old tab had retained a generated connection-error `data:` document that the browser URL policy would not bind. A fresh tab in the same IAB (tab 2) restored the authorized localhost session without resetting application state. All new records remained explicitly synthetic acceptance data.

| Check | Observed result |
|---|---|
| Voice input control | Supported browser exposed an idle microphone control gated by explicit choice; no microphone or speech permission was started. A typed, edited and separately confirmed transcript became a retained Voice conversation and exploratory scenario. No new matter or fact was created |
| Executed-document amendment | Separate fictional amendment saved as Draft, revision 1, alongside original Acme DPA revision 1, now correctly labeled Marked executed. The original was unchanged |
| Internal response obligation | Explicit local date saved with visible UTC equivalent, owner, rationale and fulfillment criteria. The proposal required a separate exact basis approval |
| Acknowledgment versus fulfillment | Acknowledge left the obligation Active. Separate attributed evidence of the actually observed two-document condition changed it to Fulfilled, labeled Human attestation |
| Elapsed effort | Explicit start/stop retained 0.5 minutes of actual acceptance elapsed time including tool latency/idle time. A separately entered five-minute synthetic Estimate baseline showed a 4.5-minute difference and explicit incomplete/open-work/no-savings limitations |
| Exact execution | Fresh proposal business and fictional local-counsel decisions, internal action plan, separate authorization and server-derived execution preview were all distinct. Preview named no sender, recipients or external destination. Explicit creation returned Verified by read-back and retained a new Draft in Documents |
| Coverage registry | Explicit fictional contract source/domain/jurisdiction was registered. It remained Source verification pending; founder's Verify source revision control was disabled. No qualified legal-coverage assessment is claimed |
| Latest narrow layout | At 320px the coverage definition dialog was 300px, body/document widths were 320px, initial focus was the dialog, and Escape closed it. The inline screenshot was visually clean |

The native datetime field worked through the documented AX `setValue` control when the Playwright fill abstraction did not preserve its value. This was an automation limitation, not a product-state failure. An obsolete obligation-review blocker after fulfillment was reported to root and root owned its backend repair. The verified execution dialog was refined to show retained completion evidence rather than a reconciliation heading and to summarize the internal storage receipt instead of exposing raw encryption metadata.

### Recovery and document revision completion

`RecoveryPanel.tsx` exposes only the backend's opaque control records after evidence access is removed: owned affected work IDs/status and effect counts, withdrawal of future work with an exact version/reason/confirmation, and own unavailable timer stop or exclusion. Removed titles, evidence and history are not recreated. Completed or uncertain external effects are explicitly retained rather than claimed reversed.

`DocumentDetails.tsx` and shared intake now provide template-to-draft named substitutions with full exact draft preview; immutable returned-draft revisions through pasted text or retained Word/plain-text upload; server-derived current-head eligibility; revision history; authenticated retained-original download; and exact extracted-text comparison with clearly labeled additions/removals and limitations for formatting, annotations, signatures and tracked changes. Executed/effective originals remain on the separate amendment path. Old authority and approvals do not transfer to returned drafts. Current heads come from the service's globally derived, access-filtered `documentHeadIds`, so a missing inaccessible successor cannot make a historical revision appear current.

Typecheck and the three exact-review tests passed after this interface completion. These final recovery/template/reimport/compare additions await the next coordinated browser handoff; they are not included in the passed table above yet.

### Final coordinated document and recovery observations

The final browser handoff exercised the actual interfaces on the isolated localhost workspace:

- Retained a fictional template with `PARTY` and `PURPOSE` fields. Explicit full-preview confirmation produced a separate Draft, leaving the template intact.
- Imported revised draft text with a required revision note. Documents listed revision 2 as the current head; revision 1 remained in history. Server comparison showed the exact removed sentence and two added sentences, with formatting/signature/tracked-change limitations visible.
- Created a new disposable synthetic matter and linked evidence, then explicitly started its timer. Revoking only that synthetic source hid the source title and matter from normal views. Recovery showed only opaque references, state and zero effect counts.
- Stopped the owned unavailable timer with an attributed elapsed-time note; no removed evidence content reappeared. A separate exact-version withdrawal with reason changed the opaque work state to Canceled. Other sources and matters remained available.
- Inspected the source-deletion review dialog. It named the exact source/version, irreversible content removal, separate original/index/history/backup states and reconciliation exceptions. Submission remained disabled without a reason and confirmation. The dialog was closed without performing permanent deletion.

Snapshot authorization failures (401/403) now clear stale content and editors. Actor/tenant changes clear the previous identity's draft, selected records and uncertain-command display. `SourceAccessPanel.tsx` exposes exact source revocation/deletion requests and generic, admin-visible deletion-progress records without claiming immediate erasure. No deletion job's real backup cleanup was qualified by this worker.

First-session visual inspection at 1280×720 found the composer below the original starter-card grid. The composer now precedes the secondary starter cards: its textarea spans y=453–549px at 1280×720 and ends at y=576px at 390×844. Mobile body/document widths equal the viewport; the primary input is visible without scrolling. The later public copy accurately distinguishes supported document intake/browser voice from configured external services.

### Saved rendered artifacts

The supported browser screenshot API returns image bytes. Those bytes were saved with standard Node filesystem I/O, then the files were visually inspected. This supersedes the earlier screenshot-save limitation recorded above. These are renders of implemented UI using fictional acceptance data, not generated mockups:

- [Workspace desktop](renders/workspace-desktop.png)
- [Workspace mobile](renders/workspace-mobile.png)
- [Public desktop](renders/public-desktop.png)
- [Public mobile](renders/public-mobile.png)
- [Document comparison desktop](renders/document-comparison-desktop.png)

Final worker checks: `npm run check` passed after recovery, source-access and document lifecycle UI integration; all three exact-preview tests passed; `git diff --check` passed before handoff. Root owns the final integrated build, full suite and production/connected-service qualification. Browser tab 2 was left on the working home preview as founder with the viewport override reset.

### Collaboration audit and implementation

A new full-contract pass identified three specific missing paths: selected scenario sharing without private conversation history (§4, §14, §16); accepted, scoped routing preferences that preserve authority (§6, §12); and explicit conversation-to-existing-matter continuity with identical visibility (§3, §16). `src/v2/collaboration.ts` and `CollaborationPanel.tsx` implement these bounded paths. Safe recipient views contain selected immutable text, attribution, recipients and expiry; origin IDs and source provenance stay outside that projection. Underlying source access is never granted by the sharing command. Scenario/source/fact/membership revision changes and expiry withdraw recipient viewing.

Routing has distinct offer, recipient acceptance and grantor application steps, for one matter and named factual/business/legal topics. The recipient must already have the corresponding capacity and matter access. Current task ownership is derived at use time; expiry or withdrawal restores the recorded owner, with required review tasks and approval gates unchanged. No provider notification is claimed. Conversation linkage asserts exact conversation/matter versions and identical visibility; it does not duplicate a matter or broaden private access.

Nine focused collaboration tests passed, including no private history/origin-ID disclosure, inaccessible evidence refusal, stale/expired/member-changed sharing, two-party routing, expiry fallback, private-to-team denial, another owner's same-scope private-link denial, and current/historical deletion redaction. Independent review found no blocking issue; the independent combined collaboration, document-route and inventory/index run passed 20 tests.

The actual browser sequence used explicitly fictional data: selected only the synthetic/no-customer-data assumption from a private two-assumption scenario; provisioned engineer saw only the selected title/text in Company → Sharing and the private conversation remained absent. Founder offered factual routing for `5832bb99-bea5-45fa-8ca6-790b71453fb3`; engineer accepted; founder separately applied it; the task owner changed to engineer while Pending and Needs facts stayed visible. Withdrawal restored founder ownership. A same-scope team conversation linked to that existing matter and both navigation paths returned to the same records without increasing the work count.

### Supplied agreement inventory

`InventoryPanel.tsx` in Work → Evidence displays the complete server-enumerated current agreement/amendment register, including draft and unknown-authority records, with exact version/hash and inspectable bodies. A named factual owner chooses retained completeness evidence, describes a bounded customer/business population, specifies expiry, and separately confirms the full register. Current/stale/withdrawn status remains explicit. Prepared work distinguishes “Supplied register attested” from legal applicability and external discovery.

Browser acceptance inspected both the fictional original Acme agreement and separate draft amendment, then recorded an explicitly synthetic two-record population attestation by `local-engineer`. The saved record displayed named ownership, expiry and the register hash. No real customer inventory completeness or legal conclusion was asserted.

Fixture provenance correction: the localhost preview used the configured MongoDB store for these earlier synthetic browser records. A later restart with MongoDB disabled opened an empty filesystem-backed local workspace; the prior records remained intact in their original store. These observations establish executed preview behavior, not managed Atlas topology, production readiness or live provider qualification. After the store distinction was discovered, this worker neither read/copied remote payloads nor reconnected the preview to that store. Subsequent browser checks use fresh local-only fixtures.

Additional renders: `renders/scenario-shared-recipient-desktop.png` and `renders/accepted-routing-desktop.png` record implemented collaboration UI. The original full-page inventory capture had an IAB scaling/padding limitation. It was replaced with a visually inspected, clean normal-viewport render from the fresh local-only fixture run below.

### Attention and source-recovery follow-up

`AttentionPanel.tsx` now renders the server's current actor-specific feed on the home surface and Activity, including separate Now and Digest placement, typed recorded deadlines, required escalation, and retained acknowledgment. Exact-fingerprint acknowledgment/dismissal requires an attributed reason; required items cannot be dismissed, and acknowledgment is never completion or a relevance-training label. Personal timezone, quiet hours, in-app digest time and approaching-deadline threshold have exact-version settings dialogs. Required escalations bypass ordinary grouping; no external delivery is claimed. Preferences now use current server values across identity changes.

`RecoveryPanel.tsx` adds an admin's exact opaque-source deletion review after prior revocation. The source ID/version, irreversible content removal and separate cleanup obligations are shown; removed titles/content remain unavailable. Both active-source and recovery commands assert the inspected source version server-side. Browser checks will inspect this control without performing irreversible deletion.

The attention integration passed typecheck and the seven combined server-attention/exact-preview checks. Browser attention/recovery observations will be appended after the local-only fixture run.


### Fresh local-only attention and recovery acceptance

The next browser sequence used an explicitly opened fictional rehearsal in the filesystem-backed local-only preview, with no read or copy of earlier remote payloads. A newly created synthetic matter remained Pending / Needs facts throughout ordinary attention dismissal. Quiet hours in America/New_York grouped ordinary updates in Digest. Preparing its review packet created new attention bases, and an explicitly unavailable counsel route appeared as required attention in Now despite quiet hours. Exact-item acknowledgment left the escalation visible as “Acknowledged · still open”; no dismissal control or completed-work claim appeared for it.

At 390px, body and document width matched the viewport. At 320px, the personal-settings dialog measured 300px, keyboard focus entered the dialog, and Escape closed it. The viewport override was reset after testing. Clean saved renders are [required attention desktop](renders/attention-required-desktop.png) and [attention mobile](renders/attention-mobile.png).

Work → Evidence displayed the one fictional Acme agreement in the fresh supplied register. The named factual owner recorded an explicitly bounded synthetic completeness attestation against that exact head and retained evidence. The [inventory render](renders/inventory-attestation-desktop.png) now records this clean local-only result.

A separate disposable synthetic source was retained and then revoked. Normal source lists removed its title and body. Recovery exposed only its opaque ID, version and Revoked state. The [removed-source deletion preview](renders/removed-source-deletion-preview.png) showed that exact opaque reference, separate retention/cleanup states, and a disabled submission until a reason and confirmation are supplied. It was closed without performing irreversible deletion. Final typecheck passed after these UI changes. These observations establish local product behavior; external delivery, legal qualification, backup deletion and remote database deployment remain outside this browser evidence.


### Legal-source maintenance interface

`LegalMaintenancePanel.tsx` is part of Company → Legal coverage. It exposes the server's authority-specific URL-policy availability, monitoring owner/status/schedule, blocked or overdue checks, and pending observations without implying successful retrieval or legal qualification. Named legal reviewers inspect both complete retained texts and exact hashes before recording applicability. Affected matters/rules must share the source's audience; their inspected versions and the authority/change/source revisions are frozen in the dialog. Source adoption is a separate unchecked choice, explicitly followed by new source verification and dependent coverage review.

A fresh local fictional registry entry with an example.com reference demonstrated that configuration remains disabled even for the legal-reviewer simulation when the operator policy is absent. No browser or worker HTTP source fetch was requested. [Unconfigured source monitor](renders/source-monitor-unconfigured.png) records the actual default state. Configured observation/assessment behavior is covered by root's injected-fetch service tests; this worker did not browser-qualify live monitoring or make a legal assessment.

### Natural drafting and bounded internal preparation

`DraftingPanel.tsx` binds requests to an explicitly selected current document revision and renders typed draft artifacts independently from conversation prose. Full-content decision dialogs freeze the proposal version/hash, selected conversation, mapped fact versions, and exact template permission. Acceptance retains a separate draft or a proposed work plan; rejection records a reason. Earlier proposals remain inspectable in a collapsed history. Template approval controls in Documents map every placeholder to a scalar fact predicate, name the purpose, expiry and reviewer, and leave standing internal preparation unchecked by default. Merely importing a template is labeled “Template text · review required.”

Fresh local-only browser acceptance passed this complete bounded journey:

1. Retained a fictional internal note template containing `{{COMPANY}}`. The local legal-reviewer simulation approved its exact revision, one short-text mapping to `fictional_company_label`, a next-day expiry, and explicitly bounded fictional internal preparation.
2. A natural draft request without a selected document produced a retained Needs input artifact and no document. Selecting the exact template and requesting a draft again produced the specific missing confirmed-fact question; the proposal remained unacceptable.
3. The factual owner explicitly proposed and confirmed the fictional scalar value. Another request in the same conversation generated the exact unchanged template substitution. The preview displayed full content, proposal/basis hashes, named factual attribution/version and the internal-only scope.
4. Explicit acceptance retained a separate unsigned Draft with the exact preview hash and selected it as the conversation's working document. The template and executed agreement remained separate. A subsequent “Make it shorter” request honestly reported that semantic rewriting needs a configured model; no document or matter changed.
5. An older incomplete proposal was rejected with an attributed reason and remained in history. The accepted eligible draft's separate “Prepare internal retention for review” control displayed the exact purpose, reviewer, expiry, content and fact basis before creating one linked Business review matter. The business decision and exact internal-action authorization stayed pending. No execution was dispatched by this browser sequence.

The internal route's Work view now explains its bounded template basis and required remaining decisions rather than presenting a customer-agreement inventory as its prerequisite. This does not allow external actions or changed terms through standing permission. The server remains the authority for current policy eligibility and action admission.

At 390×844, the draft-review dialog measured 370px and both body/document widths were 390px. Keyboard focus was visible; the complete proposal remained scrollable within the dialog. The viewport override was reset. Visually inspected artifacts: [exact draft desktop](renders/draft-exact-preview-desktop.png), [exact draft mobile](renders/draft-exact-preview-mobile.png), and [retained accepted draft](renders/accepted-draft-desktop.png). No live model, legal-service or external-provider execution was qualified by this UI worker.

`SlackDeliveryStatus.tsx` separately projects only the current conversation's server-authorized operational status. Prepared/generated answers are not called delivered; an attempted dispatch stays confirmation-pending; only exact readback is labeled verified. Unknown delivery explicitly advises against resending and provides no duplicate-send control. The local workspace has no Slack installation, so these status branches rely on regression's injected-provider/server tests rather than fabricated browser delivery.

### Second full-target audit after drafting, attention, monitoring and Slack

This pass re-read the v2 plan, especially §§3–6, 12, 15–17, and inspected current service, draft, attention, procedure, voice and delivery implementations. Implemented safety/workflow behavior and customer-quality qualification remain distinct.

| §16 scenario | Current evidence and remaining product limit |
|---|---|
| Explain this contract | Supplied-document local explanation and source inspection exist without creating a matter. Model-backed explanation has bounded evidence and support checks; independent legal/domain quality and useful-output acceptance remain unqualified. |
| Hypothetical retention | Scenario branch/adoption separation, selective sharing and no company-fact promotion tested. Scenario reasoning remains bounded/local unless a model is configured. |
| Ambiguous go ahead | Bare assent produces no approval or effect and points to exact visual controls. Broader intent paraphrase coverage needs a frozen intent benchmark. |
| Unauthorized correction | Attributed candidate/confirmation/supersession gates exist. Natural correction currently asks the user to open the fact control rather than extracting a structured candidate automatically. |
| Explicit personal preference | Personal response length and reversible settings exist; attention/routing are typed. Natural-language preference understanding is a small deterministic pattern set. |
| First session without integrations | Real question/document/draft paths exist; fictional rehearsal stays separate. Time-to-user-accepted-useful-output and goal progress are missing and are assigned as the next value slice. A company with no template still needs a reviewed template supplied; no prequalified template catalog is claimed. |
| Event during conversation | Selected event correlation and explicit same-scope conversation linkage preserve one matter; regression owns integration replay proof. Live provider deployment qualification remains separate. |
| Restricted evidence | Access/lineage checks span conversation, selected scenario projection, counsel packets, attention and Slack audience controls; revocation/deletion regressions exist. Newly added feedback/value records must obey the same rules. |
| Stale/unsupported coverage | Registry, named verification, source observations/applicability review, visible stale state and pending work exist. Named qualified real-world legal coverage has not been supplied or independently certified. |
| No counsel | Exportable scoped packet, accountable pending work, explicit unavailability, escalation and required attention exist. A live referral/provider-capacity operation remains unconfigured. |
| Counsel changes v3 | Exact prepared-packet identity and returned edits invalidate earlier approvals; final dispatch checks current dependencies. |
| Merged versus deployed | Planned/live fact distinction and evaluated release-evidence procedure exist. Confirmation never comes from merge alone. |
| Signed changes | Separate amendment and immutable originals/current heads exist. Neither imported executed text nor a generated draft proves a signature. |
| Send timeout | Broker/Slack ambiguity stays uncertain with reconciliation and no blind resend; provider adapters are qualified by injected tests, not live sends. |
| Lesson regression | One deterministic guard has independent frozen replay, promotion, expiry, rollback and affected-work identification. Model/retrieval/drafting strategy improvement has no equivalent controlled product loop yet. |
| Misheard voice | Opt-in capture, editable transcript, explicit names/dates/amounts confirmation, retained transcript and separate visual action gates exist. Actual microphone/provider speech quality and interruption behavior have not been exercised; no structured interpretation summary or targeted ambiguity detector is implemented. |

The largest remaining customer bottleneck is evidence of useful work, not additional controls: a founder can now obtain a draft but cannot record whether an explanation/scenario/draft satisfied the original goal or see honest first-output timing. The next owned slice is `src/v2/value.ts`, its scoped service contract and UI, with durable first-work observation, exact output usefulness receipts, separate user-reported goal achievement and rehearsal exclusion. It must not treat generated text, a clicked approval or an opened rehearsal as customer activation.

The next independent learning slice should capture classified reasons from returned edits, rejected drafts, factual corrections and observed outcomes against their exact versions. A strategy candidate must name a finite prompt/retrieval/drafting configuration, preserve tenant/evidence custody, and be compared by an independent evaluator on the original failure, near misses and protected holdout. Promotion needs frozen results, responsible owner approval, shadow evidence, effective/review dates and a rollback target; recurrence and all human review/correction effort should be measured afterward. Current manual lesson prose and the one release guard do not satisfy this probabilistic strategy-learning requirement. Recommended ownership: root/evaluation worker for candidate/configuration registry and corpus custody; platform for bounded generation/retrieval application; product for inspectable before/after comparisons and review decisions.

The next notification slice must distinguish in-app attention from an actual configured delivery promise. Current quiet/digest controls organize in-app items; Slack continuity sends authorized thread replies, not general background escalation/digest notifications. Add explicit owner-selected verified channel/destination grants, immutable digest/escalation intents, worker delivery/reconciliation, scope rechecks and channel-specific opt-out/quiet behavior. Required escalations remain visible even if external delivery fails. Email intake/secure review-link delivery is still a distinct missing adapter contract; no existing UI should imply it is active. Recommended ownership: root/integrations for authorization and workers, regression for uncertainty/replay/scope tests, product for channel expectation and status.

Voice's next bounded improvement is a frozen interpretation summary that visibly separates corrected entities, dates/amounts, factual candidates and proposed actions from the transcript before any consequential mutation. A typed transcript correction can be tested without microphone access; live speech-provider retention and recognition quality require separate qualification. Existing exact action approvals must remain the only path to external effect.


Root independently continued the standing internal path through business decision, exact authorization, internal broker execution, verified readback and evidenced matter closure. The resulting closed-state UI now shows its recorded rationale and steps, retains effect evidence, and disables new review/action controls. Canceled work separately keeps any unresolved-effect blockers visible. The standing plan dialog offers only exact immutable internal retention content, with no external destination/recipient fields. Root captured the independent result in `renders/standing-internal-verified.png`.

Checkpoint checks after this wave: typecheck passed; all 12 focused collaboration/exact-review tests passed; `git diff --check` passed. The next value-measurement wave has been assigned separately and is not included in these passed claims.

### Observed first-work value and exact private feedback

This wave implements the value slice identified in the preceding audit. `src/v2/value.ts` retains one first-work baseline per actor, observed at the first admitted request/import/goal command. For an existing workspace it explicitly labels the earliest retained own work as a potentially incomplete baseline. New questions, conversations and goals do not reset it. Generated-output timing is observed only after committed preparation, including asynchronous answer completion; it never implies usefulness or goal success.

Private goal, exact-output usefulness/needs-work receipts, withdrawal corrections and separately attributed goal-progress reports now appear in the conversation side panel and Activity. Output assessment freezes the version, full content and server-generated evidence-lineage hash. Reporting a goal achieved requires that person's available useful-output receipt for that exact goal, while matter state and legal/execution gates remain unchanged. Historical receipts identify their inspected version; they do not certify the current revision. Current container/evidence access gates the views and counts. The original first-useful receipt remains pinned; withdrawal or lost access makes its timing unavailable instead of replacing it with a later favorable result. The downloadable aggregate contains only the current actor's authorized numeric report and interpretation, with no names, IDs or source/output text. Rehearsal feedback remains inspectable and is excluded from observed-value metrics.

Fresh local fictional browser acceptance passed goal definition → natural agreement question → full exact answer preview and explicit usefulness reason → separately supported user-reported goal achievement → withdrawal correction. The existing counsel matter stayed open throughout; after correction, the goal correctly displayed “Reported outcome · receipt unavailable” and the withdrawn report remained in history. Rehearsal metrics read “Excluded,” and the earlier retained baseline stayed unchanged. At 320×800 a metric-word overflow was identified and repaired with a stacked responsive value-stat layout; body and document widths then measured 320px and the dialog 300px. Desktop/mobile renders were visually inspected: [exact usefulness preview](renders/usefulness-exact-preview.png), [value record and corrected outcome](renders/value-goal-record.png), [mobile goal progress](renders/value-progress-mobile.png).

The same wave repairs factual scalar entry: choosing Text, Number or True/false is explicit, candidates display the retained value type, and zero/false remain valid values. Browser-created `fictional_typed_boolean_acceptance=false` and `fictional_typed_number_acceptance=0` remained unconfirmed candidates. No factual or legal authority was inferred from saving those test inputs.

Root's independent integration review found that a measurement observer could throw after a user's own membership revocation, rolling back the authority-reducing command. The observer now skips measurement when the current actor/session is invalid. The actual service self-revoke regression asserts retained revocation despite the subsequent snapshot denial, and the existing asynchronous support-review test again prevents attaching an answer after revocation. All 33 focused value/AI tests passed (12 value, 21 AI), using isolated temporary stores and an injected provider; no live model request was made. Typecheck and diff validation passed before the final auth-link-only edit; assembled final checks remain the lead's responsibility.

### Explicit email expectation and secure attention entry

`NotificationPanel.tsx` presents the separately verified email identity, preview/live transport, personal opt-in, exact grant fingerprint and latest delivery statuses. Configuration is disabled when no current operator-verified identity/origin exists. Its frozen review distinguishes daily digest from required alerts plus digest and keeps in-app required attention visible even if email is disabled. Prepared, attempted, provider-accepted, delivery-verified, failed, canceled, preview and unknown states use separate labels. Accepted/unknown attempts expose only exact receipt readback; no resend control exists. Readback checks the original attempt and cannot authorize a second send.

The actual default browser showed “Email notifications off,” no current configured recipient, and a disabled preference control. The authenticated attention link opened `/review/attention` directly on Activity. The sign-in link on that route uses the single allowed attention return target; root owns the signed OIDC return validation. [Unconfigured notification view](renders/notifications-unconfigured.png) records the honest default. This worker did not opt into a real recipient or send/reconcile live email. Configured delivery and ambiguous-send behavior require the root/regression injected-provider evidence and operator deployment qualification.

These mechanisms close the earlier audit's missing value-record and notification-expectation surfaces. They do not establish customer usefulness, legal quality, realized savings, live notification reliability or probabilistic strategy-learning qualification. Independent learned strategy evaluation and email-intake preview remain the next assigned bounded interfaces.

### Preview notification and received-email decisions

Configured preview-only browser acceptance used the isolated local fictional workspace, the synthetic `founder@example.test` recipient and a protected exact grant. The founder inspected the destination, preview transport and grant fingerprint before enabling required alerts plus digest. Native time entry was verified against the dialog's rendered “Schedule to save” before saving quiet hours off and digest 00:00. The root's preview helper then produced one daily attention record; the UI displayed “Preview only · no email delivered” and “Preview not delivery.” No provider request or actual email was sent. [Configured preview result](renders/notifications-preview-result.png) preserves this distinction.

The Connections received-email panel now opens a receiving-owner-only exact retained-source preview. It separates claimed sender, provider authentication, extracted plain text, unparsed attachment metadata, source authority and original retention, and freezes source version/content/receipt hashes. Only a quarantined record offers explicit admission or rejection. Admission is labeled “Admitted as untrusted evidence”; it grants no company-fact, legal or execution authority. Interrupted decision responses retain the identical inspected payload for saved-result reconciliation, blocking intervening mutation. Role/access loss clears the preview; nonowners see no private intake summaries.

Using the regression worker's explicitly synthetic, injected-network fixtures, the real browser admitted the `accept evidence` record and rejected the `reject evidence` record. Reopening the admitted source showed version 2 and only read-only close controls. Switching to the evaluator hid both receiving-owner records. The 320px dialog measured 300px with a 320px body; limitation paragraphs were stacked after visual review. [Exact intake preview](renders/email-quarantine-exact-preview.png), [mobile intake preview](renders/email-quarantine-mobile.png), and [two recorded decisions](renders/email-intake-decisions.png) record the local acceptance. Fixtures explicitly state that no actual email was received or sent.

### Classified feedback and finite controlled strategy adoption

Company → Learning now provides full retained-output inspection, category-specific attributed feedback, withdrawal, inactive catalog proposal, independent server evaluation, no-effect observation, exact adoption and rollback. Feedback freezes the output version and hash; retrieval reports additionally name a current same-audience document. Legal judgment and business preference require their corresponding capacities, while feedback does not confirm facts or grant approval. Only replayable retrieval/rewriting fidelity categories can propose the two finite supported behaviors. Exact evaluation and observed-comparison hashes, expiry, evidence scope, and three distinct author/evaluator/owner identities stay visible. All held-out rows remain hidden from every UI actor; total and withheld counts are separate. The comparison does not qualify generalized learning, legal correctness or Atlas ranking changes.

Actual local browser acceptance created two clearly fictional documents: a keyword-title distractor and an exact Section 7 target. A team question produced a retained answer that omitted the target. The engineer inspected that exact answer and recorded/proposed a ranking correction; the author's evaluation control was disabled. A separate evaluator executed the frozen comparison: 6 baseline failures → 0 candidate failures over 7 total cases, with 3 held-out details withheld and the original issue improved. The evaluator could not start observation. A third founder identity inspected and started no-effect observation; adoption stayed disabled until a newly submitted team question produced one current comparison. That shadow answer retained the old distractor-first behavior. The founder then adopted the exact evaluation/comparison. A subsequent answer put the actual Section 7 target first. Explicit rollback stopped the strategy and retained one affected answer for review. The adopted behavior changed local deterministic ranking only, without a model or provider call. [Applied answer](renders/strategy-applied-answer.png) and [mobile exact adoption](renders/strategy-adoption-mobile.png) and [reviewed comparison history](renders/strategy-reviewed-history.png) are observed product renders; the latter measured body/dialog widths of 320/300px.

Root independently reviewed the StrategyPanel frozen intents and scope controls with no blocking finding. Typecheck passed after the email/strategy and run-status UI additions. Backend strategy tests and full assembled qualification remain separately owned by the lead/platform workers. This closes the finite feedback/adoption interface identified in the prior audit; probabilistic drafting/model improvement and real-customer learning performance remain unqualified.

### Initiating-owner stop controls and separate work completion

The conversation run panel now freezes the initiating owner's exact retained request, run ID/version and reason before stopping generation. Queued, running, generation-stopped/accounting-settling, terminal canceled and uncertain-charge states are distinct. The UI never implies a provider abort, refund, evidence deletion, revoked approval or reversed external effect. A changed run disables the frozen decision; interrupted commands retain the same saved-result reconciliation path. Cancellation accounting continues polling after generation stops.

Using the regression worker's synthetic queued and simulated-running fixtures, the actual browser canceled the queued run directly to terminal stopped/accounting-settled. The simulated-running record stopped generation and displayed pending accounting reconciliation, preserving the saved request and named reason. No model or provider network request was made. The exact stop dialog fits at 320px (300px dialog) and is recorded in [mobile stop review](renders/run-stop-exact-mobile.png); [pending accounting status](renders/run-stopped-accounting-pending.png) preserves the generation-versus-accounting distinction. After the lead's injected fixture recovery, the actual browser displayed terminal stopped with “Provider charge outcome remains unknown; the ledger retains the uncertainty.” The [terminal unknown-accounting render](renders/run-stopped-accounting-unknown.png) preserves that state.

Matter tasks now display explicit substantive-work, artifact-review and proposal-review purposes. The currently routed business/legal owner can inspect exact same-audience source versions and text before recording a named human attestation of substantive work. This is labeled human evidence, not provider verification or proposal legal clearance; adding it requires a fresh proposal basis. Artifact acceptance and exact business/legal proposal decisions remain separate controls. Prepared matter artifacts display the accepted objective, tasks and frozen matter/plan hashes, and clearly describe adoption as a review proposal rather than a new signed or effective document. Asynchronous matter preparation opens its returned linked conversation for run and artifact inspection. These task/preparation surfaces pass typecheck; their positive browser fixture is the next qualification step.
