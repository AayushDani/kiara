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
