# Shared-original retention deadline repair · 2026-09-27

An independent review found two ways to delete content-addressed original bytes before all owners' retention deadlines:

1. When two deleted sources had the same original and different `notBefore` dates, `originalHeldElsewhere` ignored the second deletion job. The first worker could physically purge the shared object while the second delay was still open.
2. An expired attached intake could run its orphan sweep after its source was deleted. The sweep ignored the source's pending deletion job and could purge the same object before the source retention delay.

Both regressions were reproduced with the original code: the focused retention suite passed 10 tests and failed the two new safety cases. The repair checks other pending deletion jobs' deadlines and operational exceptions, makes the intake sweep yield to any pending same-content deletion job, and records the worker's purge claim in the same workspace transaction as its final holder/deadline check. A concurrent workspace mutation conflicts with that claim; new same-content intake remains fenced by the deletion job. A crashed `purging` claim can be retried; physical purge remains exact and idempotent.

After the repair, `node --import tsx --test tests/v2-retention.test.ts` passed **13/13**, including later-deadline hold, eventual purge after both deadlines, attached-intake hold, and observation of the committed `purging` status before physical adapter invocation. `tsc --noEmit --incremental false` passed, and `npm test` passed **631/631**. These are local/injected adapter results; managed backup expiry, production S3/KMS and a connected multi-writer timing drill still require separate evidence.

The generated [Atlas cutover/reconciliation rerun](shared-original-retention-atlas-sep27.log) completed with exit code 0 after this worker change. It verified alias/native/effect/intake holds, transactional target deletion, two completed retention jobs, and the generated database drop with `cleanupVerified: true`. That connected run did not create two independently timed deletion jobs or race separate workers; those specific invariants remain supported by local tests only.

A subsequent [connected two-owner drill](shared-original-multiowner-atlas-sep27.md) did stage two native deletion jobs with different deadlines and an expired attached intake in a generated Atlas database. It observed the hold, eventual deletion and database cleanup. It still did not race simultaneous workers.
