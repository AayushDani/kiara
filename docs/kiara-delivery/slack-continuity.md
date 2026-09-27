# Scoped Slack conversation continuity

The configured path now accepts signed messages from an explicitly bound Slack user and thread, continues one durable conversation across Slack and web, and schedules an answer back to that exact thread. Ten injected integration checks exercise this path. No actual Slack message, connected workspace, paid inference or managed Temporal service was used.

## Operator grant

An existing Slack installation may opt in through `slackReplies`. This is server configuration, not a webhook or browser field:

```json
{
  "botUserId": "UAPPBOT",
  "validUntil": "2026-10-01T00:00:00Z",
  "readTokenEnv": "SLACK_THREAD_READ_TOKEN",
  "bindings": [{
    "channel": "CSELECTED",
    "threadTs": "1770000000.001",
    "conversationId": "existing-empty-conversation-id",
    "actorId": "provisioned-actor-id",
    "slackUserId": "USELECTED"
  }]
}
```

The installation must select the exact channel, already have an active integration membership, and use an exact audience shared by the conversation. The mapped actor must already hold membership. Channel and DM thread IDs are supported; a restricted team scope listing the mapped actor and integration actor can represent a selected DM audience. The binding is stamped only on an empty conversation, preventing preexisting private web history from being silently shared. Subsequent web messages stay in that conversation but do not themselves schedule Slack posts.

The grant pins installation configuration, mapped membership version, channel, thread and user. Removing or changing the grant, membership, selection, scope or expiry stops new processing. Credential names are retained in configuration; values never enter records or workflow histories. `readTokenEnv` is optional for installations requiring a separate credential for thread history. Provisioning, upstream channel audience management, required OAuth scopes and account connectivity remain operator responsibilities; the application does not certify provider ACL synchronization.

## Evidence and delivery

Local answers, model requests, history, scenarios, source/fact dependencies, agreement inventories and hybrid-search IDs must all match the destination audience. An actor's broader private access is insufficient. Answer creation stamps an exact source/fact/current-document-head hash; delivery rechecks it. Model answers additionally recheck their frozen evidence packet. Message edits, deletions and revoked installation evidence cannot authorize a previously queued answer. Bot messages are ignored to prevent reply loops.

The reply receipt and outbox are durable. Workers carry tenant/reply/outbox references only. Before one POST, the adapter verifies the configured bot identity and channel membership, then rechecks current authority in the dispatch transaction. It uses a fixed Slack endpoint, an exact thread, disabled broadcasts/unfurls/markup and opaque receipt metadata. The write credential is pinned through identity checking and dispatch.

A successful POST acknowledgement is insufficient. Verification requires readback with the exact metadata ID, bot, thread, timestamp when known, and content hash. A lost acknowledgement may reconcile through that readback. Readback scans up to five pages; repeated receipt metadata on later pages or a remaining cursor prevents a unique-delivery claim. Missing, contradictory or unavailable evidence remains uncertain; another worker or retry never repeats the post. Receipts retain IDs and hashes rather than duplicate answer text. Already delivered provider content is outside application erasure; this implementation does not claim remote deletion.

This grant permits conversational replies only. It cannot confirm company facts, approve a proposal, sign, publish or execute a matter action. Those retain their separate decision and execution gates.

Protocol references: [Slack message posting](https://docs.slack.dev/reference/methods/chat.postMessage/), [thread readback](https://docs.slack.dev/reference/methods/conversations.replies/) and [message metadata](https://docs.slack.dev/messaging/message-metadata/). They support implementation choices, not connected-service qualification.

## Local evidence

`tests/v2-slack-continuity.test.ts` covers signed identity, replay, bot loops, private evidence exclusion, web continuation, lost acknowledgement, no resend after uncertainty, configuration/member revocation during preparation, source changes, DM routing, concurrent workers, stale document heads, sanitized delivery status, later-page duplicate metadata and reference-only worker dispatch. `tests/v2-slack-knowledge.test.ts` independently tests model/retrieval audience boundaries. The combined Slack, legal-watch, integration, retention/index and attention worker run passed 43/43 in 4.60 seconds (`evidence/slack-legal-workers-tests.log`). All provider responses were injected.
