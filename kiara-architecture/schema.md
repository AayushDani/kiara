# Physical MongoDB design

Status: **designed; Atlas deployment and runtime acceptance remain unexecuted**. Integrated from T04; source ownership and checks remain attributed. Research date 2026-09-26. This is an architecture/schema/fixture handoff, not an implemented application. All business people, accounts, decisions, deliveries, evaluations and workflow outcomes in the fixture set are synthetic design examples. The retained California source bytes are real T03 research snapshots.

## Decisions and artifact entry points

Use one MongoDB Atlas database, native Node driver, 28 physical collections. One tenant is one company in this implementation: `company_id == tenant_id`, with company profile and shared concurrency guards in `tenants`. No extra `companies` collection is implied. All legal-source copies, original bytes, chunks and evidence bundles are tenant-owned. A public source URL indicates authority; it never authorizes a tenantless or `tenant_id:null` read. There is no shared-public-query bypass.

- `schema/*.validator.json`: one deployable MongoDB `$jsonSchema` validator per collection, `validationLevel:strict`, `validationAction:error`.
- `schema/indexes.json`: 54 index specifications, separate from validators.
- `schema/collection-catalog.json`: physical names, mutability and wire-ID mapping.
- `fixtures/*.ejson.json`: 88 schema-valid synthetic example documents, including 3 real source snapshots, 31 source/provision excerpt chunks and 13 distinct operational follow-ups.
- `fixtures/id-map.json`, `fixtures/legal-alias-map.json`: deterministic UUID identities and T03 semantic-key crosswalk.
- `contracts/seed-reset-spec.json`: future script interfaces and reset/seed contract.
- `research/T04/checks.json`: actually-run local verification, including its limits.
- `research/T04/reconcile_artifacts.py`: final artifact generator, consumes the pinned specialist source snapshots in `inputs/`; `input-manifest.json` records their hashes. Later specialist changes require an explicit refresh and recheck. `research/T04/build_artifacts.py` is its internal bootstrap, not the final generator to run alone.
- `scripts/check-storage.cjs`: offline Ajv verification. Read-only reuse of T13's installed Ajv dependency; `KIARA_AJV_PATH` can point to another installed Ajv.

## Verified database facts

