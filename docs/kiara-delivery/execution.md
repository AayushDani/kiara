# Restricted execution and read-back

27 September 2026. This is a working local implementation with injected protocol tests. No email was sent, no customer publication was changed, and no connected provider or hosted recovery was qualified.

## Exact intent and admission

`src/v2/execution/broker.ts` exports `executionPreview(actor, actionId)`, `dispatchAction(actor, actionId, {expectedVersion, contentHash, previewHash})`, and `reconcileAction(actor, actionId, {expectedVersion, contentHash, providerReceipt?})`. The authenticated HTTP route is `/api/v2/actions/[id]/execution`: GET returns the configured preview; POST accepts `operation: dispatch | reconcile` and only the listed fields. Adapter injection is a server/test seam, never an HTTP option.

The preview shows mode, sender when applicable, exact recipients/destination, title and content. Its hash binds the actor, current membership version, action version/hash and configured adapter identity. A sender, mode, account credential reference or recipient configuration change requires a new preview. Secret values never enter the preview or durable effect intent.

Admission and the transaction immediately before dispatch check current membership and record scope, exact proposal/action bytes, source/fact/document versions, current business/legal/action decisions and their authorizer versions, applicable promoted procedure requirements, and current legal/contractual deadline review. The dispatcher's membership version must still match the explicit preview decision after asynchronous preparation. Canceled, closed and legacy-owned work cannot begin a new effect.

## Durable lifecycle

The workspace atomically records a prepared effect intent and 60-second lease before dispatch. It retains exact action bytes, proposal/dependency hashes, authorizing decision, execution decision, adapter configuration hash and a stable provider idempotency key. Preparation is bounded at 15 seconds; dispatch and read-back also have deadlines. The final transaction records `dispatched` before the external call.

Replays return the existing intent. An expired prepared checkpoint can fail without a provider call; an interrupted dispatched call remains uncertain. A timeout never authorizes resending. Cancellation stops future dispatch but retains in-flight intent and permits read-back of its outcome. A retained provider identity may not be replaced. An operator-supplied email receipt is accepted only when provider read-back matches the exact effect tags and payload.

The claim transaction also records an `effect_reconcile` outbox entry bound to that immutable intent. Local and managed Temporal workers receive only tenant/action/outbox references and perform read-back only. Known pending outcomes are checked every five minutes; delivered email is checked every six hours for later bounce or complaint while its record remains active. Unknown effects without a receipt remain owned, with six-hour local state checks and no provider request or resend. Internal completion, preview/manual routing and terminal failures stop their effect workflow. Local scheduling filters deferred work before its batch limit so long-lived effects cannot starve a later accepted conversation. Temporal continues its workflow as new after 100 checks; failures expose static codes rather than private action contents.

Acceptance is not completion. Read-back must verify the action-specific outcome. Preview stays pending manual; a signing-request receipt cannot establish an executed original. A late bounce/complaint or contradictory payload changes the action to failed and opens an owned corrective task, reopening a previously closed matter. Earlier proof remains historical. Concurrent older success cannot overwrite a recorded terminal failure. A canceled matter remains canceled. Attributed manual completion is preserved.

## Available adapters

* Internal document: retain encrypted original UTF-8 bytes, read them back exactly, then create one immutable draft Source and proposed DocumentRecord. Completion does not imply signature, filing or publication.
* Configured Resend email: POST the exact sender, recipients, subject and body to the fixed provider endpoint, using the stable idempotency key and effect/content tags. GET read-back requires exact payload identity and delivered/opened/clicked status. Sent/queued stays pending; bounce/failure/complaint is failed. Credential and exact recipient allowlist are required before effect admission.
* Email preview: compute the exact payload locally, perform no network operation, and retain an explicit `PREVIEW_NOT_DELIVERY` state for the manual path.
* Publication read-back: GET only from the exact configured HTTPS destination, without redirects. Compare exact bytes and retain encrypted proof. This adapter verifies an existing publication; it does not publish content.

Signature providers, arbitrary product changes and no-action effects have no configured automatic adapter. Existing authorized manual decisions and evidence remain available.

Server-owned `KIARA_V2_EXECUTION` is a JSON array, for example:

```json
[{"tenantId":"example","email":{"mode":"preview","from":"legal@example.test","allowedRecipients":["recipient@example.test"]},"publicationUrls":["https://example.test/notice"]}]
```

For live email, an operator must explicitly configure `mode: resend` and `tokenEnv` naming the installed provider credential. Never put the credential value in this JSON. Configuration is not an invitation to send test messages. The delivery agent ran only injected tests with external fetch denied by default.

## Qualification

`tests/v2-execution.test.ts` covers exact encrypted internal output and replay, role/approval/title guards, concurrent admission, revocation and cancellation races, preview/configuration changes, dispatcher authority changes, deadline review, prepared checkpoints, known rejection, unknown delivery without resend, wrong receipt identity, exact delivery read-back, late bounce after closure, concurrent read-back ordering, manual completion, publication bytes and signing receipt boundaries. Results are retained in `evidence/execution-tests.log`; this test suite is not connected delivery evidence.

Remaining operational qualification includes real provider payload/read-back compatibility, installed account ownership, signed provider event intake, provider retention windows, Temporal/host restart and kill-point tests, and deployment/restore. The ongoing read-back schedule is implemented and tested with injected adapters; no provider or managed Temporal server was connected. An acknowledgment lost after dispatch requires matching read-back identity or operator reconciliation; it is not automatically retried. General retryable corrective replacement actions and publication write adapters remain separate work. Deletion now redacts effect payloads through the shared retention policy, with explicit unresolved-effect exceptions and retained original manifests; connected provider/database backup erasure remains unqualified.

## Effect receipt deletion

`redactEffectReceipts(state, affectedRecordIds)` runs synchronously in the deletion transaction and returns explicit action IDs whose exact payload must remain private for operational reconciliation. A prepared effect fails before dispatch and loses its payload. Dispatched, verifying and uncertain effects keep protected comparison bytes until a known terminal outcome; deletion cannot assert that an accepted message was unsent. At terminal settlement, the broker scrubs snapshot title/body/recipients/destination, sender and artifact payload, retaining effect identity, hashes, provider identity, actor, timestamps and outcome. Deleted provider records are no longer polled. In-flight callbacks check the durable redaction marker and cannot restore payload. An internal output settling after deletion does not create new derivative document text.

Before scrubbing, validated original manifests from internal receipts and publication read-back artifacts are retained separately for the deletion worker. The workspace deletion worker remains responsible for removing previously excepted live Action payloads and purging these exact original versions after retention or operational holds permit. Tests cover prepare/resume, unknown-to-settled deletion, delayed callback rejection and both encrypted original paths. The combined execution/document/recovery run passed33/33 in9.94seconds, and typecheck exited0 (`evidence/execution-retention-tests.log`, `evidence/execution-retention-typecheck.log`). These are local encrypted artifacts and injected providers.
