# Component and interface contracts

The [operation registry](contracts/operation-registry.json) is the executable-schema index: each selected operation maps to its exact request, success, error, caller and examples. [Components](contracts/component-registry.json) and [diagram edges](contracts/edge-contract-crosswalk.json) bind those operations to process boundaries and implementation owners. These are proposed Kiara operations. They are not undocumented vendor endpoints.

## Authority and common envelope

Wire JSON uses snake_case, UUID strings and RFC3339 UTC timestamps; storage uses BSON Date and binary values. T04 collection validators and T09 wire schemas serve different dialects. Wire `revision_id`, `event_id`, and similar identifiers map to physical `_id`; the shared trace uses [one canonical ID map](fixtures/id-map.json). Independent endpoint examples are schema probes with separate synthetic IDs, not additions to that trace.

Authentication injects tenant, actor, role, capability and reset generation. Model arguments never supply that authority. One tenant is one company (`company_id == tenant_id`); repositories qualify private references by tenant and epoch. Every state-changing command checks expected reset generation and state/head version. A reset advances the persistent tenant guard, and late earlier-generation results are rejected even if fixture UUIDs are reused.

Closed request schemas reject extra keys. Content, URLs, feedback, model outputs and retrieved text remain untrusted data. The model has no direct database query, SQL/Mongo operator, shell, network fetch, approval, finalization, email send or champion-write tool. Source ingestion is a privileged registered-source operation with DNS/redirect checks, a whole-fetch 10-second deadline, 4MiB original-byte admission and 8MiB source BSON ceiling. Tenant-owned public-law copies do not create a tenantless read bypass.

## Runtime and adapters

| Boundary | Exact contract | Effects and retry owner |
|---|---|---|
| API → workflow | [Ten command schemas](contracts/workflow/command-io.schema.json), [commands](contracts/workflow/commands.json) | Short guarded DB transactions; duplicate key+request hash returns original receipt. Conflicting reuse fails. No model/network call inside transaction callbacks. |
| Worker → model | [RunInput/RunResult/ModelInvocation](contracts/runtime/runtime-contracts.schema.json), [policy](contracts/runtime/runtime-policy.json) | Reserve budget before send; official Responses SDK, retries disabled; scheduler records every physical attempt and uncertain charge. |
| Model → tools | [Eight-tool catalog](contracts/runtime/tool-catalog.json) | Strict model arguments plus server ToolServerContext; scoped reads or proposals only. Receipts bind full immutable artifacts; 12k-character results do not truncate law. |
| Retrieval/context | [Operation map](contracts/context/operation-schema-map.json) and [schema](contracts/context/contracts.schema.json) | Exact mandatory provisions/facts before optional discovery; full-evidence hydration and coverage accumulator; no missing-evidence success inferred from transport success. |
| Document services | [K-DOC-001..005](contracts/documents/document-io.schema.json) | Immutable clauses/revisions/proposals, review packet read, deterministic seal, ordered human command and export. Whole document cap 1MiB; hash/evidence changes invalidate review. |
| Validation/adaptation | [Harness contracts](contracts/harness/interface-contracts.md) and [harness plan](harness-and-evals.md) | Trusted validator/evaluator/promotion services; model only proposes catalog rules. Shared budgets and atomic champion generation/policy guards. |
| Delivery | [Dispatch adapter](contracts/notification/notification-adapter.schema.json), [durable outbox](contracts/workflow/notification.schema.json) | Stored rendered payload, same provider key on retry, 5 physical attempts, 15-second HTTP timeout, 23-hour horizon. |
| Read views | [Five typed endpoints](contracts/observability/read-models.schema.json), [bindings](contracts/observability/read-models-bindings.json) | Snapshot-consistent scoped joins, pagination/high-water/completeness, no mutation through GET; liveness is not dependency readiness. |
| User feedback | [Canonical feedback command](contracts/workflow/feedback-command.schema.json), [UX examples](contracts/ux/canonical-wire-examples.json) | Distinct fact correction, requested edit, legal note and harness proposal; attributed resolution and explicit verification. |