MongoDB validates its supported JSON Schema draft-4 dialect with BSON extensions, including `bsonType`. This is a storage validator, separate from the JSON Schema 2020-12 wire contracts authored by T09/T06/T13. The generator expands local refs, converts `const` to `enum`, and converts `if/then` to equivalent `anyOf/not` so unsupported modern keywords are not shipped to MongoDB. [MongoDB schema validation](https://www.mongodb.com/docs/manual/core/schema-validation/specify-json-schema/), [operator reference](https://www.mongodb.com/docs/manual/reference/operator/query/jsonschema/).

A single-document conditional write is atomic. Matching the expected current value in its filter detects a concurrent change. Cross-collection atomicity requires a transaction; a collection-wide update does not make its multiple documents atomic. [Atomicity and transactions](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/).

Unique indexes prevent duplicate indexed keys; missing/null values have uniqueness consequences. Partial unique indexes apply only to matching records. [Unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/), [partial indexes](https://www.mongodb.com/docs/manual/core/index-partial/).

The BSON document limit is 16 MiB. Kiara deliberately admits at most 4 MiB original source bytes and 8 MiB total serialized BSON per source record; character-count constraints alone cannot guarantee that bound. [MongoDB limits](https://www.mongodb.com/docs/manual/reference/limits/).

Extended JSON encodes BSON Date and binary values; these fixtures use `$date` and `$binary` rather than pretending ISO strings or base64 strings are the native database types. [Extended JSON v2](https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/).

Change streams provide change notifications/resume tokens, not this design's job claim, retry or human-wait semantics. They may wake a worker, while persisted jobs remain authoritative. [Change streams](https://www.mongodb.com/docs/manual/changestreams/).

TTL uses a single date-field index and background removal. Only completed diagnostic telemetry receives `expires_at`; domain evidence, approvals, events and configs never receive this TTL. Application freshness/lease decisions compare timestamps explicitly, not TTL deletion timing. [TTL expiration](https://www.mongodb.com/docs/manual/tutorial/expire-data/).

The cited manual pages displayed MongoDB 8.3 current documentation at retrieval. This does not establish the invited Atlas sandbox's actual server version, topology, privileges or feature availability. T04 did not connect to any cluster.

## Physical boundaries and field ownership

All collections contain UUID-string `_id`, trusted `tenant_id`, `schema_version`, BSON `created_at` and integer `reset_epoch`. Imported wire version strings are preserved (for example events `1.0`); other physical records use schema version `1`. Schema migration must explicitly handle version changes. Native BSON dates have millisecond precision; normalize higher-precision source timestamps before persistence. The generator normalizes timestamps to UTC milliseconds before sealing hash inputs. Runtime canonical hash inputs use RFC3339 strings, not Extended JSON wrappers.

| Collection | Boundary and writer |
|---|---|
| `tenants` | Mutable company/profile/context and harness heads, active legal-source membership, monotonic context/evidence/policy/reset generations and review fence. Deterministic service writes only. |
| `actors` | Tenant membership, roles, disabled status; identity/auth administrator. Per-tenant memberships permit one lawyer to work for multiple companies. |
| `company_context_versions` | Immutable full bounded fact snapshots; verified context-commit service. Up to 200 facts embedded with per-fact provenance, author, knowledge/verification state, effective dates and supersession. |
| `customers` | Current bounded customer/residency evidence projection; ingest service. Raw signup facts remain in immutable events. No street address or IP becomes declared legal residence by inference. |
| `events` | Immutable complete T09 discriminated envelope and payload; deterministic handlers. Unique tenant/idempotency and aggregate sequence indexes. Not a pointer-only projection. |
| `documents` | Mutable revision head and persistent active workflow slot; document service. Human waits retain the slot. |
| `document_revisions` | Immutable ordered clauses and metadata; version writer. Stable clause UUIDs, parent/base revision and computed content hash. |
| `legal_source_versions` | Immutable source originals as BSON binary plus retained extracted text, original/text hashes, authority, effective dates and parser lineage; privileged registered-source ingestion. |
| `legal_chunks` | Immutable provision/page excerpt records, locators, text/hash, source UUID and semantic provision key; ingestion service. Source page text and normalized search text must not share unverified offsets. |
| `assessments` | Immutable case-specific criteria/result with exact fact and provision IDs; assessment service. `covered`, `not_covered`, `needs_information` are distinct from overall compliance. |
| `evidence_bundles` | Immutable selected facts, source membership/hashes, provision IDs, assessment and source-attestation references; retrieval/validation service. |
| `change_proposals` | Immutable complete edits, source anchors, embedded exact T08 redline and legal map; proposal writer. Corrected provenance creates a new proposal even when policy text is unchanged. |
| `validation_runs` | Immutable readiness or proposal result, checks and permitted repair action; deterministic validator. A pre-draft failure has null proposal/revision/review-input IDs. |
| `review_bundles` | Immutable sealed review input and successful validation linkage; workflow service after validation. |
| `workflows` | Mutable T09 state/checkpoint, assigned reviewers, proposal/slot/approval references and CAS version; deterministic transitions only. |
| `jobs` | Mutable T09 scheduled work with dedupe key, deadline, retries and fenced lease; worker/scheduler. |
| `agent_runs` | Mutable bounded execution ledger, immutable pinned snapshots, counters/deadline and at most 12 embedded model invocation attempts; runtime. Model invocations are not a separate collection. |
| `tool_receipts` | Fenced `started` to terminal receipt, unique tenant/run/idempotency key and output references; tool server. No arbitrary database tool. |
| `review_actions` | Immutable `viewed`, `reviewed`, `requested_changes`, `rejected`, `approved` with authenticated actor and demo/human provenance; human action handler only. |
| `feedback` | Typed fact correction/document edit/legal note/harness improvement and attributed resolution, with CAS; authorized reviewers and deterministic resolver. Never automatically overwrites legal authority. |
| `harness_versions` | Immutable T07 prefetch config plus protected runtime/validator policy versions/hashes; harness service. Protected policy is outside patchable config. |
| `harness_candidates` | Mutable evaluation/promotion lifecycle with exact patch/base hash and expected generation; deterministic promotion service. |
| `evaluation_runs` | Immutable frozen comparison and measurement status; evaluator. `planned_fixture` outcomes cannot authorize runtime promotion. |
| `notification_outbox` | Durable T09 outbox plus embedded immutable rendered payload and bounded delivery attempts; notification service. Mode `preview` is distinct from `live`. No separate payload/attempt collection. |
| `operational_followups` | Independent obligations, owner, readiness and resolution; authorized humans. Policy approval never auto-closes them. |
| `seed_manifests` | Synthetic dataset/version/content hashes/counts/readiness; seed/reset operator only. |
| `telemetry_spans` | T13 privacy-safe diagnostics with 14-day completion TTL; telemetry service. Persisted domain metrics remain in runs. |
| `source_recheck_attestations` | Immutable assigned-lawyer manual authoritative recheck, exact source bytes/as-of/expiry and new bundle reference; protected source-review capability. No generic trust/future-law override. |

Collections are separated where retention, mutation privileges, retry contention or append-only history differ. Bounded facts, criteria, clauses, edits, model attempts and delivery attempts stay embedded. Customer, event, version, feedback and source histories do not grow unbounded inside a tenant document.

## IDs, hashing and reference rules

UUID strings are lowercase in BSON, JSON and diagrams. Production IDs may be random UUIDs; fixture IDs are UUIDv5 in namespace `cd20cbe3-869b-40d6-b7c8-06ea20dbb48c`. A wire `event_id`/`workflow_id`/`revision_id` maps to physical `_id`; do not maintain a second diverging copy. Embedded clause IDs are UUIDs. T03 `fact_key`, `source_key`, `provision_key` and operational keys are semantic strings, not database foreign keys. Fact-key aliases are normalized to T03's snake_case map; imported structured legal inventory values preserve their explicitly validated source field names.

Every private reference is resolved with both ID and authenticated tenant. A UUID pattern and validator do not enforce referential integrity, permissions or immutability. Repository methods plus collection privileges enforce those boundaries; model tools cannot receive arbitrary MongoDB filters or `bypassDocumentValidation`. Immutable collections require insert-only application credentials, with migration/reset credentials separated. No array uniqueness claim is substituted for checking clause/fact IDs in deterministic code.

Hashes are lowercase SHA-256 hex. The selected runtime uses JCS/RFC8785 canonicalization. The local Python generator matches this for the fixture subset (ASCII keys, integral numbers, no negative zero); a general runtime must use the selected canonicalizer rather than assuming `sort_keys` is a complete JCS implementation.

`document_revisions.content_hash = SHA256(JCS({schema_version,document_id,language,title,policy_updated_on,clauses}))`, matching T08 exactly. Original source hashes cover original bytes; extracted-text/chunk hashes cover UTF-8 text. Redline hash covers T08's redline object excluding `diff_hash`. Snapshot/assessment/validation hashes exclude identity and storage metadata (`_id`, `tenant_id`, `schema_version`, `created_at`, `reset_epoch`, hash field); their preimages are versioned contracts.

The acyclic seal is: review input pins base/candidate/diff/legal-map/context/evidence/assessment/run/harness and validator/renderer identities, tenant reset/material epochs, source attestations and freshness deadline. Validate the `review_input_hash`; then seal `SHA256(JCS({review_input_hash,validation_run_id,validation_hash,validator_version_id}))`. Both approvals reference that exact sealed bundle. A champion harness promotion alone does not change an existing run's pinned config or invalidate its untouched packet.

## Concurrency and transaction contracts

Each mutable head/state update matches `(tenant_id, _id, reset_epoch, expected state_version)` and increments its version. Jobs additionally match owner, unexpired lease and monotonic `lease_epoch`. A re-leased worker's late result is discarded. Job claims, workflow transition, event insert and new jobs/outbox intents commit together where they represent one state transition. Network/model/email work occurs outside transaction callbacks. Use the Node driver's transaction API with primary reads, snapshot read concern and majority write concern; retry only documented transient transaction conditions and re-read state. Do not parallelize operations inside a transaction. [Node driver transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/).

Document slot acquisition conditionally sets `active_workflow_id` and increments `slot_epoch`; waiting workflows use deterministic intake ordering. No expiring job lease frees a document slot during human review. Finalization compares the pinned base head, slot owner/epoch, state version, reset generation, fresh immutable bundle and both ordered approvals before moving the document head and releasing the slot. Finalized means approved within Kiara, not publicly published.

Workflow CAS alone does not prevent approval write skew. Every fact commit, source activation or membership/assignment revocation writes the same tenant guard. Material fact/source changes increment `material_context_epoch`/`material_evidence_epoch`; gate transactions compare both pinned epochs and increment `review_fence`. Revocation writes the fence too. Thus simultaneous revocation/evidence change and approval share a write conflict and cannot silently both commit from stale snapshots. An async invalidation event is a UI/history update, not the correctness mechanism. Changed text, map/citations, material facts/evidence or expired recheck requires validation and founder then lawyer approval again.

Human views/reviews do not set approval. `review_actions` has a partial unique key for one approval per role/workflow/approval epoch (storage-only `workflows.approval_epoch` increments for each revalidated active bundle); the workflow transaction also enforces reviewer assignment, active membership, role order, bundle equality and freshness. Harness promotion CAS checks both `harness_head_id` and monotonic `harness_epoch` (T07 champion generation), plus `policy_epoch`; rollback increments generation rather than recycling it.

Outbox creation follows founder approval for the lawyer request. Email status cannot finalize or grant approval. Provider idempotency includes reset generation. Max 5 live send attempts/23h window comes from T09; embedded array capacity 10 is a storage ceiling, not permission for 10 sends. Unknown provider outcome preserves its reservation/idempotency record for reconciliation.

## Retrieval, source storage and examples

Selected exact retrieval uses active tenant corpus membership and source/provision indexes. T05's lexical search is optional discovery; rehydrate/authorize primary records before use. Vector embeddings are not required by this physical schema. Required sources cannot disappear because a text/search index is stale. Evidence arrays permit 200 selected chunk IDs; per-source references permit 100. These are storage ceilings; T05's explicit batch/call/token limits still apply.

Current seed parsing is T03's pypdf extraction with unrecorded package version; retained text hashes/pages are real. New ingestion uses T05's pinned parser and must reanchor its own output. Do not label the old seed as PDF.js output. Source admission checks actual serialized BSON bytes, never only Unicode character length. Oversize yields `source_too_large`; no silent truncation and no GridFS implied.

The example set traverses NY and CA signup → full synthetic company facts → positive assessment → sources/provisions → policy revisions → pre-draft missing-bundle failure → candidate/proposal citation-span failure → corrected immutable proposal → passing validation → sealed founder/lawyer decisions → finalized revision, with independent operational followups, preview outbox, harness candidate/evaluation/config and promoted pointer. It is a **synthetic completed-state trace, not an executable exhaustive event replay**. Intermediate event states are defined in T09; several compact representative event records are stored here. T07's actual live measured improvement remains future work; planned fixture outcomes never become evidence of execution.

## Checks actually run and remaining acceptance

`research/T04/checks.json` reports 61 passing offline checks over 28 validators, 88 documents and 54 indexes: Ajv validation after explicit BSON-to-JSON adaptation; UUID/tenant/reference links; source bytes and text hashes; document, event and harness hashes; review bindings; fixture uniqueness against index keys; reset-generation consistency; raw/estimated BSON bounds; rejection of an IP claim as declared residence and rejection of an ObjectId-like string. Exact T08 redline artifact hashes are checked. Conservative BSON size calculation is not native-driver serialization.

No Atlas connection, server validator installation, BSON round-trip, index creation, transaction race, change-stream delivery, live model, email or end-to-end workflow was executed. The organizer's invited sandbox/access and eligibility remain prerequisites. T16/T17 must review/integrate this staged design; T04 does not mark the overall pack accepted.

Required build acceptance: install every validator/index on the invited sandbox; EJSON deserialize and round-trip types; insert all examples in a disposable synthetic tenant; reject invalid inserts; verify actual BSON sizes; race two state updates and two document slots; race fact activation/revocation against approval/finalization; reject old reset workers; demonstrate duplicate event/approval/outbox handling; kill/restart a lease holder; preserve final state through email failure; reject a harmful patch, CAS champion generation through rollback, and run the frozen baseline/candidate/later-event suite. The five elapsed-hour build window starts later; this research work is not that implementation window.

## Freeze and integration notes

The final inputs are pinned by `input-manifest.json`; `frozen-manifest.json` covers this report, schemas, examples, seed/reset contract, checks and local tooling. Latest T06 reset-epoch policy, T09 sealed review input and T13 `context_version_id` naming are included. T04 adds storage-only `approval_epoch`, maintenance state and source-recheck activation list to the tenant/workflow guards. Preview and live outbox intents have distinct semantic deduplication keys. The editable document admission cap is T08's 1 MiB serialized canonical content with 200 clauses and 50,000 characters per clause; raw legal sources use the separate 4/8 MiB source caps. Record sizes must be checked before insert.

Remaining design limitations are explicit: the legacy seed parser version is unknown (bytes/text/page hashes are retained); production server behavior and account readiness are unverified; the seed script interface is specified rather than implemented. None removes product scope. T03 supplies all eleven legal assessment cases and T07 the full regression/later-event campaign; their planned evaluations must not be relabeled as measured by the synthetic stored evaluation example.

Final grounding reconciliation: context contains 53 explicit synthetic facts (46 T03 legal/business rows plus seven T08 policy-support assertions). All seven are selected into evidence and bound to their actual clause UUIDs in the sealed legal map. They are asserted demo facts, not verification of an operational request system. Telemetry uses `revision_id` and `context_version_id`. The four-field seal and all affected context/evidence/validation/bundle hashes were recomputed after this change.
