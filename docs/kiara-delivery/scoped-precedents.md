# Scoped negotiated precedents

Target: v2 §§7, 12, 14–16. Implementation: `src/v2/scoped-precedents.ts`, shared command/snapshot/storage/retention wiring, and `tests/v2-scoped-precedents.test.ts`.

An adopted precedent is an attributed historical clause and context, never a standing policy or present legal clearance. A proposal binds one origin matter/proposal, exact business and legal origin decisions, an executed agreement revision/content hash, an exact character-span quote, declared counterparty/product IDs, exact confirmed fact IDs/hashes, jurisdiction and transaction. Its visibility is the origin matter's exact audience. A similarly named entity does not match.

An executed agreement may arrive after the origin proposal was approved. The prior decisions therefore establish transaction history, not clearance of the final executed clause. A named legal reviewer separately reviews the frozen executed clause and context; then a business owner adopts that same current basis. Each command checks the exact record version and basis hash. The candidate remains unavailable for reuse until both decisions. A new matter must still obtain its own current business/legal decisions and action authorization.

Reuse is a suggestion only. A named owner first confirms a target context for one open matter with exact counterparty, jurisdiction, transaction, date, product IDs and every confirmed matter fact ID. The target freezes its matter, subjects, facts, source graph and owner membership. `matchingPrecedentsForMatter` verifies that target and the origin before returning a suggestion. Same-audience historical cards without that confirmation are explicitly unverified. The workspace snapshot exposes both the frozen target and verified per-matter matches; neither grants review or action authority.

A superseded executed revision remains historical context if its bytes and source access survive. Source revocation/deletion, owner revocation, changed proof, decision revocation and explicit withdrawal prevent reuse. Withdrawal retains attribution and history. Deletion redacts the quote and target context and retains only the minimum custody record.

The local tests exercise the state machine, exact target and origin authority, stale review, post-signature retrospective decisions, historical revision, source and owner revocation, withdrawal, shared command/snapshot, local and normalized persistence, and source deletion after target matching. Connected provider, qualified legal review and customer validation are not claimed by these synthetic checks.
