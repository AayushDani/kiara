# Retention, recovery and original intake

This implementation distinguishes access withdrawal, application payload deletion, original-object retention, provider reconciliation and backup expiry. A deletion request immediately denies the source and dependent records. It does not claim that all external copies have disappeared.

## Attributed deletion and exceptions

The source control commits a lineage manifest, payload redaction and a durable cleanup outbox entry together. It covers current sources, documents, facts, conversations/scenarios, selected scenario shares, routing decisions, agreement inventories, proposals, counsel packets, learning/evaluation records, events, obligations and effort notes. IDs, hashes and decision timestamps remain for audit. Immutable document/history changes are allowed only by the exact committed redaction manifest.

An already dispatched or uncertain provider effect remains an operational exception. Its content is hidden from ordinary workspace views but retained privately for exact read-back. Future dispatch is canceled. After terminal reconciliation the effect receipt is scrubbed and repeated cleanup picks up its exact original references. Historical database generations and migration archives are redacted independently; they do not retain duplicate reconciliation payloads.

The worker uses permanent per-record index fences, verified exact original deletion and historical cleanup adapters. MongoDB cleanup is transactionally serialized against generation writes. S3 deletion names the retained version and verifies its absence; it does not bypass Object Lock. Shared live references, admitted original writers, unresolved effects and configured retention holds prevent physical deletion. Original retention defaults to 30 days, configurable through `KIARA_RETENTION_ORIGINAL_DAYS` from 0 to 3650; `KIARA_RETENTION_HOLD=true` prevents original erasure. These settings do not remove provider or legal retention obligations.

## Document intake and interrupted writes

Pasted document text and uploaded bytes create a durable intake record before object I/O. The command receives only workspace revisions created by its own intake; concurrent changes force refreshed review. A stable key cannot identify different bytes. Replays attach one document, and abandoned originals have durable cleanup work. A committed source-deletion fence prevents a later intake from recreating the same known original bytes.

A process can stop after the object store accepts bytes but before its reference reaches the workspace. That intake remains `ORIGINAL_REFERENCE_RECONCILIATION_REQUIRED`; absence of a reference is never treated as erasure. An operator can supply the exact retained manifest. Recovery verifies tenant, content hash, size, authenticated object read and unchanged intake before saving it. It neither creates a document nor authorizes any external action. S3 manifests must identify a verified object version; do not substitute an unspecified latest version. Missing encryption keys or unidentifiable versions remain explicit operator incidents.

## Operator procedure

Use the supported Node 24 runtime and an explicitly selected isolated or authorized tenant/store. Each command closes its database clients. Status output omits document and effect payloads.

```sh
npm run v2:operator -- inspect TENANT
npm run v2:operator -- retention-status TENANT
npm run v2:operator -- retention-run TENANT DELETION_JOB_ID
npm run v2:operator -- intake-status TENANT
npm run v2:operator -- intake-reconcile TENANT INTAKE_ID /absolute/path/exact-original-manifest.json
npm run v2:operator -- intake-sweep TENANT
npm run v2:operator -- effect-status TENANT
npm run v2:operator -- effect-reconcile TENANT ACTION_ID INTENT_ID
```

For a lost email acceptance receipt, the final command may include a candidate provider receipt ID. The provider read-back must bind the retained exact effect identity and bytes; a supplied ID alone proves nothing. Read-back never resends an effect. The original adapter configuration must be restored when it changed. Re-run retention cleanup after reconciliation. A user who lost source access can stop their own timer and withdraw future owned work through opaque Recovery controls without recovering removed content.

Backup status remains `operator_verification_required`, with unknown expiry. No application command currently certifies external backups, provider retention, object-lock expiration or customer legal retention policy. Operators must record actual backup expiration/deletion evidence in their deployment procedure; a green application cleanup count is insufficient.

Original purge claims are stored with an opaque claim ID and a 15-minute expiry. A second worker skips a live claim, including a claim held by another due deletion job for the same bytes. An expired claim can be retried, and an older worker cannot overwrite a later worker's completion or failure record. Retry timing uses the claim expiry. The physical purge adapter must remain idempotent because an old request may finish after its lease expires. The [generated Atlas concurrent-worker drill](evidence/shared-original-concurrent-atlas-sep27.md) verifies one overlapping claim and exact Mongo byte deletion; it does not establish managed backup erasure or customer migration.

## Evidence

`evidence/retention-collaboration-routes.log` records 20 passing local tests for lineage deletion, current/historical share redaction, uncertain effects, purge delay/hold, pending intake races, interrupted-write recovery and exact document API originals/replay/reimport. Route tests invoke the actual Request/Response handlers; they are not network or browser observations. S3 behavior uses an injected transport. The separate MongoDB integration record documents actual transactions on an isolated loopback replica set. No customer database, S3 bucket or paid provider was used.