`get_company_context`/`read_company_document`/`search_legal_evidence`/`read_legal_provision` are bounded model tools; RET service requests additionally resolve trusted event/run pins and server purpose. Adapter field mappings are part of the retrieval operation map. Runtime rule IDs now exactly match the two harness catalog IDs. Security aliases reference the canonical runtime/review schemas, preventing divergent authority fields. Metadata source paths in a specialist handoff refer back to `research/Txx`; shared schema paths are resolved by the operation registry.

## Event and state ownership

The sole signup event is `user.signed_up`. The [event schema](contracts/workflow/event.schema.json), [48-type catalog](contracts/workflow/event-catalog.json), [25 guarded transitions](contracts/workflow/transitions.json), and [notification transitions](contracts/workflow/notification-transitions.json) are canonical. Events carry causal/correlation IDs, aggregate identity/sequence, actor, reset generation and payload hash. Correlation does not imply idempotency; client time does not establish causal approval order.

Persist ingress event, workflow and initial job atomically. Claim jobs with owner, deadline and lease epoch; heartbeat/reclaim never permits an old lease to commit. A completed stage transaction writes its artifacts, state CAS, event, successor jobs and outbox intents. Unknown commit outcomes reconcile the durable receipt before replay. Leases expire during crashes; document review slots survive human waits and release only through guarded workflow outcomes.

Readiness repair occurs before legal assessment: missing bundle emits a readiness validation result with no proposal IDs, WF24 records bounded repair, and WF03 only proceeds after complete context is pinned. Proposal repair has exact candidate and review-input bindings. `needs_information`, `not_covered`/no-action, human escalation, rejection, changes requested, supersession and terminal failure are explicit outcomes. They do not convert to successful legal approval.

## Review and feedback correctness

`review_input_hash = SHA256(JCS(review_input))`. The input pins exact base/candidate/diff/legal-map/context/evidence/assessment/run/harness, validator/config/renderer, tenant reset/material epochs, source attestations and freshness deadline. Validation completes against that hash. The seal is exactly:

```text
review_bundle_hash = SHA256(JCS({
  review_input_hash, validation_run_id, validation_hash, validator_version_id
}))
```

There is no circular dependency on a bundle containing its own validation. Both human approvals name the same immutable sealed bundle. `viewed`, `reviewed`, `requested_changes`, `rejected` and `approved` stay distinct. The client cannot infer approval from an open page or delivered email. Only the assigned founder can pass the first gate; only the assigned authorized lawyer can pass the second after the first remains current.

Material fact/source activation, membership/assignment revocation, approval and finalization conditionally write the same tenant guard. This prevents snapshot write skew; asynchronous invalidation alone is insufficient. Finalization additionally checks exact document base/head, active slot owner/epoch, state version, both approvals and current freshness. It makes the revision current in Kiara; public publication is a separate authorized action.

A fact edit becomes a proposed assertion, then an authorized verified context commit. A document edit creates a new revision. A citation-only correction creates a new proposal/legal map. A legal note remains attributed interpretation. Source recheck requires an assigned-lawyer capability, exact source bytes/as-of/authority locator, and expiry no later than 24 hours or the source's validity bound. Known-invalid, future, superseded or untrusted law cannot be rescued. Every material change revalidates and repeats founder then lawyer approval.

## Email and visibility

Founder approval enqueues the lawyer review request immediately with exact approved draft/evidence links; it does not wait for final-document delivery. Finalization may enqueue a distinct final notification. Email failure retries only delivery. Preview has a separate dedupe namespace and visible label; `.test` addresses in fixtures are intentionally nondeliverable. Unknown provider outcomes stay unknown, preserving the key and receipt; after the 23-hour local retry horizon there is no blind new-key send. Webhook verification uses raw bytes and signature validation, then provider-event deduplication.

Required product views read Atlas business records, showing source dates, known/unknown/conflicted facts, clause evidence, current repair, candidate patch, frozen metrics, pinned versus active harness and delivery state. Polling cadence is 1 second active, 5 seconds human wait, 15 seconds background, with bounded backoff. Optional LangSmith receives only allowlisted timing/counts/status, random diagnostic IDs and HMAC pseudonyms; never document text, prompts, raw feedback, addresses, secrets or model reasoning. Vendor outages do not affect legal state.

See [security policy](contracts/security/security-policy.json), [role matrix](contracts/security/role-action-matrix.json), [schema concurrency rules](schema.md), and [independent review](review.md) for implementation checks and unresolved acceptance.
