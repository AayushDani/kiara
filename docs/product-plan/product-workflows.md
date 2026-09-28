# Kiara workflow and approval specification

26 September 2026 · Target product contract · Product and legal operations

This specification defines proposed product behavior, not legal conclusions for any particular company. The customer's authorized legal owner determines applicable obligations, jurisdiction coverage and delegated review policies. Northstar and RelayAI are fictional. Read alongside the [product definition](README.md), [screen specification](screen-specification.md) and [architecture specification](cto-architecture.md).

## 1. Work Kiara owns

Kiara brings a business change from evidence to an authorized decision and verified completion. Its core object is a **matter**, comprising the change, entities, sources, confirmed facts, uncertainties, applicable playbook, proposed work, tasks, decisions and completion record. A matter can end without a document change; changing product behavior can be the appropriate remedy.

Design for a 20–200-person B2B software company coordinating outside or fractional counsel. The founder or operations lead owns business decisions; engineering, sales and vendor owners answer scoped factual questions; counsel resolves legal choices; designated publishers and signatories execute approved actions. One person can hold several roles, with their capacity recorded at each decision.

The workspace navigation is **Inbox · Documents · Company context · Playbooks & learning · Connections · Activity**. The matter workspace contains **Overview · Evidence · Proposed changes · Approvals & delivery**. The assigned counsel room exposes only authorized material for named matters.

## 2. Three operating tiers

Review effort must match the work. Requiring a new consultation for every source event would defeat the product's purpose.

| Tier | Qualifying work | What happens |
|---|---|---|
| Deterministic triage | Duplicate delivery, excluded source/object, exact repeat of already evaluated revision, or a narrow approved irrelevance rule | Record the rule and event disposition; attach related evidence to an existing matter; suppress redundant notifications. No invented legal determination. |
| Standing-policy work | Confirmed facts satisfy every prerequisite of a current, counsel-approved playbook; no material exception | Prepare the specified work and record the exact delegated legal basis. The configured business and execution gates still apply. |
| Matter-specific review | New legal question, material deviation, conflicting commitment, unknown prerequisite, out-of-scope jurisdiction or changed negotiated terms | Prepare a bounded packet for the assigned legal reviewer; retain a visible owner while waiting. |

For example, an internal refactor with no changed data flow can receive a no-action disposition only under a narrow approved rule with sufficient factual evidence. “The model sees no risk” is not such a rule. A permitted routine register entry may use standing policy after all required vendor facts and contract checks pass. A new category of transcript processing or a conflicting negotiated customer clause routes to counsel.

Every automated disposition is auditable and sampled for missed work. A company can require human review for a workflow regardless of tier. Delegation is explicit, scoped and revocable; silence, a high model score or prior counsel approval of a superficially similar matter cannot establish it.

## 3. Onboarding creates decision rights as well as context

The four onboarding screens are **Choose sources → Confirm context → Assign decisions → See your first matter**. Users select repositories, channels and folders, or upload documents and submit a manual change. Scope and freshness remain visible. Background import can continue while useful permitted work begins.

Context confirmation prioritizes legal entities, products, markets, active document versions, key vendors, data practices and responsible owners. Signed originals, effective policies, templates and obsolete copies are distinct. Unreadable files and unknown facts remain explicit tasks, rather than being counted as understood context.

Assign decisions asks for a business owner, factual owners, legal reviewer or unassigned-counsel route, authorized external reviewers, publishers and signatories. Set the business calendar, reminders, sharing defaults and approved workflow packs. An administrator's connector grant establishes reading access, not legal or publication authority.

A workspace without counsel can investigate, assemble context and prepare drafts. It cannot pass a required legal gate without an appropriate reviewer or applicable preapproved policy. A workspace without documents receives a scoped inventory of missing materials and proposed creation matters. The last screen presents a real sourced matter when available; any rehearsal is prominently labeled.

## 4. Matter state and transition contract

Events first enter an immutable intake ledger. Only potentially actionable work creates a matter; duplicates and known irrelevant events do not fill the Inbox. Related PR, Slack and document events join one matter when entity and business-change identity match. Ambiguous matches are reviewable, and splitting or merging preserves provenance.

