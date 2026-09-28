# Test pilot matters · pending work

Status: synthetic examples, not observed customer matters or completed compliance.

## Matter 1 · candidate deletion request

Fictional candidate identifier `CAND-TEST-001` asks Test to delete a profile and applications in `PRIV-TEST-001`. The actual authored chronology has a **private** profile and one **unsubmitted application draft**; it records no employer copy. Goal: explain which records Test controls, what evidence would establish any employer copy, how to verify the request, applicable California rights and exceptions, downstream indexes/providers/backups, and what information the requester should receive. Inputs: `company-context.md`, `profile-visibility-history.md`, `job-and-application-record.md`, `privacy-request-case.md`, `retention-decision-register.md`, `vendor-data-inventory.md`, `candidate-privacy-notice.md`, `data-processing-addendum.md`, `privacy-operations.md`, retained CPPA source if reviewed. Output: source-linked issue list and a proposed response workflow. No deletion, employer contact, or response send is authorized. The candidate and request are invented.

## Matter 2 · NYC matching launch review

Test product proposes employer-facing candidate suggestions for NYC technology roles. The current authored candidate is private, and the sample employer has no executed order or provisioned recruiter seat, so this exact pair must not appear in an employer suggestion result. Goal: map proposed inputs and human use, assess whether the feature falls within the NYC AEDT law/rule, identify any audit and notice requirements, review EEOC disability/accommodation concerns, and draft questions for qualified counsel and product owner. Inputs: `company-context.md`, `job-and-application-record.md`, `profile-visibility-history.md`, `employer-order.md`, `match-evaluation-record.md`, `ai-matching-review.md`, NYC DCWP and EEOC sources if reviewed. Output: bounded assessment with unknowns and launch blockers. No launch or legal conclusion is authorized.

## First-session questions

- “For Test, what would happen if `CAND-TEST-001` asked us to delete their profile and application draft? Which parts of our draft process are still unresolved?”
- “Does Test Match need a NYC bias audit before we use it for employer candidate suggestions? What facts do you need before answering?”
- “Compare our draft candidate notice with the authored Test pilot flows. Where do they disagree or omit a decision?”
- “Could `REC-TEST-001` see `CAND-TEST-001` today, and what evidence supports the answer?”
- “Was `APP-TEST-001` sent to Harborline Systems, and what would we need to check before asserting any employer copy exists?”

Pass condition for this seed: Kiara references current Test sources, keeps unsigned drafts and official unreviewed legal sources distinct, states missing facts, and saves pending work without claiming it was completed. Human usefulness measurement and independent legal adjudication are separate release gates.
