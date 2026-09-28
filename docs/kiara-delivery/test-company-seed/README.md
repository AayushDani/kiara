# Test company seed · tech hiring marketplace

Seed status: authored test material, dated 2026-09-28. `Test` is a fictional pilot company modeled on the *type of business* operated by Dice, not Dice Inc. or DHI Group. Nothing in this pack is a record, policy, customer agreement, candidate record, legal opinion, or operational claim of Dice. Do not use Dice names, logos, metrics, accounts, or customer data in the Test tenant.

## Public basis

- Dice describes a technology-focused job marketplace with profiles, job matching, and employer recruiting tools: https://www.dice.com/why-join-dice and https://www.dice.com/hiring/solutions.
- Dice's public privacy policy shows why a marketplace must distinguish candidate profiles, employer access, applications, matching, and privacy choices: https://www.dice.com/about/privacy-policy. It is **not** Test's policy.

## Test operating model

Test operates a US technology hiring marketplace **inside the pilot scenario**. Candidates create profiles, select profile visibility, search and apply for jobs. Employer customers buy access to post roles, search eligible profiles, and message candidates. Recruiters verify employers and moderate listings. A matching feature ranks jobs for candidates and suggests profiles to recruiters; it does not make hiring decisions. The initial business footprint is US only, with California candidates and New York City jobs included to exercise jurisdictional routing. The Test product, customers, candidates, events, vendors, and practices are fictional. The pack contains no real candidate PII or real employer contract.

## Intake order and authority

1. Set workspace name `Test`; declare Test as the workspace company. Add company facts from `company-context.md` only with an explicit synthetic-pilot description. Product and data-flow relationships may be created as attributed pilot declarations.
2. Retain the authored files in this directory as separate `draft` or `synthetic_example` documents, preserving their per-file status. Policy and contract text is **unsigned, unpublished, and unapproved**; example events are **authored scenarios**, not observed operations. Do not mark any file `executed`, `effective`, `delivered`, or legally approved. Preserve exact source text and hash on readback.
3. Register the official references in `legal-source-manifest.md` with their original URLs and publication/verification metadata where available. A qualified legal reviewer must verify the retained source, applicability, scope, and coverage before Kiara treats them as reviewed legal guidance. An official URL alone is not approval.
4. Open the two pending matters in `pilot-matters.md` as work to assess, not completed compliance or a permission to contact anyone. Use the linked job, candidate, employer, request, model, and access records as synthetic context. All IDs are invented; no external delivery occurred.
5. Verify in the hosted Test workspace that company name, facts, documents, legal-source state, and matters survive a fresh sign-in and that a company-specific question cites the appropriate retained source. Record whether the answer is useful to a human participant separately; a synthetic response is not customer validation.

## Corpus map

| File | Product role | Intake authority |
| --- | --- | --- |
| `company-context.md` | business and process map | draft/internal assertion |
| `candidate-privacy-notice.md` | candidate-facing notice proposal | draft/unpublished |
| `candidate-terms.md` | candidate terms proposal | draft/unpublished |
| `employer-terms.md` | employer order/terms proposal | draft/unsigned |
| `data-processing-addendum.md` | employer processing allocation proposal | draft/unsigned |
| `ai-matching-review.md` | AI feature launch and human-review gate | draft/internal proposal |
| `privacy-operations.md` | rights, retention, and incident workflow | draft/internal proposal |
| `job-and-application-record.md` | `JOB-TEST-001` and unsubmitted `APP-TEST-001` | authored synthetic example |
| `profile-visibility-history.md` | `CAND-TEST-001` / `PROF-TEST-001` choice chronology | authored synthetic example |
| `employer-order.md` | `EMP-TEST-001` / `REC-TEST-001` unsigned worksheet | authored synthetic example |
| `vendor-data-inventory.md` | proposed logical stores and vendor proof gaps | draft/internal inventory |
| `retention-decision-register.md` | record-by-record unresolved retention decisions | draft/internal worksheet |
| `privacy-request-case.md` | `PRIV-TEST-001` pending deletion exercise | authored synthetic example |
| `match-evaluation-record.md` | current eligibility and evaluation plan | draft/internal worksheet |
| `access-incident-case.md` | `ALERT-TEST-001` access tabletop | authored synthetic example |

The shared chronology is: profile private (September 10), visibility on (September 12), application draft saved (September 15), visibility off (September 20), deletion request scenario (September 22), and access alert tabletop (September 23). The application was never submitted, the employer order never signed, and no recruiter seat was provisioned. These are useful working documents, not legal signoff or proof of live operations. Unresolved choices are explicit in each file.
