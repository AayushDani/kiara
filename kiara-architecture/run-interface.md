# Proposed seed/reset/run contract — design only

These commands are interfaces for I00/I01/I12 to implement. None is an existing application command, and none was run in this architecture phase. Repository paths in the packets are proposed application paths, separate from this architecture handoff.

Selected runtime follows T06 D-T06-001 and T10's 2026-09-26 dependency manifest: TypeScript, Node 24.19.0, `openai@7.23.0`, `mongodb@7.6.0`, `resend@6.30.0`, a small custom Responses loop, one **Next.js App Router/React web/API process with Node-runtime Route Handlers**, and one separate durable Node worker. The application uses `gpt-6-astra` with **medium** reasoning per T06's runtime policy; every implementation **chat** remains `gpt-6-astra` / **xhigh**. SDK installation, provider entitlement and runtime latency are unverified. I00 pins all selected package versions in one lockfile. T06/T10 now pin Next16.3.6, React19.3.0 and react-dom19.3.0. Frozen T06 policy SHA256: `3a973cb796f959faa32a325debc877a6582fab785ef589d80270acb25bfb2883`; dependency bindings are recorded in `runtime-dependency-binding.json`.

## Environment schema

`env.example` contains names with blank values, never credentials. I00 validates presence, allowed values and modes on startup. The following are proposed application variables; map any changed names once through the final contract release.

| Variable | Meaning and prerequisite | Proposed default/constraint |
|---|---|---|
| NODE_ENV | Node runtime environment | development locally; production only for authorized release |
| PORT | Web/API listening port | 3000 |
| KIARA_PUBLIC_BASE_URL | Absolute origin used for review links | localhost for preview; authorized public origin for release |
| MONGODB_URI | Secret database connection | Required for the chosen Atlas sandbox; never printed |
| MONGODB_DB | Scoped database name | `kiara_demo`; reset requires explicit allowlist |
| ATLAS_PROJECT_ID | Non-secret ID used to match human-confirmed organizer sandbox | Does not itself prove sandbox eligibility |
| ATLAS_SANDBOX_CONFIRMATION_REF | Local attestation/evidence reference after invited project/cluster is verified | No private invite token stored |
| OPENAI_API_KEY | Runtime API credential, separate from Codex credits | Required for live model acceptance |
| KIARA_MODEL | Runtime provider model | `gpt-6-astra` per T06 |
| KIARA_REASONING_EFFORT | Runtime reasoning | `medium` per T06; no impact on chat xhigh setting |
| KIARA_RUNTIME_POLICY_VERSION | Versioned policy limits | Approved K-RUN-POLICY-001 version |
| KIARA_TOOL_REGISTRY_VERSION | Typed server tool catalog | `0.1.0` per frozen T06 |
| KIARA_MAX_MODEL_CONCURRENCY | Shared worker/provider semaphore | `2` per frozen T06 |
| KIARA_AUTH_MODE | Synthetic-only identity/seed behavior | `demo_simulated`; do not represent as production auth |
| KIARA_SESSION_SECRET | Secret for server-side signed demo sessions | Unique high-entropy value; never client-exposed |
| KIARA_ALLOWED_RESET_DATABASES | Explicit database allowlist | No wildcard/production database |
| KIARA_EMAIL_MODE | Preview versus actual provider | `preview` until sending is authorized |
| EMAIL_PROVIDER | T10-selected adapter key | `resend` |
| RESEND_API_KEY | Secret provider credential | Required for integration smoke test; sending separately authorized |
| KIARA_EMAIL_FROM | Verified sender | Provider/domain readiness required |
| EMAIL_TEST_TO | Explicitly authorized test recipient | Blank until recipient/transmission authorized |
| RESEND_WEBHOOK_SECRET | Delivery callback authentication | Required for Resend delivery callbacks |
| LANGSMITH_TRACING | External tracing mode | `false` until redaction and destination verified |
| LANGSMITH_API_KEY | Optional external trace credential | Never required for Atlas technical pane |
| LANGSMITH_PROJECT | Optional trace project | Synthetic/redacted traces only |
| LANGSMITH_ENDPOINT | Optional documented endpoint | T13-selected endpoint; avoid guessed URL |

Optional search/embedding credentials are added only if T05 selects that actual path; exact/provision and lexical retrieval remain testable without waiting for vector-index provisioning. This is an implementation-method choice preserving retrieval, not replacement of Atlas storage. Any indexes required by the selected path must exist and be queryable before the readiness gate is green.

## CLI interface

```sh
npm ci
npm run kiara:doctor -- --json --require-atlas-sandbox
npm run kiara:seed -- --tenant demo-rippit-inspired --scenario covered-ny-ca --seed 20260926 --clock 2026-09-26T16:00:00Z --notification-mode preview
npm run kiara:verify-seed -- --tenant demo-rippit-inspired --json
npm run dev:web
npm run dev:worker
npm run kiara:demo -- --scenario covered-ny-ca --mode interactive
npm run kiara:eval -- --suite full --baseline harness-v1 --candidate harness-v2 --json
npm run kiara:demo -- --scenario repeat-ca --mode replay --recorded-run recorded-main-run
npm run kiara:reset -- --tenant demo-rippit-inspired --scenario covered-ny-ca --seed 20260926 --clock 2026-09-26T16:00:00Z --confirm-demo-tenant demo-rippit-inspired
npm run kiara:verify-seed -- --tenant demo-rippit-inspired --json
npm run build
npm run test:acceptance
```

