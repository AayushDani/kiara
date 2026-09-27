# Kiara v2 qualification status · 27 September 2026

This is the current evidence index for the v2 plan. The detailed requirement/owner map is in [product acceptance](product-acceptance.md); the object, transition, tool and authority contracts are in [platform contracts](platform-contracts.md) and the typed service code. The working UI and earlier screen renders are under `src/ui/v2/` and [renders](renders/). The [reference journey](reference-journey.md) is a partial synthetic control-path trace; it names exactly what one local tenant exercised and what stayed pending.

## Verified checkout evidence

- Node 24 assembled suite: **597/597 passed** in [the final log](evidence/assembled-tests-final-sep27.log).
- TypeScript check and Next production build passed; see [build log](evidence/build-final-sep27.log).
- Independent code review of J04–J06, J09 timing and authority, plus an earlier custodial/security audit: [QA note](reviews/independent-custody-memory-task-audit.md). The J09 DST and notice-preview issues found by QA were repaired and rechecked.
- Local browser review used an isolated fictional workspace on `127.0.0.1:3091`, empty Mongo URI, local AI and disabled live email. J05's frozen clause review/history and J09's timing choice, UTC conversion, daylight-saving ambiguity and 320/390 px layouts were exercised. No notice or action was sent. These observations do not certify a real legal conclusion or a production provider.

## Northstar / RelayAI trace

| Steps | Local evidence | Limit |
|---|---|---|
| J01–J03 | Question → hypothetical scenario → deliberate adoption → one matter in `tests/v2-reference-journey.test.ts` | The first answer has no current company records to cite. The J01 sourced-context condition and expert usefulness are still pending. |
| J04 | Signed PR and Slack event, deduplicated source revisions, exact named-owner link to the same matter and inline updates | Separate engineering confirmation of planned versus actual deployment and vendor terms/location is not in this trace. Real installations need customer deployment. |
| J05 | Supplied-register attestation, selected confirmed facts, exact executed-clause offsets and structured notice assessment | Synthetic legal-role assessment is conditional; external agreement discovery and qualified legal review remain open. |
| J06 | Signed new-user Slack question, permission-scoped short answer, same-matter link and synthetic readback | Configured single-user thread, mapped identity and real Slack delivery need live validation. |
| J07–J08 | Frozen counsel packet, fictional intake/terms/share, returned successor proposal and renewed exact decisions | The one-tenant test does not inspect the named-counsel/material UI preview; separate browser review covers that control. No real conflicts check, engagement, fee charge or professional legal clearance was claimed. |
| J09 | Exact content, recipients and UTC timing are fingerprinted; future action rejects early completion | The reference notice remains pending and this trace does not exercise distinct publisher authorization or an owned unresolved task. Separate execution tests verify local readback, preview, timeout and no blind resend. No external send occurred. |
| J10 | Attributed correction invalidates old work; feedback is retained; later matter reuses the current planned fact | The one-tenant trace does not promote or roll back a lesson. Separate deterministic procedure and strategy evaluation/promotion/rollback tests are in `tests/v2-learning-coverage.test.ts` and `tests/v2-strategies.test.ts`; generalized legal or model-quality learning is not established. |

## Section 16 acceptance coverage

| Criteria | Automated or observed evidence | Qualification limit |
|---|---|---|
| A01–A02 | Bounded sourced explanation and scenario isolation: platform, conversation and scenario tests | Expert answer usefulness and legal quality require human review. |
| A03–A05 | Narrow ambiguous-assent clarification; attributed correction candidate; same-user short-answer preference: natural-language, answer-preference and strategy tests | Broader intent and phrasing benchmark remains customer/domain work. |
| A06–A07 | First-session local question/document paths; signed event linkage during conversation and duplicate replay: platform, integrations and reference journey | First accepted useful-output timing needs customer receipts; live integrations need deployment. |
| A08–A10 | Restricted-source lineage and access regressions; stale coverage state; no-counsel exportable pending packet: scope, retrieval, coverage and counsel suites | Live legal-source coverage and counsel availability remain unqualified. |
| A11–A14 | Versioned counsel revision, planned-versus-live source, immutable signed original/amendment, provider timeout/reconciliation: counsel, source, document and execution suites | Provider acceptance and delivered outcome need real configured readback. |
| A15–A16 | Evaluated procedure rollback adds affected-work review; voice interpretation freezes corrected names/dates before consequential commands: learning and voice suites | Speech recognition quality and independent legal outcome assessment need external testing. |

Quality measurement now separates attributed correction minutes from total effort and counts repeated feedback only with a reviewer-chosen issue key on distinct outputs in the same audience. See [quality measurement](quality-measurement.md). These are reports, not adjudicated error rates or customer savings.

## Remaining release qualification

Live tenant identity and access mapping; configured Atlas Search, managed Temporal, encrypted original storage and provider delivery; actual counsel/conflicts and maintained legal-source review; customer-observed usefulness, comparable effort baselines and expert adjudication; and operational migration/recovery drills with production credentials remain required. Local and injected-provider tests do not stand in for those results. No deployment or live external effect was performed in this checkout.
