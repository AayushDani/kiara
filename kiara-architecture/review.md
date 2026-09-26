# Integrated review and validation

**Status: candidate awaiting the independent T16 final-pack audit.** Preliminary specialist reviews and the focused demo audit are recorded under [T16](research/T16/); they do not count as final integrated critique/revision/recheck cycles.

The unchanged brief requires at least one complete independent critique, owner-routed correction, reintegration and recheck, with at most three final cycles. This file will record findings against the frozen candidate and the actual disposition. It does not mark a missing check passed.

The architecture preserves all 130 stable requirements. No product scope has been removed; tool self-modification alone is the explicitly designated stretch. The five-hour implementation remains conditional: nominal eight-worker schedule T+285, three-worker T+395, 25% shared slowdown T+356.25. Real entitlement, latency and capacity require readiness checks before that clock starts.

## Validation evidence

Run `python3 scripts/validate-architecture.py` from this pack. The results distinguish JSON/schema/hash/reference checks, rendered-artifact inspection and specialist feasibility checks from unexecuted application acceptance. MongoDB BSON validators are translated for offline Ajv checks; this does not establish server installation or transaction correctness. Source extraction, deterministic redline/citation checks and SDK serialization probes use retained local artifacts without sending customer data or email.

The integrated record is [validation/results.json](validation/results.json). Every claimed pass must appear there or in a linked owner check with its limited scope. The [provenance manifest](research/T17/integrated-provenance.json) records selected source/output hashes; reference examples from separate namespaces are not mistaken for one execution trace.

## Remaining implementation acceptance

Install validators and indexes on the organizer-invited Atlas sandbox; round-trip BSON/EJSON and verify actual serialized sizes; exercise duplicate ingress, head/slot conflicts, approval-versus-fact/revocation races, lease restart and reset-generation races. Measure the full legal/semantic context and phase latency against runtime caps. Execute the exact two-fault workflow with founder then lawyer decisions. Send actual authorized review email and reconcile signed delivery callbacks. Run the frozen paired comparison, reject a harmful patch, promote only measured passing results, restart the worker, and record the distinct later event plus counterfactual. Check public repository/demo accessibility, working video audio and organizer logistics with the human owners.

These are preserved acceptance gates for the later implementation. An architecture-only handoff does not require building the full application, but cannot claim those behaviors were demonstrated by schema fixtures.
