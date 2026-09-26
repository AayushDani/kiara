# Kiara demo UI

The demo is a single split-screen workspace inspired by the supplied Legal Context Layer prototype. A warm, light company workspace sits beside a dark execution harness. There is no dashboard sidebar. On narrow screens the panes stack without shrinking text.

The primary path is one synthetic California signup → saved context retrieval and applicability assessment → scripted policy draft → visible validation and repair → founder approval → simulated lawyer review. A public visitor's final lawyer approval atomically restores their original demo data. The UI shows a completion receipt while displaying the fresh workspace. **Reset demo** is also available manually.

`src/ui/pages/KiaraApp.tsx` owns server state and actions. `src/ui/components/DemoHarness.tsx` displays execution and a read-only state snapshot. `src/ui/demo-harness.ts` projects saved workflow state into progress checkpoints; no timer invents progress. `src/ui/presentation.ts` retains lossless clause comparisons. `src/app/globals.css` defines the responsive visual system.

## Company workspace

The initial signup uses fictional defaults, with optional scenario customization. Activity, Policy, and Company context views keep the main page compact. Full original and proposed clauses remain available for review, with additions, changes, removals, and unchanged content distinguished. Retained sources and email previews are inspectable. Founder and lawyer actions remain explicit and ordered.

Every mutation uses the session CSRF token and a generated idempotency key. Review commands carry the reset generation, workflow state version, and sealed bundle hash. The UI polls saved state, and handles failed commands without claiming success. The server continues to enforce isolated signed public sessions and all approval gates.

## Execution harness

Six checkpoints show the current saved run: signup, context, applicability, draft, validation/repair, and human approval. Repairing retrieval and repairing a proposal are separate states. No-change decisions skip drafting and approvals. A material correction restarts progress even when the server retains historical checks. Only approvals bound to the current packet count.

Recorded events expose actual timestamps and failure/repair explanations. The syntax-colored snapshot is a projection of persisted fields, not an editable configuration or a claim that the harness upgraded itself. Harness versions are pinned to each workflow. After automatic reset the old run is not represented as ongoing activity.

## Demo boundaries

The company and review roles are simulated. Model output is scripted; email messages are previews. MongoDB Atlas and Vercel Workflow labels appear only when those modes are reported by the server. Local persistence is labeled separately. The source-review window uses retained legal fixtures. Internal approval does not publish a policy or establish operational compliance.

## Verification

Run `npm run check`, `npm test`, and `npm run build` under Node 24. Presentation tests verify complete clause comparisons and truthful errors. Harness tests verify state-driven progression, stale historical records, separate repair stages, no-change outcomes, ordered current-packet approvals, reset, and pinned harness versions. Browser verification covers rendered desktop/mobile layouts and the signup-to-approval path. Public automatic reset is checked over HTTPS on the deployed demo.
