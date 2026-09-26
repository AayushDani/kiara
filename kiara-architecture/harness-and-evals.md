# Bounded repair and evaluated harness improvement

Kiara repairs the current output and improves future execution through separate durable paths. All outputs here are synthetic design fixtures; the measured application comparison remains a later build acceptance gate. [Runtime policy](contracts/runtime/runtime-policy.json), [protected kernel](contracts/harness/protected-kernel.json), [typed harness commands](contracts/harness/harness-commands.schema.json) and [evaluation suite](fixtures/harness/evaluation-suite.json) are the machine-readable definitions.

## Current run

The worker pins tenant/reset generation, event, context, complete evidence, document base, harness config/hash, model/settings, protected policy and build. Durable budget counters survive retries and restarts. A champion promotion does not silently switch that run.

The selected first-event demonstration has two explicit faults:

| Fault | Detection and current correction | Attribution |
|---|---|---|
| V03 `APPLICABILITY_BUNDLE_MISSING` | Protected context readiness blocks before assessment/draft. Exact retrieval supplies the already-approved CA facts and provisions. Repair action 1; no model rewrite call. | The generic v1 selector omitted an available bundle. This observation supports the prefetch candidate. |
| V04 `CITATION_SPAN_MISMATCH` | A labeled seeded proposal citation starts at UTF-16 offset 1135 instead of 1134 on the same saved source page. Reanchor to [1134,1238), create a new immutable proposal/legal map, and repeat complete validation. Repair action 2 and a reserved model repair call. | Ordinary output repair. Prefetch does not fix citation spans; no improvement credit is assigned to removing this challenge. |

The [bad and corrected citation trace](fixtures/documents/citation-repair-trace.json) retains the real pinned source and unchanged candidate content hash. A provenance correction can create a new proposal without changing the candidate document. A text correction creates a new document revision. In either case the review input changes and affected approvals restart founder then lawyer.

Readiness validation uses `subject_kind=context_readiness`, `context_selection_id`, and null proposal/review IDs. T09 WF24 enters repair; a complete snapshot uses WF03 to enter assessment. Proposal validation uses `subject_kind=proposal` with exact candidate/proposal/review bindings. WF08 and WF24 consume the same root repair counter. Three semantic proposal passes are the maximum, not permission to exceed two repair actions or token/deadline limits. A deterministic failure remains blocking even if semantic review passes.

The run stops at 9 logical requests, 12 physical attempts, 16 tools, 2 repairs, 90 seconds/request, 300 seconds total, 24k input/request, 120k input total, 24k output total, 4k output/request, or $3 settled+reserved+unknown cost. Only two model requests may be in flight. SDK retries are zero; the scheduler owns at most two retries per logical request within every remaining cap. The worst proposed phase allocation is three assessment batches, one draft, three semantic reviews and two repairs; full evidence and semantic context must fit the actual tokenizer measurement before launch. Budget exhaustion yields persisted escalation, never truncated mandatory law or a fresh child budget.

## Exact automatic patch

The proposer supplies only observation IDs, reviewed catalog rule IDs and rationale. Deterministic code derives this finite JSON Patch; model-provided paths, selectors, code or URLs are rejected.

```json
[
  {"op":"test","path":"/retrieval/prefetch/declared_ca_resident_ccpa_bundle","value":false},
  {"op":"test","path":"/retrieval/prefetch/declared_ca_resident_company_facts","value":false},
  {"op":"replace","path":"/retrieval/prefetch/declared_ca_resident_ccpa_bundle","value":true},
  {"op":"replace","path":"/retrieval/prefetch/declared_ca_resident_company_facts","value":true}
]
```

The flag match is a declared-California-resident `user.signed_up` event, including subsequent CA users. Both versions use the identical already-loaded corpus and facts. v1 exact retrieval repairs the omission after protected readiness fails; v2 prefetch obtains the same evidence before the first check. Mandatory criteria and source coverage are independent of these flags.

Reject other paths, ancestor/escaped paths, add/remove/move/copy, extra keys, duplicate/unpaired tests, integers masquerading as booleans, true→false, failed base tests, patches over 2kB and mismatched candidate hashes. Authorization, tenant scope, human gates, source trust/freshness, legal criteria, evidence minima, prompts, tools, budgets, evaluations and protected policy remain outside the patchable object. New catalog rules or drafting guidelines require reviewed code/config deployment. Tool mutation alone remains stretch.

Fact correction, document edit, legal note and harness feedback have distinct types and reviewers. Feedback is attributed evidence; it does not rewrite authoritative law or become verified business truth automatically. Source rechecks use a separate assigned-lawyer capability and durable attestation, not a generic stale-source override.

## Frozen comparison and promotion

Freeze event bytes, company/context, document base, legal snapshots/provisions/effectivity, retrieval/index build, cache treatment, model and settings, prompt/tool/runtime/validator/kernel/catalog versions, dataset/split hashes and assertions before selecting a candidate. Holdouts are unavailable to the runtime proposer. Evaluation runs in isolated namespaces, suppressing email, real approvals, public document changes and champion mutation.

All deterministic legal and workflow cases run against both versions. The initial semantic experiment is three baseline/candidate pairs on EV-01, with alternating order. It includes all required proposal checks. Twenty-four workflow/adaptation cases and the full T03 legal cases remain mandatory; deterministic receipt replay is explicitly labeled. A separate later event EV-12 is excluded from promotion scoring.

Hard gates require all deterministic assertions, zero new hard failures, complete mandatory evidence, complete material-claim references, no severe semantic findings, strictly fewer missing-bundle repairs on the diagnosis case, nonworse other cases and nonworse first-pass quality. Proposed descriptive paired p95 latency may be at most 1.25× baseline and mean cost at most 1.20× while meeting absolute ceilings. Six semantic samples do not justify population reliability claims. Report raw observations and denominators. A source/model/kernel change invalidates comparison; unresolved nondeterminism is disclosed.

The six-child campaign has a 900-second/$18/72-physical-attempt parent cap and two shared in-flight slots. Each child retains the foreground 300-second/$3/12-attempt ceiling. The campaign can end `inconclusive`; it cannot manufacture a passing result. One candidate per diagnosis and at most three per tenant/day prevent unbounded tuning against holdouts. A holdout failure requires a reviewed new dataset before further tuning.

Promotion recomputes gates from immutable measured results. `planned_fixture` results never authorize live promotion. Atomically compare expected champion version, monotonically increasing generation and protected policy epoch; write the new pointer, audit/event and outbox in one transaction. Existing pinned drafts remain unchanged. Material evidence revocation serializes through the same protected guard.

## Later event and rollback

Persist v2, restart the worker, and submit a distinct signup/customer ID. The new run reads v2 from Atlas, shows two prefetch receipts before readiness, and records zero missing-bundle repairs only if observed. Run an isolated v1 counterfactual against that same later-event snapshot. A now-current CA policy may correctly need no second redline. The first event still demonstrates the complete requested redline and approval sequence.

For the first five promoted runs, record validation outcomes, repair classes, latency and cost. One new hard safety/tenant/citation/approval regression, or two missing-bundle regressions, triggers rollback and pauses automatic promotion. Rollback restores a previously approved kernel-compatible version and increments generation; it never recycles a CAS generation or silently rewrites outputs. Incompatible policy changes require operator review. Delivery retries do not rerun the agent.

Local specialist checks exercised finite patch rejection, schema examples, hash links, toy retrieval timing and in-memory CAS/rollback. They did not execute Atlas transactions, live model improvement, actual email, or the complete application. [Review and validation](review.md) records the exact integrated checks and remaining acceptance.
