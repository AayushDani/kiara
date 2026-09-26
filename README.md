# Kiara

Kiara turns a company change into a source-backed legal review. A California signup triggers a scoped applicability assessment, a versioned privacy-policy proposal, visible validation and repair, founder approval, then lawyer approval. The technical view connects that work to a persisted, measured retrieval-harness improvement.

This repository contains the actual application and the retained engineering inputs in `kiara-architecture/`. DemoCo is a fictional Rippit-inspired music-discovery company. Its revenue and practices are explicit synthetic facts; they are not claims about Rippit. A California address alone does not prove CCPA coverage, and an approved policy does not complete operational duties.

## Live hackathon demo

Open [Kiara](https://kiara-khaki-kappa.vercel.app). No login is required. Each visitor has an isolated Atlas-backed workspace and can switch between simulated founder and lawyer roles. Final lawyer approval automatically restores the original data; **Reset demo** is also available anytime. Hosted processing uses Vercel Workflow. The demo uses scripted generation and email previews, not paid model calls or email delivery.

## Deploy updates

The production branch is `main`. With the Vercel GitHub connection configured, committing and pushing to `main` triggers a build and updates the same live URL after a successful deployment:

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
- **OpenAI:** supply `OPENAI_API_KEY`, set `KIARA_MODEL_MODE=openai`; the default runtime model is `gpt-6-astra`, reasoning `medium`. The adapter uses bounded Responses requests, explicit budgets and scoped evidence tools. The chat's reasoning configuration is separate from the application model.
- **Resend:** supply provider key, verified sender, webhook secret, approved recipient addresses, and `KIARA_EMAIL_MODE=delivery`. Real sending also requires `KIARA_ALLOW_LIVE_EMAIL=true` after explicit authorization. Preview messages never count as deliveries. Unknown provider outcomes require reconciliation.

Local simulated identities are restricted to loopback. The public hackathon mode provides isolated synthetic demo sessions with simulated roles; it is not authentication for a real legal-service deployment. No real policy is publicly published or email sent by the demo.

## Working flow

1. Start from the synthetic New York customer baseline and simulate a declared California signup.
2. Watch context retrieval, explicit CCPA criteria, the full policy redline, the deliberately seeded citation fault and bounded repair.
3. Inspect authoritative source text, source hashes/dates, linked company facts, operational follow-ups and validation records.
4. Submit classified feedback or approve as founder. Switch to the simulated lawyer and approve the exact sealed bundle. A material change requires new validation and both approvals.
5. In local or private mode, run the harness comparison. The narrow approved change prefetches California facts and legal evidence. Persisted deterministic results are labeled separately from a live-model evaluation.
6. In local or private mode, submit a distinct later signup. The new workflow pins the promoted version; prior workflows retain their original pins. A reviewed current policy may need no second redline.

## Verification and handoff

```sh
npm run check
npm test
npm run build
npm run doctor
```

Actual results and unresolved limitations are recorded in `docs/verification.md` as verification progresses. `implementation-registry.json` accounts for all 130 retained requirements without treating design artifacts as executed application evidence. Provider-dependent checks remain blocked until credentials and the relevant authorization exist.

Repository: https://github.com/AayushDani/kiara. Existing remote history is preserved.
