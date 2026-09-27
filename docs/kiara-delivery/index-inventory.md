# Scoped index maintenance and agreement inventory

Source coverage: product plan v2 §§7–8 and §13 (complete agreement inventories, current source evidence, scoped retrieval), §§14–16 (bounded cost, durable work and invalidation). Owner: platform contracts. Independent review: root and regression qualification. No paid providers or Atlas cluster were contacted for this wave.

## Maintenance admission

`KIARA_V2_INDEX_POLICY` is a protected operator JSON tenant-policy list. An entry explicitly names `tenantId`, `enabled`, `actorIds`, allowed `scopeKinds` (`private`, `team`, `matter`), `maxChunksPerJob` (1–100) and `validUntil`. Missing or expired policy admits no jobs. The configured Atlas mode and all its required connection/index parameters remain mandatory. A model, incoming source or browser command cannot create or expand this grant.

After an accepted command changes a source, document or confirmed fact, the same durable transaction compares canonical fingerprints and queues only current chunks readable by the initiating member and within the policy's permitted scope kinds. Each job binds the policy hash, member version, retrieval configuration and exact chunk IDs. Jobs contain at most 20 records and the policy's chunk bound; their outbox carries only tenant/job references. Snapshot progress is visible only to the initiating actor. Questions do not grant index authority or require that user to become an administrator. Malformed maintenance policy or missing index configuration records a visible blocked maintenance admission for changed records; it cannot roll back a primary source or membership revocation.

`processIndexJob(tenantId, jobId)` rechecks the standing grant, its expiry, membership, current record eligibility and a five-minute worker lease before any embedding dispatch and index write. Token counting and cost use the existing exact tokenizer and global spend ceiling. Replay reuses completed immutable chunk embeddings. Concurrency/rate pressure leaves a delayed durable job; exhausted budgets, changed authority or unsupported configuration block it. Ambiguous provider outcomes remain unknown and are never automatically resubmitted. A pending ledger recovery remains queued until reconciliation is durable. Deletion remains authoritative immediately, independent of eventual index maintenance.

## Supplied agreement register

`inventory.attest` records a named fact owner's statement about the **supplied** register, its customer/business scope description, retained evidence, current agreement/amendment revision IDs and hashes, source versions, member version and expiry (at most 30 days). It does not certify discovery of external agreements or legal applicability. This is a human attestation, not a model result.

The server enumerates all current agreement and amendment heads for the matter's exact audience before applying access checks. Draft and unknown authority are included in the count; an inaccessible current head prevents attestation, and a previous visible draft cannot replace it. The submitted IDs must match that full register; a retrieved top-k subset fails. A separate private audience is outside this precisely described register. Actor lists are compared as sets, so ordering cannot change the population. A zero-document register requires retained supporting evidence and an explicit named attestation.

A prepared proposal records the current attestation identity, hash, scope and count and inherits its supporting source lineage. New agreement heads, successor revisions, changed sources, changed owner authority, revocation or expiry invalidate that completeness claim. Service approval/manual execution/closure, counsel review and final broker dispatch all check the current attestation again. Repreparation may remain explicitly incomplete until an owner provides an updated attestation. Revoking an inventory does not erase its decision history.

Snapshot `inventories` exposes attributed, scoped decisions with `current` and `count`; `inventoryCandidates` supplies exact eligible revision IDs per matter. `inventoryComplete` refers only to the stated supplied register; the UI and proposal retain the limits of this claim.

## Evidence and limits

`tests/v2-index-inventory.test.ts` exercises disabled/default policy, non-admin standing admission, private-scope exclusions, policy/member revocation, source revocation during embedding, restart replay, budget exhaustion, concurrency retry, unknown outcomes, full register count, successor revisions, attestation expiry at approval and final dispatch, and private lineage inheritance. Combined platform/hybrid/counsel regression: 50/50 in `evidence/v2-index-inventory-tests.log`. The subsequent malformed-policy/configuration control regression passes with the focused suite (10/10), `evidence/index-admission-repair.log`.

The maintenance policy is intentionally bounded and does not provide unbounded tenant indexing, a managed Atlas availability guarantee or a live-provider quality result. Static eligible-chunk scans and full workspace hydration remain scale limits. An operator must qualify managed index creation and lag behavior before enabling Atlas in production.