| State | Entry and permitted work | Exit condition |
|---|---|---|
| Observed | Authorized event linked to a candidate business change | Identity, source revision and initial scope recorded |
| Triaging | Correlate evidence, select playbook and assign accountable owner | Supported disposition or investigation route recorded |
| Needs facts | Ask named owners precise questions; show conflicts and missing sources | Required facts confirmed, or reviewer explicitly handles remaining uncertainty |
| Proposed | Assemble impact assessment, alternatives, draft bundle and verification findings | Packet is internally consistent and reviewable |
| Business review | Confirm intent, operational feasibility, counsel scope/budget and permitted sharing | Named business decisions recorded |
| Legal review | Apply standing-policy predicates or obtain matter-specific legal review | Scoped legal clearance, revision request or reasoned no-action decision |
| Approved for a specific action | Required gates satisfied; execution authority covers exact action | Preflight checks pass at dispatch time |
| Executing | Restricted executor performs only the authorized action | Provider result captured or uncertainty declared |
| Verifying | Reconcile actual result with authorized content, target and required evidence | Every required task is evidenced or returned to an owner |
| Closed | Record outcome, rationale and closure evidence | Reopen if a relevant correction or new event invalidates the decision |

Business and legal review may iterate. Material legal revisions to commercial intent return to the business owner. Fact requests can run in parallel; dependent approvals cannot. Each policy-authorized skipped gate has an explicit reason, including which standing delegation substituted for a fresh decision.

**Waiting on third party**, **Escalated**, **Stale approval** and **Execution uncertain** are blocking conditions alongside the underlying state and task. They never appear as successful completion. **Rejected** means a proposal was rejected, not necessarily that the matter is closed. The owner chooses revised work, an alternative or an authorized closure rationale. **No action** is a recorded outcome with applicable facts, rule or reviewer, and a reopen trigger. **Not now** requires an owner, reason and revisit date; it cannot conceal a verified deadline.

A matter closes only when all required tasks satisfy their completion criteria or an authorized reviewer records a supported no-action/withdrawn-change outcome. Handoff, queued publication and a signature request are intermediate events. A withdrawn feature does not automatically erase obligations already created by earlier activity.

## 5. Authority matrix

| Role | Explicit decisions | Boundary |
|---|---|---|
| Source administrator | Connection scopes, source access, connector recovery | Does not approve content or sharing beyond assigned authority |
| Fact owner | Confirm or correct facts within their remit | Does not establish legal interpretation |
| Business owner | Business intent, operational tradeoff, counsel instruction, review budget and packet sharing | Does not replace required legal clearance |
| Legal reviewer/counsel | Interpretation, required legal work, exact wording, legal no-action rationale and standing policies | Does not implicitly authorize publication, spend or signature |
| Publisher/sender | Exact approved content, destination/recipients, channel and timing | Cannot execute a changed version under an old approval |
| Signatory | Sign through the authorized signing process | Cannot establish another party's acceptance |
| Kiara | Triage, preparation, checks and explicitly delegated coordination/actions | Cannot enlarge its authority or promote its own proposed legal rule |

Delegation records principal, delegate, capacity, entities, action types, limits, effective/expiry dates and revocation. Standing publication or sending authority may exist only where the company explicitly configures it; a content playbook alone never provides that authority. Material exceptions remove the delegated route.

## 6. Proposal and document behavior

A proposal bundle contains a one-page business brief; facts and unknowns; source versions; relevant agreement clauses and definitions; recommended actions and alternatives; document redlines; open decisions; task dependencies; deadline derivation; reviewer route; and verification findings. Every proposed change links to the fact or approved rule that motivates it.

Document operations have different meanings:

| Document class | Product behavior |
|---|---|
| New document | Search the declared authoritative scope, then select an approved template; fill confirmed facts, flag legal choices and route review |
| Unsigned draft | Produce a new proposed revision, preserve the original and compare changes |
| Effective policy/public notice | Prepare a successor version with controlled publication and effective date; retain historical versions |
| Executed agreement | Preserve the signed original; prepare a separate amendment or replacement proposal, with negotiation and execution tasks as required |
| Internal register | Update through its defined operational approval policy, while separately checking whether the change triggers other obligations |

“No suitable document found” states which repositories were checked and any coverage gaps. It is never a claim that no document exists anywhere. Unresolved mandatory fields prevent an execution-ready version. The product preserves numbering, tables, comments and redlines where supported; unsupported fidelity creates a visible manual-editing task with a reviewable proposed change.

A reviewer can choose no document change, a narrower business change, a product configuration fix or a negotiated exception. The workflow must not assume that updating written promises resolves an underlying practice problem.

## 7. Approval and execution contract

The UI uses **Confirm fact**, **Authorize counsel sharing**, **Confirm business decision**, **Record legal clearance**, **Authorize publication**, **Authorize send** and **Request signature**. Each button names its consequence; there is no all-purpose approval.

