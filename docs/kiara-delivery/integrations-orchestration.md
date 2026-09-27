# Configured integration and orchestration foundation

This path is implemented and tested with synthetic responses. No connected GitHub, Slack, Drive or managed Temporal service was exercised. No provider write, webhook registration, external message or paid inference was performed.

## Installation authority

`src/v2/integrations/config.ts` reads `KIARA_V2_INSTALLATIONS` or `KIARA_V2_INSTALLATIONS_FILE` (regular private file, no group/other access, <=256 KB). Each installation explicitly binds `id`, `provider`, `tenantId`, `actorId`, `enabled`, `resources`, `scope`, `tokenEnv`, and `webhookSecretEnv`. Credential values stay in environment or operator secret injection, never in workspace/snapshot/history. The integration actor must already have a current persisted `integration` membership; configuration cannot bootstrap authority. Revoking that membership rejects correctly signed deliveries and retained source reads. Each provider source pins its installation grant/configuration hash; removing, disabling or changing installation selection/scope immediately denies retained source and derived-record eligibility on every read, including retrieval and dispatch.

Provider-specific fields and resource selection:

| Provider | Identity fields | Resources | Intake |
|---|---|---|---|
| GitHub | `providerInstallationId` | Exact `owner/repository` strings | Raw-body HMAC-SHA256; signed installation/repository binding; bounded pull-request, push and deployment-status evidence. Merge/push never implies deployment. Body-derived replay identity also covers unsigned delivery-header changes. |
| Slack | `slackTeamId` | Exact channel IDs | Raw-body HMAC-SHA256 with five-minute timestamp bound; signed team/channel binding; message edits/deletions and stable event IDs. Signed URL verification is supported. No chat messages are sent. |
| Drive | `driveChannelId`, `driveResourceId`, `driveStartPageToken` | `file:<id>` or `folder:<id>` direct children | Channel token + exact channel/resource identity. Notification body is empty. Read authenticated changes, ingest selected resources, then CAS-save the cursor. Deletion/access removal revokes retained source eligibility. |

The config scope is authoritative; incoming payloads cannot choose tenant, actor, participant list or scope. Upstream credential renewal, installation provisioning and Drive watch creation are operator responsibilities. Full per-user upstream ACL synchronization, recursive folder traversal, binary parsing and initial corpus backfill are not implemented and must not be represented as complete connection coverage.

## Read and HTTP contracts

- `acceptWebhook(installationId, headers, rawBytes, optionalFetch)` in `src/v2/integrations/intake.ts` verifies and durably ingests before returning acceptance. Route owner supplies a bounded raw body. Authentication replaces session/CSRF only on this webhook path. Return Slack `challenge` when present; sanitize failures.
- `readGitHubPullRequest(installation, repo, number)` reads one current PR snapshot.
- `readSlackThread(installation, channel, threadTs)` reads at most five pages, fails visibly if incomplete, and never sends content.
- `readDriveFile(installation, fileId)` checks metadata/selection before content and rechecks revision after extraction. Native Docs export as text; plain text/Markdown/CSV are supported; other formats explicitly require a parser.
- `connectionAvailability(tenantId)` provides sanitized configuration status, not connected-service qualification.

All read adapters use fixed HTTPS provider origins, GET only, no redirects, a 15-second deadline and a two-MB response bound. Evidence intake has a 100,000-character bound. No provider response body or credential is included in an error. API session callers must additionally authorize the installation tenant and intended scope before invoking a reader; adapters are server-only components.

## Temporal foundation

`src/v2/orchestration/temporal.ts` exposes `dispatchOutbox(tenantId, optionalDispatcher, limit)`. Managed configuration requires `KIARA_TEMPORAL_ADDRESS`, `KIARA_TEMPORAL_NAMESPACE`, `KIARA_TEMPORAL_TASK_QUEUE` and `KIARA_TEMPORAL_API_KEY`. TLS is mandatory. Missing config raises `ORCHESTRATION_UNAVAILABLE` and leaves durable work pending.

