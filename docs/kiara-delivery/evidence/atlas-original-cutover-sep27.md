# Connected Atlas synthetic original cutover · 27 September 2026

The operator ran `scripts/v2-atlas-original-cutover-qualify.ts --synthetic-atlas` against the existing Atlas cluster with a freshly generated `kiara_qualification_2ef52c190e01437cb6f50c76edf8d936` database and `synthetic-atlas-cutover-2ef52c190e01437cb6f50c76edf8d936` tenant. The script accepted the configured standard multi-host Atlas URI after checking that every parsed host ended in `.mongodb.net`. It did not read an existing tenant or call a model, legal API, delivery provider or worker.

The synthetic 572-byte local encrypted original was referenced by one generated source. Preview verified its bytes and exact source/purge URI, and the wrong preview hash was rejected. Applying the reviewed preview hash `bfb8e91513890fb836340449f694de36854afb5ecc2ea01309e38f6d5c0282bd` published one Mongo alias after destination readback and purged the exact old local object. Replaying the same cutover reported one completed purge. A fresh application Mongo client read the identical bytes through the legacy reference; direct Mongo readback also matched. Purging either the legacy reference or the native Mongo target was rejected with `ORIGINAL_ALIAS_TARGET_HELD`, and the target remained readable.

The generated database had one cutover manifest, one alias and one retained Mongo original. The script checked its exact qualification marker before dropping only that generated database and verified that the dropped database had no collections. The random local-original directory was removed. The safe output was:

```json
{"database":"kiara_qualification_2ef52c190e01437cb6f50c76edf8d936","tenant":"synthetic-atlas-cutover-2ef52c190e01437cb6f50c76edf8d936","previewHash":"bfb8e91513890fb836340449f694de36854afb5ecc2ea01309e38f6d5c0282bd","count":1,"bytes":572,"sourceHash":"ebd0cd48abe50253ea684c5ff055bc196b3183a39267745bd515fb6a523d2703","aliasReadbackAfterClientReopen":true,"legacyPhysicalPurged":true,"replayVerified":true,"aliasAndNativePurgeHeld":true,"remoteTenantDataRead":false}
{"database":"kiara_qualification_2ef52c190e01437cb6f50c76edf8d936","dropped":true,"cleanupVerified":true}
```

This qualifies one synthetic local-original-to-Mongo cutover on Atlas. It does not qualify customer original migration, shared-target garbage collection, managed backup expiry or restore, escrowed-key recovery, production credentials, or a hosted tenant.
