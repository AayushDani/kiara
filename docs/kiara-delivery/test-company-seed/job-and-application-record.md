# Test Jobs · sample role and application record

Status: authored synthetic pilot record; no listing was published, application submitted, or employer contacted. Record version: 1, 2026-09-28. All identifiers, organizations, and people below are invented.

## Role `JOB-TEST-001`

| Field | Sample value |
| --- | --- |
| Employer | `EMP-TEST-001`, Harborline Systems (fictional) |
| Hiring contact | Recruiter seat `REC-TEST-001`; no name or email attached |
| Title | Senior Data Platform Engineer |
| Work location | New York City, hybrid (three on-site days); US work authorization requested |
| Compensation shown in sample | USD 165,000–195,000 annual base; proposed text, not a validated posting disclosure |
| Essential criteria | Production Python and SQL; distributed data pipelines; on-call collaboration |
| Optional criteria | MongoDB and cloud search experience |
| Route | Apply inside Test Jobs; no external ATS endpoint configured |
| State | `draft_pending_moderation`; no public URL or publication timestamp |

The employer authored the criteria. Test's sample moderation checklist flags compensation, location, work authorization language, accessibility of the application route, and prohibited or discriminatory criteria for human review. It does not approve this posting or conclude that its text meets any jurisdiction's law.

## Application `APP-TEST-001`

Candidate `CAND-TEST-001` prepared a sample application for `JOB-TEST-001` on 2026-09-15T14:10:00Z. Its synthetic fields are profile ID, role ID, a one-paragraph skills summary (Python, SQL, batch pipelines), and attachment reference `RESUME-TEST-001` (a placeholder; no actual resume file). The status is `local_draft_not_submitted`. There is **no** delivery receipt, employer copy, hiring result, interview, or response. The candidate's current profile visibility choice does not by itself publish or send this draft application.

If the candidate later submits it, Test must record the explicit submit event, payload version, destination employer account, delivery result, and any downstream employer copy. The draft candidate notice and employer terms describe the proposed allocation; neither proves a real transfer. See `profile-visibility-history.md`, `employer-order.md`, and `privacy-request-case.md`.
