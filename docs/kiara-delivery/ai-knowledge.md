# Bounded conversation AI and authorized knowledge

Implemented against product-plan v2 §§3, 7, 8, 13 and 16. This is an operational adapter with injected-provider verification, not a live model-quality or jurisdiction-coverage qualification. No live OpenAI requests or paid probes were performed for this wave.

## Runtime and ownership

`KIARA_V2_AI_MODE=local` is the default and visibly identifies deterministic local assistance. `openai` uses the installed OpenAI SDK's Responses API. An unsupported mode, missing credential, missing authorized budget or invalid model configuration leaves the accepted message with an explicit blocked run; it never silently substitutes a local model answer. Consequential acknowledgements, corrections and ambiguous approvals remain deterministic service responses in either mode.

`message.send` atomically stores the human message, its explicit scenario artifact where applicable, a conversation-run receipt and `conversation_answer` outbox entry before the worker contacts a model. The command result includes `conversationId`, `userMessageId`, `runId`, `answerStatus` and `artifactIds`. The normal command idempotency key binds one message/run. `snapshot` exposes safe run statuses to the initiating actor, without attempts or raw provider responses.

Server-only worker entry points:

- `processConversationRun(tenantId, runId, {provider?})` returns a `ConversationRunView`; the optional injected provider is used by tests.
- `pendingConversationRuns(tenantId)` returns pending/running runs and durable interrupted-recovery references.
- The integration/orchestration module consumes only scoped record references. Provider prompts, responses and credentials stay outside Temporal histories.

The run pins the authenticated actor, membership version, original session expiry, conversation scope, model/review model, reasoning effort, pricing/configuration version, explicit budget and evidence references. Membership/session expiry and source/fact/scope changes are rechecked before counting, before provider dispatch and before response attachment. A run cannot bootstrap a membership or accept a browser-selected actor. Approval, fact confirmation, sharing and external actions remain exclusively typed service commands; the model has no tools or command execution path.

## Retrieval and grounding

`retrieval.ts` enumerates current authorized records, then performs deterministic exact/keyword ranking over source text and document revisions. It sends exact contiguous quotes with character offsets, document authority and stable evidence IDs. Confirmed reusable facts are separate from exploratory hypotheses; planned/live status is preserved. Provider observations retain observed/effective times and revisions and carry no inferred deployment or legal authority. Private or revoked evidence cannot enter an unauthorized caller's packet. Every source/fact dependency is retained on the generated response, so later access changes deny derived responses before index cleanup.

The agreement inventory explicitly enumerates all currently authorized executed agreement records in the workspace, bounded to 100 records. It does not assert that all customer agreements were uploaded, that they apply to the change, or that amendments outside the workspace were found. Ranked excerpts are not a completeness claim. No Atlas Search, vector search, embeddings or semantic retrieval is claimed to be deployed.

The generation request treats source text, user/history fields and hypotheses as untrusted data. It has no tools. Strict structured output separates grounded claims, hypotheses, questions and limitations. Deterministic validation rejects absent/invented citation IDs, unsupported output shapes and excessive content. A separate bounded review request checks every paragraph against supplied evidence and rejects unsupported claims. Only a completely successful result is attached to the original conversation. Support checking is explicitly not legal approval, independently measured model quality or a substitute for a qualified reviewer.

The implementation follows the official [token counting](https://developers.openai.com/api/docs/guides/token-counting) and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) interfaces. The runtime still validates incomplete responses and parsed data rather than assuming schema configuration proves an answer is complete or correct.

## Spending, crash recovery and receipts

The existing operator-wide spending ledger and `authorizedBudget()` policy are reused unchanged: every visitor, tenant and evaluation shares the configured ceiling, which may not exceed the existing $50 hard limit. This wave does not increase either ceiling. The queued run also freezes the configured amount; a changed amount or model configuration blocks dispatch rather than silently changing authorization.

Each stage counts the exact request, caps input at 50,000 tokens, reserves input plus the maximum output at existing conservative standard-tier prices, and records a durable attempt before dispatch. Generation is capped at 3,000 output tokens and support review at 1,800. SDK retries are disabled. There are at most two generation requests per run. Usage, provider response ID, request/response hashes and response text are retained in server-only receipts. Missing or inconsistent usage/model/response identity is an unknown charge. Count failures never dispatch generation.

A five-minute persisted run lease prevents concurrent invocation. A live duplicate returns its status. An expired run never resumes generation: prepared reservations settle to zero; dispatched requests become unknown pending explicit operator accounting. A durable recovery marker is written before ledger recovery and remains discoverable until recovery succeeds, including a crash between these steps. Outbox work remains eligible while recovery is pending. Unknown outcomes are never automatically retried or described as successful answers.

## Verification and limits

`tests/v2-ai.test.ts` injects provider requests entirely in process. Cases cover durable acceptance, restart/replay, concurrent workers, missing/invalid configuration, shared budget exhaustion, definitive provider rejection, unknown failure, revoked source/member during awaits, token-count-time revocation, malformed/unsupported citations, a rejected claim-support check, untrusted source instructions, hypothesis isolation, authorized inventory, and both prepared/dispatched recovery checkpoints. These tests verify boundaries and state transitions; they do not prove a real model will consistently resist prompt injection or interpret a legal clause correctly.

`tests/v2-platform.test.ts` also verifies superseded assertions remain readable as authorized history while new proposals require fresh facts and decisions. Business and legal review now have durable named tasks; unmet approval conditions cannot complete them.

Remaining qualification: connected OpenAI execution, calibrated legal/answer quality, adversarial model evaluation, managed Temporal operation, Atlas indexing and field encryption, complete external contract inventories, physical deletion/retention across all derived receipts, and production SLO/tenant-load testing. The current aggregate store remains a bounded transactional adapter; it is not the final normalized data plane. Operator restore merges current receipts to preserve attempts and prevent old backups from authorizing duplicate calls.
