# Paired-case evidence qualification

Run the read-only operator check against the configured v2 workspace store:

```sh
node --import tsx scripts/v2-measurement-qualification.ts '<tenant-id>' /path/to/paired-case-manifest.json
```

The manifest names the exact baseline and current matter IDs, each frozen outcome hash, current usefulness receipt ID, action IDs, participant IDs, and effort entry IDs. It also names the current observed baseline record, comparison scope, and an independent quality adjudication with reviewer identity, membership version, review time, both outcome hashes, verdict, and a SHA-256 digest of the separately retained adjudication artifact. `caseOutcomeHash(state, matterId)` in `src/v2/measurement-qualification.ts` defines the outcome hash. The manifest's `tenantId` must match the command argument and stored workspace.

Exit code `0` means `evidence_ready`; exit code `1` returns `incomplete` with reason codes; malformed input or a store read failure exits `2`. Output is one bounded JSON result. The check does not write to the workspace. A ready result includes recorded baseline/current human minutes and correction minutes as a subset counted once. It is a structural evidence check, **not** a finding of time savings, financial savings, customer validation, legal quality, or authentic independent adjudication. An operator must verify the adjudication artifact and customer context outside this gate.

The gate fails closed when linked goal-only effort exists for a usefulness receipt. Reconcile that time to a case exactly once before attempting a paired qualification. Existing counsel without a named accountable actor and effort also remains incomplete.
