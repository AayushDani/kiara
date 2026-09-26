# Kiara implementation verification

Verified locally on 26 September 2026. The application is implemented in `src/`; the retained architecture is engineering input, not a record of live execution.

## Hosted hackathon follow-up

The public deployment uses Atlas, isolated anonymous demo sessions, and durable Vercel Workflow jobs. All **74 tests** and the production build pass. A live two-visitor run verified role switching, ordered approvals, automatic reset after final approval, manual reset from either role, isolation, and stale-worker fencing. See [live check results](verification/public-demo-verification.json) and [deployment setup](vercel-deployment.md). The earlier local verification below is retained as historical evidence. Live model quality and real email delivery are still unverified and disabled for the public demo.

## Executed checks

| Check | Actual result |
| --- | --- |
| Runtime | Node **24.19.0**, exact requested version |
| TypeScript | Passed (`tsc --noEmit`) |
| Automated tests | **63 passed, 0 failed**, 11.77 seconds, Node 24.19.0 |
| Production build | Next **16.3.6**, compiled, typechecked, generated pages successfully |
| Independent review | Eight reproduced defects fixed and rechecked; 12 independent regression tests |
| Persistence verification | Passed: 29 runtime collections projected, retained source bytes/hashes checked, no scope errors |
| Readiness | Local persistence, scripted model, email preview, worker heartbeat present |
| Local production preview | `http://localhost:3000`, separate Node 24 worker |

The full test output is in [verification/node24-tests.txt](verification/node24-tests.txt). The tests execute isolated temporary stores; no live OpenAI, Atlas or Resend request was used as acceptance evidence. Provider adapters are exercised with injected responses, timeouts and errors. Six actual child processes test evaluation isolation and fail closed without provider credentials.

## Browser acceptance

Native Chrome and the in-app browser were used against the real running API and worker. Screenshots were inspected at the overview, review, source, and comparison views. A small in-app viewport also exercised the collapsed navigation. These were real application interactions, not seeded completed workflows:

1. Created **Taylor Morgan**, a synthetic California signup, with a synthetic postal address and a separately declared residence.
2. Observed the baseline harness omit its applicability bundle, fail readiness, retrieve the missing bundle, and retain that failure in the validation history.
3. Observed the immutable v2 policy proposal: **18 clauses, 13 changes**, complete original/proposed text, linked company facts and retained legal provisions.
4. Observed the deliberately seeded citation-offset mismatch and the bounded repair to the exact retained source span. Both original failures remained visible.
5. Opened retained `Civ. Code §1798.140(d)(1)-(4)` source text, official source link, effective/retrieval metadata and hash inspector. Effective dates now display the unshifted calendar date.
6. Confirmed the founder decision against packet prefix **79c36bbcd561**, switched simulated identity, then confirmed the lawyer decision against the same packet. Workflow `1550fb89-8633-4767-a992-045b0b2f5f5a` finalized internally. Both outbox messages reached **previewed**, with no real email sent.
7. Executed the frozen deterministic comparison in the app. The narrow prefetch change passed its gates and promoted **harness v2**. The UI labels this deterministic execution and excludes live-model quality claims.
8. Created a distinct later signup, **Alex Rivera**. It pinned **harness v2**, incurred **zero missing-bundle repairs**, and closed with no new change after checking the previously approved current policy. The first workflow retained its v1 pin and one missing-bundle repair.
9. Restarted the web process using the production build and restarted the separate worker. Persisted workflows, approvals, previews and harness promotion survived.

All founder/lawyer actions above use visibly simulated development identities. They do not demonstrate review by two actual people or authorize public policy publication.

## Corrections verified during review

- Old sessions cannot cross a reset epoch during asynchronous request parsing.
- Approval dialogs retain the exact viewed packet, role and version. Stale document edits reject before any record is appended.
- Verified facts preserve signup-specific context; model fact proposals retain model attribution and require founder verification.
- Human-resolved model runs can receive linked budget scopes only after prior charges settle; automatic repair cannot reset its budget or deadline.
- Provider transport ambiguity remains unknown delivery/unknown charge, preventing blind retry or unsafe reset.
- Early signed delivery webhooks reconcile against later provider acknowledgments.
- An unchanged event can reuse only a current, source-valid, sealed finalized packet.
- Scripted edits contradicting known practices fail validation; exhausted repairs escalate visibly.

See [independent-review.md](independent-review.md), [security-review.md](security-review.md), [runtime.md](runtime.md), and [persistence.md](persistence.md) for exact boundaries and test details.

## Unverified integrations and external handoff

- **MongoDB Atlas:** transaction/index/validator adapter implemented. No URI or organizer sandbox access was supplied; actual Atlas deployment, transaction behavior and eligibility remain unverified. Local JSON is an explicit development mode.
- **OpenAI:** Responses runtime, scoped tools, semantic validation, durable budget accounting and six-trial live evaluation campaign implemented. No API key was supplied; actual model availability, live generation quality, token pricing and live promotion performance remain unverified.
- **Resend:** bounded delivery adapter, idempotency, outbox leases, retries and signed webhook reconciliation implemented. Provider credentials, verified sender and approved real recipients were not supplied. Real sending also requires the explicit live-send flag.
- **Identity:** signed, CSRF-protected loopback demo sessions implemented. External deployment requires actual identity/tenant membership integration.
- **Optional evaluation choices:** exact scoped retrieval is used; vector retrieval and LangSmith export remain evaluated alternatives in the retained design. Arbitrary tool implementation self-mutation remains the original optional stretch.
- **Publication/submission:** no remote push, public website/policy, real email, video submission, or organizer eligibility claim was made. Original research and submission deliverables remain in `kiara-architecture/`.

`implementation-registry.json` preserves all 130 original requirements and distinguishes local verification, provider acceptance, retained design work and superseded instructions.
