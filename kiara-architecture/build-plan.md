# Proposed five elapsed-hour implementation plan

Planning/research is separate from the later **T+0..300 elapsed-minute build window**. This plan preserves every committed product requirement and stages thirteen persistent implementation chats, all `gpt-6-astra` / `xhigh`. No implementation chat has been created by T14 and no application build has started.

The selected target assumes **eight active worker chats plus one coordinator**, using the observed ability of the host to run many independent persistent chats as a reason to test that admission level. The conservative baseline remains **three active workers plus the coordinator**. The coordinator's four-slot ephemeral-agent tree is a separate mechanism and establishes neither a persistent-chat hard limit nor sustained throughput. As of the coordinator's 2026-09-26T16:01:27.793Z observation, all 17 research chats had started and produced tool activity; their overlapping turn lifetimes support concurrency, not a timing benchmark or guarantee.

## Admission, ownership and contracts

I00 is the integration worker; the build coordinator is a separate scheduling role. Create persistent chats from `implementation-manifest.json` only when the later build is authorized. Use `list_projects`, verify the project/workspace, then explicitly set `model: gpt-6-astra` and `thinking: xhigh` for each local project task. Do not create cloud tasks or infer actual settings from intent. Record returned thread/host IDs and actual execution settings separately. A pending client thread ID is not a ready thread ID. Verify each chat can read the shared original brief and finalized contracts before launch; these files exist locally during planning but future accessibility must be checked again. Tool schema changes must be handled from the live schema.

The thirteen complete packet files cover I00 integration; I01 Atlas/schema/seed; I02 retrieval; I03 runtime/context tools; I04 workflow/reviews; I05 documents; I06 validators/adaptation; I07 founder/lawyer UI; I08 email; I09 observability; I10 security/contract verification; I11 independent E2E; I12 demo/release. One package can own several code modules; this is not a thirteen-service deployment.

I00 owns manifests, lockfile, entrypoints and shared contract exports. Peers own disjoint directories specified in their packets. Use the final T17 contract release and T15 component mapping; current package component aliases are a handoff mapping, not a rival diagram namespace. The wire baseline follows T09/T17: snake_case, UUID domain IDs, RFC3339 wire timestamps/BSON Date storage, trusted tenant scope, `user.signed_up`, and immutable review bundles. I00 freezes input hashes at T+15. If contracts are not final before T+0, the current five-hour estimate does not apply until their reconciliation work is explicitly included; never hide design work outside the clock.

## Elapsed schedule and gates

`schedule.json` has the full machine-readable dependency graph and resource-constrained allocations. Durations below include assumed model/tool/edit/check cycles; they are not measured productivity. Every requirement is present in `requirement-package-map.json`.

| Window | Active work and integration outcome | Gate |
|---|---|---|
| 0–15 | I00 creates the installable skeleton and contract exports; coordinator admits workers and checks sandbox/provider/access/deadline readiness with the human owner | G0: contract release and credential/index readiness known, blocked items named |
| 15–55 | Eight workers I01–I08 build independent owned modules against fixed typed contracts and labeled fixtures | No API/enum drift; publish first module signature/check results by +30 |
| 55–80 | I09 observability starts as I08 frees a slot; I10 independent security tests starts at +65; retrieval integrates with actual Atlas +70–85; I12 capture/provenance preparation starts +80 | G1 at +80: real storage/schema/seed ready; runtime/workflow/document modules individually checked |
| 80–100 | I04 wires actual runtime, Atlas and immutable document flow; model request must be real and entitlement verified | G2 at +100: event persists, assessment/draft/validation can execute; remaining UI adaptation/notification wires are named |
| 100–120 | UI, persisted adaptation, notifications and timeline replace mocks with actual contracts | G3 at +120: no permanent mock in committed product path; preview remains explicitly separate from email provider |
| 120–140 | I00 runs the integrated vertical slice; I06 executes frozen baseline/candidate/holdout evaluation until +145 | G4 at +140: covered signup reaches founder queue with evidence/redline/failure/repair; +145 actual adaptation results |
| 140–185 | I11 independently tests complete human gates, missing/noncovered cases, security, retry/crash and email behavior; evidence captured | G5: severity findings and exact owner fixes; no self-graded acceptance |
| 185–220 | I00 integrates corrections with up to two responsible owners; three slots are explicitly reserved | G6: fixes complete; no new product scope or broad rewrites |
| 220–240 | I11 rechecks the final integrated revision and records residual limitations | G7: acceptance/rejection/provisional result; failures are not hidden for recording |
| 240–265 | I12 + on-site human record/edit the 60-second split-screen video; I00 prepares final sanitized release/reproduction artifact +240–255 | G8: real capture, code/function/audio; deployment/publication remains an authorized human action |
| 265–285 | I12 + human owner check repository/demo/video access, roster, description and submission receipt when external action is authorized | G9: submission-ready package, or exact external blocker |
| 285–300 | Explicit 15-minute contingency for access, audio/link correction or organizer submission queue | Must not silently reallocate away mandatory checks |

Critical serial chain at the eight-worker target: **J00 (15) → J04 (65) → J12 (20) → J13 or J14 (20) → J17 (20) → J18 (45) → J20 (35) → J21 (20) → J23 (25) → J25 (20) = 285 minutes**. This chain is why simply creating more chats does not improve the modeled result. A real signup-to-founder slice exists by +140, leaving another 100 minutes of review/correction before final capture.