`dev:web` and `dev:worker` run in separate terminals; shared start/stop script is acceptable if the two process responsibilities remain clear. Scenario, tenant, harness and run labels are CLI aliases resolved to canonical UUIDs; they must not leak into UUID record fields. `--mode interactive` requires explicit human review clicks. A scripted replay shows recorded human actions only in a clearly labeled replay; it must not bypass server approval guards or masquerade as real approvals. `repeat-ca` creates a new event/run against the promoted harness and stable evidence; a replay is not a fresh live provider success.

Exit codes: `0` success, `2` configuration/readiness missing, `3` fixture/schema/version conflict, `4` selected dependency unavailable, `5` check failure. Outputs include `schema_version`, `status`, `run_id`, `checks`, `artifacts`, and `blocked_on`. They never include secrets or complete customer addresses.

### Seed manifest contents

The deterministic seed derives UUIDs from a fixed namespace + fixture version + entity semantic key. Immutable source snapshots retain raw-byte hashes, retrieval dates, effective dates, authority and exact provision locators. It includes:

1. One **fictional** Rippit-inspired company with NY-only known customers, synthetic founder/lawyer actors, baseline privacy document and clause IDs.
2. T03's explicit positive fixture: for-profit/controller status, doing business in CA, nonexempt signup PI, 2025 gross revenue USD 30 million, and declared California residence. This is subject to T03's complete legal condition matrix; the adjusted USD 26,625,000 revenue threshold is source-backed by T03, not a fact about real Rippit.
3. Stable NY baseline events plus two distinct CA signup events; declared residence, address, IP and billing geography are separate evidence fields. No CA event is emitted by initial seeding unless selected explicitly.
4. Legal snapshots and company context sufficient for the main scenario, plus `needs_information` and `not_covered` fixtures, adversarial and stale-source fixtures, and operational follow-up records specified by T03/T07.
5. Immutable harness baseline, candidate patch allowlist, protected policy, frozen evaluation manifests/holdouts, configuration hashes and champion pointer.
6. No preapproved review actions, no fake provider deliveries, and no precomputed “live” success. Deliberate defective output, if used, is labeled an evaluation fixture. Real generated output and human decisions are recorded during the actual run.

Reset first requires stopped/paused tenant worker intake, the same tenant alias confirmation, demo mode, an allowed database, and a manifest. It clears only tenant-scoped demo descendants and restores immutable seed references/champion v1; immutable shared legal snapshots remain keyed by hash. It aborts for active non-demo runs or cross-tenant references. Preserve the prior recorded-run evidence in a separate export before reset. Repeating reset must yield identical semantic data/hash counts (apart from explicit reset audit timestamps/IDs) with no duplicate key error or duplicate events.

### Readiness and access ownership

Human build lead supplies/attests the organizer invite and confirms the project/cluster were created through it. No agent reads private email without further authorization. I01 checks database connectivity, transactions/indexes and fixture writes; local MongoDB can unblock development but cannot satisfy finalist eligibility. I03 verifies runtime model/tool/structured-output capability with a small authorized call and logs latency. I08 validates the real email adapter, separate preview, sender verification and callback contract. I00 verifies available processes/ports, tests, reproducible install, account usage and at least three admission slots. The coordinator records actual launch-to-first-tool and checkpoint latency and admits up to eight only if they progress. The human submission owner confirms exact deadline, venue/on-site recording, September 30 availability and external release approval.

### Proposed doctor response example

```json
{
  "schema_version": 1,
  "status": "blocked",
  "run_id": "50f08236-e3f2-4aa9-8c61-32fe9b85f105",
  "checks": [
    {"id": "node_version", "status": "not_run"},
    {"id": "atlas_connectivity", "status": "not_run"},
    {"id": "organizer_sandbox_attestation", "status": "missing"},
    {"id": "runtime_provider_smoke", "status": "not_run"},
    {"id": "email_provider_contract", "status": "not_run"}
  ],
  "artifacts": [],
  "blocked_on": ["organizer_sandbox_access", "runtime_credentials", "email_credentials_and_sender_verification"]
}
```

This is a parseable design example, not an executed doctor's report.

Runtime environment names align with frozen T06. The Resend adapter reads `KIARA_EMAIL_FROM`; T10’s documentation example name `MAIL_FROM` is an adapter mapping, not a second required environment variable. Every value stays blank in T14’s template. Automatic child runs inherit `budget_scope_id`, counters and deadline; no timeout/retry/chunk transition silently creates a fresh budget. Full document inventory and T05 source batches are hydrated from authorized manifests; oversized semantic inputs produce explicit capacity failure, never truncation or skipped validation.

**Verified reset contract:** T06 re-froze the persistent monotonic `reset_epoch` correction at `2026-09-26T16:24:29.261413+00:00`; T14 verified all current manifest file hashes. Preserve this tenant guard through reset, quiesce job/model/tool/email dispatch, cancel old work, retain or reconcile unknown model charges and live-send receipts, then atomically advance/touch the guard before deleting/reseeding the selected epoch. Every claim, dispatch, tool/hydration operation, commit and replay must compare the epoch in the same guarded transaction; old-epoch completions cannot attach to reused deterministic UUIDs. Semantic fixture hashes stay repeatable, while the surviving reset guard deliberately increases. This is required by the adopted runtime contract; the superseded hashes and correction reason remain recorded in the dependency binding.
