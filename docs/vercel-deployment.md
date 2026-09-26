# Vercel deployment

Kiara uses Vercel Functions and Workflow SDK for hosted processing, and MongoDB Atlas for durable application data. Node 24 is required. The first deployment uses the scripted model and email previews; it does not call paid models or send email.

## Public hackathon demo

The current deployment uses `KIARA_AUTH_MODE=public_demo`: no passwords or login are required. A signed Secure/HttpOnly cookie selects an isolated visitor workspace. Judges can switch between founder and lawyer roles; the ordered review gates still apply. After final lawyer approval, the server atomically restores the original seed and returns the visitor to the founder role. A visible Reset demo button offers the same restoration at any time, including while viewing as lawyer. Old workers and stale requests cannot revive a prior generation.

Mutable visitor data is stored in bounded documents in the Atlas `demo_workspaces` collection. Each cookie expires after four hours, and a TTL index removes its stored workspace. The original 29-collection dataset is not exposed to anonymous edits. New visitors share retained legal fixtures but not workflows, facts, drafts or approvals. The public scripted demo uses a simulated source-review window for its session, not a claim that retained legal sources were freshly rechecked. Live generation and email delivery fail closed in public mode.

## Optional private authentication (not active)

Set `KIARA_AUTH_MODE=hosted_password`, a random `KIARA_SESSION_SECRET` of at least 32 characters, and `KIARA_FOUNDER_PASSWORD_HASH` / `KIARA_LAWYER_PASSWORD_HASH`. The latter are SHA-256 hashes of independently generated 256-bit passwords. Do not use human-chosen passwords with this scheme. The original passwords are kept in the owner-only, Git-ignored `.kiara/deployment-access.md` file. The app signs eight-hour HttpOnly, Secure, SameSite=Strict cookies. Each role must sign in separately. These are demo roles, not verified professional identities.

Local development retains `demo_simulated` authentication on loopback only. In optional password mode, hosted sessions cannot use the local role-switch endpoint and unauthenticated workspace requests do not access Atlas. Public-demo mode instead issues an isolated demo session automatically.

## Runtime configuration

- `MONGODB_URI`: existing TLS Atlas connection; encrypted Vercel secret.
- `MONGODB_DB=kiara`
- `KIARA_WORKER_MODE=vercel_workflow`
- `KIARA_MODEL_MODE=scripted`
- `KIARA_EMAIL_MODE=preview`
- `KIARA_ALLOW_LIVE_EMAIL=false`
- `KIARA_DATA_DIR=/tmp/kiara` (scratch only; never durable hosted state).

Mutations enqueue durable Workflow jobs. Each step advances persisted state, and processing pauses at human review. Review, edit, and verification actions start another drain. System & activity includes Resume processing to recover a failed enqueue. Old reset generations cannot advance new workflows. Atlas remains the record of decisions and application events.

Live model evaluation campaigns still require a dedicated worker; hosted API requests reject them before creating a candidate. The scripted evaluation works on Vercel, using explicitly bundled source files and retained fixtures for integrity attestations.

## Network and deployment

GitHub integration: `AayushDani/kiara` → `main` → Vercel production. No manual Vercel upload is needed for ordinary code changes. Failed builds do not replace the last successful production deployment.

The owner explicitly approved the Atlas `0.0.0.0/0` network entry for Vercel's dynamic egress. Credentials and TLS remain required. Replace this entry with restricted egress if migrating to fixed-IP infrastructure.

Push commits to the connected GitHub repository’s `main` branch to trigger production deployment. `vercel deploy --prod` remains a manual fallback. The linked project is `aayushdani01-5976/kiara`. Do not upload `.env*`, `.kiara`, or research files; `.vercelignore` excludes them. `next.config.ts` explicitly bundles runtime fixtures and excludes private files from function traces. Vercel environment secrets must be configured before deployment.

## Validation

The full suite passed 74 tests, including public session isolation, ordered role review, atomic automatic reset, manual lawyer reset, stale-worker fencing and public-mode provider restrictions. Focused hosting/security/adaptation tests also passed on Node 24.19.0 after dependency patches. Production Next.js and Workflow compilation passed. Installed dependency audit reported zero vulnerabilities. Live deployment checks are recorded separately in [`verification/public-demo-verification.json`](verification/public-demo-verification.json).
