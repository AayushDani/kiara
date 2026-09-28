# Test Match · synthetic design and evaluation worksheet

Status: design exercise, not a live model evaluation, validated metric, bias audit, or launch approval. Version: 1, 2026-09-28. The candidate and job below are invented.

## Proposed bounded flow

For candidate-facing role suggestions, the input could include skills and location/work preferences from `PROF-TEST-001` plus role criteria from `JOB-TEST-001`. For employer-facing candidate suggestions, candidate visibility must be `visible_to_verified_employers` **at query time**, and employer/recruiter entitlements must be verified. The sample candidate turned visibility off on 2026-09-20; therefore this candidate is **ineligible for employer-facing suggestions in the current authored state**. `EMP-TEST-001` has only an unsigned worksheet and `REC-TEST-001` has no provisioned seat, providing another independent access stop.

The hypothetical feature could embed job/profile text, retrieve candidates or roles, apply eligibility filters, and let a human recruiter choose whether to review/contact someone. It must retain source IDs and versions, filter before disclosure, and record what the human saw and did. No automatic reject/hire action is included. Exact model, provider, training, prompts, features, thresholds, and production implementation are **TBD**.

## Evaluation plan, not results

| Test | Required evidence before launch |
| --- | --- |
| Relevance | Labeled representative candidate/job pairs, agreed precision/ranking measure, blind reviewer disagreement and error analysis |
| Privacy and access | Private/visibility-off candidates absent from employer results; revoked seat blocked; stale vectors removed or filtered with an auditable delay bound |
| Job criteria | Human review of essential vs optional skills, location and compensation filtering, and misleading criteria |
| Fairness and accommodation | Counsel-scoped applicable groups, valid measurement design, disparate-outcome analysis, disability accommodation route, and remediation record |
| NYC applicability | Specific workflow and “substantially assists” analysis by qualified reviewer; if applicable, required audit/notice/publication artifacts before use |
| Operations | Complaint/contest path, rollback, drift monitoring, incident routing, owner and review date |

No sample score is presented as a measured result. `ai-matching-review.md` remains the launch gate and `legal-source-manifest.md` is only an unreviewed source queue.
