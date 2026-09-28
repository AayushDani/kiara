# Atlas keyword and vector index operations

The v2 Atlas retrieval path uses two MongoDB Search indexes on `v2_search_chunks`. Their exact definitions come from `hybridIndexDefinitions()` in `src/v2/hybrid.ts`. Configured names alone do not establish that either index exists or can answer a query. MongoDB says `createSearchIndex()` may return before the index is ready; `listSearchIndexes()` supplies status and queryability. See [MongoDB Search index management](https://www.mongodb.com/docs/search/indexes/manage-indexes/) and the [index status fields](https://www.mongodb.com/docs/v8.0/reference/operator/aggregation/listsearchindexes/).

For the new v2 application, create a separate `kiara_v2` database on the selected Atlas deployment; leave the legacy demo database unchanged. Set `KIARA_V2_ATLAS_URI` to a TLS-enabled Atlas URI whose path is `/kiara_v2`, set `MONGODB_DB=kiara_v2` and `KIARA_V2_RELEASE_DB=kiara_v2`, and configure `KIARA_V2_RETRIEVAL_MODE=atlas` and the exact `KIARA_V2_ATLAS_SEARCH_INDEX` and `KIARA_V2_ATLAS_VECTOR_INDEX` names. The operator accepts Atlas SRV URIs or standard multi-host Atlas URIs with explicit `tls=true`. It rejects TLS opt-outs, ambiguous TLS options, non-Atlas hosts, a URI path naming another database, and simultaneous production and synthetic target settings. An isolated qualification database can instead use `KIARA_V2_RELEASE_SYNTHETIC_DB` with `synthetic`, `sandbox`, or `test` in its name. Use a credential with search-index listing rights for preview and verify; apply also needs index creation rights. Protect the URI as a secret. Output contains only its SHA-256 fingerprint.

Run from the release checkout:

```sh
node --import tsx scripts/v2-atlas-indexes.ts preview --database kiara_v2
node --import tsx scripts/v2-atlas-indexes.ts apply --database kiara_v2 --preview-hash EXACT_HASH_FROM_PREVIEW
node --import tsx scripts/v2-atlas-indexes.ts verify --database kiara_v2
```

Preview is read-only and prints the exact expected definitions, current definition/status/queryability for both named indexes, and a hash bound to the Atlas connection fingerprint, database, collection, definitions and current state. Apply re-reads that state, requires the same hash, creates only absent indexes, and never updates or drops an existing index. A wrong existing definition stops apply for manual inspection. If Atlas changes state between preview and apply, preview again. Apply may create one index and then fail on another; inspect and preview again before any retry.

Readiness requires **both** indexes to have the exact expected type and definition, status `READY`, `queryable: true`, and every reported shard status ready and queryable. `verify` is read-only and exits nonzero until this is true. Apply checks readiness immediately after creation and exits with code 2 when a build is pending; run verify later after Atlas finishes. A ready result establishes index readiness for the selected database only. It does not establish tenant data, ACL, embedding, retrieval, deletion, or connected-release qualification.

The current Atlas deployment was reached read-only. Its legacy database was left untouched; `kiara_v2` was empty and the exact two-index preview found both indexes absent. No live Atlas index mutation was performed. The CLI's standard-URI path has focused injected-adapter tests.
