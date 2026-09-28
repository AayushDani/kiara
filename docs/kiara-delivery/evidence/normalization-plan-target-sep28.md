# Local normalization target binding, 28 September 2026

An isolated loopback MongoDB Community 8.0.32 replica set at `127.0.0.1:27931` exercised the real normalized-store transactions under Node 24.19.0. The test generated two `kiara_qualification_<random>` databases, populated the same synthetic tenant state in both, and dropped both databases afterward. No Atlas, customer tenant, provider, or production credential was used.

Focused command:

```sh
KIARA_QUALIFICATION_MONGO_URI='mongodb://127.0.0.1:27931/?replicaSet=kiaraQualification' \
  node --import tsx --test --test-name-pattern 'normalization and rollback apply reject' tests/v2-mongo.integration.ts
```

Observed: **1 pass, 0 fail**. A cutover plan reviewed for database A was rejected against database B despite identical tenant state. Changing B's aggregate owner version invalidated B's own plan. A rollback plan reviewed for A was rejected against B; changing B's frozen ownership fence invalidated B's own plan. Rechecking and applying a fresh B plan succeeded in the isolated test. The full local Mongo integration suite, including interrupted cutover resume and historical redaction, passed **11 of 11** before the additional owner-drift assertions; the focused regression passed again after those assertions. TypeScript `tsc --noEmit --incremental false` passed after the change.

This proves the exercised local replica and CLI-backed library behavior. It does not prove Atlas failover, managed backup restoration, production tenant mapping, or customer recovery.