## Capacity and latency sensitivity

| Active workers, plus coordinator | Nominal duration multiplier | Modeled finish | Implication |
|---|---:|---:|---|
| 3 | 1.00 | +395 | Conservative full-scope plan misses five hours by 95 minutes |
| 6 | 1.00 | +310 | Ten-minute miss before contingency |
| 8 | 1.00 | +285 | Fifteen-minute reserve; conditional target |
| 12 | 1.00 | +285 | Serial chain dominates; no modeled benefit |
| 8 | 1.25 | +356.25 | A 25% common slowdown consumes more than all reserve |
| 3 | 1.25 | +493.75 | Significant capacity/latency risk |
| 3 | 0.75 | +296.25 | Fits only if all jobs beat nominal by 25%; not a safe promise |

Nominal jobs sum to 865 elapsed job-minutes. Including the two additional correction workers reserved in J20 gives 935 worker-minutes; this is capacity accounting, **not a human-hours interpretation**. T+300 is an elapsed deadline. The list scheduler respects dependencies, worker slots and single-owner nonoverlap. It is a reproducible estimate, not proof of optimality.

Budget assumptions: an ordinary scoped module consumes roughly 6–12 model/edit/tool/check cycles at about 2–5 elapsed minutes per cycle, with reading/setup and local validation included in its 35–65 minute phase. These are explicit planning assumptions. Host launch delays, shared account token limits, network retries, dependency installation and Atlas index readiness can consume them. T06 separately caps each application agent run at 300,000 ms, each provider request at 90,000 ms, at most 9 logical/12 physical model requests, 16 tool calls and 2 repairs. These are bounds, not expected latency. The 25-minute evaluation phase requires the chosen deterministic cases plus selected live runs to fit the campaign budget; I06 must calculate actual fixture/model-call count before G0 and expand the schedule if it does not. Do not multiply a five-minute maximum by many serial cases and pretend they fit 25 minutes.

At +15 and +30, record each admitted chat's launch-to-first-tool delay, model/tool completion times and completed contract checks. At +65 and +100, recompute remaining longest path from actual completions. If effective worker capacity is below eight or a critical gate is >15 minutes late, the five-hour target is at risk. Give the human owner a concrete revised forecast. Keep the complete requirement map; do not convert email to preview-only, adaptation to a source refresh, missing-law uncertainty to false, or approvals to a simulated green badge.

T07's revised campaign is concrete: six complete baseline/candidate semantic runs (three paired positive-fixture repetitions), aggregate limits **USD18, 72 physical attempts, 900 seconds, two in flight**; each run still inherits T06's USD3/12-attempt/300-second limits. The old USD6/12-attempt campaign is superseded. Campaign exhaustion produces `inconclusive` and no promotion. J19's 25 minutes reserves up to 15 minutes for that bounded campaign plus 10 for deterministic checks, persisted result inspection and the held-out later-event proof. The later event is excluded from tuning/promotion. This remains unmeasured and access-dependent; if T07's full frozen suite needs more work, G0 must account for it.

Frozen T06 runtime reconciliation: Next16.3.6/React19.3.0/react-dom19.3.0 on Node24.19.0. Main three-batch/two-fault reservation totals7 model calls,104k input,18k output,USD1.94; worst two-output-repair reservation9 calls,120k input,24k output,USD2.40. These arithmetic ceilings do not verify the actual fixture fits its8k-token semantic-validation input or completes within300 seconds. Nine sequential90-second requests exceed the deadline; the deadline is an enforced cap, not a completion promise. Preserve `budget_scope_id` across automatic children and manifest hydration of full evidence/document inventory. Any actual capacity overflow remains a readiness blocker.

Bottleneck remedies preserve behavior: pre-stage legal/fixture/design artifacts during this authorized design phase; freeze contracts before independent code; centralize package installation once; use source-backed exact/lexical retrieval when optional vector provisioning delays; use the selected minimal custom runtime; let spare persistent chats reproduce a failure or independently review an owner patch; allocate two focused fix owners alongside I00; rehearse framing/audio in I12 before final code freeze. Avoid duplicative framework experiments or separate backend languages. If measured effective capacity is only three, nominal completion stays +395; unless a measured faster cycle or additional progressing slots resolves it, the five-hour build remains **dependency/timing-blocked**, with full scope preserved.

## Prerequisites and public handoff

The first 15 minutes include checks and small smoke calls; account creation, invite recovery, sender-domain verification, or an unknown submission deadline cannot be assumed to finish in that allowance. Their unknown duration is a visible external blocker. The named human must confirm the actual organizer cutoff so +300 ends before it. This phase neither reads private invite email nor publishes or sends anything.

Use `run-interface.md` and `env.example` for planned commands, deterministic fixture/reset behavior, readiness statuses and startup. Use `demo.md` for exact recording and submission ownership. Public repository handoff includes original code provenance, licenses/NOTICE as required by dependencies, environment names only, reproducible install/run/seed/reset, actual checks, known limitations, raw recording references, concise description, and a recorded commit hash. I10 scans publishable files and I12 inspects frames. Only after the prepared artifact and applicable user authorization does the human publisher make the repo/demo accessible and the human submission owner submit to Cerebral Valley.
