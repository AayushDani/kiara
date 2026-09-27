# Declared subjects and evidenced relationships

Status: company-memory module is integrated with shared commands, snapshots, subject-scoped conversation and facts, retrieval, normalized storage and deletion. Ten focused module and integration tests pass. Browser acceptance and independent final review are pending.

The workspace's existing `entityId` remains the security boundary. A separately selected `subjectEntityId` identifies a declared company, product, data practice, vendor or counterparty. A graph edge never grants workspace, entity, matter or source access. Existing records with no explicit subject continue to refer to the workspace company.

`MemoryEntity` retains an exact ID, kind, name, aliases, named owner, scope and a declaration source. The source explicitly describes its contents as user-declared identifiers, not proof of legal existence, production deployment or authority. Identical names and aliases never automatically merge entities. The declaring fact owner and named owner must both have current access to the proposed audience under their membership restrictions.

`MemoryRelationship` starts as an attributed candidate. Its exact subject IDs, typed relationship, assertion, planned/live/unknown status, effective period and selected evidence are frozen. Evidence and all nested dependencies must have the exact same audience. Confirmation requires a fact owner, exact candidate version and dependency fingerprint. It produces a real `FactAssertion` with the subject ID and a relationship marker, so common fact and derived-evidence controls continue to apply. It cannot authorize publication, signing or legal clearance.

The relationship basis includes exact entity, source, fact and document hashes. A later document head, changed proof, withdrawn declaration or superseded fact prevents reuse. Current graph resolution uses explicit IDs, current confirmed assertions and permitted sources. Historical candidates and expired or planned relationships are never silently treated as current deployed practice. Withdrawal preserves attributed history and supersedes the produced fact. Archiving a non-root declaration withdraws its declaration source so dependent content follows the established source-access boundary.

Integrated controls:

- Store and snapshot collections with current access filters, normalized persistence and historical deletion erasure.
- `subjectEntityId` in conversation/fact creation, correction identity, template mappings and retrieval, while retaining the workspace security entity.
- Exact subject selection and inherited declaration-source lineage before model context, answer attachment and derived records.
- Per-record validity in source lineage, reserved `relationship.*` predicates and owner-current-access rechecks.
- Proposal review invalidation after confirmation, withdrawal or archive.

Focused tests cover declaration/candidate isolation, explicit planned confirmation, exact ID resolution, cross-tenant denial, role denial, nested private-evidence laundering, stale evidence, archive-driven access withdrawal, changed document heads, validity, conflicting relationship replacement, graph audience, inaccessible and revoked named owners, command dispatch, subject-scoped retrieval, normalized roundtrip and deletion. The latest local focused run passed 48/48 across company memory, drafting, migration and retention. The retained `evidence/company-memory-tests.log` is earlier pre-integration evidence and remains 7/7. No provider or customer data is used.
