# Independent application acceptance review

Reviewer: independent implementation reviewer, 2026-09-26. This review inspects actual application code and executes isolated regressions; it is not another architecture review. Changes by the reviewer are confined to `tests/review.test.ts` and this report. Root and the runtime builder own corrections. The original brief, persistence/security handoffs, HTTP API, worker, workflow, runtime, validation, adaptation and notification implementations were read.

## Reproduced findings

| Priority | Finding and reproduction | Disposition |
| --- | --- | --- |
| P1 | `src/runtime/index.ts`, `executeModel`: human-edit validation rotated the existing ledger before testing unsettled attempts. An unknown semantic-check charge disappeared from active counters and a new token-count call started. Reproduce with the `unresolved model charges survive human-edit validation` regression. | Fixed by runtime owner. Existing unsettled attempts now stop provider activity and continue to block reset. Regression passed. |
| P2 | `src/workflow/engine.ts`, `verifyFact`: verifying synthetic revenue replaced each workflow's event-specific company snapshot with the NY baseline. The declared residence stayed CA, but physical state reverted to NY and CA processing/count facts were lost. Reproduce with `verified company facts preserve signup-specific provenance`. | Fixed by root with a shared signup-event overlay. Regression passed. |
| P1 | `src/runtime/index.ts`, model input fence: after a definite provider rejection, a verified company correction retained the old ledger input hash. All future draft attempts failed `MODEL_INPUT_CHANGED` before counting and could not recover. Reproduce with `changed input can start a new settled model ledger`. | Fixed by runtime owner. Settled input can rebind with recorded input history while retaining bounded accounting. Regression passed. |
| P1 | `src/validation/proposal.ts`, `semanticRuleChecks`: a human edit saying “We sell your personal information to advertisers.” passed despite the explicit false sale fact. The contradictory candidate reached a sealed founder queue. Reproduce with `scripted document edits cannot contradict an explicit no-sale fact`. | Fixed by runtime owner with a symmetric contradiction check. Regression passed. This remains a narrow deterministic rule, not proof of general natural-language semantic correctness. |
| P1 | `src/server/notifications.ts`, `dispatchNotification`: Resend 6.30.0 returns a null-status `application_error` when its fetch fails. Treating every returned SDK error as a definite rejection changed a potentially accepted send to `failed`, allowing blind retry and loss of its intent on reset. The installed SDK's actual behavior is exercised against a throwing transport stub. | Fixed by root. Null-status/ambiguous transport failures preserve `unknown_delivery`, block blind retry and fence reset. Regression passed; no real email/network request occurred. |
| P2 | `src/workflow/engine.ts`, `feedback`: a stale full-clause edit silently overwrote a newer immutable revision because only reset epoch was checked. | Fixed by root with mandatory expected candidate revision and state version. Regression verifies rejection before any revision, feedback, event or receipt mutation, followed by successful fresh edit. |
| P1 | `src/app/api/[...path]/route.ts`, `POST`: authentication read epoch 1, then awaited the body. A reset during body reading let a client-selected epoch 2 create a workflow using the old signed session. The regression forces exactly this interleaving and originally returned 201. | Fixed by root. Every applicable body epoch must equal the authenticated session epoch before reaching the transaction guard. Regression now returns 409 and leaves the new epoch empty. |
| P2 | `src/runtime/index.ts`, human-resolution selection: the new model-fact verification path retained a separate resolution receipt, while child-run authorization inspected only human feedback. A model-proposed fact verified after the settled parent's five-minute deadline could not redraft. | Fixed by runtime owner. The verified resolution receipt is checked for founder identity, hash, tenant/epoch/workflow, current fact/context and one-time use. Both the independent reproduction and actual-tool proposal regression passed. |

Additional owner-routed findings from code inspection:

- Model fact proposals now have a separate founder verification path. Executed checks reject lawyer verification, stale reset/context, malformed values and replay; preserve the original model receipt; retain a distinct human resolution; and restart affected contexts/reviews. The late-resolution integration edge was also fixed and rechecked.
- Redline rationale/citation rendering now uses `proposed.evidence_bindings` when available; the static fixture is the fallback. Code inspection confirms this correction.
- UX peer review found that the approval modal used the live-polled workflow at confirmation time. Code inspection now confirms an immutable `decisionTarget`, stale packet/session/role detection, disabled stale confirmation, and submission of the captured target. Root owns rendered browser verification.
- Explicit applied human edits and founder-verified model-fact resolutions now authorize linked child runs after settled parent deadlines. The runtime regressions executed in the combined suite preserve parent accounting, reject unknown charges and prevent automatic repair from rotating the budget.

## Executed checks

Final independent suite: **12 passed, 0 failed** within the combined run. All eight reproduced application findings above have owner fixes and passing executable regressions.

`npm test`: **63 passed, 0 failed**, 12.16 seconds, exit 0 in the final reviewer run. The suite includes actual local persistence, cross-process write concurrency, workflow/HTTP security, immutable approval gates, runtime adapter injection, actual child-process isolation with missing credentials, deterministic/isolated campaign execution, and UI presentation helpers. These are not browser checks. Earlier failures were reproduced and retained as regressions rather than removed.

`node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed, exit 0 alongside the final suite. Reviewer commands used Node v26.7.0; the root/runtime owners separately verify the frozen Node 24 runtime. Base Git commit was `c04edb889c8e694b2ce8b33c7a26eca820af8175`; application edits were uncommitted during review.

The independent suite additionally verifies:

- An authentically signed early Resend delivery event is persisted and deduplicated before the send response, then reconciled when its provider message ID arrives. Delivery never supplies lawyer approval, and retained live delivery receipts fence reset.
- A distinct later signup closes without a new redline only against a current, sealed, internally finalized packet with unchanged inputs. It does not fabricate approvals or rewrite the current policy.
- An unsupported compliance statement after the automatic repair limit reaches `needs_human_review`, preserves the failed candidate/validation record, and cannot finalize the policy.

All review tests use unique temporary local data directories and restore process configuration. Provider tests inject a model provider or stub `fetch`; no provider credentials, Atlas server, OpenAI generation, Resend email, external source fetch or publication were used. The running demo's `.kiara` state was not touched.

## Acceptance limits

Live Atlas transactions/validators/indexes/failover and organizer sandbox eligibility remain unverified without an authorized database. OpenAI generation and the six-run paired evaluation quality/cost remain unverified with the actual model. Resend provider delivery and real webhooks remain unverified; signed local webhook verification and SDK control flow are separate evidence. Root owns rendered browser QA and production build/startup evidence. Simulated localhost identities are not external authentication.

Source snapshots and fixture-backed legal checks validate the retained synthetic demonstration; this review does not certify legal advice, current real-world applicability or operational compliance. Arbitrary public source ingestion/reingestion and deployment authentication should not be described as implemented merely because a fixture or allowlisted source-recheck function exists.
