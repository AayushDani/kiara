# Connected Atlas synthetic recovery-state verification · 27 September 2026

`scripts/v2-atlas-recovery-state-qualify.ts --synthetic-atlas` created a generated `kiara_recovery_1d0a22c6a69e4700b16ef387b9c6a9d0` database and one generated tenant on the existing Atlas cluster. It used the configured standard multi-host TLS Atlas connection, a random temporary original-encryption key, two generated original payloads, two generated OIDC bindings, and normalized synthetic state. No prior tenant was read or copied. **This was not an Atlas managed backup restore.**

The script retained one original and purged another, revoked one identity and its membership, redacted one source and recorded its tombstone, and kept a selected durable receipt. It closed the application clients, then ran the operator's original and state restore verifiers against the generated recovery database. The original checks authenticated the retained bytes and observed the permanent deletion fence. The state check rehydrated all normalized record kinds and matched exact state hash `a458c6782ee87d9cb91cd86112c9da26ee8685e1bbbde78959d274ca149c55a5` at version 2. One active identity resolved to its active membership; one revoked identity was denied. The redacted source, tombstone and receipt hash were present.

Safe output:

```json
{"database":"kiara_recovery_1d0a22c6a69e4700b16ef387b9c6a9d0","tenantHash":"e20395f3e80a89b1cfc5a3cf024cdb7915b8e57226a69e5a9be8a7776517ab39","stateHash":"a458c6782ee87d9cb91cd86112c9da26ee8685e1bbbde78959d274ca149c55a5","version":2,"originals":[{"expected":"readable","verified":true},{"expected":"deleted","verified":true}],"activeMemberships":1,"revokedMemberships":1,"deletedSources":1,"receipts":1,"activeIdentities":1,"revokedIdentities":1,"managedBackupRestored":false,"remoteTenantDataRead":false}
{"database":"kiara_recovery_1d0a22c6a69e4700b16ef387b9c6a9d0","dropped":true,"cleanupVerified":true}
```

The generated database marker was checked before drop, and the post-drop collection listing was empty. This qualifies the connected verifier path on Atlas with synthetic records. An operator still must restore an actual managed snapshot into a separate recovery database, supply its escrowed key and snapshot-specific expected manifest, prove backup origin and recovery point/time, and test worker/provider reconciliation and access denial under real production credentials before release qualification.
