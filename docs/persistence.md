# Persistence implementation

The app supports a real MongoDB native-driver adapter and an explicitly separate local file adapter. No Atlas URI was available during implementation. Local checks do **not** prove Atlas Sandbox eligibility, Atlas connectivity, server transactions/index creation, or provider execution.

## Interfaces and startup

`src/data/store.ts` preserves `transaction<T>((state: State) => T)`, `readState()`, `persistenceMode()` and `closeStore()`. Transaction callbacks must be synchronous and cannot dispatch network effects. MongoDB can retry the callback, so it must have no external side effects. Optional transaction guards are `{expected_reset_epoch, expected_state_version}`. A successful mutation increments the surviving tenant `state_version`; no-op transactions leave storage unchanged.

Additional exports: `seedStore()`, `resetStore(expected_reset_epoch)`, `verifyStore()`, `readPhysicalCollections()` and `assertResetSafe(state)`.

- `npm run seed` creates the baseline only when missing; subsequent runs verify without overwriting current workflows.
- `node --import tsx scripts/reset.ts --dry-run` checks reset eligibility.
- `node --import tsx scripts/reset.ts --expected-reset-epoch N --synthetic-only` performs a fenced reset.
- `node --import tsx scripts/verify-seed.ts` checks scope, baseline and retained source integrity. Scripts load `.env.local`/`.env` without printing credentials.

`MONGODB_URI` selects MongoDB; `MONGODB_DB` defaults to `kiara`. MongoDB must support multi-document transactions (Atlas or a replica set). The app fails closed on an unavailable database; it never falls back silently. Initialization requires collection/validator/index permissions. Existing earlier development Mongo payload-wrapper databases require a fresh development database; the code does not destructively migrate unknown records.

Without `MONGODB_URI`, `KIARA_DATA_DIR` (default `.kiara`) contains a private atomic state envelope. Writes use a process-shared directory lock, owner token, dead-process recovery, fsync and atomic rename. Read paths see either the old complete file or the new complete file. Only the current lock owner releases its lock. `format:2` includes the State and retained immutable context/review history; the earlier plain State format is read and upgraded on the next mutation. Local retained source files remain the checked-in fixture assets, and `readPhysicalCollections()` materializes their collection view. This is local development storage, not a pretend Mongo server.

## Physical schema reconciliation

The architecture's 28 collection names are retained, plus `company_facts` for the runtime's direct fact-array read model. `src/data/physical.ts` is the runtime projection catalog. MongoDB applies strict runtime-v2 validators and tenant/epoch indexes; these are **not** the earlier architecture validators because the assembled runtime contracts intentionally have different fields. Domain UUIDs stay in explicit ID fields; the storage `_id` combines tenant, epoch and record key to fence reused fixture IDs.

The surviving `tenants` record holds head fields, the reset epoch and state-version CAS. Core arrays have queryable top-level records. Customers, documents, context snapshots, jobs, assessment/evidence/proposal/validation/review records, actors, sources/chunks, harness candidates and operational follow-ups have separate physical records. Receipt/ledger entries live in `tool_receipts`, rather than growing the tenant document. Source-recheck receipts are projected into `source_recheck_attestations` only when the application actually records an attestation. Event timestamps produce privacy-safe `telemetry_spans` with IDs, operation type, timestamp and elapsed time since the previous workflow event; customer names, event titles/details and legal bodies are excluded. Baseline collections remain empty, and the adapter never inserts fictional attestations or generated timing results.

A single snapshot transaction reconstructs the State. Every write compares the tenant ID, prior reset epoch and prior state version in the same transaction as child writes. Unique compound indexes cover record keys, event sequence, fact key, notification dedupe and provision lookup. Every read/delete is scoped to this fixture tenant and active epoch. Reset never drops databases or collections and never deletes another tenant. It increments the surviving guard atomically with reseeding. In-flight/unknown/reserved model costs and live email intents/receipts block reset until reconciled; preview-only state can reset. Old commands must supply their expected epoch and are rejected.

Existing revision content and records are immutable and events append-only within an epoch. Facts generate retained context versions. Historical assessment/evidence/proposal/review snapshots remain queryable when the mutable workflow advances. There is no seeded synthetic completed workflow, approval, provider receipt, evaluation result or source-recheck attestation.

## Baseline and evidence

The repeatable seed has one NY customer, 53 explicit fictional company facts, one baseline document revision, three founder/lawyer/service actors, harness v1, three retained primary-source originals and 32 chunks. Event-specific baseline residence and physical-state facts are NY, current CA customer count is zero, and CA-processing start is unknown. Signup creates CA customer/event-specific context only from the explicit synthetic scenario. The company market-launch and $30m revenue stipulations remain explicit facts, not conclusions from an address.

The architecture had 31 chunks but its mandatory evidence list also required `prov_ccpa_cpi`. `legalChunks()` derives the missing 32nd chunk from the retained CPPA adjusted-threshold HTML table, preserving source offsets and documenting tag removal/entity decoding/whitespace collapse. It is derived source evidence, not invented legal text. Runtime binding source hashes use original source bytes and current chunk hashes; the historical design fixtures are not overwritten. The lawyer actor ID is reconciled to the canonical actor fixture.

Seed preflight verifies SHA256 of retained binary originals and every chunk, maximum raw size 4 MiB and BSON source size 8 MiB. Fixture data stays labeled synthetic and Sandbox eligibility stays `unverified`.

## Executed checks

`node --import tsx --test tests/persistence.test.ts`: 10 passed. Covered deterministic/byte-identical repeat seed, rollback, rejected async callback, tenant and stale guard rejection, immutable revision enforcement, four independent processes with 48 total atomic writes, dead-owner lock recovery, CA customer/context/job materialization and reset reconciliation/epoch fencing. Source binary/BSON/hash checks passed locally. TypeScript found no data-module errors at this checkpoint.

MongoDB server-side validation, cross-tenant preservation on a real replica set, failover and live Atlas verification remain external checks pending credentials. Do not report these as passed.

Final combined persistence/security recheck: `node --import tsx --test tests/persistence.test.ts tests/security.test.ts` — **20 passed, 0 failed** (2.23 seconds). Source-seal and notification regressions found during independent review were fixed by the integration owner and rechecked. See `docs/security-review.md` for findings, reproductions and limits.

The final reset regression also verifies that a persisted `evaluation_campaign` blocks reset while running, while any reserved cost remains, or while charges are unknown. It releases the fence only after completion with zero reserved cost and no unknown charge. Final combined recheck after this addition: 20 passed, 0 failed (2.23 seconds).
