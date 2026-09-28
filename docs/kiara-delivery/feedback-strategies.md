# Classified feedback and bounded strategy adoption

This wave implements the v2 feedback/learning loop for two finite executable behaviors. It does not claim general self-improvement, legal correctness, or evaluation on real customer outcomes.

Feedback is an attributed record bound to an exact assistant answer, proposed draft, or matter proposal. Categories distinguish retrieval misses, drafting fidelity, wording preference, business preference, factual correction, legal judgment, and scope clarification. Recording feedback changes no facts, approvals, or effects. Legal and business feedback require their named capacities. Only a replayable retrieval miss or actual rewrite fidelity issue can propose a catalog strategy.

The catalog contains:

- Exact clause reference ranking: an explicit requested clause heading gets a bounded score increase within already authorized local keyword results. It does not change Atlas reciprocal rank fusion, expand permissions, or infer legal applicability.
- Material value preservation: recognized meaning-preserving rewrite requests retain the original literal numeric/date tokens, including percent units. Explicit substantive-change requests remain proposed changes. Number words, obligation meaning, and all other material terms are outside this finite guard; independent support checks and human review remain necessary.

The independently initiated evaluation runs actual baseline and candidate functions over the retained original issue and a versioned frozen synthetic corpus. Manual passing labels cannot qualify a candidate. The original must improve and the candidate must have zero frozen regressions. This measures only catalog behavior. Retrieval replay and shadow use a bounded same-audience document set; production retrieval may contain additional authorized records.

All UI actors, including the evaluator, receive original/near-miss details and aggregate holdout results only. Holdout row names, expected labels and output identifiers remain in server-only receipts. Type-only UI imports do not ship the corpus. Repository operators can inspect the checked-in synthetic corpus; this boundary is not protection from a developer with filesystem access.

Candidate author, evaluator, and adoption owner must be three different identities. A business owner controls ranking adoption; a legal reviewer controls the rewrite preservation guard. The current evaluator/owner membership version, role, source/fact lineage, originating conversation or matter, exact scope, and expiry remain necessary. A shadow phase records real submitted questions or generated rewrites without changing behavior. Adoption binds the inspected evaluation and shadow hashes. Shadow comparisons retain exact current source/fact/document references; revocation or a new document head invalidates comparison eligibility, stale adoption, and an already promoted policy.

Provider runs freeze current policy identity. Changes or expiry before dispatch or attachment block the old run. Applied user/run references are retained for rollback inspection, including draft runs later blocked by the guard. Rollback increments the rule version and removes the behavior; it does not erase history or reverse external effects.

Verification uses isolated local workspaces and injected providers only. Tests exercise actual local answer ranking and model evidence ordering, unchanged hybrid supplied ordering, actual numeric omission blocking, holdout projection, three-person separation, no-effect shadow, stale shadow hash, shadow-only revoked evidence, container access loss, private fact lineage, expiry during provider counting, and rollback. No paid evaluation or live provider call was made.
