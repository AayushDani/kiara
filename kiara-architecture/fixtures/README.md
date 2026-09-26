# Synthetic fixture catalog

The root `*.ejson.json` files form one canonical, tenant-scoped **completed-state design trace**, using [id-map.json](id-map.json). Dates and original source bytes use Extended JSON representations of BSON. The fixture trace is not an exhaustive executable event replay and is not evidence that a model, reviewer, provider or database transaction ran.

The retained California source bytes and page excerpts are real research snapshots. DemoCo, customers, reviews, approvals, deliveries, learned outcomes and operational promises are synthetic. These fixture facts do not describe Rippit. Planned evaluation scores cannot authorize real promotion.

| Directory | Interpretation |
|---|---|
| Root EJSON | One valid example set for all 28 physical collections, including source bytes, complete policy, both validation faults, corrected proposal, sealed decisions, job/run/outbox and harness records |
| [legal](legal/) | Authoritative-source manifest, all legal boundary cases, criteria/provision/fact/clause map and operational followups |
| [documents](documents/) | Exact baseline/candidate/redline, legal map, bad/corrected citation, hashes and printable Markdown/HTML artifacts |
| [harness](harness/) | Before/after config, finite patch, frozen suite, parent/child budget examples and planned later-event proof |
| [canonical trace](canonical-trace.json) | Cross-record identity and stage index, separating synthetic state from unexecuted acceptance |

Independent request/response probes under `contracts/*/*examples.json` use their own synthetic identifiers unless explicitly marked canonical. Do not merge their records into the root EJSON dataset. At implementation time, seed with the [reset contract](../contracts/seed-reset-spec.json), validate actual BSON sizes/types on Atlas, and keep a monotonic tenant reset guard when deterministic UUIDs are reused.
