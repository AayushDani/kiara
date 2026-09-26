# Kiara

Kiara turns a company change into a source-backed legal review. A California signup triggers a scoped applicability assessment, a versioned privacy-policy proposal, visible validation and repair, founder approval, then lawyer approval. The split-screen demo pairs a simple company workspace with a persistent execution harness.

This repository contains the actual application and the retained engineering inputs in `kiara-architecture/`. DemoCo is a fictional Rippit-inspired music-discovery company. Its revenue and practices are explicit synthetic facts; they are not claims about Rippit. A California address alone does not prove CCPA coverage, and an approved policy does not complete operational duties.

## Live hackathon demo

Open [Kiara](https://kiara-khaki-kappa.vercel.app). Public sessions use synthetic company/event inputs and simulated founder/lawyer roles. The live OpenAI path is protected by a shared $50 operator budget across all visitors and evaluations; credentials stay server-side. Completed runs retain history. Email is preview-only. Configuration is distinct from verified inference: see [current acceptance status](docs/ai-e2e-verification.md).

## Deploy updates

Vercel is connected to `AayushDani/kiara`. Committing and pushing to the production branch, `main`, automatically triggers a build and updates the same live URL after a successful deployment:

```sh
npm run check
npm test
npm run build
git add .
git commit -m "Describe the change"
git push origin main
```

Check the [Vercel project](https://vercel.com/aayushdani01-5976/kiara) for deployment status. Environment secrets are configured in Vercel; keep `.env.local`, `.kiara/`, and `.vercel/` out of Git. See [deployment details](docs/vercel-deployment.md).

## Run locally

```sh
npm install
npm run seed
npm run dev
```

In another terminal in this directory:

```sh
npm run worker
```

Open http://localhost:3000. Keep both processes running. The UI reads persisted records; the separate worker advances jobs and creates notification previews. `npm run doctor` checks configured modes and worker heartbeat without printing credentials.

The frozen package versions are Next 16.3.6, React 19.3.0, MongoDB driver 7.6.0, OpenAI SDK 7.23.0 and Resend 6.30.0. Use Node 24.19.0 (`.nvmrc`). The application typecheck, automated suite, production build, and running web/worker were verified with that exact runtime.

## Modes and integrations

Copy `.env.example` to `.env.local` and configure only the modes you intend to use. Never commit populated environment files.

- **Local development:** atomic JSON persistence in `.kiara/`, an explicitly scripted model, simulated founder/lawyer identities, and email previews. No API credentials are needed. This is not Atlas, live-model, email-delivery or organizer-sandbox proof.
- **MongoDB:** supply `MONGODB_URI` and `MONGODB_DB`; the adapter uses MongoDB transactions and tenant/reset guards. Use a replica set or Atlas. An organizer-invited sandbox must be configured separately for any eligibility requirement.
- **OpenAI:** supply `OPENAI_API_KEY`, set `KIARA_MODEL_MODE=openai` and an explicitly authorized `KIARA_OPENAI_BUDGET_USD`; public live also requires `KIARA_PUBLIC_LIVE_ENABLED=true`; the default runtime model is `gpt-6-astra`, reasoning `medium`. The adapter uses bounded Responses requests, explicit budgets and scoped evidence tools. The chat's reasoning configuration is separate from the application model.
- **Resend:** supply provider key, verified sender, webhook secret, approved recipient addresses, and `KIARA_EMAIL_MODE=delivery`. Real sending also requires `KIARA_ALLOW_LIVE_EMAIL=true` after explicit authorization. Preview messages never count as deliveries. Unknown provider outcomes require reconciliation.

Local simulated identities are restricted to loopback. The public hackathon mode provides isolated synthetic demo sessions with simulated roles; it is not authentication for a real legal-service deployment. No real policy is publicly published or email sent by the demo.

## Working flow

1. Register an event; the harness pins the company context, prior policy and legal evidence.
2. The real agent retrieves scoped facts/clauses/evidence and returns a structured candidate output event.
3. Deterministic and independent model checks validate it; failures retain evidence and enter bounded repair.
4. Genuine failure and review-feedback patterns trigger a model strategy proposal and frozen baseline/candidate evaluation. Only demonstrated improvements promote.
5. Review the immutable redline, give attributed factual/document/legal feedback, and approve the exact packet as founder then lawyer. Changed packets invalidate stale approvals.
6. Retain completed history and run the next event against the current harness version.

Private mode also accepts founder-supplied context and prior documents. Unsupported legal scope escalates. [Runtime architecture and limits](docs/runtime.md) explains the application agents, event contracts, evaluation gates and protected controls.

## Verification and handoff

```sh
npm run check
npm test
npm run build
npm run doctor
```

Actual results and unresolved limitations are recorded in `docs/verification.md` as verification progresses. `implementation-registry.json` accounts for all 130 retained requirements without treating design artifacts as executed application evidence. The latest provider-backed acceptance and any external blockers are recorded separately from injected tests.

Repository: https://github.com/AayushDani/kiara. Existing remote history is preserved.
