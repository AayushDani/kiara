# Local MongoDB qualification

27 September 2026. Four real database integration checks passed in 3.98 seconds under Node24.19.0 and MongoDB Community8.0.32. The replica set was the isolated, root-owned `kiaraQualification` instance on `127.0.0.1:27931`. The recorded official binary SHA-256 is `f81cb258434d548dca7244d599c82eb339043d8dedd0b1b807870c9d263117f2`.

The opt-in test is `tests/v2-mongo.integration.ts`, deliberately outside the default `*.test.ts` suite. It refuses any qualification URI other than the exact loopback replica-set URI below. It overrides database configuration only in its own process, creates a random `kiara_qualification_<32 hex>` database, and drops only that generated database in cleanup. It reads no `.env` and uses no production database configuration. Global fetch is denied. No Atlas search, embedding request or external provider call occurs.

```sh
KIARA_QUALIFICATION_MONGO_URI='mongodb://127.0.0.1:27931/?replicaSet=kiaraQualification' \
/Users/aayushdani/.npm/_npx/09ae5d3560c7b1f2/node_modules/node/bin/node \
  --import tsx --test tests/v2-mongo.integration.ts
```

The test requires that temporary replica set to be running. It does not start, stop or reconfigure a database server.

## Observed checks

- Sixteen concurrent aggregate CAS updates retain every accepted receipt with no lost counter increments. An obsolete migration hash is rejected.
- A persisted staging image simulates the committed-stage/pre-cutover interruption boundary. Closing storage clients and invoking the real migration resumes this image, publishes the head, preserves the checksum, and makes repeated migration idempotent. Both aggregate reads and stale aggregate writes are fenced afterward.
- Twelve concurrent normalized transactions preserve every write. A fresh application process reads the same checksum. Rollback copies the current normalized state, including late receipts, unknown effect/provider identity, outbox ownership, tombstones and membership revocation; it does not restore the older migration backup.
- Eight real concurrent empty-tenant aggregate/normalized bootstrap races each commit exactly one owner using the common aggregate document fence.
- A real index writer is paused after its transaction snapshot read but before its fence update. Deletion commits the permanent per-record fence and removes the chunks. Resuming the writer produces a transaction conflict/retry and then `INDEX_RECORD_DELETED`; the deleted text is not reinserted. A fresh adapter still rejects the deleted record, while another tenant's identical record ID remains independent.
- Actual inactive normalized generations, retained migration backups and the frozen aggregate copy lose the private fixture payload through the shared redaction policy. Cleanup replays after client restart, and a fresh application process reads the redacted canonical state. Current-state rollback retains that erasure and the provider receipt identity.

Evidence: [mongo-integration.log](evidence/mongo-integration.log), [mongo-integration-typecheck.log](evidence/mongo-integration-typecheck.log). Final database `kiara_qualification_2023419a2fe3462c9b15ef27a21d9cf7` was dropped successfully; all test clients and child processes closed. The parent owns shutdown of the temporary server.

This qualifies the exercised local replica-set transactions and application reconnect/restart paths. It does not qualify database-server process kill/failover, multi-node elections, hosted networking, Atlas search/index lag, deployment restoration, host/provider backups or production-scale latency. Staging interruption is represented by a real persisted boundary fixture, not a forced process kill during the migration implementation.
