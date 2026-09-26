# Independent persistence and security review

Review scope: the persistence builder independently inspected HTTP routes, sessions/CSRF, workflow commands, approval sealing, fact correction, reset and notification dispatch. Findings were sent to the root integration owner; this reviewer did not edit engine/server code. This is a local application review, not a penetration test or a production-authentication certification.

## Findings and disposition

| Finding | Evidence / affected code | Resolution and recheck |
| --- | --- | --- |
| P1: changed source-original hash could be approved after prior validation | `src/workflow/engine.ts`, `seal` and `verifyGate`; initial security run changed one used provision's `source_hash` and the founder approval succeeded. The source-integrity regression test failed as expected. | Root bound source ID, original/chunk hashes, effective/retrieved times, evidence mappings and semantic attestation into the review seal and reruns proposal integrity at the gate. Regression now rejects approval and passes. |
| P1: stale founder-approved notification could dispatch for a new review bundle | `src/server/notifications.ts`, `dispatchNotification`; previous check accepted any non-null workflow bundle. | Root added an explicit notification bundle binding and cancels a mismatching bundle. Test performs founder approval, lawyer document feedback, revalidation and dispatch; old outbox is canceled. No email sent. |
| P1: malformed boolean facts could be marked known and satisfy applicability | `src/workflow/engine.ts`, `verifyFact`, and `src/workflow/legal.ts`, `assess`; a string value for `for_profit` previously passed through typed-fact expectations. | Root validates proposed value shape and makes invalid required fact types unresolved. Tests reject the verification and return `needs_information` for invalid input. |
| P2: harness mutations could miss the session reset epoch | HTTP handler read/authorization and later evaluate/rollback transaction were separate. | Routed to root/runtime; commands now receive the session epoch. Independent final acceptance should continue covering guarded adaptation commands. |
| P2: signup provenance referenced a different event ID | Workflow `event_id` and generated signup event previously used independent UUIDs. | Root makes the actual signup event use the pinned workflow event ID. Persistence tests confirm generated CA customer/context rows point to the event. |
| P2: lawyer identity mismatched canonical fixture | `src/data/fixtures.ts` exported an ID absent from the actor fixture. | Corrected to canonical actor `3a6ef3af-edf4-58c4-8123-03bbcbf09ad1`; fixture mapping test passes. |
| P2: design after-event facts leaked CA customer information into baseline | The reused design context contained a CA residence/count before a signup. | Persistence now derives NY baseline state with zero current CA customers and unknown processing start. Root explicitly supplies event-specific synthetic facts during signup. Baseline and CA projection tests pass. |

## Checks actually executed

Final command:

```sh
node --import tsx --test tests/persistence.test.ts tests/security.test.ts
```

Result: **20 passed, 0 failed**, 2.23 seconds in the final run. Tests ran against separate temporary local stores and made no provider requests.

Persistence coverage includes byte-identical reseed; no seeded completed approvals/evaluations; retained source hash/BSON-size checks; rollback on thrown/async callbacks; tenant and stale-CAS fences; immutable revisions; four separate processes executing 48 writes without lost updates; dead-owner lock recovery; CA customer/context/job records; unknown-charge reset blocking and monotonic epoch/state guard behavior.

HTTP/security coverage includes rejected extra client actor/role fields, malformed CSRF, cross-origin POST, tampered signed session, remote demo-host access and lawyer signup; rejected lawyer-first/stale-version/stale-bundle approvals; actual replay of the same approval command without another decision; changed source hash invalidation; stale outbox cancellation; malformed fact types and fail-closed applicability; and old sessions/commands rejected after reset.

The passing tests are not browser QA. A separate owner is exercising the rendered UI and integrated application. No real OpenAI request, Resend send/webhook delivery, Atlas connection, Atlas Sandbox eligibility or public deployment was exercised by this reviewer. Simulated identities are intentionally constrained to a loopback development server; an external authentication adapter remains required for deployment.

## Persistence handoff limits

The real MongoDB code uses a surviving tenant CAS in multi-document transactions, runtime-v2 validators, tenant/epoch indexes and separate physical records. It has not been executed against a live replica set in this environment. The runtime data contract differs from the frozen design fixtures; the schema reconciliation is described in `docs/persistence.md`, and the application does not claim the earlier validators were deployed. Local storage is explicitly a file-backed development adapter.

Server-side validator/index behavior, failover and cross-tenant preservation should be rechecked using an authorized isolated database when credentials are configured. No unknown/live provider evidence is discarded by the reset path; it blocks until reconciliation. No publication or real email was authorized or performed.

The final reset regression also verifies that a persisted `evaluation_campaign` blocks reset while running, while any reserved cost remains, or while charges are unknown. It releases the fence only after completion with zero reserved cost and no unknown charge. Final combined recheck after this addition: 20 passed, 0 failed (2.23 seconds).