An approval records actor and capacity, tenant/entity/matter, proposal hash, source snapshot, affected document/base revisions, playbook version, approved conditions, permitted recipients or destinations, action type, validity interval and timestamp. Clause-level acceptance informs editing but cannot stand in for final authorization of an unenumerated bundle.

Before dispatch, the executor checks current authority, source availability/freshness, unresolved conditions, target revision, approved content and action scope. Changed recipients, wording, relevant facts or target revisions invalidate affected decisions. Unaffected independent tasks retain valid approvals; the system explains which dependency caused re-review.

Each external action has a stable action ID and durable status. Publication verifies the resulting revision/content and destination. Notice tracking distinguishes attempted, accepted by provider, delivered, bounced and unknown; the required completion criterion is determined by the approved task. Signature workflows retain the final executed document and provider evidence. Docusign distinguishes recipient activity from completed-envelope status, reinforcing why a single signature or sent request cannot close a multi-party task. [Docusign completion guidance](https://www.docusign.com/blog/developers/dsdev-has-my-envelope-been-signed).

If a provider times out after receiving a request, mark **Execution uncertain** and reconcile before retrying; never assume failure and duplicate a notice. Partial completion leaves unfinished tasks visible. Revocation blocks undispatched work; an action already performed requires assessment of a corrective action, not a fictitious rollback. Manual completion requires an artifact and designated verification, not merely a checked box.

## 8. Notifications that request one useful decision

The web app is the canonical record. Slack provides scoped action requests and an updated thread for the matter. Email supplies configured fallback, counsel invitations or digests with secure links. Optional GitHub checks/comments report a review dependency only when enabled; blocking a merge requires a separate administrator-approved policy.

Each request includes matter ID, short business change, recipient's next action, due date with its reason, and secure link. Example: **“KI-104: Planned RelayAI summary feature. Alex, confirm whether customer transcript text will leave Northstar and whether this is already live. Requested before the team's target launch; no contractual deadline confirmed yet. Open factual questions.”**

Do not place restricted clauses or advice in broadly visible channels. Access is rechecked when opening the link. Slack emoji, email replies and meeting silence are evidence or acknowledgments, not version-bound legal approval. Factual responses can be captured through an authenticated scoped form; consequential approval returns to the workspace.

Default reminders occur after one business day and escalate to the configured delegate after two, adjusted for verified deadlines and quiet hours. Material changes update the existing thread. Digests collect nonurgent matters; reassignment stops reminders to the former owner. Delivery failures appear in the workspace. Critical deadline policy can change cadence, but the product never manufactures urgency from low source confidence.

## 9. Northstar: one complete matter

1. A GitHub PR adds a RelayAI client for support summaries. Kiara records planned integration. A Slack launch discussion joins the same matter. GitHub exposes separate pull-request and deployment event families; Kiara's design consequently treats code intent and deployed behavior as different evidence. [GitHub webhook reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads).
2. Retrieval finds Northstar's current privacy notice, DPA, subprocessor register, relevant customer agreements and vendor records. The PR alone proves neither actual transcript transfer nor a legal notice requirement.
3. Engineering confirms payload categories, environment, feature flag, intended rollout and whether any real customers already use it. The vendor owner confirms processing location and supplies authoritative terms. Unknowns remain assigned tasks.
4. Kiara prepares a possible register entry, proposed notice edits if supported, vendor questions and an agreement-specific notice matrix. Each row cites its governing agreement/version, trigger, recipients, channel, timing rule and unresolved interpretation. No universal number of notice days is assumed.
5. The business owner confirms the intended launch and authorizes a selected packet for named counsel. Counsel determines whether changes or other remedies are needed, edits the proposal and resolves contractual requirements. Material changes to business intent return for business confirmation.
6. Approved tasks may include publication, individual customer notices, vendor follow-up or postponing rollout. Each gets an owner and completion evidence. The signed DPA is preserved; proposed changes to its contractual terms require the separate amendment/replacement route.
7. Publishers/senders authorize exact content and destinations. The executor verifies resulting publication and notice outcomes. Any required signature task remains open until its completion criteria pass. Closure records which work happened, its evidence and any continuing obligations.
8. If engineering corrects “live” to “staging only,” the fact changes immediately and dependent proposals become stale. A proposed inference-rule lesson enters learning review and regression tests. The correction does not automatically rewrite all future legal policies.

## 10. Counsel collaboration

Counsel receives an authenticated, expiring invitation to assigned matters with a clear question, business owner, scope/budget if supplied and requested deadline. The packet includes authorized excerpts rather than indiscriminate access to company channels. Sharing previews name recipients and materials; requests for further access go to the designated owner.

Counsel can request a specific fact, annotate a clause, return a Word redline, propose another remedy, record legal clearance or a no-action decision. Re-imported edits create a new proposal version with affected approvals invalidated. A scope or fee change returns to the business owner. Counsel can review without joining the entire company's operating system.

Restricted legal discussion has its own visibility scope; business users receive the actionable task they are permitted to see. Any privilege designation follows the customer's legal/access policy and is not automatically conferred by the product. Export includes the approved packet, decision history and completion record within the exporter's permissions.

## 11. Reusable playbook template

Every workflow pack is a versioned record containing:

| Field | Required content |
|---|---|
| Identity and ownership | Name, version, tenant, legal owner, operational owner, effective/review dates |
| Applicability | Entity, domain, jurisdiction, contract/document families and expressly excluded cases |
| Trigger | Event patterns and correlation rules; distinguish planned, live and withdrawn change |
| Required evidence | Authoritative documents, factual owners, freshness limits and conflict handling |
| Decision logic | Explicit predicates for no action, standing-policy work and counsel escalation |
| Preparation | Templates, permitted substitutions, rationale requirements and alternatives |
| Authority | Required business/legal gates, counsel-sharing policy and separate execution delegation |
| Delivery | Authorized action types, prerequisites, recipients/destination rules and completion evidence |
| Monitoring | Deadline rules, reminders, reopen conditions and exception ownership |
| Learning | Correction taxonomy, regression cases, promotion approver and rollback version |

The RelayAI playbook must escalate if data categories or location are unknown, existing commitments conflict, a negotiated clause changes the route, or required vendor evidence is missing. A repeated routine matter qualifies for standing policy only after all predicates pass. A reviewer can accept wording for one matter without approving it as reusable precedent. Learning proposals show scope, before/after behavior and evaluation results before activation.

## 12. Concrete stories and acceptance criteria

| Story | Acceptance demonstration |
|---|---|
| Founder connects selected tools | Selected scope, parsed/unreadable objects and missing permissions are visible; useful ingestion proceeds without claiming complete coverage |
| Engineer corrects a deployment inference | Correction preserves provenance, updates company context, invalidates dependent proposals and becomes an inspectable learning candidate |
| Operations handles repeat register work | All standing-policy predicates and its version are visible; no fresh consultation is required where delegated; external action still has valid authority |
| Counsel requests a different remedy | Product change/no-action/amendment alternatives can replace a draft edit without losing the evidence trail |
| Founder requests a new NDA | Kiara shows searched scope, selects the approved template, flags missing terms and routes required review/signature steps |
| Sales introduces nonstandard retention terms | Relevant commitments and operational facts are compared; conflicts route to named owners; signed agreements remain intact |
| An obligation approaches its deadline | Clause, triggering date, calculation and owner are reviewable; counsel resolves ambiguity; verified delivery satisfies the configured task |
| Publisher edits an approved notice | Changed content cannot use the earlier approval; UI names the affected gate and version |
| Provider times out after sending | Matter remains uncertain; reconciliation prevents duplicate delivery and establishes actual outcome |
| Source access is revoked | Restricted evidence and derived content stop being exposed; dependent work shows its resulting gap |
| Counsel is unavailable | Owner sees an escalation/delegate route and pending legal gate; no silent clearance or artificial closure occurs |
| Irrelevant event arrives repeatedly | Idempotent triage records disposition once, creates no duplicate matter and contributes to audited false-negative sampling |

## 13. Outcome measurement and qualification

Measure human minutes across fact gathering, preparation, review, coordination and rework, including allocated onboarding effort. Track time to the first useful decision, actionable-matter precision, audited missed changes, response cycles, verified completion before sourced deadlines, repeat-error rate and reopened matters. Report standing-policy matters, counsel-reviewed matters, completed actions, no-action outcomes and specialist handoffs separately.

Qualification must exercise conflicting facts, no documents, staging-only code, expired approval, unsupported jurisdiction, unsigned versus executed documents, material counsel edits, duplicate events, failed notifications, source revocation and uncertain writes. Require zero unauthorized or duplicate external effects in the specified qualification suite; this is a tested release gate, not a guarantee about all future operation.

The success criterion is a customer who can understand the evidence, make a bounded decision and see completed work with less total effort. More detected events, more agent steps or more counsel referrals do not independently demonstrate value.
