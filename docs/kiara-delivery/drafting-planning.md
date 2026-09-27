# Bounded drafting, plans and internal standing work

This implements product-plan-v2 §§3,5,9,12,13 as bounded, reviewable preparation. It uses the existing scoped conversation, retained records, provider run, spend ledger and execution broker. It does not establish general legal drafting quality or automatically infer that an agreement applies.

## Concrete behavior

A conversation selects an exact current document revision and content hash. An instruction such as “make it shorter” binds that document, includes its complete body (maximum 24,000 characters) independently of search rank, and queues a durable proposal run. A configured model returns title, proposed body, reported changes, questions, typed tasks and exact citation IDs. A separate support pass checks each output item. Unsupported citations, schema violations, stale bases, source/role/config changes, review rejection and budget limits stop attachment. Source content remains untrusted data and the model has no command or provider tools.

Generation changes no document, fact, approval or matter. The user accepts or rejects a proposal with its version and exact body hash. Acceptance creates an immutable successor of the selected unsigned draft. A signed/effective basis creates a separate proposed amendment and preserves the original. A changed selection or newer revision invalidates the old request. Acceptance also rechecks metadata-only evidence references and current lineage for all supplemental documents, sources and facts used by the generation. Successors invalidate dependent proposals and approvals while retaining already submitted uncertain effects for reconciliation.

“Prepare a work plan” creates an explicit proposed plan with factual, business and legal tasks. Acceptance creates one owned matter; model task text is not evidence of completion. Factual tasks require their named predicates to be current confirmed facts, so confirming an unrelated fact does not complete them. Work-plan tasks do not infer contractual deadlines or external authorization. This remains a bounded text plan, not an automatic multi-document legal strategy.

## Approved templates and standing scope

Uploaded classification as a template is not approval. A legal reviewer approves its exact revision/hash, purpose, explicit placeholder-to-predicate scalar mappings, expiry (at most 30 days), and optional internal standing use. Deterministic filling requires exactly one current confirmed company fact of the specified text, number or date type, with the same audience. Missing/ambiguous fields produce visible questions. Hypotheses and unconfirmed assertions cannot supply fields. Semantic rewrites never inherit standing eligibility.

After accepting an eligible unchanged template draft, `draft.prepare_internal` creates a matter and exact proposal with `route: standing_policy`. The current policy, reviewer membership version, expiry, facts, template, accepted document, audience and literal substituted body are rechecked. This route permits only `internal_document`, with no recipients or destination. Business review and exact publisher authorization remain mandatory. Final broker dispatch repeats the standing guard after asynchronous preparation; policy expiry or revocation stops dispatch. Edited proposals and returned counsel edits move back to legal review. The route never signs, sends, shares, publishes or declares legal applicability.

## Shared commands and views

- `conversation.select_document`: conversation ID/version, revision ID and content hash.
- `template.approve` / `template.revoke`: exact controlled template policy with scalar field mappings and expiry.
- `message.send`: the existing conversation message admission; instructions may produce a linked draft proposal or durable model run.
- `draft.accept` / `draft.reject`: exact proposal version; acceptance also binds content hash.
- `draft.prepare_internal`: accepted proposal version/hash, current standing eligibility, no previously linked work.

Snapshot `drafts` and `templateApprovals` expose only readable records with current-eligibility flags. `Conversation.activeDocumentId` identifies the selected basis. Deletion removes derived draft/template payloads and invalidates eligibility. Run receipts retain cost/identity accounting while deleting prompt and output payloads.

## Qualification and limits

`tests/v2-drafting.test.ts` exercises 16 local/injected-provider cases: missing/unconfirmed fields, malformed mapping, fact/policy changes, exact selected rewrite, original preservation, restart/replay, unsupported citations, source revocation while awaiting inference, typed plan tasks, internal-only standing scope, real local encrypted broker output, expiry during broker preparation, deletion, calendar-date validation, stale supplemental evidence and budget exhaustion. The final focused drafting run passed **16/16** (`evidence/drafting-tests.log`). The preceding combined drafting, conversation AI, platform and Slack-knowledge run passed **62/62**, recorded in `evidence/drafting-platform-tests.log`. No live model, paid probe, email or signing call was made.

These checks qualify state transitions, scope, exactness and spending behavior. Mocked text and a model support pass do not certify legal correctness, semantic preservation, professional qualifications, document suitability or deployed provider quality. Intent routing remains bounded lexical recognition. Local mode performs deterministic approved-template filling and explicitly reports semantic rewriting/planning unavailable. Explicit current-draft selection is required; automatic template discovery, multi-document strategy and broader strategy evaluation remain separate work.
