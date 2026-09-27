# Kiara v2 qualification status · 27 September 2026

This is the current evidence index for the v2 plan. The detailed requirement/owner map is in [product acceptance](product-acceptance.md); the object, transition, tool and authority contracts are in [platform contracts](platform-contracts.md) and the typed service code. The working UI and earlier screen renders are under `src/ui/v2/` and [renders](renders/). The [reference journey](reference-journey.md) is a partial synthetic control-path trace; it names exactly what one local tenant exercised and what stayed pending.

## Live-release integration delta

The isolated `codex/kiara-live-release` branch starts from `f1ec2cf`. It adds Mongo encrypted originals, Mongo OIDC identity binding, guarded Atlas legal-source indexing, a reviewed GovInfo preview/stage path, hosted preflight, and exact Resend recovery/readback repairs. The authoritative [v2 product plan](../product-plan/kiara-product-plan-v2.md) is included in this branch; the originating checkout and its preexisting unrelated files remain untouched.

- Node 24.19.0 assembled suite: **607/607 passed** ([log](evidence/live-release-tests-sep27.log)); `tsc --noEmit --incremental false` passed; Next 16.3.6 production build passed ([log](evidence/live-release-build-sep27.log)). These are local/injected-provider results.
- Isolated MongoDB 8.0.32 loopback replica-set integration: **5/5 passed**, including a 17 MB encrypted-original exact readback, client restart, duplicate intake, tenant denial, purge fence, normalized transactions and recovery checks. Its generated database was dropped ([log](evidence/live-release-mongo-sep27.log)). No remote tenant payload was read.
- The secret-free [hosted readiness preflight](evidence/live-release-readiness-sep27.json) reports `configurationReady: false` and `releaseQualified: false` for the available local environment. A metadata-only Atlas ping also failed from this shell; no connected Atlas Search, model embedding, GovInfo, Resend, Temporal or Vercel result is claimed.
- Independent cross-cutting review checked the GovInfo route, retrieval eligibility, Resend receipt ambiguity and attachments, TLS preflight, and A01–A16/J01–J10 claim boundaries. Its findings were repaired locally except the explicitly gated external steps below.

Production identity provisioning, legacy-original migration cutover, and private Vercel dashboard access were rejected by automatic approval review. The rejected actions would change tenant access, read/purge sensitive originals, and access a private deployment account respectively. No indirect route was used. [Hosted release operations](live-release-operations.md), [Mongo originals](mongo-originals.md), and [legal source operations](legal-reference-operations.md) give the exact operator gates and evidence limits.

## Previous `f1ec2cf` checkpoint evidence

- Node 24 assembled suite after the owned-action and reference-journey follow-up: **598/598 passed** in [the follow-up log](evidence/assembled-tests-j10-followup.log).
- TypeScript check and Next production build passed sequentially after the follow-up; see [build log](evidence/build-j10-followup.log).
- Independent code review of J04–J06, J09 timing and authority, plus an earlier custodial/security audit: [QA note](reviews/independent-custody-memory-task-audit.md). The J09 DST and notice-preview issues found by QA were repaired and rechecked.
- Local browser review used an isolated fictional workspace on `127.0.0.1:3091`, empty Mongo URI, local AI and disabled live email. J05's frozen clause review/history and J09's timing choice, UTC conversion, daylight-saving ambiguity and 320/390 px layouts were exercised. No notice or action was sent. These observations do not certify a real legal conclusion or a production provider.

## Northstar / RelayAI trace

| Steps | Local evidence | Limit |
|---|---|---|
| J01–J03 | Supplied current support record → cited answer → hypothetical scenario → deliberate adoption → one matter in `tests/v2-reference-journey.test.ts` | Expert answer usefulness and real customer context are still pending. |
| J04 | Signed PR and Slack event, exact named-owner link to the same matter, then separate engineering confirmation of planned flow and unconfirmed deployment | Vendor terms/location remain open; real installations need customer deployment. |
| J05 | Supplied-register attestation, selected confirmed facts, exact executed-clause offsets and structured notice assessment | Synthetic legal-role assessment is conditional; external agreement discovery and qualified legal review remain open. |
| J06 | Signed new-user Slack question, permission-scoped short answer, same-matter link and synthetic readback | Configured single-user thread, mapped identity and real Slack delivery need live validation. |
| J07–J08 | Frozen counsel packet, fictional intake/terms/share, returned successor proposal and renewed exact decisions | The one-tenant test does not inspect the named-counsel/material UI preview; separate browser review covers that control. No real conflicts check, engagement, fee charge or professional legal clearance was claimed. |
| J09 | Exact content, recipients and UTC timing are fingerprinted; a distinct publisher authorizes and owns a pending action task; future action rejects early completion | The reference notice remains pending. Separate execution tests verify local readback, preview, timeout and no blind resend. No external send occurred. |
| J10 | Attributed correction invalidates old work; later matter reuses a settled planned fact without reconfirmation. A separate retrieval issue undergoes frozen evaluation, shadow, third-person promotion, observed later ranking change and rollback with affected answer ID. | Wording feedback is not promoted. This bounded local ranking behavior does not establish generalized legal or model-quality learning; separate procedure tests cover affected-matter rollback. |

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

Live tenant identity provisioning and access mapping; configured Atlas Search/vector indexes and embeddings; managed Temporal and a persistent worker; connected Mongo encrypted-original and recovery drills; sandbox provider delivery/readback; GovInfo API compatibility and actual qualified legal-source/counsel review; customer-observed usefulness, comparable effort baselines and expert adjudication; and authorized legacy migration/cutover remain required. Local and injected-provider tests do not stand in for those results. No v2 deployment or live external effect was performed in this checkout.
