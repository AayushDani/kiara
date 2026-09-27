# Read-only Atlas Search index observation — 2026-09-27

At 2026-09-27 16:54 UTC, an independent read-only MongoDB query used the existing local Atlas connection and explicitly selected database `kiara_v2`. It read collection metadata and `listSearchIndexes()` for `v2_search_chunks`. The command printed no connection string, credentials, tenant records, indexed text, or vectors. No Atlas write was performed by this observation.

| Item | Observed result |
| --- | --- |
| Database/collection | `kiara_v2.v2_search_chunks` exists |
| `kiara_keyword_v1` | `search`; top-level `READY` and `queryable: true`; all three returned status-detail rows `READY` and queryable |
| `kiara_vector_v1` | `vectorSearch`; top-level `READY` and `queryable: true`; all three returned status-detail rows `READY` and queryable |
| Definitions | Each live `latestDefinition` matched the code's `hybridIndexDefinitions()` under the repository's stable `digest()` canonicalization. Expected keyword definition hash: `914555ca944752980a97303e6e2bac51dc71355e1bc6f81642c5f86a75f0689c`; vector definition hash: `ea82e68c04e6389de60b52e15aab5527afef4c34e24d6aa3b9a65ac363788af7`. The index definitions are unchanged between the main checkout at `f1ec2cf` and release commit `da8593f`. |

The release branch `codex/kiara-live-release@da8593f` also passed [hosted CI run 36334586413](https://github.com/AayushDani/kiara/actions/runs/36334586413): dependency installation, Next type generation, TypeScript, 620 tests, and production build. That CI did not connect to Atlas.

This observation proves that the two configured index definitions were present and queryable at the stated instant. It does not prove tenant-scoped retrieval, vectors populated by a paid embedding request, index recovery after deletion/failover, encrypted-original restore, OIDC identity, managed Temporal replay, or provider delivery. Those require separate connected evidence and operator review.