`runManagedWorker(tenantIds, abortSignal)` runs separately from HTTP. `KIARA_V2_WORKER_TENANTS` explicitly selects tenants for the executable entry point. `KIARA_V2_ORCHESTRATION_MODE=temporal` selects managed ownership. Stable hashed tenant/aggregate workflow IDs and signal-with-start support replay. Arguments and signal/activity results contain record IDs and compact status/version/count metadata only. Outbox status changes after server acknowledgement; lost acknowledgement replays the same reference. Activities always reread current state. Duplicate/late signals do not replay old approval or effect instructions. Canceled matters with uncertain effects keep reconciliation pending. Legacy-owned records are never dispatched by v2. Workflows periodically recheck and continue-as-new to bound history. No activity grants approval, sends a message, publishes, signs, or claims provider completion.

This foundation observes durable matter state and keeps human gates pending. It does not replace a complete autonomous planner or make external actions operational. Conversation runs use a dedicated durable workflow; the activity invokes the platform reservation/lease processor by run ID and returns status only. Its lease recovery stops at blocked/unknown outcomes rather than retrying generation. The standalone `src/v2/orchestration/local-worker.ts` executes pending conversation runs and internal matter reconciliation with the same references; it requires no Temporal connection and refuses managed ownership. Local mode is not managed qualification. Neither runner dispatches external-action outbox entries.

## Local evidence

- `tests/v2-integrations.test.ts`: synthetic signature, tenant/installation/resource scope, replay conflict, provider bounds, Drive cursor failure/deletion and extraction race, outbox acknowledgement loss/cancellation, late-signal reconciliation, explicit missing configuration.
- Final focused integration + legacy replay: 31/31 pass in 10.5 seconds, including extraction race, installation grant removal and Slack deletion of retained thread snapshots.
- TypeScript: passes the integrated execution/retention scheduling snapshot (`evidence/retention-orchestration-typecheck.log`).
- Actual installed Temporal SDK `bundleWorkflowCode`: five workflows bundle successfully at 1,650,532 bytes (`evidence/temporal-retention-bundle.log`). This verifies bundling, not a server workflow run or replay history.
- Evidence: `evidence/integrations-regressions.log`, `evidence/integrations-typecheck.log`, `evidence/temporal-bundle.log`.

Primary API contracts checked against [GitHub webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [Slack verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Drive push notifications](https://developers.google.com/workspace/drive/api/guides/push), [Drive changes](https://developers.google.com/workspace/drive/api/guides/manage-changes), and installed Temporal 1.24 TypeScript definitions. These references support protocol implementation; they do not certify deployment configuration.

## Effect reconciliation extension

The explicit execution broker now atomically creates an `effect_reconcile` outbox only after the user confirms an exact execution preview. `processEffectReference` and the third Temporal workflow perform read-back of that recorded effect; they cannot approve or dispatch a new one. Pending known effects poll every five minutes, verified email every six hours for late bounce, and unknown receipt-less effects retain their owned unresolved state without provider calls or resend. Local processing filters deferred entries before its bounded batch to prevent starvation. See `execution.md` for the exact protocol, tests and connected-service limitations.

## Retention scheduling

A source deletion atomically adds `retention_cleanup` with tenant/job/outbox references. Both local processing and `kiaraRetentionWorkflow` invoke `processDeletionJob` and return only complete/waiting plus a bounded delay. Pending original retention uses its next due time, capped at24hours; failures, holds and unsettled effects retry after6hours. No source body, object key, actor credential or provider error enters Temporal history. The job completes only when application cleanup is complete; host/provider backup erasure stays explicitly unverified.

The local worker isolates each unavailable item, defers its retry and continues later accepted work. A missing original effect adapter cannot starve a later conversation or deletion. The combined execution/integration/retention/hybrid/normalized local replay passed75/75 in14.17seconds; managed services were not connected.

Abandoned upload intake also creates an `artifact_cleanup` outbox before original I/O. The fifth workflow checks exact tenant/intake/outbox identity, waits for its24-hour expiry, and invokes the operator-owned original cleanup processor. A missing reference after a possible object write stays pending for reconciliation; no absence is inferred. Source attachment hands cleanup ownership to the source retention path. Actual local encrypted orphan expiry and reference-only dispatch are covered by `tests/v2-retention-orchestration.test.ts`; the final focused extension passed62/62.
