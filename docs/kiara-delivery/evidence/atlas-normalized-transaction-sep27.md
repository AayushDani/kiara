# Connected Atlas normalized transaction drill — 2026-09-27

At 2026-09-27 17:13 UTC, an operator probe generated an isolated Atlas database named `kiara_qualification_0425d9f13bb142bcb1bd48c2a43f065b`. It confirmed the database had no collections before use, set `KIARA_V2_STORE_MODE=normalized`, and committed one synthetic tenant membership and company label through Kiara's `transactWorkspace`. The first normalized head had version 1 and one membership row. After closing and reopening the Mongo client, `readWorkspace` returned the identical state hash. A second transaction revoked that membership; another client reopen returned version 2 with membership version 2 and the revocation timestamp.

The probe dropped **only** its generated `kiara_qualification_*` database in a `finally` cleanup. A separate read-only connection confirmed that no collections remained there. No production tenant, old demo record, customer text, embedding provider, delivery provider, or Vercel setting was touched.

This verifies a bounded managed-Atlas normalized transaction, durable readback after application client reopen, and persistence of one membership revocation. It does not establish live OIDC binding/session invalidation, a managed backup restore, Atlas failover, migration of a production tenant, deployed worker replay, or customer acceptance.
